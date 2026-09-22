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
const { CROPS, seedPrice, guaranteed } = require('../src/farm/crops');
const { dayKey } = require('../src/services/dayKey');

let ok = 0; let bad = 0;
const eq = (name, got, want) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { ok += 1; } else { bad += 1; console.log(`  ✗ ${name}\n     받음: ${JSON.stringify(got)}\n     기대: ${JSON.stringify(want)}`); }
};

const ZERO = () => 0;

// ================================================================ 1. 작물표

eq('씨앗값은 파는 값보다 싸다 (수확하면 반드시 남는다)', CROPS.filter((c) => !(seedPrice(c) >= 1 && seedPrice(c) < c.price)).map((c) => c.key), []);
eq('보장 이익은 성장일의 절반(올림)', CROPS.filter((c) => guaranteed(c) !== Math.min(Math.ceil(c.days / 2), c.price - 1)).map((c) => c.key), []);
eq('키가 안 겹친다', new Set(CROPS.map((c) => c.key)).size, CROPS.length);
eq('레벨은 1~5', CROPS.filter((c) => !(c.lv >= 1 && c.lv <= 5)).map((c) => c.key), []);
eq('Lv1 작물 여덟', CROPS.filter((c) => c.lv === 1).length, 8);
eq('키는 아이템 키 모양', CROPS.filter((c) => !/^[a-z][A-Za-z0-9]{0,39}$/.test(c.key)).map((c) => c.key), []);
eq('재수확은 성장일 이하', CROPS.filter((c) => c.regrow && c.regrow > c.days).map((c) => c.key), []);

// ================================================================ 2. 땅 · 레벨

eq('해시 난수는 늘 같다', land.hashRand('a', 1), land.hashRand('a', 1));
eq('해시 난수는 [0,1)', [land.hashRand('x'), land.hashRand('y', 2)].every((x) => x >= 0 && x < 1), true);
eq('토질 ★', [0, 19, 20, 60, 299, 300, 9999].map(land.soilStar), [1, 1, 2, 3, 4, 5, 5]);
eq('레벨', [0, 59, 60, 150, 2999, 3000, 99999].map(land.levelOf), [1, 1, 2, 3, 9, 10, 10]);
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
  eq('당근 3칸 심기', rules.plant(f, D0, { plot: P, cells: [0, 1, 2], crop: 'carrot' }), { ok: true, cost: 3, count: 3, crop: 'carrot' });
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
  W(f, 0); at(f, 1); W(f, 1);
  const h = rules.harvest(f, day(1), {}, { rand: ZERO });
  eq('오이 셋 수확(★1 은 칸마다 1)', [h.items, h.harvested], [{ cucumber: 3 }, 3]);
  eq('경험치 = 칸 3 + 첫 작물 10', h.xp, 13);
  eq('토질 경험 +3', f.plots[P].soilXp, 3);
  eq('재수확 작물은 칸이 남는다', [cell(f).t, f.plots[P].crop], ['plant', 'cucumber']);
  at(f, 2); W(f, 2); at(f, 3); W(f, 3);
  eq('이틀 뒤 다시 익는다', rules.view(f, day(3)).plots[P].ripe, 3);
  eq('두 번째부터는 첫 작물 보너스가 없다', rules.harvest(f, day(3), {}, { rand: ZERO }).xp, 3);
}
{
  const f = fresh();
  f.plots[P].soilXp = 300;                      // ★5 보통 작물은 칸마다 3
  rules.plant(f, D0, { plot: P, cells: [0, 1], crop: 'soybean' });
  W(f, 0); at(f, 1); W(f, 1);
  const h = rules.harvest(f, day(1), {}, { rand: ZERO });
  eq('★5 콩 두 칸 = 6개', h.items, { soybean: 6 });
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
  f.xp = 58;
  const up = rules.gainXp(f, 2, Math.random);
  eq('Lv2 — 2번 밭이 열린다', [up.from, up.to, up.opened], [1, 2, [1]]);
  eq('Lv2 작물이 풀린다', up.crops.includes('tomato'), true);
  eq('새 밭은 돌투성이', f.plots[1].cells.some((c) => c.t === 'rock' || c.t === 'boulder'), true);
  eq('오르지 않으면 null', rules.gainXp(f, 1, Math.random), null);
  const g = fresh(); g.xp = 0;
  eq('한 번에 여러 레벨', rules.gainXp(g, 500, Math.random).opened, [1, 3, 5, 7]);
  const o = fresh({ owner: 'boss' });
  rules.plant(o, D0, { plot: P, cells: [0], crop: 'carrot' });
  rules.plant(o, D0, { plot: P, cells: [1], crop: 'carrot' });
  eq('주인이 물 주면 +2', rules.water(o, D0, 'boss', { budget: 1 }).xp, 2);
  eq('그날 두 번째는 없다', rules.water(o, D0, 'boss', { budget: 1 }).xp, 0);
  const n = fresh({ owner: 'boss' });
  rules.plant(n, D0, { plot: P, cells: [0], crop: 'carrot' });
  eq('남이 물 주면 주인 경험치는 없다', rules.water(n, D0, 'guest').xp, 0);
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
    eq('주인에게는 기력을 준다', (await hit(`/farms/${CH}?user=${U}`)).body.me, { stamina: { left: 5, max: 5 } });
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
    eq('시금치 셋 수확', [h1.ok, h1.items, h1.account.items.spinach], [true, { spinach: 3 }, 3]);
    eq('경험치 = 물 2 + 돌 2 + 바위 3 + 수확 3 + 첫 작물 10', h1.farm.xp, 20);
    eq('수확 전적', (await acct(U)).stats.farmHarvest, 3);

    // --- 레벨업이 응답에 실린다
    const d3 = readFile();
    d3.farms[CH].xp = 59;
    Object.assign(d3.farms[CH].plots[4].cells[3], { g: 2, ripeDay: dayKey() });
    writeFile(d3);
    const h2 = (await post('/farms/harvest', { channelId: CH, userId: U })).body;
    eq('레벨업 — 2번 밭', [h2.levelUp.to, h2.levelUp.opened, h2.farm.plots[1].open], [2, [1], true]);

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
