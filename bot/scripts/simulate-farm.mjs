/**
 * simulate-farm — 농장 레벨 속도와 체력 · 골드 흐름 시뮬레이션
 *
 *   node scripts/simulate-farm.mjs [일수=60] [판수=20]
 *
 * **서버의 진짜 규칙**(`server/src/farm/rules.js`)으로 하루씩 돌린다. 레벨 속도 목표는
 * "매일 성실히 하면 6~8주에 Lv10"(docs/FARM.md §8.2). 물은 한 포기에 체력 1이라 체력이
 * 성장의 천장이 된다 — 그게 얼마나 누르는지를 보려는 것이 이 스크립트의 주된 목적이다.
 *
 * 플레이어 넷을 견준다. 모두 매일 들어오고, 출첵(체력 +20)을 받고, 기력을 다 써서 개간하고,
 * 다 자란 것을 거두고, 빈 흙에 심고, 체력이 닿는 만큼 물을 준다.
 *   혼자        그것뿐
 *   먹으며      체력이 반 밑이면 거둔 작물 가운데 먹으면 차는 것을 먹는다(나머지는 판다)
 *   이웃        남이 하루 체력 20만큼 물을 대신 준다
 *   이웃+먹으며 둘 다
 *   +비료       이웃+먹으며에 더해, 골드가 넉넉하면(200 넘게) 밭마다 하루 비료 하나를 사서 넣는다
 *   +퇴비       이웃+먹으며에 더해, 팔 작물을 퇴비로 바꿔(다섯에 하나) 밭마다 하루 셋까지 넣는다
 *
 * 작물은 **궁합 미리보기를 보고** 고른다 — 하루당 보장 이익 × 그 밭의 성장 배율(궁합·연작)이 가장
 * 큰 것, 토질 경험이 0 이 되는 연작은 조금 덜 친다(3a). 연작이 걸린 밭은 더 심지 않고 비워서
 * 작물을 바꾼다. `생각없이` 는 늘 같은 작물을 이어 심는다 —
 * 연작 벌칙이 얼마나 누르는지 보려는 비교다. 바위는 가운데부터 치고 힌트로 좁힌다.
 */
import { createRequire } from 'node:module';
import { ITEM_BY_KEY } from '../src/casino/items.js';

const require = createRequire(import.meta.url);
const rules = require('../../server/src/farm/rules.js');
const affinity = require('../../server/src/farm/affinity.js');
const land = require('../../server/src/farm/land.js');
const { CROPS, seedPrice, guaranteed } = require('../../server/src/farm/crops.js');

const DAYS = Number(process.argv[2]) || 60;
const RUNS = Number(process.argv[3]) || 20;
const D0 = '2026-10-01';
const MAX_HP = 100;
const CHECKIN_HEAL = 20;
/** 비료 한 포대(봇 명부의 값 — `FERT_PRICE=20` 으로 바꿔 볼 수 있다). 사고 나서도 이만큼은 남긴다. */
const FERT_PRICE = Number(process.env.FERT_PRICE) || ITEM_BY_KEY.fertilizer.price;
const FERT_RESERVE = 200;

/** 되풀이할 수 있는 난수(mulberry32). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 레벨이 닿는 작물 가운데 하루당 보장 이익이 가장 큰 것. */
const bestCrop = (level) => CROPS.filter((c) => c.lv <= level)
  .sort((a, b) => guaranteed(b) / b.days - guaranteed(a) / a.days || b.lv - a.lv)[0];

/** 궁합 미리보기를 보고 고른다 — 하루당 보장 이익 × 성장 배율, 연작(토질 0)은 20% 덜 친다. */
function smartCrop(farm, plot, level) {
  let best = null; let score = -1;
  for (const c of CROPS.filter((x) => x.lv <= level)) {
    const m = affinity.modsFor(farm, plot, c.key);
    const v = (guaranteed(c) / c.days) * (m?.rate ?? 1) * (m?.soil === 0 ? 0.8 : 1);
    if (v > score) { score = v; best = c; }
  }
  return best;
}

