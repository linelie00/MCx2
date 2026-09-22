/**
 * check-farm — 농장 규칙과 /api/farms 회귀 검사
 *
 *   node scripts/check-farm.js
 *
 * 둘로 나눠 본다.
 *   1. 규칙(`farm/rules.js` · `farm/land.js`) — 날짜와 난수를 마음대로 넘기며 성장·시듦·죽음·
 *      과숙·재수확·잡초·토질·레벨·개간을 센다. 실제 서버로는 하루를 기다려야 하는 것들이다
 *   2. API — 임시 DATA_DIR 에 진짜 앱을 띄워 등록·주인·골드·체력·아이템이 두 파일에 맞게
 *      옮겨지는지 본다. 실제 데이터는 건드리지 않는다(check-accounts 와 같은 방식)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-'));
process.env.DATA_DIR = DIR;
process.env.BOT_KEY = 'test-key';

const rules = require('../src/farm/rules');
const land = require('../src/farm/land');
const affinity = require('../src/farm/affinity');
const quality = require('../src/farm/quality');
const weather = require('../src/farm/weather');

// 날씨·제철을 고정한다(맑음 · 모두 제철) — 날씨 전에 짠 검사가 날짜마다 흔들리지 않게.
// 날씨 검사는 아래 「4a」 에서 따로 바꿔 가며 본다.
const NEUTRAL = { weather: 'clear', inSeason: true };
weather.pin(NEUTRAL);
const { CROPS, seedPrice, guaranteed, TREE_YIELD } = require('../src/farm/crops');
const { dayKey } = require('../src/services/dayKey');

let ok = 0; let bad = 0;
const eq = (name, got, want) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { ok += 1; } else { bad += 1; console.log(`  ✗ ${name}\n     받음: ${JSON.stringify(got)}\n     기대: ${JSON.stringify(want)}`); }
};

/** 정해진 수열을 되풀이하는 난수. */
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };
const ZERO = () => 0;
/** 작물 하나의 수확 합계 — 보통 + ★ 변형(3b). API 는 진짜 난수로 품질을 굴린다. */
const crop = (items, key) => ['', 'S1', 'S2', 'S3'].reduce((a, sfx) => a + (items?.[key + sfx] ?? 0), 0);

// ================================================================ 1. 작물표

eq('씨앗값은 파는 값보다 싸다 (수확하면 반드시 남는다)', CROPS.filter((c) => !c.seedOnly && !c.tree && !(seedPrice(c) >= 1 && seedPrice(c) < c.price)).map((c) => c.key), []);
eq('묘목값 = 파는 값 × 2 · 첫 수확 최소 개수로 남는다(4c)', CROPS.filter((c) => c.tree && !(seedPrice(c) === c.price * 2 && TREE_YIELD[0][0] * c.price > seedPrice(c))).map((c) => c.key), []);
eq('과수 다섯 · 모두 다년생 · 키 큼 · 제철 둘 이하', CROPS.filter((c) => c.tree).map((c) => [c.key, c.perennial && c.tall && c.regrow > 0 && c.seasons.length <= 2 && Boolean(c.treeName)]),
  [['lemon', true], ['redApple', true], ['grape', true], ['peach', true], ['pear', true]]);
eq('계절마다 제철 나무가 있다', weather.SEASONS.map((x) => CROPS.filter((c) => c.tree && c.seasons.includes(x.key)).length > 0), [true, true, true, true]);
eq('희귀 작물은 씨앗값이 없다(주머니 씨앗)', CROPS.filter((c) => c.seedOnly && seedPrice(c) !== 0).map((c) => c.key), []);
eq('희귀 씨앗 목록 = seedOnly 작물', [...land.RARE_SEEDS].sort(), CROPS.filter((c) => c.seedOnly).map((c) => c.key).sort());
eq('보장 이익은 성장일의 절반(올림)', CROPS.filter((c) => !c.tree && guaranteed(c) !== Math.min(Math.ceil(c.days / 2), c.price - 1)).map((c) => c.key), []);
eq('키가 안 겹친다', new Set(CROPS.map((c) => c.key)).size, CROPS.length);
eq('레벨은 1~10', CROPS.filter((c) => !(c.lv >= 1 && c.lv <= 10)).map((c) => c.key), []);
eq('특수 규칙이 있으면 안내 문구가 있다', CROPS.filter((c) => (c.thirsty || c.spread || c.flee || c.scream || c.shadeNeed || c.perennial || c.seedOnly) && !c.note).map((c) => c.key), []);
eq('다년생은 재수확 작물이다', CROPS.filter((c) => c.perennial && !c.regrow).map((c) => c.key), []);
eq('Lv1 작물 여덟(희귀 빼고)', CROPS.filter((c) => c.lv === 1 && !c.seedOnly).length, 8);
eq('키는 아이템 키 모양', CROPS.filter((c) => !/^[a-z][A-Za-z0-9]{0,39}$/.test(c.key)).map((c) => c.key), []);
eq('처음 성장일은 재수확 간격의 두 배 이상', CROPS.filter((c) => c.regrow && c.days < c.regrow * 2).map((c) => c.key), []);

// ================================================================ 2. 땅 · 레벨

eq('해시 난수는 늘 같다', land.hashRand('a', 1), land.hashRand('a', 1));
eq('해시 난수는 [0,1)', [land.hashRand('x'), land.hashRand('y', 2)].every((x) => x >= 0 && x < 1), true);
eq('토질 ★', [0, 19, 20, 60, 299, 300, 9999].map(land.soilStar), [1, 1, 2, 3, 4, 5, 5]);
eq('레벨', [0, 19, 20, 50, 819, 820, 99999].map(land.levelOf), [1, 1, 2, 3, 9, 10, 10]);
eq('레벨표는 오르기만 한다', land.LEVEL_XP.every((x, i) => !i || x > land.LEVEL_XP[i - 1]), true);
eq('간판', [1, 3, 6, 9, 10].map(land.signOf), ['🛖', '🏠', '🏡', '🏯', '🏰']);
eq('기력 Lv1 5 · Lv3 6', [land.staminaOf(1), land.staminaOf(3)], [5, 6]);
eq('밭이 열리는 순서는 아홉 칸 전부', [...land.PLOT_ORDER].sort(), [0, 1, 2, 3, 4, 5, 6, 7, 8]);

{
  const p = land.makePlot(Math.random, { first: true });
  const count = (t) => p.cells.filter((c) => c.t === t).length;
  eq('첫 밭은 빈 흙 셋 · 돌 넷 · 바위 둘', [count('soil'), count('rock'), count('boulder')], [3, 4, 2]);
  eq('바위의 결은 1~5', p.cells.filter((c) => c.t === 'boulder').every((c) => c.grain >= 1 && c.grain <= 5), true);
  for (let n = 0; n < 50; n += 1) {
    const q = land.makePlot(Math.random);
    const r = q.cells.filter((c) => c.t === 'rock').length; const b = q.cells.filter((c) => c.t === 'boulder').length;
    if (r < 3 || r > 5 || b < 2 || b > 3) { eq('나중 밭은 돌 3~5 · 바위 2~3', [r, b], 'range'); break; }
  }
}
{
  const rolls = Array.from({ length: 2000 }, () => land.rollLoot('normal', Math.random, { fossilLeft: 0 }));
  eq('화석이 막히면 안 나온다', rolls.includes('oddFossil'), false);
  eq('원석은 여섯 가지 중 하나', rolls.filter((k) => k.startsWith('ore')).every((k) => land.ORES.includes(k)), true);
  eq('희귀 씨앗은 아직 안 나온다', rolls.some((k) => ['screamRoot', 'walkingCap', 'keeperBerry'].includes(k)), false);
}
eq('힌트: 결이 왼쪽 · 바로 옆', land.hintOf(2, 3), { dir: 'left', near: true });
eq('힌트: 결이 오른쪽 · 멀다', land.hintOf(5, 2), { dir: 'right', near: false });

// ================================================================ 3. 규칙

const D0 = '2026-09-01';
const day = (n) => rules.addDays(D0, n);
const P = rules.START_PLOT;
/** 가운데 밭을 전부 빈 흙으로 만든 농장. 성장 검사에 돌이 끼지 않게. */
function fresh({ owner = '333333' } = {}) {
  const f = rules.newFarm({ channelId: '111111', guildId: '222222', owner, today: D0, now: `${D0}T00:00:00.000Z` });
  f.plots[P].cells = f.plots[P].cells.map(() => ({ t: 'soil' }));
  return f;
}
/**
 * n일째로 넘어가서 셈한다. 성장 검사에 잡초(성장 ×0.95)가 끼지 않게 **돋은 잡초는 걷어 낸다.**
 * 잡초 자체는 아래에서 `rules.tick` 으로 따로 본다.
 */
const at = (farm, n) => {
  rules.tick(farm, day(n));
  for (const p of farm.plots) p.cells.forEach((c, i) => { if (c.t === 'weed') p.cells[i] = { t: 'soil' }; });
  return farm;
};
const cell = (farm, i = 0) => farm.plots[P].cells[i];
const state = (farm, n, i = 0) => rules.view(farm, day(n)).plots[P].cells[i];
const W = (farm, n, who = 'u1', opts = {}) => rules.water(farm, day(n), who, opts);

eq('날짜 더하기', rules.addDays('2026-12-31', 1), '2027-01-01');
eq('윤년', rules.addDays('2028-02-28', 1), '2028-02-29');

{
  const f = rules.newFarm({ channelId: '1', guildId: '1', owner: '1', today: D0, now: `${D0}T00:00:00.000Z` });
  eq('가운데 밭만 열림', f.plots.map((p) => p.open), [false, false, false, false, true, false, false, false, false]);
  eq('잠긴 밭은 칸이 없다', f.plots[0].cells.length, 0);
  eq('새 농장 Lv1', [rules.levelOf(f), f.xp], [1, 0]);
  eq('보기에 결 자리가 안 샌다', JSON.stringify(rules.view(f, D0)).includes('grain'), false);
}

// --- 심기
{
  const f = fresh();
  eq('당근 3칸 심기', rules.plant(f, D0, { plot: P, cells: [0, 1, 2], crop: 'carrot' }), { ok: true, cost: 3, count: 3, crop: 'carrot', seeds: 0 });
  eq('다른 작물은 같은 밭에 못 심는다', rules.plant(f, D0, { plot: P, cells: [3], crop: 'potato' }).reason, 'otherCrop');
  eq('레벨이 모자란 작물', rules.plant(fresh(), D0, { plot: P, cells: [3], crop: 'tomato' }), { ok: false, reason: 'level', need: 2, crop: 'tomato' });
  eq('심은 칸에 또 못 심는다', rules.plant(f, D0, { plot: P, cells: [0], crop: 'carrot' }).reason, 'occupied');
  f.plots[P].cells[5] = { t: 'rock' };
  eq('돌 위엔 못 심는다', rules.plant(f, D0, { plot: P, cells: [5], crop: 'carrot' }).reason, 'occupied');
  eq('잠긴 밭', rules.plant(f, D0, { plot: 0, cells: [0], crop: 'carrot' }).reason, 'locked');
  eq('모르는 작물은 모양 오류', rules.plant(f, D0, { plot: P, cells: [4], crop: 'rose' }), { ok: false, reason: 'crop', bad: true });
  eq('겹친 칸은 모양 오류', rules.plant(f, D0, { plot: P, cells: [4, 4], crop: 'carrot' }).bad, true);
  eq('밭 번호 9 는 모양 오류', rules.plant(f, D0, { plot: 9, cells: [0], crop: 'carrot' }).bad, true);
}

// --- 물과 성장: 당근(3일)은 사흘 연속 물을 주면 셋째 날 다 자란다
{
  const f = fresh();
  rules.plant(f, D0, { plot: P, cells: [0], crop: 'carrot' });
  eq('심은 날은 새싹', state(f, 0), 'seed');
  const w = W(f, 0, 'u1');
  eq('물 한 포기', [w.ok, w.watered, w.left], [true, 1, 0]);
  eq('같은 칸은 하루 한 번', W(f, 0, 'u2').reason, 'already');
  at(f, 1); W(f, 1);
  eq('이틀째 물 → 🌿', state(f, 1), 'grow');
  at(f, 2);
  eq('사흘째 물 → 다 자람', W(f, 2).ripened, 1);
  eq('다 자람', state(f, 2), 'ripe');
  at(f, 3);
  eq('다 자란 칸은 물이 필요 없다', W(f, 3).reason, 'noPlants');
  eq('사흘 지나면 과숙', state(f, 5), 'over');
  at(f, 7);
  eq('다 자란 지 닷새(과숙)여도 살아 있다', cell(f).t, 'plant');
  at(f, 8);
  eq('다 자란 날로부터 엿새째 썩는다', cell(f), { t: 'dead', why: 'rot' });
}

