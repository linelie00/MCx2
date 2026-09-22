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
 *   +설비       이웃+먹으며에 더해, 골드가 넉넉하면(200 넘게) 설비를 산다(4b) — 빗물통 → 덮개 →
 *               지지대 → 배수로 → 스프링클러. 덮개·지지대는 내일 다칠 밭(경고 줄)에만 산다.
 *               설비값을 되찾는지는 "설비 빼고 번 것" 으로 본다. `EQUIP_ONLY=빗물통키` 로 하나만 볼 수 있다
 *   +주문       이웃+먹으며에 더해, ★ 이상 작물을 쌓아 두고 개인 의뢰 · 게시판 주문을 채운다(5a).
 *               주문에 안 쓰이는 것은 판다. 게시판은 `BOARD_SHARE`(기본 0.5)만큼만 먼저 가져간다고 친다
 *   +과수       이웃+먹으며에 더해, Lv5 부터 열리는 밭 `TREES`(기본 3) 곳에 지금 제철인 나무를 심는다(4c).
 *               나무 밭이 번 골드를 따로 센다 — 밭 하나 · 하루로 나눠 작물 밭과 견준다
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
const weather = require('../../server/src/farm/weather.js');
const land = require('../../server/src/farm/land.js');
const { CROPS, CROP_BY_KEY, seedPrice, guaranteed } = require('../../server/src/farm/crops.js');

const DAYS = Number(process.argv[2]) || 60;
const RUNS = Number(process.argv[3]) || 20;
const D0 = '2026-09-21';     // 가을 1일째 — 실제 배포 때처럼 가을에 시작한다
const MAX_HP = 100;
const CHECKIN_HEAL = 20;
/** 비료 한 포대(봇 명부의 값 — `FERT_PRICE=20` 으로 바꿔 볼 수 있다). 사고 나서도 이만큼은 남긴다. */
const FERT_PRICE = Number(process.env.FERT_PRICE) || ITEM_BY_KEY.fertilizer.price;
const FERT_RESERVE = 200;
const { EQUIPS } = require('../../server/src/farm/equip.js');
/** 설비를 사는 차례(4b). */
const EQUIP_ORDER = process.env.EQUIP_ONLY ? [process.env.EQUIP_ONLY] : ['rainBarrel', 'cover', 'stakes', 'drain', 'sprinkler'];

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
const bestCrop = (level) => CROPS.filter((c) => c.lv <= level && !c.seedOnly && !c.tree)
  .sort((a, b) => guaranteed(b) / b.days - guaranteed(a) / a.days || b.lv - a.lv)[0];

/**
 * 오래 두고 봤을 때의 하루당 가치(보장 몫). 재수확 작물은 두 번째부터 씨앗값이 없어
 * `파는 값 / 재수확 간격` 이다 — 처음 한 번의 보장 이익만 보면 재수확 작물을 과소평가한다.
 */
const longRun = (c) => (c.regrow ? c.price / c.regrow : guaranteed(c) / c.days);