/** 바위 하나를 힌트로 좁혀 가며 친다. 기력이 떨어지면 멈춘다. */
function breakBoulder(farm, today, plot, cell, st, rand, fossils) {
  let lo = 1; let hi = land.GRAIN_SPOTS;
  while (st.left > 0) {
    const pos = Math.floor((lo + hi) / 2);
    const r = rules.clear(farm, today, { plot, cell, pos }, { rand, stamina: st.left, fossilLeft: land.FOSSIL_PER_DAY - fossils.n });
    if (!r.ok) return null;
    st.left -= r.used;
    fossils.n += r.fossils;
    if (r.broke) return r;
    if (r.hint.dir === 'left') hi = pos - 1; else lo = pos + 1;
    if (r.hint.near) { lo = r.hint.dir === 'left' ? pos - 1 : pos + 1; hi = lo; }
    lo = Math.max(1, lo); hi = Math.min(land.GRAIN_SPOTS, Math.max(lo, hi));
  }
  return null;
}

function play({ eat, neighbor, fert, compost, naive }, seed) {
  const rand = seeded(seed);
  const farm = rules.newFarm({ channelId: String(100000 + seed), guildId: '1', owner: 'me', today: D0, now: `${D0}T00:00:00.000Z`, rand });
  let hp = MAX_HP; let gold = 0; let seeds = 0; let loot = 0; let waterMissed = 0; let dead = 0;
  let fertSpent = 0; let compostHeld = 0; let cropBank = 0;
  const reached = {};
  let lowHpDays = 0;

  for (let n = 0; n < DAYS; n += 1) {
    const today = rules.addDays(D0, n);
    const before = farm.plots.reduce((a, p) => a + p.cells.filter((c) => c.t === 'dead').length, 0);
    rules.tick(farm, today);
    dead += farm.plots.reduce((a, p) => a + p.cells.filter((c) => c.t === 'dead').length, 0) - before;
    hp = Math.min(MAX_HP, hp + CHECKIN_HEAL);

    // 개간 — 돌 먼저, 그다음 바위
    const st = { left: land.staminaOf(rules.levelOf(farm)) };
    const fossils = { n: 0 };
    const add = (r) => { if (r) for (const [k, c] of Object.entries(r.loot)) loot += (ITEM_BY_KEY[k]?.price ?? 0) * c; };
    for (const [pi, p] of farm.plots.entries()) {
      if (!p.open || st.left <= 0) continue;
      if (p.cells.some((c) => c.t === 'rock')) {
        const r = rules.clear(farm, today, { plot: pi, all: true }, { rand, stamina: st.left });
        if (r.ok) { st.left -= r.used; add(r); }
      }
      p.cells.forEach((c, ci) => {
        if (c.t === 'weed') add(rules.clear(farm, today, { plot: pi, cell: ci }, { rand }));
        if (c.t === 'boulder' && st.left > 0) add(breakBoulder(farm, today, pi, ci, st, rand, fossils));
      });
    }

    // 수확 — 먹을 것은 먹고 나머지는 판다
    const h = rules.harvest(farm, today, {}, { rand });
    if (h.ok) {
      for (const [k, c] of Object.entries(h.items)) {
        let left = c;
        const heal = ITEM_BY_KEY[k]?.heal ?? 0;
        while (eat && left > 0 && heal > 0 && hp < MAX_HP / 2) { hp = Math.min(MAX_HP, hp + heal); left -= 1; }
        if (compost && k !== 'dandelion' && k !== 'compost') { cropBank += left; left = 0; }
        if (k === 'compost') { compostHeld += left; left = 0; }
        gold += left * (ITEM_BY_KEY[k]?.price ?? 0);
      }
    }

    // 거름 — 퇴비(작물 다섯에 하나)와 비료(골드가 넉넉하면)
    if (compost) { compostHeld += Math.floor(cropBank / land.COMPOST_CROPS); cropBank %= land.COMPOST_CROPS; }
    for (const [pi, p] of farm.plots.entries()) {
      if (!p.open) continue;
      if (compostHeld > 0) {
        const r = rules.fertilize(farm, today, { plot: pi, item: 'compost', count: compostHeld });
        if (r.ok) compostHeld -= r.used;
      }
      if (fert && gold - FERT_PRICE >= FERT_RESERVE && rules.fertilize(farm, today, { plot: pi, item: 'fertilizer' }).ok) {
        gold -= FERT_PRICE; fertSpent += FERT_PRICE;
      }
    }

    // 심기 — 빈 흙 전부
    const level = rules.levelOf(farm);
    for (const [pi, p] of farm.plots.entries()) {
      if (!p.open) continue;
      const soil = p.cells.map((c, i) => (c.t === 'soil' ? i : -1)).filter((i) => i >= 0);
      if (!soil.length) continue;
      // 연작(⚔️)이 걸린 밭은 **더 심지 않고 비운다** — 다 거두면 작물이 풀려 다른 것을 심는다.
      // 이어 심으면 밭이 영영 안 비어 연작이 풀리지 않는다(칸 하나로 연작을 피하지 못하게 한 규칙).
      if (!naive && p.crop && affinity.modsFor(farm, pi)?.rotation === 'same') continue;
      const crop = p.crop ?? (naive ? bestCrop(level) : smartCrop(farm, pi, level)).key;
      const r = rules.plant(farm, today, { plot: pi, cells: soil, crop });
      if (r.ok) { seeds += r.cost; gold -= r.cost; }
    }

    // 물 — 이웃 먼저(체력 20), 그다음 나
    if (neighbor) rules.water(farm, today, 'neighbor', { budget: CHECKIN_HEAL, rand });
    const w = rules.water(farm, today, 'me', { budget: Math.max(0, hp - 1), rand });
    if (w.ok) { hp -= w.watered; waterMissed += w.left; } else if (w.reason === 'tired') waterMissed += w.need;
    if (hp < 30) lowHpDays += 1;

    const lv = rules.levelOf(farm);
    if (!reached[lv]) reached[lv] = n + 1;
  }
  const cells = farm.plots.reduce((a, p) => a + p.cells.filter((c) => c.t === 'plant').length, 0);
  const soils = farm.plots.filter((p) => p.open).map((p) => land.soilStar(p.soilXp));
  return {
    reached, gold, seeds, loot, waterMissed, dead, lowHpDays, level: rules.levelOf(farm), cells, soils, fertSpent,
  };
}