// --- 체력: 줄 수 있는 만큼만, 급한 칸부터
{
  const f = fresh();
  rules.plant(f, D0, { plot: P, cells: [0, 1, 2, 3, 4], crop: 'carrot' });
  const w = W(f, 0, 'u1', { budget: 3 });
  eq('체력만큼만 준다', [w.watered, w.left], [3, 2]);
  eq('나머지는 다른 사람이 이어서', W(f, 0, 'u2', { budget: 10 }).watered, 2);
  eq('물 준 사람 둘', rules.view(f, D0).waterBy, ['u1', 'u2']);
  eq('체력이 없으면 못 준다', (at(f, 1), W(f, 1, 'u1', { budget: 0 })), { ok: false, reason: 'tired', need: 5 });
  at(f, 3);                                     // 1·2일째 굶김 → 전부 🍂
  cell(f, 4).thirst = 1;                        // 한 칸만 덜 목마르게
  const first = W(f, 3, 'u1', { budget: 4 });
  eq('시든 칸부터 준다', [first.revived, cell(f, 4).wet === day(3)], [4, false]);
}

// --- 시듦과 죽음
{
  const f = fresh();
  rules.plant(f, D0, { plot: P, cells: [0, 1], crop: 'carrot' });
  W(f, 0);
  at(f, 2);                                     // 1일째를 건너뜀
  eq('하루 빠지면 thirst 1', cell(f).thirst, 1);
  eq('아직 안 시듦(성장만 멈춤)', [state(f, 2), cell(f).g], ['seed', 1]);
  eq('어제 못 받은 칸이 보인다', rules.view(f, day(2)).plots[P].thirsty, 2);
  at(f, 3);
  eq('이틀 빠지면 🍂', state(f, 3), 'dry');
  eq('시든 칸에 물 → 살아남', W(f, 3).revived, 2);
  eq('시든 흔적이 남는다', cell(f).scar, true);
  f.plots[P].soilXp = 30;
  at(f, 8);                                     // 4~7일 넷을 건너뜀
  eq('나흘 빠지면 💀', cell(f), { t: 'dead', why: 'dry' });
  eq('죽으면 토질 경험이 칸마다 −3', f.plots[P].soilXp, 24);
}

// --- 토질: 좋으면 한 번에 더 자란다
{
  const f = fresh();
  f.plots[P].soilXp = 300;                      // ★5 — 물 한 번에 1.5
  rules.plant(f, D0, { plot: P, cells: [0], crop: 'carrot' });
  W(f, 0); at(f, 1); W(f, 1);
  eq('★5 당근(3일)은 두 번 만에 다 자란다', cell(f).ripeDay, day(1));
  const g = fresh(); g.plots[P].soilXp = 20;    // ★2 — 1.1
  rules.plant(g, D0, { plot: P, cells: [0], crop: 'carrot' });
  W(g, 0);
  eq('★2 는 1.1', cell(g).g, 1.1);
  eq('남은 물주기는 토질 배율로', rules.view(g, D0).plots[P].left, 2);
}

// --- 잡초: 해시 난수라 몇 번 셈해도 같다
{
  const a = fresh(); const b = fresh();
  rules.tick(a, day(40)); rules.tick(b, day(40));
  const weeds = a.plots[P].cells.filter((c) => c.t === 'weed').length;
  eq('40일 비워 두면 잡초가 난다', weeds > 0, true);
  eq('같은 셈은 같은 잡초', a.plots[P].cells, b.plots[P].cells);
  const s = rules.view(a, day(40)).plots[P].cells;
  eq('잡초가 보인다', s.includes('weed'), true);
  eq('잡초 칸엔 못 심는다', rules.plant(a, day(40), { plot: P, cells: [s.indexOf('weed')], crop: 'carrot' }).reason, 'occupied');
}

// --- 한 번에 몰아서 셈해도 하루씩 센 것과 같다
{
  const a = fresh(); const b = fresh();
  for (const f of [a, b]) { rules.plant(f, D0, { plot: P, cells: [0, 1, 2], crop: 'carrot' }); W(f, 0); }
  for (let n = 1; n <= 9; n += 1) rules.tick(a, day(n));
  rules.tick(b, day(9));
  eq('몰아 세기 = 하루씩 세기', a, b);
  eq('lastTickDay 는 어제', b.lastTickDay, day(8));
  eq('두 번 세도 그대로', JSON.stringify(rules.tick(structuredClone(b), day(9))), JSON.stringify(b));
}

// --- 수확 · 토질 경험 · 레벨
{
  const f = fresh();
  rules.plant(f, D0, { plot: P, cells: [0, 1, 2], crop: 'cucumber' });
  eq('익은 게 없으면 nothing', rules.harvest(f, D0).reason, 'nothing');
  // 오이 — 처음 4일, 그다음 2일마다(처음 성장일은 재수확 간격의 두 배 이상)
  W(f, 0); for (let n = 1; n <= 2; n += 1) { at(f, n); W(f, n); }
  eq('처음엔 물 세 번으론 안 익는다', rules.view(f, day(2)).plots[P].ripe, 0);
  at(f, 3); W(f, 3);
  const h = rules.harvest(f, day(3), {}, { rand: ZERO });
  eq('오이 셋 수확(★1 은 칸마다 1)', [h.items, h.harvested], [{ cucumber: 3 }, 3]);
  eq('경험치 = 칸 3 + 첫 작물 10', h.xp, 13);
  eq('토질 경험 +3', f.plots[P].soilXp, 3);
  eq('재수확 작물은 칸이 남는다', [cell(f).t, f.plots[P].crop], ['plant', 'cucumber']);
  at(f, 4); W(f, 4); at(f, 5); W(f, 5);
  eq('그다음엔 이틀 뒤 다시 익는다', rules.view(f, day(5)).plots[P].ripe, 3);
  eq('재수확으로 거둔 칸은 경험치 절반 · 첫 작물 보너스 없음', rules.harvest(f, day(5), {}, { rand: ZERO }).xp, 1.5);
  eq('재수확 횟수를 센다', cell(f).regrows, 2);
}
{
  const f = fresh();
  f.plots[P].soilXp = 300;                      // ★5 보통 작물은 칸마다 3
  rules.plant(f, D0, { plot: P, cells: [0, 1], crop: 'soybean' });
  W(f, 0); at(f, 1); W(f, 1);
  const h = rules.harvest(f, day(1), {}, { rand: ZERO });
  // ★5 · 안 시듦 · 제철 = 65점(+난수 0) → ★
  eq('★5 콩 두 칸 = 6개 · 품질 ★', h.items, { soybeanS1: 6 });
  eq('콩 계열은 토질 경험 +10', f.plots[P].soilXp, 300 + 2 + 10);
}
{
  const f = fresh();
  rules.plant(f, D0, { plot: P, cells: [0], crop: 'potato' });
  W(f, 0); at(f, 1); W(f, 1);
  f.plots[P].cells[1] = { t: 'dead', why: 'dry' };
  f.plots[P].cells[2] = { t: 'weed' };
  const h = rules.harvest(f, day(1), { plot: P }, { rand: ZERO });
  eq('감자 · 죽은 칸 · 잡초', [h.items, h.harvested, h.cleared, h.weeds], [{ potato: 1, dandelion: 1 }, 1, 1, 1]);
  eq('퇴비 조각 둘', f.compostBits, 2);
  eq('밭이 비면 작물도 비운다', f.plots[P].crop, null);
  eq('잠긴 밭 수확', rules.harvest(f, day(1), { plot: 0 }).reason, 'locked');
}
{
  const f = fresh();
  f.xp = 18;
  const up = rules.gainXp(f, 2, Math.random);
  eq('Lv2 — 2번 밭이 열린다', [up.from, up.to, up.opened], [1, 2, [1]]);
  eq('Lv2 작물이 풀린다', up.crops.includes('tomato'), true);
  eq('새 밭은 돌투성이', f.plots[1].cells.some((c) => c.t === 'rock' || c.t === 'boulder'), true);
  eq('오르지 않으면 null', rules.gainXp(f, 1, Math.random), null);
  const g = fresh(); g.xp = 0;
  eq('한 번에 여러 레벨', rules.gainXp(g, 180, Math.random).opened, [1, 3, 5, 7]);
  const o = fresh({ owner: 'boss' });
  rules.plant(o, D0, { plot: P, cells: [0], crop: 'carrot' });
  rules.plant(o, D0, { plot: P, cells: [1], crop: 'carrot' });
  eq('그날 첫 물이면 +2', rules.water(o, D0, 'guest', { budget: 1 }).xp, 2);
  eq('그날 두 번째는 없다 — 주인이 줘도', rules.water(o, D0, 'boss', { budget: 1 }).xp, 0);
}

// --- 개간
{
  const f = fresh();
  const p = f.plots[P];
  p.cells[0] = { t: 'rock' }; p.cells[1] = { t: 'rock' }; p.cells[2] = { t: 'rock' };
  p.cells[3] = { t: 'boulder', grain: 3, swings: 0, cracked: false };
  p.cells[4] = { t: 'boulder', grain: 5, swings: 0, cracked: false };
  p.cells[5] = { t: 'weed' };

  const r1 = rules.clear(f, D0, { plot: P, cell: 0 }, { rand: ZERO, stamina: 5 });
  eq('돌 하나 — 기력 1 · 경험치 1', [r1.ok, r1.used, r1.xp, p.cells[0].t], [true, 1, 1, 'soil']);
  eq('돌은 30% 로 전리품(0 이면 나옴)', Object.keys(r1.loot).length, 1);
  eq('기력이 없으면 못 캔다', rules.clear(f, D0, { plot: P, cell: 1 }, { stamina: 0 }).reason, 'tired');
  const all = rules.clear(f, D0, { plot: P, all: true }, { rand: () => 0.9, stamina: 1 });
  eq('돌 모두 — 기력만큼만', [all.used, all.left, all.loot], [1, 1, {}]);
  eq('잡초는 기력 없이 뽑는다', rules.clear(f, D0, { plot: P, cell: 5 }, { stamina: 0 }).loot, { dandelion: 1 });
  eq('빈 흙은 캘 게 없다', rules.clear(f, D0, { plot: P, cell: 0 }, { stamina: 5 }).reason, 'notStone');
  eq('바위는 자리가 있어야', rules.clear(f, D0, { plot: P, cell: 3 }, { stamina: 5 }).bad, true);

  const miss = rules.clear(f, D0, { plot: P, cell: 3, pos: 1 }, { stamina: 5 });
  eq('빗나감 — 힌트', [miss.broke, miss.hint, miss.swings], [false, { dir: 'right', near: false }, 1]);
  const hit = rules.clear(f, D0, { plot: P, cell: 3, pos: 3 }, { rand: ZERO, stamina: 5 });
  eq('두 번째에 맞힘 — 보통', [hit.broke, hit.perfect, hit.xp, Object.values(hit.loot).reduce((a, n) => a + n, 0)], [true, false, 3, 1]);
  const perfect = rules.clear(f, D0, { plot: P, cell: 4, pos: 5 }, { rand: ZERO, stamina: 5, fossilLeft: 1 });
  eq('첫 휘두름에 맞힘 — 완벽', [perfect.perfect, perfect.xp, Object.values(perfect.loot).reduce((a, n) => a + n, 0)], [true, 5, 2]);

  p.cells[6] = { t: 'boulder', grain: 1, swings: 0, cracked: false };
  for (let n = 0; n < 3; n += 1) rules.clear(f, D0, { plot: P, cell: 6, pos: 5 }, { stamina: 5 });
  eq('세 번 빗나가면 금', [p.cells[6].cracked, rules.view(f, D0).plots[P].cells[6]], [true, 'crack']);
  eq('금 간 바위는 어디를 쳐도 깨진다', rules.clear(f, D0, { plot: P, cell: 6, pos: 4 }, { rand: ZERO, stamina: 5 }).broke, true);
}
{
  // 화석 상한 — 화석이 뽑히는 난수를 넣는다(표의 맨 끝)
  const f = fresh();
  f.plots[P].cells[0] = { t: 'boulder', grain: 2, swings: 0, cracked: false };
  const r = rules.clear(f, D0, { plot: P, cell: 0, pos: 2 }, { rand: () => 0.999, stamina: 5, fossilLeft: 1 });
  eq('완벽 두 번 뽑기 중 화석은 하나만', [r.fossils, r.loot], [1, { oddFossil: 1, crackleStone: 1 }]);
}

// --- 돌이 남은 밭도 다 거두면 작물이 풀린다(2a 버그)
{
  const f = fresh();
  f.plots[P].cells[8] = { t: 'rock' };
  f.plots[P].cells[7] = { t: 'boulder', grain: 1, swings: 0, cracked: false };
  rules.plant(f, D0, { plot: P, cells: [0], crop: 'potato' });
  W(f, 0); at(f, 1); W(f, 1);
  rules.harvest(f, day(1), {}, { rand: ZERO });
  eq('돌이 남아도 작물이 풀린다', [f.plots[P].crop, f.plots[P].history], [null, ['root']]);
  eq('다른 작물을 심을 수 있다', rules.plant(f, day(1), { plot: P, cells: [0], crop: 'lettuce' }).ok, true);
  const stuck = fresh();
  stuck.plots[P].crop = 'potato';
  stuck.plots[P].cells[8] = { t: 'rock' };
  eq('묶여 있던 밭은 읽을 때 푼다', rules.upgrade(stuck).plots[P].crop, null);
  const alive = fresh();
  alive.plots[P].crop = 'potato';
  alive.plots[P].cells[0] = { t: 'dead', why: 'dry' };
  eq('죽은 칸이 남았으면 안 푼다(치워야 한다)', rules.upgrade(alive).plots[P].crop, 'potato');
}