/** 궁합 미리보기와 제철을 보고 고른다 — 하루당 가치 × 성장 배율 × 제철, 연작(토질 0)은 20% 덜 친다. */
function smartCrop(farm, plot, level, today) {
  let best = null; let score = -1;
  for (const c of CROPS.filter((x) => x.lv <= level && !x.seedOnly && !x.tree)) {
    const m = affinity.modsFor(farm, plot, c.key);
    const season = weather.inSeason(c, today) ? 1 : weather.OFF_SEASON_GROWTH;
    const v = longRun(c) * (m?.rate ?? 1) * season * (m?.soil === 0 ? 0.8 : 1);
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

/** 지금 제철인 나무 가운데 하루당 가치(값 / 재수확)가 큰 것. */
const bestTree = (level, today) => CROPS.filter((c) => c.tree && c.lv <= level && weather.inSeason(c, today))
  .sort((a, b) => b.price / b.regrow - a.price / a.regrow)[0] ?? null;
const TREE_KEYS = new Set(CROPS.filter((c) => c.tree).map((c) => c.key));
const orders = require('../../server/src/farm/orders.js');
const BOARD_SHARE = Number(process.env.BOARD_SHARE ?? 0.5);
const TREES = Number(process.env.TREES) || 3;

function play({ eat, neighbor, fert, compost, naive, equip, trees, order }, seed) {
  const rand = seeded(seed);
  const farm = rules.newFarm({ channelId: String(100000 + seed), guildId: '1', owner: 'me', today: D0, now: `${D0}T00:00:00.000Z`, rand });
  let hp = MAX_HP; let gold = 0; let seeds = 0; let loot = 0; let waterMissed = 0; let dead = 0;
  let fertSpent = 0; let compostHeld = 0; let cropBank = 0; let equipSpent = 0;
  let treeGold = 0; let treePlotDays = 0; let cropGold = 0; let cropPlotDays = 0;
  const stock = {}; const taken = {}; let orderGold = 0; let orderXp = 0; let orderN = 0;
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
        if (order && /S[123]$/.test(k)) { stock[k] = (stock[k] ?? 0) + left; left = 0; }   // 주문에 쓰려고 쌓는다
        gold += left * (ITEM_BY_KEY[k]?.price ?? 0);
        const base = k.replace(/S[123]$/, '');
        const worth = c * (ITEM_BY_KEY[k]?.price ?? 0);     // 먹은 것도 값으로 친다(밭끼리 견주려고)
        if (TREE_KEYS.has(base)) treeGold += worth; else if (k !== 'dandelion' && k !== 'compost') cropGold += worth;
      }
    }

    // 주문 — 채울 수 있는 것부터 내고, 아무 주문에도 안 쓰일 ★ 작물은 판다
    if (order) {
      const open = [...(farm.requests ?? []), ...orders.activeBoard(today, taken)
        .filter((o) => land.hashRand('share', seed, o.id) < BOARD_SHARE)];
      for (const o of open) {
        const { take } = orders.takeFor(o, stock);
        if (!take) continue;
        for (const [k, c] of Object.entries(take)) stock[k] -= c;
        gold += o.gold; orderGold += o.gold; orderXp += o.xp; orderN += 1;
        rules.gainXp(farm, o.xp, rand);
        if (o.kind === 'board') taken[o.id] = { day: today };
        else farm.requests = farm.requests.filter((x) => x.id !== o.id);
      }
      const want = new Set([...(farm.requests ?? []), ...orders.activeBoard(today, taken)].flatMap((o) => o.parts.map((x) => x.crop)));
      for (const [k, c] of Object.entries(stock)) {
        if (!c || want.has(k.replace(/S[123]$/, ''))) continue;
        gold += c * (ITEM_BY_KEY[k]?.price ?? 0);
        stock[k] = 0;
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

    // 설비 — 차례대로, 골드가 넉넉하면
    if (equip) {
      for (const key of EQUIP_ORDER) {
        const e = EQUIPS.find((x) => x.key === key);
        // 덮개·지지대는 **내일 다칠 밭**(경고 줄)에만 — 화면을 보고 사는 사람처럼
        const risk = rules.view(farm, today).risk;
        const want = key === 'cover' ? 'frost' : 'storm';
        const plots = e.per === 'plot' ? (risk?.weather === want ? risk.plots : []) : null;
        if (plots && !plots.length) continue;
        const fit = plots ? plots.slice(0, Math.max(0, Math.floor((gold - FERT_RESERVE) / e.gold))) : null;
        if (plots && !fit.length) continue;
        const sim = structuredClone(farm);
        const r = rules.buyEquip(sim, today, { key, plots: fit });
        if (!r.ok || gold - r.cost < FERT_RESERVE) continue;
        rules.buyEquip(farm, today, { key, plots: fit });
        gold -= r.cost; equipSpent += r.cost;
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
      // 나무 — 빈 흙 아홉 칸인 밭에, 나무 밭이 `TREES` 곳이 될 때까지
      // 나무 밭은 Lv5 부터 열리는 밭 `TREES` 곳(7 · 1 · 3번 …) — 아홉 칸이 다 빌 때까지 다른 것을 안 심는다
      const orchard = trees && land.PLOT_ORDER.slice(4, 4 + TREES).includes(pi);
      if (orchard && !p.crop && soil.length < 9) continue;
      const tree = orchard && !p.crop ? bestTree(level, today) : null;
      if (orchard && !p.crop && !tree) continue;
      if (tree) {
        const r = rules.plant(farm, today, { plot: pi, cells: [4], crop: tree.key });
        if (r.ok) { seeds += r.cost; gold -= r.cost; treeGold -= r.cost; }
        continue;
      }
      // 주문 — 아직 아무 밭에도 없는 주문 작물이 있으면 그것부터(나무 · 희귀는 빼고)
      const growing = new Set(farm.plots.map((pp) => pp.crop).filter(Boolean));
      const forOrder = order && process.env.ORDER_PLANT !== '0' && !p.crop
        ? [...(farm.requests ?? []), ...orders.activeBoard(today, taken)].flatMap((o) => o.parts.map((x) => CROP_BY_KEY[x.crop]))
          .find((c) => c && c.lv <= level && !c.tree && !c.seedOnly && !growing.has(c.key))
        : null;
      const crop = p.crop ?? forOrder?.key ?? (naive ? bestCrop(level) : smartCrop(farm, pi, level, today)).key;
      const r = rules.plant(farm, today, { plot: pi, cells: soil, crop });
      if (r.ok) { seeds += r.cost; gold -= r.cost; cropGold -= r.cost; }
    }
    for (const p of farm.plots) {
      if (!p.open || !p.crop) continue;
      if (CROP_BY_KEY[p.crop]?.tree) treePlotDays += 1; else cropPlotDays += 1;
    }

    // 물 — 이웃 먼저(체력 20), 그다음 나
    // 폭염이면 한 포기에 체력 2(4a). 비 오는 날은 비가 준다(water → rain).
    const cost = rules.hpCostOf(farm, today);       // 빗물통이면 폭염에도 1 (4b)
    if (neighbor) rules.water(farm, today, 'neighbor', { budget: Math.floor(CHECKIN_HEAL / cost), rand });
    const w = rules.water(farm, today, 'me', { budget: Math.floor(Math.max(0, hp - 1) / cost), rand });
    if (w.ok) { hp -= w.watered * cost; waterMissed += w.left; } else if (w.reason === 'tired') waterMissed += w.need;
    if (hp < 30) lowHpDays += 1;

    const lv = rules.levelOf(farm);
    if (!reached[lv]) reached[lv] = n + 1;
  }
  const cells = farm.plots.reduce((a, p) => a + p.cells.filter((c) => c.t === 'plant').length, 0);
  const soils = farm.plots.filter((p) => p.open).map((p) => land.soilStar(p.soilXp));
  return {
    reached, gold, seeds, loot, waterMissed, dead, lowHpDays, level: rules.levelOf(farm), cells, soils, fertSpent, equipSpent,
    orderGold, orderXp, orderN,
    treeDay: treePlotDays ? treeGold / treePlotDays : null, cropDay: cropPlotDays ? cropGold / cropPlotDays : null,
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
  ['+설비', { eat: true, neighbor: true, equip: true }],
  ['+과수', { eat: true, neighbor: true, trees: true }],
  ['+주문', { eat: true, neighbor: true, order: true }],
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
    + `${s.fert ? ` · 비료에 쓴 골드 ${fmt(avg(res.map((r) => r.fertSpent)))}` : ''}`
    + `${s.order ? ` · 주문 ${fmt(avg(res.map((r) => r.orderN)))}건 · 보상 ${fmt(avg(res.map((r) => r.orderGold)))}골드 · 경험치 ${fmt(avg(res.map((r) => r.orderXp)))}` : ''}`
    + `${s.trees ? ` · 밭 하루당 — 나무 ${avg(res.map((r) => r.treeDay ?? 0)).toFixed(1)} · 작물 ${avg(res.map((r) => r.cropDay ?? 0)).toFixed(1)}골드어치` : ''}`
    + `${s.equip ? ` · 설비에 쓴 골드 ${fmt(avg(res.map((r) => r.equipSpent)))} (설비 빼고 번 것 ${fmt(avg(res.map((r) => r.gold + r.equipSpent)))})` : ''}`);
}
console.log('\n목표: 성실하면 6~8주(42~56일)에 Lv10 (docs/FARM.md §8.2)\n');