const STRATS = [
  ['생각없이', { eat: true, neighbor: false, naive: true }],
  ['혼자', { eat: false, neighbor: false }],
  ['먹으며', { eat: true, neighbor: false }],
  ['이웃', { eat: false, neighbor: true }],
  ['이웃+먹으며', { eat: true, neighbor: true }],
  ['+비료', { eat: true, neighbor: true, fert: true }],
  ['+퇴비', { eat: true, neighbor: true, compost: true }],
];

const avg = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const fmt = (x) => (x == null ? '—' : String(Math.round(x)));

console.log(`\n농장 시뮬레이션 — ${DAYS}일 × ${RUNS}판 · 첫 작물 ${bestCrop(1).key}(씨앗 ${seedPrice(bestCrop(1))})\n`);
console.log('레벨에 닿은 날(중앙값) — ' + Array.from({ length: 9 }, (_, i) => `Lv${i + 2}`).join(' '));
for (const [name, s] of STRATS) {
  const res = Array.from({ length: RUNS }, (_, i) => play(s, i + 1));
  const days = Array.from({ length: 9 }, (_, i) => {
    const got = res.map((r) => r.reached[i + 2]).filter(Boolean);
    return got.length > RUNS / 2 ? med(got) : null;
  });
  console.log(`\n${name.padEnd(8)} ${days.map((d) => fmt(d).padStart(4)).join(' ')}`);
  console.log(`         최종 Lv ${avg(res.map((r) => r.level)).toFixed(1)} · 판 수익 ${fmt(avg(res.map((r) => r.gold)))}골드(씨앗 ${fmt(avg(res.map((r) => r.seeds)))} 뺀 값)`
    + ` · 개간 전리품 ${fmt(avg(res.map((r) => r.loot)))}골드어치`);
  console.log(`         못 준 물 ${fmt(avg(res.map((r) => r.waterMissed)))}포기 · 죽은 칸 ${fmt(avg(res.map((r) => r.dead)))}`
    + ` · 체력 30 밑인 날 ${fmt(avg(res.map((r) => r.lowHpDays)))}일 · 마지막 날 심긴 칸 ${fmt(avg(res.map((r) => r.cells)))}`);
  console.log(`         토질 ★ 평균 ${avg(res.map((r) => avg(r.soils))).toFixed(2)} (★5 밭 ${avg(res.map((r) => r.soils.filter((x) => x === 5).length)).toFixed(1)}개)`
    + `${s.fert ? ` · 비료에 쓴 골드 ${fmt(avg(res.map((r) => r.fertSpent)))}` : ''}`);
}
console.log('\n목표: 성실하면 6~8주(42~56일)에 Lv10 (docs/FARM.md §8.2)\n');