// --- 3a: 궁합 · 세 자매 · 윤작과 연작
{
  /** 원하는 밭에 원하는 작물이 심긴 농장. `{ 밭: 작물 }` */
  const layout = (map, { history = {} } = {}) => {
    const f = fresh();
    for (const [pi, crop] of Object.entries(map)) {
      f.plots[pi] = {
        open: true, crop, soilXp: 0, history: history[pi] ?? [], streak: 0,
        cells: Array.from({ length: 9 }, () => ({ t: 'plant', g: 0, thirst: 0, scar: false, ripeDay: null, planted: D0, wet: null })),
      };
    }
    return f;
  };
  eq('이웃은 상하좌우', [affinity.neighbors(4).sort(), affinity.neighbors(0).sort(), affinity.neighbors(8).sort()], [[1, 3, 5, 7], [1, 3], [5, 7]]);

  const alone = affinity.modsFor(layout({ 4: 'carrot' }), 4);
  eq('이웃이 없으면 보정 없음', [alone.growth, alone.rate, alone.quality, alone.soil, alone.rotation, alone.notes], [0, 1, 0, 1, null, []]);

  const onionCarrot = affinity.modsFor(layout({ 4: 'carrot', 1: 'onion' }), 4);
  eq('파속 이웃 → 뿌리 +10% · 품질 +5', [onionCarrot.growth, onionCarrot.quality, onionCarrot.notes[0].good], [0.1, 5, true]);
  eq('대각선은 안 본다', affinity.modsFor(layout({ 4: 'carrot', 0: 'onion' }), 4).growth, 0);
  eq('박끼리 −10%', affinity.modsFor(layout({ 4: 'cucumber', 5: 'pumpkin' }), 4).growth, -0.1);
  eq('콩 이웃 → 잎 +10% · 토질 ×1.5', [affinity.modsFor(layout({ 4: 'lettuce', 3: 'soybean' }), 4).growth, affinity.modsFor(layout({ 4: 'lettuce', 3: 'soybean' }), 4).soil], [0.1, 1.5]);
  eq('옥수수 그늘 → 잎 +10% · 열매 −5%', [affinity.modsFor(layout({ 4: 'lettuce', 1: 'corn' }), 4).growth, affinity.modsFor(layout({ 4: 'tomato', 1: 'corn' }), 4).growth], [0.1, -0.05]);
  eq('허브 이웃 → 열매 품질 +5', affinity.modsFor(layout({ 4: 'tomato', 1: 'basil' }), 4).quality, 5);

  // 세 자매 — 옥수수(4) · 콩(1) · 박(5): 4-1, 4-5 가 맞닿음
  const sis = layout({ 4: 'corn', 1: 'soybean', 5: 'cucumber' });
  eq('세 자매 — 옥수수', affinity.threeSisters(sis, 4, CROPS.find((c) => c.key === 'corn')), true);
  eq('세 자매 — 끝의 박도 받는다(콩과는 안 맞닿아도 이어져 있다)', affinity.threeSisters(sis, 5, CROPS.find((c) => c.key === 'cucumber')), true);
  const m = affinity.modsFor(sis, 4);
  eq('세 자매 +20% + 콩 이웃 +10% = +30%', [m.growth, m.quality], [0.3, 10]);
  eq('떨어져 있으면 세 자매가 아니다', affinity.threeSisters(layout({ 4: 'corn', 1: 'soybean', 8: 'cucumber' }), 4, CROPS.find((c) => c.key === 'corn')), false);
  const many = affinity.modsFor(layout({ 4: 'carrot', 1: 'onion', 3: 'garlic', 5: 'greenOnion', 7: 'onion' }), 4);
  eq('궁합은 +30% 에서 자른다', [many.growth, many.rate, many.notes.some((n) => n.text.includes('까지만'))], [0.3, 1.3, true]);

  // 윤작 · 연작
  const same = affinity.modsFor(layout({ 4: 'carrot' }, { history: { 4: ['leaf', 'root'] } }), 4);
  eq('연작 — ×0.85 · 품질 −10 · 토질 0', [same.rotation, same.rate, same.quality, same.soil], ['same', 0.85, -10, 0]);
  const varied = affinity.modsFor(layout({ 4: 'carrot' }, { history: { 4: ['leaf', 'legume'] } }), 4);
  eq('윤작 — 품질 +10 · 토질 ×1.5', [varied.rotation, varied.quality, varied.soil], ['varied', 10, 1.5]);
  eq('기록이 하나면 윤작도 아니다', affinity.modsFor(layout({ 4: 'carrot' }, { history: { 4: ['leaf'] } }), 4).rotation, null);
  const streak = layout({ 4: 'carrot' });
  streak.plots[4].streak = 9;
  eq('비우지 않고 아홉 칸 넘게 거두면 연작', affinity.modsFor(streak, 4).rotation, 'same');
  const regrow = layout({ 4: 'cucumber' });
  regrow.plots[4].streak = 30;
  eq('재수확 작물은 이어 거둬도 연작이 아니다', affinity.modsFor(regrow, 4).rotation, null);
  eq('미리보기 — 다른 작물을 심으면', affinity.modsFor(layout({ 4: 'carrot' }, { history: { 4: ['root'] } }), 4, 'lettuce').rotation, null);

  // 규칙에 붙었나 — 성장 · 수확 토질 · history
  const g = layout({ 4: 'carrot', 1: 'onion' });
  rules.water(g, D0, 'u1', { budget: 1, plot: 4 });
  eq('물 한 번에 궁합만큼 자란다', g.plots[4].cells[0].g, 1.1);
  const v = rules.view(g, D0).plots[4].mods;
  eq('보기에 궁합이 실린다', [v.growth, v.rate, v.notes.length], [0.1, 1.1, 1]);
  const h = fresh();
  rules.plant(h, D0, { plot: P, cells: [0], crop: 'potato' });
  W(h, 0); at(h, 1); W(h, 1);
  rules.harvest(h, day(1), {}, { rand: ZERO });
  eq('밭이 비면 history 에 계열을 적는다', h.plots[P].history, ['root']);
  rules.plant(h, day(1), { plot: P, cells: [0], crop: 'carrot' });
  eq('같은 계열을 또 심으면 연작', rules.view(h, day(1)).plots[P].mods.rotation, 'same');
  h.plots[P].soilXp = 0;
  W(h, 1); at(h, 2); W(h, 2); at(h, 3); W(h, 3); at(h, 4); W(h, 4);
  rules.harvest(h, day(4), {}, { rand: ZERO });
  eq('연작 수확은 토질 경험이 없다', h.plots[P].soilXp, 0);
  eq('history 는 최근 셋까지', (() => { const x = fresh(); x.plots[P].history = ['a', 'b', 'c']; rules.plant(x, D0, { plot: P, cells: [0], crop: 'potato' }); W(x, 0); at(x, 1); W(x, 1); rules.harvest(x, day(1), {}, { rand: ZERO }); return x.plots[P].history; })(), ['b', 'c', 'root']);
}

// --- 2b: 거름 · 퇴비 · 곡괭이
{
  const f = fresh();
  eq('비료 +15', rules.fertilize(f, D0, { plot: P, item: 'fertilizer' }), { ok: true, item: 'fertilizer', used: 1, soil: 15, from: 1, to: 1, capped: false });
  eq('비료는 밭마다 하루 하나', rules.fertilize(f, D0, { plot: P, item: 'fertilizer' }).reason, 'fertCap');
  eq('퇴비 셋까지 — 넷을 넣으면 셋만', [rules.fertilize(f, D0, { plot: P, item: 'compost', count: 4 }).used, f.plots[P].soilXp], [3, 30]);
  eq('토질 ★2 가 됐다', land.soilStar(f.plots[P].soilXp), 2);
  eq('보기에 오늘 넣은 거름', rules.view(f, D0).plots[P].fert, { fertilizer: 1, compost: 3 });
  eq('다음 날엔 다시 넣는다', rules.fertilize(f, day(1), { plot: P, item: 'fertilizer' }).ok, true);
  eq('다음 날 보기엔 그날 것만', rules.view(f, day(1)).plots[P].fert, { fertilizer: 1 });
  eq('모르는 거름은 모양 오류', rules.fertilize(f, D0, { plot: P, item: 'dirt' }).bad, true);
  eq('잠긴 밭엔 못 넣는다', rules.fertilize(f, D0, { plot: 0, item: 'compost' }).reason, 'locked');
  f.plots[P].soilXp = 300;
  eq('★5 밭엔 안 넣는다', rules.fertilize(f, day(2), { plot: P, item: 'fertilizer' }).reason, 'soilMax');
}
{
  const f = fresh();
  f.compostBits = 2;
  f.plots[P].cells[0] = { t: 'weed' };
  const r = rules.clear(f, D0, { plot: P, cell: 0 }, {});
  eq('조각이 셋이 되면 퇴비 하나', [r.compost, r.loot.compost, f.compostBits], [1, 1, 0]);
  f.compostBits = 5;
  f.plots[P].cells[1] = { t: 'dead', why: 'dry' };
  const h = rules.harvest(f, D0);
  eq('수확에서도 퇴비로 바뀐다', [h.compost, h.items.compost, f.compostBits], [2, 2, 0]);
}
{
  const f = fresh();
  f.plots[P].cells[0] = { t: 'boulder', grain: 4, swings: 0, cracked: false };
  eq('나무 곡괭이는 거리를 안 준다', rules.clear(structuredClone(f), D0, { plot: P, cell: 0, pos: 1 }, { stamina: 5 }).hint, { dir: 'right', near: false });
  eq('철 곡괭이는 거리를 준다', rules.clear(structuredClone(f), D0, { plot: P, cell: 0, pos: 1 }, { stamina: 5, tool: 'iron' }).hint, { dir: 'right', near: false, dist: 3 });
  const c = rules.candidates(f);
  eq('미스릴 후보는 두 자리이고 결이 들어 있다', [c[P][0].length, c[P][0].includes(4)], [2, true]);
  eq('후보는 늘 같다', rules.candidates(structuredClone(f)), c);
  f.plots[P].cells[0].cracked = true;
  eq('금 간 바위는 후보가 없다', rules.candidates(f), {});
  eq('곡괭이 차례', [land.nextPickaxe('wood').key, land.nextPickaxe('iron').key, land.nextPickaxe('mithril')], ['iron', 'mithril', null]);
}

// --- 3c: 특수 작물 · 희귀 씨앗
{
  const lv = (f, n) => { f.xp = land.LEVEL_XP[n - 1]; return f; };
  // 물 욕심 — 쌀은 하루 굶으면 시들고 사흘이면 죽는다
  const r = lv(fresh(), 5);
  rules.plant(r, D0, { plot: P, cells: [0], crop: 'rice' });
  W(r, 0);
  at(r, 2);                                 // 1일째 굶김
  eq('쌀 — 하루 굶으면 🍂', state(r, 2), 'dry');
  eq('쌀 — 오늘 못 받으면 시든다(목마름 표시)', rules.view(r, day(2)).plots[P].thirsty, 0);
  at(r, 4);                                 // 2·3일째도 굶김 → thirst 3
  eq('쌀 — 사흘 굶으면 💀', cell(r), { t: 'dead', why: 'dry' });
  const c = fresh();
  rules.plant(c, D0, { plot: P, cells: [0], crop: 'carrot' });
  W(c, 0); at(c, 2);
  eq('보통 작물은 하루 굶어도 멀쩡', state(c, 2), 'seed');

  // 퍼짐 — 박하
  const m = lv(fresh(), 4);
  rules.plant(m, D0, { plot: P, cells: [0], crop: 'mint' });
  W(m, 0); at(m, 1); W(m, 1); at(m, 2); W(m, 2);
  const hm = rules.harvest(m, day(2), {}, { rand: ZERO });
  eq('박하를 거두면 한 포기 번진다', [hm.spread, m.plots[P].cells.filter((x) => x.t === 'plant').length], [1, 2]);

  // 비명 — 밭 한 번 거둘 때 한 번
  const s1 = fresh();
  rules.plant(s1, D0, { plot: P, cells: [0, 1], crop: 'screamRoot' }, { pouch: 2 });
  for (const x of s1.plots[P].cells.slice(0, 2)) Object.assign(x, { g: 7, ripeDay: D0 });
  eq('비명 뿌리 두 칸을 거둬도 비명은 한 번', rules.harvest(s1, D0, {}, { rand: ZERO }).screams, 1);

  // 희귀 — 주머니 씨앗 · 레벨 제한 없음
  const p1 = fresh();
  eq('씨앗이 모자라면 못 심는다', rules.plant(p1, D0, { plot: P, cells: [0, 1], crop: 'keeperBerry' }, { pouch: 1 }), { ok: false, reason: 'noSeed', crop: 'keeperBerry', have: 1, need: 2 });
  eq('Lv1 이어도 희귀는 심는다 · 골드 0 · 씨앗 둘', rules.plant(p1, D0, { plot: P, cells: [0, 1], crop: 'keeperBerry' }, { pouch: 5 }), { ok: true, cost: 0, count: 2, crop: 'keeperBerry', seeds: 2 });
  eq('레벨 올라도 희귀는 해금 목록에 없다', rules.gainXp(fresh(), 5000, Math.random).crops.some((k) => CROPS.find((x) => x.key === k).seedOnly), false);

  // 도망 — 익은 날 안 거두면 옆 빈 흙으로, 다시 셈해도 같은 칸
  const w1 = fresh();
  rules.plant(w1, D0, { plot: P, cells: [0], crop: 'walkingCap' }, { pouch: 1 });
  Object.assign(cell(w1), { g: 5, ripeDay: D0 });
  const w2 = structuredClone(w1);
  at(w1, 1); rules.tick(w2, day(1));
  const where = (f) => f.plots[P].cells.findIndex((x) => x.t === 'plant');
  eq('버섯갓이 도망갔다', [cell(w1).t, where(w1) > 0, w1.plots[P].cells[where(w1)].ripeDay], ['soil', true, day(1)]);
  eq('다시 셈해도 같은 칸으로', where(w1), where(w2));
  const w3 = fresh();
  rules.plant(w3, D0, { plot: P, cells: [0], crop: 'walkingCap' }, { pouch: 1 });
  Object.assign(cell(w3), { g: 5, ripeDay: D0 });
  for (let i = 1; i < 9; i += 1) w3.plots[P].cells[i] = { t: 'rock' };
  rules.tick(w3, day(1));
  eq('빈 흙이 없으면 사라진다', [cell(w3).t, w3.plots[P].crop], ['soil', 'walkingCap']);

  // 그늘 · 다년생
  const sh = lv(fresh(), 8);
  rules.plant(sh, D0, { plot: P, cells: [0], crop: 'pineMushroom' });
  eq('향송이 — 그늘이 없으면 절반', affinity.modsFor(sh, P).rate, 0.5);
  sh.plots[1] = { open: true, crop: 'sunflower', soilXp: 0, history: [], streak: 0, cells: Array.from({ length: 9 }, () => ({ t: 'plant', g: 0, thirst: 0, scar: false, ripeDay: null, planted: D0, wet: null })) };
  eq('해바라기 그늘이면 +10%', affinity.modsFor(sh, P).rate, 1.1);
  const pe = lv(fresh(), 6);
  pe.plots[P].history = ['leaf'];
  rules.plant(pe, D0, { plot: P, cells: [0], crop: 'asparagus' });
  eq('다년생은 연작을 안 따진다', affinity.modsFor(pe, P).rotation, null);

  // 희귀 씨앗 전리품 — 하루 상한
  const rolls = Array.from({ length: 400 }, () => land.rollLoot('perfect', Math.random, { seedLeft: 0 }));
  eq('상한이 막히면 씨앗이 안 나온다', rolls.some((k) => k.startsWith('seed:')), false);
  const b = fresh();
  b.plots[P].cells[0] = { t: 'boulder', grain: 2, swings: 0, cracked: false };
  let found = null;
  for (let n = 0; n < 200 && !found; n += 1) {
    const f = structuredClone(b);
    const r2 = rules.clear(f, D0, { plot: P, cell: 0, pos: 2 }, { stamina: 5, seedLeft: 1 });
    if (r2.found) found = r2;
  }
  eq('희귀 씨앗은 주머니로(아이템이 아니라)', [found?.found, Object.keys(found?.seeds ?? {}).every((k) => land.RARE_SEEDS.includes(k)), Object.keys(found?.loot ?? {}).some((k) => k.startsWith('seed'))], [1, true, false]);
}

// --- 3b: 품질 ★ · 거대 작물
{
  const carrot = CROPS.find((c) => c.key === 'carrot');
  const cell0 = { scar: false };
  const q = (o) => quality.rollQuality({ crop: carrot, soilStar: 1, cell: cell0, rand: ZERO, ...o });
  eq('★1 · 안 시듦 · 제철 · 난수 0 = 33점 보통', q({}), { score: 33, star: 0 });
  eq('난수 끝(40)이면 73점 ★', q({ rand: () => 0.999 }), { score: 73, star: 1 });
  eq('★5 면 65점 ★', q({ soilStar: 5 }), { score: 65, star: 1 });
  eq('★5 + 궁합 +20(윤작 포함) + 난수 끝 = 125 → ★★★', q({ soilStar: 5, mods: { quality: 20 }, rand: () => 0.999 }).star, 3);
  eq('시든 적 있으면 ★ 까지만', q({ soilStar: 5, cell: { scar: true }, mods: { quality: 20 }, rand: () => 0.999 }).star, 1);
  eq('과숙 −15', q({ overripe: true }).score, 18);
  eq('단계 경계', [49, 50, 74, 75, 94, 95].map(quality.starOf), [0, 1, 1, 2, 2, 3]);
  eq('작물 등급 보정', ['carrot', 'watermelon', 'pineMushroom', 'saffron'].map((k) => quality.gradeQuality(CROPS.find((c) => c.key === k))), [0, -5, -10, -15]);
  eq('거대 확률', [1, 5].map((x) => Math.round(quality.giantChance(x) * 100)), [14, 30]);
  eq('궁합 품질은 ±10 에서 자른다 (윤작 몫은 따로)', (() => {
    const f = fresh();
    const g = (crop) => ({ open: true, crop, soilXp: 0, history: [], streak: 0, cells: Array.from({ length: 9 }, () => ({ t: 'plant', g: 0, thirst: 0, scar: false, ripeDay: null, planted: D0, wet: null })) });
    f.plots[P] = { ...g('tomato'), history: ['leaf', 'root'] };
    for (const n of [1, 3, 5, 7]) f.plots[n] = g('basil');
    return affinity.modsFor(f, P).quality;               // 허브 넷 +20 → 10 · 윤작 +10
  })(), 20);

  // 거대 작물 — 아홉 칸이 다 익은 무 밭, Lv7
  const giantFarm = () => {
    const f = fresh();
    f.xp = land.LEVEL_XP[6];
    f.plots[P] = { open: true, crop: 'radish', soilXp: 0, history: [], streak: 0, cells: Array.from({ length: 9 }, () => ({ t: 'plant', g: 3, thirst: 0, scar: false, ripeDay: D0, planted: D0, wet: D0 })) };
    return f;
  };
  const gHit = giantFarm();
  const hg = rules.harvest(gHit, D0, {}, { rand: ZERO });
  eq('대왕 무 하나', [hg.items, hg.giants, hg.harvested], [{ giantRadish: 1 }, [{ crop: 'radish', plot: P }], 9]);
  eq('대왕 작물 경험치 +30', hg.xp >= 30, true);
  eq('밭이 비고 무가 기록된다', [gHit.plots[P].crop, gHit.plots[P].history], [null, ['root']]);
  const gMiss = giantFarm();
  const hm = rules.harvest(gMiss, D0, {}, { rand: seq(0.99, 0, 0.9, 0) });
  eq('못 합쳐지면 평소대로 아홉 칸 · 품질 +10', [hm.giants.length, crop(hm.items, 'radish'), hm.grades.radish.reduce((a, n) => a + n, 0)], [0, 9, 9]);
  const low = giantFarm(); low.xp = 0;
  eq('Lv7 전엔 거대 작물이 없다', rules.harvest(low, D0, {}, { rand: ZERO }).giants, []);
  const scar = giantFarm(); scar.plots[P].cells[4].scar = true;
  eq('한 칸이라도 시들었으면 없다', rules.harvest(scar, D0, {}, { rand: ZERO }).giants, []);
  const notAll = giantFarm(); notAll.plots[P].cells[4].ripeDay = null;
  eq('아홉 칸이 다 안 익었으면 없다', rules.harvest(notAll, D0, {}, { rand: ZERO }).giants, []);
  eq('거대가 안 되는 작물', quality.giantReady({ cells: giantFarm().plots[P].cells }, CROPS.find((c) => c.key === 'carrot'), 10), false);
  eq('수확 분포', rules.harvest(giantFarm(), D0, {}, { rand: seq(0.99, 0, 0.999) }).grades.radish.reduce((a, n) => a + n, 0), 9);
}

// --- 4a: 계절 · 날씨
{
  weather.pin(null);                                 // 여기서만 진짜 날씨
  eq('2026-09-21 은 가을 1일째', [weather.seasonOf('2026-09-21').key, weather.seasonOf('2026-09-21').day], ['autumn', 1]);
  eq('2주 뒤는 겨울 · 그 전 2주는 여름', [weather.seasonOf('2026-10-05').key, weather.seasonOf('2026-09-20').key], ['winter', 'summer']);
  eq('8주가 1년', weather.seasonOf('2026-11-16').key, 'autumn');
  eq('계절 확률표는 합이 100', Object.values(weather.TABLE).map((t) => Object.values(t).reduce((a, n) => a + n, 0)), [100, 100, 100, 100]);
  eq('날씨는 늘 같다', weather.weatherOf('2027-01-05').key, weather.weatherOf('2027-01-05').key);
  const days = Array.from({ length: 800 }, (_, n) => rules.addDays('2026-09-21', n));
  eq('겨울엔 폭염이 없다', days.filter((d) => weather.seasonOf(d).key === 'winter').some((d) => weather.weatherOf(d).key === 'heat'), false);
  eq('무지개는 비 온 다음 날에만', days.filter((d) => weather.weatherOf(d).key === 'rainbow').every((d) => weather.weatherOf(rules.addDays(d, -1)).water), true);
  eq('폭염엔 한 포기에 체력 2', [weather.hpCost(days.find((d) => weather.weatherOf(d).key === 'heat')), weather.hpCost(days.find((d) => weather.weatherOf(d).key === 'clear'))], [2, 1]);
  const lettuce = CROPS.find((c) => c.key === 'lettuce');
  const winterDay = days.find((d) => weather.seasonOf(d).key === 'winter');
  eq('상추는 겨울에 제철이 아니다', weather.inSeason(lettuce, winterDay), false);
  eq('겨울 보강 — 당근·양배추·비트·딸기는 겨울 제철', ['carrot', 'cabbage', 'beet', 'strawberry'].every((k) => weather.inSeason(CROPS.find((c) => c.key === k), winterDay)), true);
  eq('향송이와 희귀는 사계절', ['pineMushroom', 'screamRoot', 'walkingCap', 'keeperBerry'].every((k) => weather.allSeasons(CROPS.find((c) => c.key === k))), true);
  eq('제철 작물 수', weather.SEASONS.map((x) => CROPS.filter((c) => c.seasons.includes(x.key)).length).every((n) => n >= 15), true);

  // 날씨를 골라 가며 규칙을 본다
  const on = (map) => weather.pin({ weather: (d) => map[d] ?? 'clear', inSeason: true });
  on({ [day(1)]: 'rain' });
  const r1 = fresh();
  for (let i = 1; i < 9; i += 1) r1.plots[P].cells[i] = { t: 'rock' };   // 잡초(×0.95)가 끼지 않게
  rules.plant(r1, D0, { plot: P, cells: [0], crop: 'carrot' });
  W(r1, 0);
  const t1 = rules.tick(structuredClone(r1), day(1));
  eq('비 오는 날엔 물을 안 줘도 자라고 안 목마르다', [cell(t1).g, cell(t1).thirst, cell(t1).wet], [2, 0, day(1)]);
  eq('비 오는 날 물주기 → rain', rules.water(t1, day(1), 'u1').reason, 'rain');
  eq('오늘 비는 두 번 셈해도 같다', rules.tick(structuredClone(t1), day(1)), t1);
  at(r1, 3);
  eq('비 온 다음 날은 물을 받은 셈 · 그다음 날부터 목마르다', cell(r1).thirst, 1);

  on({ [D0]: 'cloudy' });
  const c1 = fresh();
  rules.plant(c1, D0, { plot: P, cells: [0], crop: 'carrot' });
  W(c1, 0);
  eq('흐리면 ×0.9', cell(c1).g, 0.9);

  weather.pin({ weather: 'clear', inSeason: false });
  const o1 = fresh();
  rules.plant(o1, D0, { plot: P, cells: [0], crop: 'carrot' });
  W(o1, 0);
  eq('제철이 아니면 ×0.7', cell(o1).g, 0.7);
  eq('제철이 아니면 보기에 표시', rules.view(o1, D0).plots[P].inSeason, false);
  eq('제철 품질 몫', [weather.qualityOf(lettuce, D0)], [weather.OFF_SEASON_QUALITY]);

  on({ [day(1)]: 'frost' });
  weather.pin({ weather: (d) => (d === day(1) ? 'frost' : 'clear'), inSeason: false });
  const f1 = fresh();
  rules.plant(f1, D0, { plot: P, cells: [0], crop: 'carrot' });
  W(f1, 0); at(f1, 1); W(f1, 1); at(f1, 2);
  eq('서리 — 제철이 아닌 칸이 물을 받았어도 상한다', cell(f1).thirst, 1);

  on({ [day(1)]: 'storm' });
  const s1 = fresh();
  s1.xp = land.LEVEL_XP[2];
  rules.plant(s1, D0, { plot: P, cells: [0, 1, 2, 3, 4, 5, 6, 7, 8], crop: 'corn' });
  W(s1, 0); at(s1, 1); W(s1, 1); at(s1, 2);
  const fell = s1.plots[P].cells.filter((c) => c.scar).length;
  eq('폭풍 — 옥수수 일부가 쓰러져 시든 흔적', fell > 0 && fell < 9, true);
  eq('쓰러진 칸은 🍂', rules.view(s1, day(2)).plots[P].cells.filter((x) => x === 'dry').length, fell);

  const hot = CROPS.find((c) => c.key === 'dragonChili');
  const moon = CROPS.find((c) => c.key === 'moonHerb');
  const rice = CROPS.find((c) => c.key === 'rice');
  on({ [D0]: 'heat', [day(1)]: 'rain', [day(2)]: 'cloudy' });
  eq('용의 고추 폭염 ×2 · 쌀 비 ×1.2 · 월광초 흐리면 0', [weather.growthOf(hot, D0), weather.growthOf(rice, day(1)), weather.growthOf(moon, day(2)), weather.growthOf(moon, day(3))], [2, 1.2, 0, 1]);
  on({ [D0]: 'downpour' });
  eq('폭우 날 뿌리 품질 −10', weather.qualityOf(CROPS.find((c) => c.key === 'carrot'), D0), 0);
  on({ [D0]: 'rainbow' });
  eq('무지개 날 품질 +10', weather.qualityOf(lettuce, D0), 20);
  weather.pin(NEUTRAL);
}

// --- 4b: 설비
{
  const { EQUIPS } = require('../src/farm/equip');
  eq('설비 다섯', EQUIPS.map((e) => e.key), ['rainBarrel', 'cover', 'drain', 'stakes', 'sprinkler']);
  const on = (map, inSeason = true) => weather.pin({ weather: (d) => map[d] ?? 'clear', inSeason });

  const e1 = fresh();
  eq('새 농장엔 설비가 없다', [e1.equip, rules.equipCount(e1)], [{ rainBarrel: false, drain: false, sprinkler: null }, 0]);
  eq('레벨이 모자라면 못 산다', rules.buyEquip(e1, D0, { key: 'rainBarrel' }), { ok: false, reason: 'equipLevel', key: 'rainBarrel', need: 4 });
  eq('모르는 설비는 bad', rules.buyEquip(e1, D0, { key: 'moat' }).bad, true);
  e1.xp = land.LEVEL_XP[9];
  rules.upgrade(e1);                                  // Lv10 — 밭이 다 열린다
  eq('빗물통 300', rules.buyEquip(e1, D0, { key: 'rainBarrel' }), { ok: true, key: 'rainBarrel', plots: [], cost: 300 });
  eq('이미 있으면 owned', rules.buyEquip(e1, D0, { key: 'rainBarrel' }).reason, 'owned');
  eq('덮개 — 밭 둘 · 밭당 80', rules.buyEquip(e1, D0, { key: 'cover', plots: [4, 1] }), { ok: true, key: 'cover', plots: [4, 1], cost: 160 });
  eq('덮개 — 이미 있는 밭은 빼고', rules.buyEquip(e1, D0, { key: 'cover', plots: [4, 3] }).plots, [3]);
  eq('덮개 — 다 있으면 owned', rules.buyEquip(e1, D0, { key: 'cover', plots: [4] }).reason, 'owned');
  eq('밭 번호가 이상하면 bad', [rules.buyEquip(e1, D0, { key: 'stakes', plots: [9] }).bad, rules.buyEquip(e1, D0, { key: 'stakes', plots: [2, 2] }).bad, rules.buyEquip(e1, D0, { key: 'stakes' }).bad], [true, true, true]);
  const e2 = fresh(); e2.xp = land.LEVEL_XP[5];
  eq('닫힌 밭엔 못 산다', rules.buyEquip(e2, D0, { key: 'stakes', plots: [8] }).reason, 'noPlot');
  eq('설비 수', rules.equipCount(e1), 4);
  const v1 = rules.view(e1, D0);
  eq('보기 — 설비 · 덮개', [v1.equip.rainBarrel, v1.plots[4].cover, v1.plots[4].stakes, v1.equipCount], [true, true, false, 4]);
  eq('옛 농장엔 빈 설비를 채운다', rules.upgrade({ ...structuredClone(fresh()), equip: undefined }).equip, { rainBarrel: false, drain: false, sprinkler: null });

  // 빗물통 — 폭염에도 1
  on({ [D0]: 'heat' });
  eq('폭염 체력 — 없으면 2 · 빗물통이면 1', [rules.hpCostOf(fresh(), D0), rules.hpCostOf(e1, D0)], [2, 1]);

  // 덮개 — 서리
  on({ [day(1)]: 'frost' }, false);
  const f1 = fresh();
  f1.plots[P].cover = true;
  rules.plant(f1, D0, { plot: P, cells: [0], crop: 'carrot' });
  W(f1, 0); at(f1, 1); W(f1, 1); at(f1, 2);
  eq('덮개가 서리를 막는다', cell(f1).thirst, 0);

  // 경고 — 내일 서리
  on({ [day(1)]: 'frost' }, false);
  const r1 = fresh();
  rules.plant(r1, D0, { plot: P, cells: [0], crop: 'carrot' });
  eq('내일 서리 — 덮개 없는 밭', rules.view(r1, D0).risk, { weather: 'frost', plots: [P] });
  r1.plots[P].cover = true;
  eq('덮개가 있으면 경고 없음', rules.view(r1, D0).risk, null);
  on({ [day(1)]: 'frost' }, true);
  r1.plots[P].cover = false;
  eq('제철이면 서리 경고 없음', rules.view(r1, D0).risk, null);

  // 지지대 — 폭풍
  on({ [day(1)]: 'storm' });
  const s1 = fresh();
  s1.xp = land.LEVEL_XP[2];
  s1.plots[P].stakes = true;
  rules.plant(s1, D0, { plot: P, cells: [0, 1, 2, 3, 4, 5, 6, 7, 8], crop: 'corn' });
  eq('내일 폭풍 — 지지대 있으면 경고 없음', rules.view(s1, D0).risk, null);
  W(s1, 0); at(s1, 1); W(s1, 1); at(s1, 2);
  eq('지지대가 폭풍을 막는다', s1.plots[P].cells.filter((c) => c.scar).length, 0);
  s1.plots[P].stakes = false;
  on({ [day(3)]: 'storm' });
  eq('내일 폭풍 — 지지대 없는 옥수수 밭', rules.view(s1, day(2)).risk, { weather: 'storm', plots: [P] });

  // 배수로 — 폭우 뿌리
  on({ [D0]: 'downpour' });
  const carrot = CROPS.find((c) => c.key === 'carrot');
  eq('배수로가 폭우 뿌리 −10 을 막는다', [weather.qualityOf(carrot, D0), weather.qualityOf(carrot, D0, { drain: true })], [0, 10]);

  // 스프링클러 — 한 주에 한 번
  weather.pin(NEUTRAL);
  eq('주는 월요일부터', [weather.weekOf('2026-09-21'), weather.weekOf('2026-09-27'), weather.weekOf('2026-09-28'), weather.weekOf('2026-09-20')], [0, 0, 1, -1]);
  const MON = '2026-09-28';
  const dd = (n) => rules.addDays(MON, n);
  const k1 = fresh();
  k1.xp = land.LEVEL_XP[8];
  rules.upgrade(k1);
  for (let i = 1; i < 9; i += 1) k1.plots[P].cells[i] = { t: 'rock' };
  k1.lastTickDay = rules.addDays(MON, -1);
  rules.plant(k1, MON, { plot: P, cells: [0], crop: 'saffron' });
  eq('스프링클러 1500', rules.buyEquip(k1, MON, { key: 'sprinkler' }).cost, 1500);
  const c0 = () => k1.plots[P].cells[0];
  rules.tick(k1, dd(1));                               // 월요일에 물을 안 줬다 → 스프링클러
  eq('못 준 날을 스프링클러가 — 안 목마르고 자란다', [c0().thirst, c0().g, c0().wet, k1.equip.sprinkler.last], [0, 1, MON, MON]);
  eq('물주기 경험치는 없다', k1.waterXpDay, null);
  eq('그 주엔 다 썼다', rules.view(k1, dd(1)).equip.sprinkler, { ready: false, last: MON });
  rules.tick(k1, dd(2));                               // 화요일도 안 줬다 → 목마르다
  eq('한 주에 한 번뿐', c0().thirst, 1);
  for (let n = 2; n <= 6; n += 1) { rules.tick(k1, dd(n)); rules.water(k1, dd(n), 'u1'); }
  rules.tick(k1, dd(8));                               // 다음 주 월요일(dd 7)에 안 줬다 → 다시
  eq('다음 주에 다시 쓴다', [k1.equip.sprinkler.last, rules.view(k1, dd(8)).equip.sprinkler.ready], [dd(7), false]);
  eq('몰아서 셈해도 같다', (() => {
    const a = structuredClone(k1); const b = structuredClone(k1);
    rules.tick(a, dd(20));
    for (let n = 9; n <= 20; n += 1) rules.tick(b, dd(n));
    return JSON.stringify(a) === JSON.stringify(b);
  })(), true);
  const k2 = fresh();
  k2.xp = land.LEVEL_XP[8];
  k2.lastTickDay = rules.addDays(MON, -1);
  rules.plant(k2, MON, { plot: P, cells: [0], crop: 'saffron' });
  rules.buyEquip(k2, dd(1), { key: 'sprinkler' });     // 화요일에 샀다 — 월요일 몫은 소급 안 한다
  rules.tick(k2, dd(1));
  eq('산 날 앞은 소급하지 않는다', [k2.plots[P].cells[0].thirst, k2.equip.sprinkler.last], [1, null]);
  weather.pin(NEUTRAL);
}

// --- 4c: 과수 · 뽑기
{
  const on = (map, inSeason = true) => weather.pin({ weather: (d) => map[d] ?? 'clear', inSeason });
  weather.pin(NEUTRAL);
  const t1 = fresh();
  t1.xp = land.LEVEL_XP[6];                        // Lv7
  eq('나무는 빈 흙 아홉 칸이어야', (() => { const f = structuredClone(t1); f.plots[P].cells[3] = { t: 'rock' }; return rules.plant(f, D0, { plot: P, cells: [0], crop: 'redApple' }).reason; })(), 'needClear');
  const tp = rules.plant(t1, D0, { plot: P, cells: [0, 1], crop: 'redApple' });
  eq('사과나무 — 묘목 10골드 · 한 그루', [tp.ok, tp.cost, tp.count, tp.tree], [true, 10, 1, true]);
  eq('가운데가 나무 · 둘레는 그늘', t1.plots[P].cells.map((c) => c.t), ['canopy', 'canopy', 'canopy', 'canopy', 'plant', 'canopy', 'canopy', 'canopy', 'canopy']);
  eq('보기 — 그늘 칸', rules.view(t1, D0).plots[P].cells.filter((x) => x === 'canopy').length, 8);
  eq('그늘엔 못 심는다', rules.plant(t1, D0, { plot: P, cells: [0], crop: 'redApple' }).reason === 'otherCrop' || rules.plant(t1, D0, { plot: P, cells: [0], crop: 'redApple' }).reason === 'occupied', true);
  eq('나무는 한 포기만 물', W(t1, 0).watered, 1);
  for (let n = 1; n < 10; n += 1) { at(t1, n); W(t1, n); }
  const tc = t1.plots[P].cells[rules.TREE_CELL];
  eq('사과는 열흘에 익는다', [tc.g, tc.ripeDay], [10, day(9)]);
  const th = rules.harvest(t1, day(9), {}, { rand: ZERO });
  eq('첫 수확 — ★1 토질 18개 · 경험치는 밭 한 판(9) + 첫 작물 10', [crop(th.items, 'redApple'), th.xp], [18, 19]);
  eq('나무는 남는다 · 그늘도', [t1.plots[P].crop, t1.plots[P].cells.filter((c) => c.t === 'canopy').length, tc.regrows], ['redApple', 8, 1]);
  eq('나무는 윤작 기록에 안 적힌다', t1.plots[P].history ?? [], []);

  // 휴면 — 제철이 아니면 물이 필요 없다
  weather.pin({ weather: 'clear', inSeason: false });
  eq('휴면 — 물 필요 없음', [rules.view(t1, day(10)).need, rules.view(t1, day(10)).plots[P].cells[rules.TREE_CELL], rules.view(t1, day(10)).plots[P].tree], [0, 'dormant', { dormant: true, fruited: true }]);
  eq('휴면 — 물주기는 noPlants', W(t1, 10).reason, 'noPlants');
  at(t1, 20);
  eq('휴면 — 열흘 굶어도 안 목마르고 안 자란다', [tc.thirst, tc.g, t1.plots[P].cells[rules.TREE_CELL].t], [0, 8, 'plant']);
  weather.pin(NEUTRAL);
  eq('제철이 오면 다시 자란다', rules.view(t1, day(20)).need, 1);
  for (let n = 20; n < 23; n += 1) { at(t1, n); W(t1, n); }
  const th2 = rules.harvest(t1, day(22), {}, { rand: ZERO });
  eq('재수확 2일 · 경험치 절반', [crop(th2.items, 'redApple'), th2.xp], [18, 4.5]);

  // 익은 채 오래 두면 열매만 떨어진다
  for (let n = 23; n < 26; n += 1) { at(t1, n); W(t1, n); }
  at(t1, 26 + rules.ROT_AFTER);
  eq('나무는 안 썩는다 — 열매만 떨어진다', [t1.plots[P].cells[rules.TREE_CELL].t, t1.plots[P].cells[rules.TREE_CELL].ripeDay], ['plant', null]);

  // 목마름 — 사흘에 시들고 이레에 죽는다
  const t2 = fresh(); t2.xp = land.LEVEL_XP[6];
  rules.plant(t2, D0, { plot: P, cells: [4], crop: 'grape' });
  W(t2, 0); at(t2, 3);
  eq('나무 — 이틀 굶어도 괜찮다', rules.view(t2, day(3)).plots[P].cells[rules.TREE_CELL], 'seed');
  at(t2, 4);
  eq('나무 — 사흘 굶으면 시든다', rules.view(t2, day(4)).plots[P].cells[rules.TREE_CELL], 'dry');
  at(t2, 8);
  eq('나무 — 이레면 죽는다', t2.plots[P].cells[rules.TREE_CELL].t, 'dead');
  rules.harvest(t2, day(8), {}, { rand: ZERO });
  eq('죽은 나무를 치우면 밭이 풀린다 · 그늘도 흙으로', [t2.plots[P].crop, t2.plots[P].cells.every((c) => c.t === 'soil')], [null, true]);

  // 폭풍엔 안 쓰러진다 · 그늘은 준다
  on({ [day(1)]: 'storm' });
  const t3 = fresh(); t3.xp = land.LEVEL_XP[6];
  rules.plant(t3, D0, { plot: P, cells: [4], crop: 'pear' });
  W(t3, 0); at(t3, 1); W(t3, 1); at(t3, 2);
  eq('폭풍 — 나무는 안 쓰러진다', t3.plots[P].cells[rules.TREE_CELL].scar, false);
  eq('내일 폭풍 경고에 나무 밭은 없다', (() => { on({ [day(3)]: 'storm' }); return rules.view(t3, day(2)).risk; })(), null);
  weather.pin(NEUTRAL);
  t3.plots[1] = { ...t3.plots[1], open: true, crop: 'pineMushroom', cells: Array(9).fill({ t: 'soil' }), soilXp: 0, history: [], streak: 0 };
  eq('나무 옆 향송이는 그늘을 받는다', require('../src/farm/affinity').modsFor(t3, 1).rate, 1.1);

  // 뽑기
  const u1 = fresh();
  rules.plant(u1, D0, { plot: P, cells: [0, 1, 2], crop: 'carrot' });
  eq('뽑기 — 작물이 아니면 notPlant', rules.clear(u1, D0, { plot: P, cell: 5, uproot: 'cell' }).reason, 'notPlant');
  eq('뽑기 — 이상한 방식은 bad', rules.clear(u1, D0, { plot: P, cell: 0, uproot: 'x' }).bad, true);
  const r1 = rules.clear(u1, D0, { plot: P, cell: 0, uproot: 'cell' });
  eq('뽑기 — 한 칸 · 기력 안 듦 · 작물은 남는다', [r1.ok, r1.removed, r1.used, r1.freed, u1.plots[P].crop, u1.plots[P].cells[0].t], [true, 1, 0, false, 'carrot', 'soil']);
  const r2 = rules.clear(u1, D0, { plot: P, cell: 1, uproot: 'plot' });
  eq('뽑기 — 밭 전체 · 작물이 풀린다 · 기록엔 안 적힌다', [r2.removed, r2.freed, u1.plots[P].crop, u1.plots[P].history ?? [], u1.compostBits], [2, true, null, [], 0]);
  const u2 = fresh(); u2.xp = land.LEVEL_XP[6];
  rules.plant(u2, D0, { plot: P, cells: [4], crop: 'peach' });
  const r3 = rules.clear(u2, D0, { plot: P, cell: 0, uproot: 'cell' });
  eq('뽑기 — 나무는 그늘 칸을 눌러도 밭 전체', [r3.ok, r3.tree, r3.freed, u2.plots[P].cells.every((c) => c.t === 'soil')], [true, true, true, true]);
  weather.pin(NEUTRAL);
}

// --- 5a: 주문
{
  const orders = require('../src/farm/orders');
  const { CROP_BY_KEY, STAR_MULT } = require('../src/farm/crops');
  weather.pin(null);
  const b1 = orders.boardOf('2026-10-01');
  eq('게시판 — 하루 셋 · 늘 같다', [b1.length, JSON.stringify(b1) === JSON.stringify(orders.boardOf('2026-10-01'))], [3, true]);
  eq('게시판 — Lv1~3 · 4~6 · 7+ 한 건씩', b1.map((o) => orders.tierOf(CROP_BY_KEY[o.crop])), [0, 1, 2]);
  eq('게시판 — 희귀 작물은 없다', b1.some((o) => CROP_BY_KEY[o.crop].seedOnly), false);
  const o0 = b1[0]; const c0 = CROP_BY_KEY[o0.crop];
  eq('기한 = 성장일 + 2', o0.due, rules.addDays('2026-10-01', c0.days + 2));
  eq('보상 = 값 × 수량 × 품질 × 4 + 성장일 × 12', o0.gold, Math.ceil(c0.price * o0.qty * STAR_MULT[o0.minStar] * orders.BOARD_GOLD) + c0.days * orders.BOARD_DAY_GOLD);
  eq('게시판 경험치 = 급 + 5', b1.map((o) => o.xp), [10, 15, 20]);
  const days = Array.from({ length: 200 }, (_, n) => rules.addDays('2026-09-21', n));
  const all = days.flatMap(orders.boardOf);
  eq('요구 품질은 ★ 이나 ★★', [...new Set(all.map((o) => o.minStar))].sort(), [1, 2]);
  eq('주문 id 는 겹치지 않는다', new Set(all.map((o) => o.id)).size, all.length);
  const act = orders.activeBoard('2026-10-01', {});
  eq('오늘 게시판 — 여섯 건 · 기한 안', [act.length, act.every((o) => o.due >= '2026-10-01')], [6, true]);
  eq('가져간 것은 빠진다', orders.activeBoard('2026-10-01', { [act[0].id]: { by: '1', channelId: '2', day: '2026-10-01' } }).some((o) => o.id === act[0].id), false);
  eq('가져간 기록은 오래되면 지운다', Object.keys(orders.pruneTaken({ a: { day: '2026-09-01' }, b: { day: '2026-09-30' } }, '2026-10-01')), ['b']);

  weather.pin(NEUTRAL);
  const r1 = fresh();
  rules.tick(r1, day(1));
  eq('개인 의뢰 — 하루 한 건(등록한 날 · 오늘) · Lv 에 맞는 작물', [r1.requests.length, CROP_BY_KEY[r1.requests[0].crop].lv, r1.requests[0].kind, r1.requests[0].xp], [2, 1, 'mine', 5]);
  const again = structuredClone(r1);
  rules.tick(again, day(1));
  eq('같은 날 다시 셈해도 같다', again.requests, r1.requests);
  r1.xp = land.LEVEL_XP[9];
  rules.tick(r1, day(1));
  eq('같은 날 레벨이 올라도 오늘 의뢰는 그대로', r1.requests, again.requests);
  rules.tick(r1, day(5));
  eq('세 건까지 쌓인다', r1.requests.length, 3);
  rules.tick(r1, day(30));
  eq('기한이 지나면 지운다', [r1.requests.length <= 3, r1.requests.every((o) => o.due >= day(30)), r1.requests.some((o) => o.day === day(1))], [true, true, false]);

  const o = { crop: 'carrot', qty: 5, minStar: 1 };
  eq('낮은 ★ 부터 뺀다', orders.takeFor(o, { carrot: 9, carrotS1: 2, carrotS2: 2, carrotS3: 4 }).take, { carrotS1: 2, carrotS2: 2, carrotS3: 1 });
  eq('보통 품질은 안 친다', orders.takeFor(o, { carrot: 9, carrotS1: 2 }), { take: null, have: 2 });
  eq('★★ 주문엔 ★ 이 안 들어간다', orders.takeFor({ ...o, minStar: 2 }, { carrotS1: 9, carrotS2: 5 }).take, { carrotS2: 5 });
  weather.pin(NEUTRAL);
}

// --- 1단계(MVP)에 연 농장 — 물 기록이 농장에 하루 하나였다
{
  // 1단계 코드(7893ca5)의 newFarm → plant → water 가 저장한 모양 그대로
  const old = {
    channelId: '111111', guildId: '1', owner: 'o', createdAt: `${D0}T01:00:00.000Z`, lastTickDay: day(-1),
    water: { day: D0, by: 'guest' },
    plots: Array.from({ length: 9 }, (_, i) => (i === P
      ? { open: true, crop: 'carrot', cells: [
        ...Array.from({ length: 4 }, () => ({ t: 'plant', g: 1, thirst: 0, scar: false, ripeDay: null, planted: D0 })),
        ...Array.from({ length: 5 }, () => ({ t: 'soil' })),
      ] }
      : { open: false, crop: null, cells: [] })),
  };
  const up = rules.upgrade(structuredClone(old));
  eq('옛 농장: 물 준 사람은 배열로', up.water.by, ['guest']);
  eq('옛 농장: 칸마다 wet 을 옮긴다', up.plots[P].cells.slice(0, 4).map((c) => c.wet), [D0, D0, D0, D0]);
  eq('옛 농장: 경험치·토질·퇴비는 0', [up.xp, up.plots[P].soilXp, up.plots[0].soilXp, up.compostBits, up.grown, up.fert], [0, 0, 0, 0, [], { day: null, plots: {} }]);
  eq('옛 농장: history · streak', [up.plots[P].history, up.plots[P].streak], [[], 0]);
  const behind = structuredClone(old); behind.xp = land.LEVEL_XP[2];          // Lv3 인데 밭은 하나
  const caught = rules.upgrade(structuredClone(behind));
  eq('레벨보다 덜 열린 밭은 읽을 때 연다(돌투성이로)', [caught.plots[1].open, caught.plots[3].open, caught.plots[1].cells.some((c) => c.t === 'rock' || c.t === 'boulder')], [true, true, true]);
  eq('그 밭은 몇 번 읽어도 같다', rules.upgrade(structuredClone(behind)).plots[1], caught.plots[1]);
  eq('upgrade 는 두 번 해도 같다', rules.upgrade(structuredClone(up)), up);
  eq('옛 농장: 오늘은 물을 다 줬다', rules.water(structuredClone(up), D0, 'o').reason, 'already');
  const t = rules.tick(rules.upgrade(structuredClone(old)), day(1));
  eq('옛 농장: 어제 준 물이 인정된다', t.plots[P].cells[0].thirst, 0);
  const w = rules.water(t, day(1), 'o');
  eq('옛 농장: 물주기 · 경험치 +2', [w.watered, t.xp], [4, 2]);
}

// ================================================================ 4. API

const app = require('../src/app');

const U = '1000001'; const V = '1000002'; const W2 = '1000003';
const CH = '2000001'; const CH2 = '2000002'; const G = '3000001';
const FILE = path.join(DIR, 'farms.json');
const readFile = () => JSON.parse(fs.readFileSync(FILE, 'utf-8'));
const writeFile = (d) => fs.writeFileSync(FILE, JSON.stringify(d));

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const hit = async (p, init = {}) => {
    const r = await fetch(base + p, {
      ...init,
      headers: { 'X-Bot-Key': 'test-key', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const post = (p, obj) => hit(p, { method: 'POST', body: JSON.stringify(obj) });
  const acct = async (id) => (await hit(`/accounts?ids=${id}`)).body.accounts[id];

  try {
    eq('키 없으면 401', (await hit('/farms/crops', { headers: { 'X-Bot-Key': '' } })).status, 401);
    const crops = (await hit('/farms/crops')).body.crops;
    eq('작물표에 레벨과 씨앗값', [crops.length, crops.find((c) => c.key === 'carrot').seed, crops.find((c) => c.key === 'tomato').lv], [CROPS.length, 1, 2]);
    eq('없는 농장', (await hit(`/farms/${CH}`)).body.farm, null);
    eq('이상한 채널 id 400', (await hit('/farms/abc')).status, 400);

    // --- 등록
    const reg = (await post('/farms/register', { channelId: CH, guildId: G, userId: U })).body;
    eq('등록', [reg.ok, reg.farm.level, reg.farm.sign], [true, 1, '🛖']);
    eq('남의 땅', (await post('/farms/register', { channelId: CH, guildId: G, userId: V })).body.reason, 'taken');
    eq('한 사람에 하나', (await post('/farms/register', { channelId: CH2, guildId: G, userId: U })).body.reason, 'hasFarm');
    eq('NPC 는 못 연다', (await post('/farms/register', { channelId: CH2, guildId: G, userId: 'npc:migel' })).status, 400);
    eq('주인에게는 기력·곡괭이를 준다', (await hit(`/farms/${CH}?user=${U}`)).body.me, { stamina: { left: 5, max: 5 }, pickaxe: 'wood', candidates: null, pouch: {} });
    eq('남에게는 안 준다', (await hit(`/farms/${CH}?user=${V}`)).body.me, null);

    // 가운데 밭을 알려진 모양으로 — 빈 흙 여섯 · 돌 둘 · 바위 하나(결 3)
    const d1 = readFile();
    d1.farms[CH].plots[4].cells = [
      { t: 'soil' }, { t: 'soil' }, { t: 'soil' }, { t: 'soil' }, { t: 'soil' }, { t: 'soil' },
      { t: 'rock' }, { t: 'rock' }, { t: 'boulder', grain: 3, swings: 0, cracked: false },
    ];
    writeFile(d1);

    // --- 심기
    const g0 = (await acct(U)).gold;
    eq('남은 못 심는다', (await post('/farms/plant', { channelId: CH, userId: V, plot: 4, cells: [0], crop: 'carrot' })).body.reason, 'notOwner');
    eq('레벨 모자람', (await post('/farms/plant', { channelId: CH, userId: U, plot: 4, cells: [0], crop: 'tomato' })).body.reason, 'level');
    const p1 = (await post('/farms/plant', { channelId: CH, userId: U, plot: 4, cells: [0, 1, 2, 3], crop: 'spinach' })).body;
    eq('시금치 네 칸 = 8골드', [p1.ok, p1.cost, p1.account.gold], [true, 8, g0 - 8]);

    // --- 물 — 체력
    await post('/accounts/deltas', { hp: { [V]: -97 } });     // 남이 체력 3 → 2포기만 줄 수 있다
    const w1 = (await post('/farms/water', { channelId: CH, userId: V })).body;
    eq('체력 3 → 2포기(1은 남긴다)', [w1.ok, w1.watered, w1.left, w1.hp, w1.helper], [true, 2, 2, 1, true]);
    eq('계정 체력도 1', (await acct(V)).hp, 1);
    eq('체력 1 이면 못 준다', (await post('/farms/water', { channelId: CH, userId: V })).body.reason, 'tired');
    const w2 = (await post('/farms/water', { channelId: CH, userId: U })).body;
    eq('주인이 나머지 둘 — 체력 −2 · 경험치 +2', [w2.watered, (await acct(U)).hp, w2.farm.xp], [2, 98, 2]);
    eq('오늘은 다 줬다', (await post('/farms/water', { channelId: CH, userId: U })).body.reason, 'already');
    eq('물 준 사람 둘', w2.farm.waterBy, [V, U]);
    eq('전적', [(await acct(V)).stats.farmHelp, (await acct(U)).stats.farmWater], [1, 1]);

    // --- 개간
    eq('남은 못 캔다', (await post('/farms/clear', { channelId: CH, userId: V, plot: 4, all: true })).body.reason, 'notOwner');
    const c1 = (await post('/farms/clear', { channelId: CH, userId: U, plot: 4, all: true })).body;
    eq('돌 둘 — 기력 3 남음', [c1.ok, c1.cleared, c1.stamina], [true, 2, { left: 3, max: 5 }]);
    const miss = (await post('/farms/clear', { channelId: CH, userId: U, plot: 4, cell: 8, pos: 1 })).body;
    eq('바위 빗나감 — 힌트 · 결은 안 샌다', [miss.broke, miss.hint.dir, JSON.stringify(miss).includes('grain')], [false, 'right', false]);
    eq('휘두른 횟수가 보인다', miss.farm.plots[4].swings, { 8: 1 });
    const br = (await post('/farms/clear', { channelId: CH, userId: U, plot: 4, cell: 8, pos: 3 })).body;
    eq('바위 깸 — 전리품이 계정으로', [br.broke, br.stamina.left, Object.keys(br.loot).every((k) => (br.account.items[k] ?? 0) >= 1)], [true, 1, true]);
    eq('기력은 계정 기준으로 남는다', readFile().daily[U].used, 4);
    eq('개간 전적', (await acct(U)).stats.farmClear, 3);

    // --- 수확: 날을 못 넘기니 파일을 고쳐 익혀 둔다
    const d2 = readFile();
    for (const c of d2.farms[CH].plots[4].cells.slice(0, 3)) Object.assign(c, { g: 2, ripeDay: dayKey() });
    writeFile(d2);
    const h1 = (await post('/farms/harvest', { channelId: CH, userId: U })).body;
    eq('시금치 셋 수확(품질은 굴림)', [h1.ok, crop(h1.items, 'spinach'), crop(h1.account.items, 'spinach')], [true, 3, 3]);
    eq('경험치 = 물 2 + 돌 2 + 바위 3 + 수확 3 + 첫 작물 10 (+ 품질 0~3)', h1.farm.xp >= 20 && h1.farm.xp <= 23, true);
    eq('20 이면 Lv2 — 2번 밭', [h1.levelUp?.to, h1.levelUp?.opened], [2, [1]]);
    eq('수확 전적', (await acct(U)).stats.farmHarvest, 3);

    // --- 레벨업이 응답에 실린다
    const d3 = readFile();
    d3.farms[CH].xp = 49;
    Object.assign(d3.farms[CH].plots[4].cells[3], { g: 2, ripeDay: dayKey() });
    writeFile(d3);
    const h2 = (await post('/farms/harvest', { channelId: CH, userId: U })).body;
    eq('레벨업 — Lv3 · 4번 밭', [h2.levelUp.to, h2.levelUp.opened, h2.farm.plots[3].open], [3, [3], true]);

    // --- 폐농 · 쿨다운
    eq('무르기', (await post('/farms/abandon', { userId: U })).body.free, true);
    eq('무르면 바로 다시 연다', (await post('/farms/register', { channelId: CH2, guildId: G, userId: U })).body.ok, true);
    eq('재등록해도 기력은 그대로', (await hit(`/farms/${CH2}?user=${U}`)).body.me.stamina.left, 1);
    const d4 = readFile();
    d4.farms[CH2].createdAt = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    writeFile(d4);
    const a2 = (await post('/farms/abandon', { userId: U })).body;
    eq('24시간 지난 폐농은 쿨다운', [a2.free, a2.until], [false, rules.addDays(dayKey(), 7)]);
    eq('쿨다운 중엔 못 연다', (await post('/farms/register', { channelId: CH, guildId: G, userId: U })).body.reason, 'cooldown');
    eq('다른 사람은 그 땅을 연다', (await post('/farms/register', { channelId: CH2, guildId: G, userId: W2 })).body.ok, true);

    // --- 2b: 거름 · 퇴비 · 곡괭이 (U 는 쿨다운 중이라 W2 의 CH2 농장으로 본다)
    eq('비료가 없으면', (await post('/farms/fertilize', { channelId: CH2, userId: W2, plot: 4, item: 'fertilizer' })).body.reason, 'noItem');
    await post('/accounts/deltas', { items: { [W2]: { fertilizer: 2, compost: 5, carrot: 12 } } });
    const f1 = (await post('/farms/fertilize', { channelId: CH2, userId: W2, plot: 4, item: 'fertilizer', count: 2 })).body;
    eq('비료 둘을 넣으려 하면 하나만 — 하나는 남는다', [f1.ok, f1.used, f1.capped, f1.account.items.fertilizer], [true, 1, true, 1]);
    eq('토질 경험 +15', f1.farm.plots[4].soilXp, 15);
    eq('오늘 두 번째 비료', (await post('/farms/fertilize', { channelId: CH2, userId: W2, plot: 4, item: 'fertilizer' })).body.reason, 'fertCap');
    const f2 = (await post('/farms/fertilize', { channelId: CH2, userId: W2, plot: 4, item: 'compost', count: 5 })).body;
    eq('퇴비는 셋까지 — 계정에서 셋만 빠진다', [f2.used, f2.account.items.compost, f2.farm.plots[4].star], [3, 2, 2]);
    eq('남은 거름을 못 넣는다', (await post('/farms/fertilize', { channelId: CH2, userId: V, plot: 4, item: 'compost' })).body.reason, 'notOwner');
    eq('모르는 거름 400', (await post('/farms/fertilize', { channelId: CH2, userId: W2, plot: 4, item: 'dirt' })).status, 400);

    const cp1 = (await post('/farms/compost', { userId: W2, crop: 'carrot', count: 2 })).body;
    eq('당근 열 개 → 퇴비 둘', [cp1.ok, cp1.used, cp1.account.items.carrot, cp1.account.items.compost], [true, 10, 2, 4]);
    eq('모자라면 안 만든다', (await post('/farms/compost', { userId: W2, crop: 'carrot', count: 1 })).body, { ok: false, reason: 'noItem', item: 'carrot', have: 2, need: 5, today: dayKey() });
    eq('작물이 아닌 것은 400', (await post('/farms/compost', { userId: W2, crop: 'beef' })).status, 400);

    eq('곡괭이 — 레벨 모자람', (await post('/farms/pickaxe', { userId: W2 })).body, { ok: false, reason: 'toolLevel', need: 6, tool: 'iron', today: dayKey() });
    const d6 = readFile(); d6.farms[CH2].xp = 820; writeFile(d6);    // Lv9
    await post('/accounts/deltas', { deltas: { [W2]: 2000 } });
    eq('곡괭이 — 철 덩어리가 없다', (await post('/farms/pickaxe', { userId: W2 })).body.reason, 'noItem');
    await post('/accounts/deltas', { items: { [W2]: { ironLump: 2, oreBlue: 1, oreRed: 2 } } });
    const g1 = (await acct(W2)).gold;
    const k1 = (await post('/farms/pickaxe', { userId: W2 })).body;
    eq('철 곡괭이 — 300골드 · 철 둘', [k1.tool, k1.account.gold, k1.account.items.ironLump ?? 0], ['iron', g1 - 300, 0]);
    const k2 = (await post('/farms/pickaxe', { userId: W2 })).body;
    eq('미스릴 — 원석 셋을 섞어서(많은 것부터)', [k2.tool, k2.paid.items], ['mithril', { oreRed: 2, oreBlue: 1 }]);
    eq('더 올릴 게 없다', (await post('/farms/pickaxe', { userId: W2 })).body.reason, 'maxTool');
    eq('곡괭이 표', (await hit(`/farms/tools/${W2}`)).body.tool, 'mithril');
    const d7 = readFile();
    d7.farms[CH2].plots[4].cells[8] = { t: 'boulder', grain: 2, swings: 0, cracked: false };
    writeFile(d7);
    const mine = (await hit(`/farms/${CH2}?user=${W2}`)).body.me;
    eq('미스릴이면 주인에게 결 후보', [mine.pickaxe, mine.candidates[4][8].includes(2), mine.candidates[4][8].length], ['mithril', true, 2]);
    eq('남에게는 후보가 없다', (await hit(`/farms/${CH2}?user=${V}`)).body.me, null);
    eq('공개 화면에는 결도 후보도 없다', JSON.stringify((await hit(`/farms/${CH2}`)).body).includes('candidates'), false);
    const miss2 = (await post('/farms/clear', { channelId: CH2, userId: W2, plot: 4, cell: 8, pos: 5 })).body;
    eq('미스릴도 빗나가면 거리를 준다', miss2.hint, { dir: 'left', near: false, dist: 3 });

    // --- 3a: 궁합 미리보기
    const pv = (await hit(`/farms/${CH2}/preview?plot=4&crop=carrot`)).body.mods;
    eq('미리보기', [typeof pv.rate, Array.isArray(pv.notes)], ['number', true]);
    eq('미리보기 — 모르는 작물 400', (await hit(`/farms/${CH2}/preview?plot=4&crop=rose`)).status, 400);
    const pall = (await hit(`/farms/${CH2}/preview?plot=4`)).body.all;
    eq('미리보기 — 작물을 안 주면 전부', [Object.keys(pall).length, typeof pall.carrot.rate], [CROPS.length, 'number']);
    eq('미리보기 — 밭 번호 400', (await hit(`/farms/${CH2}/preview?plot=9&crop=carrot`)).status, 400);
    eq('미리보기 — 없는 농장', (await hit(`/farms/2999999/preview?plot=4&crop=carrot`)).body.mods, null);
    eq('보기에 궁합이 실린다', 'mods' in (await hit(`/farms/${CH2}`)).body.farm.plots[4], true);

    // --- 3c: 희귀 씨앗 주머니 · 비명과 귀마개 (W2 의 CH2 농장)
    const d8 = readFile();
    d8.pouches = { [W2]: { screamRoot: 1 } };
    d8.farms[CH2].plots[4].cells = d8.farms[CH2].plots[4].cells.map(() => ({ t: 'soil' }));
    d8.farms[CH2].plots[4].crop = null;
    writeFile(d8);
    eq('씨앗이 모자라면', (await post('/farms/plant', { channelId: CH2, userId: W2, plot: 4, cells: [0, 1], crop: 'screamRoot' })).body.reason, 'noSeed');
    const gp = (await acct(W2)).gold;
    const sp = (await post('/farms/plant', { channelId: CH2, userId: W2, plot: 4, cells: [0], crop: 'screamRoot' })).body;
    eq('주머니 씨앗으로 심는다 — 골드 그대로 · 주머니 비움', [sp.ok, sp.cost, sp.account.gold, sp.me.pouch], [true, 0, gp, {}]);
    eq('파일의 주머니도 비었다', readFile().pouches[W2], {});
    const d9 = readFile();
    Object.assign(d9.farms[CH2].plots[4].cells[0], { g: 7, ripeDay: dayKey() });
    writeFile(d9);
    await post('/accounts/deltas', { hp: { [W2]: 100 } });
    const hs = (await post('/farms/harvest', { channelId: CH2, userId: W2 })).body;
    eq('귀마개 없이 비명 — 체력 −5', [hs.screams, hs.plugs, hs.hpLost, hs.hp], [1, 0, 5, 95]);
    await post('/accounts/deltas', { items: { [W2]: { earPlug: 1 } } });
    const d10 = readFile();
    d10.pouches[W2] = { screamRoot: 1 };
    writeFile(d10);
    await post('/farms/plant', { channelId: CH2, userId: W2, plot: 4, cells: [0], crop: 'screamRoot' });
    const d11 = readFile();
    Object.assign(d11.farms[CH2].plots[4].cells[0], { g: 7, ripeDay: dayKey() });
    writeFile(d11);
    const hs2 = (await post('/farms/harvest', { channelId: CH2, userId: W2 })).body;
    eq('귀마개가 막는다', [hs2.plugs, hs2.hpLost, hs2.account.items.earPlug ?? 0], [1, 0, 0]);
    await post('/accounts/deltas', { hp: { [W2]: -93 } });      // 체력 2
    const d12 = readFile();
    d12.pouches[W2] = { screamRoot: 1 };
    writeFile(d12);
    await post('/farms/plant', { channelId: CH2, userId: W2, plot: 4, cells: [0], crop: 'screamRoot' });
    const d13 = readFile();
    Object.assign(d13.farms[CH2].plots[4].cells[0], { g: 7, ripeDay: dayKey() });
    writeFile(d13);
    eq('비명도 체력 1 은 남긴다', (await post('/farms/harvest', { channelId: CH2, userId: W2 })).body.hp, 1);

    // --- 3b: 도감
    const bk = (await hit(`/farms/book/${W2}`)).body;
    eq('도감 — 비명 뿌리 세 번 거둠', [bk.book.screamRoot?.n, bk.total], [3, CROPS.length]);
    eq('도감 — 이상한 id 400', (await hit('/farms/book/abc')).status, 400);
    eq('도감 — 안 키운 사람은 빈 도감', (await hit('/farms/book/1999999')).body.book, {});

    // --- 4a: 날씨 · 폭염 체력
    const wf = (await hit('/farms/weather?days=3')).body;
    eq('날씨 라우트', [typeof wf.today, typeof wf.today.weather.emoji, typeof wf.today.season.name, wf.day, wf.tomorrow.day, wf.ahead.length, Array.isArray(wf.inSeason)], ['object', 'string', 'string', dayKey(), rules.addDays(dayKey(), 1), 3, true]);
    weather.pin({ weather: 'heat', inSeason: true });
    const d20 = readFile();
    d20.farms[CH2].plots[4].cells = d20.farms[CH2].plots[4].cells.map(() => ({ t: 'plant', g: 0, thirst: 0, scar: false, ripeDay: null, planted: dayKey(), wet: null }));
    d20.farms[CH2].plots[4].crop = 'carrot';
    writeFile(d20);
    await post('/accounts/deltas', { hp: { [W2]: 100 } });
    await post('/accounts/deltas', { hp: { [W2]: -94 } });      // 체력 6 → 폭염이면 (6−1)/2 = 2포기
    const hw = (await post('/farms/water', { channelId: CH2, userId: W2 })).body;
    eq('폭염 — 한 포기에 체력 2', [hw.cost, hw.watered, hw.hp], [2, 2, 2]);
    weather.pin({ weather: 'rain', inSeason: true });
    eq('비 오는 날 — 물주기는 rain', (await post('/farms/water', { channelId: CH2, userId: W2 })).body.reason, 'rain');
    weather.pin(NEUTRAL);

    // --- 4b: 설비 (CH2 는 Lv10)
    const eqs = (await hit('/farms/equips')).body.equips;
    eq('설비 표', eqs.map((e) => [e.key, e.gold]), [['rainBarrel', 300], ['cover', 80], ['drain', 300], ['stakes', 80], ['sprinkler', 1500]]);
    eq('주인 아니면 못 산다', (await post('/farms/equip', { channelId: CH2, userId: U, key: 'drain' })).body.reason, 'notOwner');
    eq('모르는 설비 400', (await post('/farms/equip', { channelId: CH2, userId: W2, key: 'moat' })).status, 400);
    await post('/accounts/deltas', { deltas: { [W2]: 1000 } });
    const ge = (await acct(W2)).gold;
    const b1 = (await post('/farms/equip', { channelId: CH2, userId: W2, key: 'rainBarrel' })).body;
    eq('빗물통 — 300골드', [b1.ok, b1.account.gold, b1.farm.equip.rainBarrel], [true, ge - 300, true]);
    const b2 = (await post('/farms/equip', { channelId: CH2, userId: W2, key: 'stakes', plots: [4, 1, 0] })).body;
    eq('지지대 셋 — 240골드', [b2.plots, b2.cost, b2.account.gold, b2.farm.plots[1].stakes], [[4, 1, 0], 240, ge - 540, true]);
    eq('저장됐다', [readFile().farms[CH2].equip.rainBarrel, readFile().farms[CH2].plots[4].stakes], [true, true]);
    await post('/accounts/deltas', { deltas: { [W2]: -((await acct(W2)).gold - 100) } });   // 골드 100
    eq('골드가 모자라면 안 산다', (await post('/farms/equip', { channelId: CH2, userId: W2, key: 'sprinkler' })).body, { ok: false, reason: 'gold', need: 1500, gold: 100, today: dayKey() });
    eq('모자라면 농장도 그대로', readFile().farms[CH2].equip.sprinkler, null);
    weather.pin({ weather: 'heat', inSeason: true });
    const d21 = readFile();
    d21.farms[CH2].plots[4].cells = d21.farms[CH2].plots[4].cells.map(() => ({ t: 'plant', g: 0, thirst: 0, scar: false, ripeDay: null, planted: dayKey(), wet: null }));
    writeFile(d21);
    await post('/accounts/deltas', { hp: { [W2]: 100 } });
    await post('/accounts/deltas', { hp: { [W2]: -94 } });      // 체력 6 → 빗물통이면 5포기
    const hw2 = (await post('/farms/water', { channelId: CH2, userId: W2 })).body;
    eq('빗물통 — 폭염에도 체력 1', [hw2.cost, hw2.watered, hw2.hp], [1, 5, 1]);
    weather.pin(NEUTRAL);

    // --- 4c: 뽑기 · 나무 (CH2 는 Lv10)
    const d30 = readFile();
    d30.farms[CH2].plots[2] = { open: true, crop: null, soilXp: 0, history: [], streak: 0, cells: Array.from({ length: 9 }, () => ({ t: 'soil' })) };
    writeFile(d30);
    await post('/accounts/deltas', { deltas: { [W2]: 100 } });
    const gt = (await acct(W2)).gold;
    const tp1 = (await post('/farms/plant', { channelId: CH2, userId: W2, plot: 2, cells: [4], crop: 'lemon' })).body;
    eq('레몬나무 — 묘목 8골드', [tp1.ok, tp1.cost, tp1.account.gold, tp1.farm.plots[2].cells[0]], [true, 8, gt - 8, 'canopy']);
    const up1 = (await post('/farms/clear', { channelId: CH2, userId: W2, plot: 2, cell: 4, uproot: 'cell' })).body;
    eq('뽑기 API — 나무 한 그루 · 밭이 풀린다', [up1.ok, up1.kind, up1.freed, up1.farm.plots[2].crop], [true, 'uproot', true, null]);
    const st2 = (await acct(W2)).stats;
    eq('농장 칭호 전적 — 레벨 · 도감 · 베기', [st2.farmLevel, st2.farmBookKinds >= 1, st2.farmChop, st2.farmScream >= 1], [10, true, 1, true]);
    eq('뽑기 API — 이상한 방식 400', (await post('/farms/clear', { channelId: CH2, userId: W2, plot: 2, cell: 4, uproot: 'all' })).status, 400);
    eq('뽑기 API — 주인만', (await post('/farms/clear', { channelId: CH2, userId: U, plot: 2, cell: 4, uproot: 'cell' })).body.reason, 'notOwner');

    // --- 5a: 주문
    {
      weather.pin(null);
      const bd = (await hit(`/farms/board?channel=${CH2}`)).body;
      eq('게시판 라우트', [bd.board.length > 0, bd.board.length <= 6, Array.isArray(bd.mine), bd.mine.length >= 1], [true, true, true, true]);
      eq('채널 없이도 게시판', Array.isArray((await hit('/farms/board')).body.board), true);
      const bo = bd.board[0];
      eq('주문 id 가 이상하면 400', (await post('/farms/deliver', { channelId: CH2, userId: W2, orderId: 'x' })).status, 400);
      eq('주인만 납품', (await post('/farms/deliver', { channelId: CH2, userId: U, orderId: bo.id })).body.reason, 'notOwner');
      const nf = (await post('/farms/deliver', { channelId: CH2, userId: W2, orderId: bo.id })).body;
      eq('작물이 모자라면 noItem', [nf.reason, nf.need], ['noItem', bo.qty]);
      const star = `${bo.crop}S${bo.minStar}`;
      await post('/accounts/deltas', { items: { [W2]: { [star]: bo.qty + 1, [bo.crop]: 5 } } });
      const g0 = (await acct(W2)).gold;
      const dv = (await post('/farms/deliver', { channelId: CH2, userId: W2, orderId: bo.id })).body;
      eq('게시판 납품 — 골드 · 작물 · 경험치', [dv.ok, dv.account.gold, dv.account.items[star], dv.account.items[bo.crop], dv.xp], [true, g0 + bo.gold, 1, 5, bo.xp]);
      eq('먼저 가져간 농장이 임자', (await post('/farms/deliver', { channelId: CH2, userId: W2, orderId: bo.id })).body.reason, 'orderTaken');
      eq('가져간 주문은 게시판에서 빠진다', (await hit('/farms/board')).body.board.some((o) => o.id === bo.id), false);
      eq('가져간 기록이 저장됐다', readFile().board[bo.id].by, W2);
      const mo = bd.mine[0];
      await post('/accounts/deltas', { items: { [W2]: { [`${mo.crop}S3`]: mo.qty } } });
      const dm = (await post('/farms/deliver', { channelId: CH2, userId: W2, orderId: mo.id })).body;
      eq('개인 의뢰 납품 — 의뢰가 빠진다', [dm.ok, dm.farm.requests.some((o) => o.id === mo.id)], [true, false]);
      eq('끝난 의뢰는 다시 못 한다', (await post('/farms/deliver', { channelId: CH2, userId: W2, orderId: mo.id })).body.reason, 'orderExpired');
      eq('주문 전적', [(await acct(W2)).stats.farmOrders, (await acct(W2)).stats.farmBoard], [2, 1]);
      weather.pin(NEUTRAL);
    }

    // --- 1단계에 연 농장이 파일에 있을 때
    const d5 = readFile();
    d5.farms[CH] = {
      channelId: CH, guildId: G, owner: V, createdAt: new Date().toISOString(), lastTickDay: rules.addDays(dayKey(), -1),
      water: { day: dayKey(), by: V },
      plots: Array.from({ length: 9 }, (_, i) => (i === 4
        ? { open: true, crop: 'potato', cells: [
          { t: 'plant', g: 2, thirst: 0, scar: false, ripeDay: dayKey(), planted: dayKey() },
          { t: 'plant', g: 1, thirst: 0, scar: false, ripeDay: null, planted: dayKey() },
          ...Array.from({ length: 7 }, () => ({ t: 'soil' })),
        ] }
        : { open: false, crop: null, cells: [] })),
    };
    writeFile(d5);
    const o1 = (await hit(`/farms/${CH}`)).body.farm;
    eq('옛 농장 조회', [o1.level, o1.waterBy, o1.need], [1, [V], 0]);
    eq('옛 농장 물 — 이미 줬다', (await post('/farms/water', { channelId: CH, userId: V })).body.reason, 'already');
    const oh = (await post('/farms/harvest', { channelId: CH, userId: V })).body;
    eq('옛 농장 수확 · 경험치', [oh.ok, crop(oh.items, 'potato'), oh.farm.xp >= 11 && oh.farm.xp <= 12], [true, 1, true]);
    eq('옛 농장이 새 모양으로 저장된다', Array.isArray(readFile().farms[CH].water.by), true);

    // --- 손상된 파일은 0 으로 읽지 않는다
    fs.writeFileSync(FILE, '{"farms": {');
    eq('손상된 파일은 503', (await hit(`/farms/${CH2}`)).status, 503);
    eq('손상된 파일에 안 쓴다', (await post('/farms/register', { channelId: CH, guildId: G, userId: V })).status, 503);
    eq('파일은 그대로', fs.readFileSync(FILE, 'utf-8'), '{"farms": {');
  } finally {
    server.close();
    fs.rmSync(DIR, { recursive: true, force: true });
    console.log(`\n${bad ? '✗' : '✓'} ${ok + bad}건 중 통과 ${ok} · 실패 ${bad}`);
    process.exit(bad ? 1 : 0);
  }
});
