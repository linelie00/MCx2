/**
 * check-farm — 농장 규칙과 /api/farms 회귀 검사
 *
 *   node scripts/check-farm.js
 *
 * 둘로 나눠 본다.
 *   1. 규칙(`farm/rules.js`) — 날짜를 마음대로 넘기며 성장·시듦·죽음·과숙·재수확을 센다.
 *      실제 서버로는 하루를 기다려야 하는 것들이다
 *   2. API — 임시 DATA_DIR 에 진짜 앱을 띄워 등록·주인·골드·아이템이 두 파일에 맞게
 *      옮겨지는지 본다. 실제 데이터는 건드리지 않는다(check-accounts 와 같은 방식)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-'));
process.env.DATA_DIR = DIR;
process.env.BOT_KEY = 'test-key';

const rules = require('../src/farm/rules');
const { CROPS, CROP_BY_KEY, seedPrice, guaranteed } = require('../src/farm/crops');
const { dayKey } = require('../src/services/dayKey');

let ok = 0; let bad = 0;
const eq = (name, got, want) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { ok += 1; } else { bad += 1; console.log(`  ✗ ${name}\n     받음: ${JSON.stringify(got)}\n     기대: ${JSON.stringify(want)}`); }
};

// ================================================================ 1. 작물표

eq('씨앗값은 파는 값보다 싸다 (수확하면 반드시 남는다)', CROPS.filter((c) => !(seedPrice(c) >= 1 && seedPrice(c) < c.price)).map((c) => c.key), []);
eq('보장 이익은 성장일의 절반(올림)', CROPS.filter((c) => guaranteed(c) !== Math.min(Math.ceil(c.days / 2), c.price - 1)).map((c) => c.key), []);
eq('당근 씨앗 1골드', seedPrice(CROP_BY_KEY.carrot), 1);
eq('시금치 씨앗 2골드', seedPrice(CROP_BY_KEY.spinach), 2);
eq('키는 아이템 키 모양', CROPS.filter((c) => !/^[a-z][A-Za-z0-9]{0,39}$/.test(c.key)).map((c) => c.key), []);

// ================================================================ 2. 규칙

const D0 = '2026-09-01';
const day = (n) => rules.addDays(D0, n);
const fresh = () => rules.newFarm({ channelId: '111111', guildId: '222222', owner: '333333', today: D0, now: `${D0}T00:00:00.000Z` });
const P = rules.START_PLOT;
/** n일째로 넘어가서 셈한다. */
const at = (farm, n) => rules.tick(farm, day(n));
const cell = (farm, i = 0) => farm.plots[P].cells[i];
const state = (farm, n, i = 0) => rules.view(farm, day(n)).plots[P].cells[i];

eq('날짜 더하기', rules.addDays('2026-12-31', 1), '2027-01-01');
eq('윤년', rules.addDays('2028-02-28', 1), '2028-02-29');

{
  const f = fresh();
  eq('가운데 밭만 열림', f.plots.map((p) => p.open), [false, false, false, false, true, false, false, false, false]);
  eq('가운데 밭은 전부 빈 흙', f.plots[P].cells.every((c) => c.t === 'soil'), true);
  eq('잠긴 밭은 칸이 없다', f.plots[0].cells.length, 0);
}

// --- 심기
{
  const f = fresh();
  eq('당근 3칸 심기', rules.plant(f, D0, { plot: P, cells: [0, 1, 2], crop: 'carrot' }), { ok: true, cost: 3, count: 3, crop: 'carrot' });
  eq('다른 작물은 같은 밭에 못 심는다', rules.plant(f, D0, { plot: P, cells: [3], crop: 'potato' }).reason, 'otherCrop');
  eq('같은 작물은 더 심는다', rules.plant(f, D0, { plot: P, cells: [3], crop: 'carrot' }).ok, true);
  eq('심은 칸에 또 못 심는다', rules.plant(f, D0, { plot: P, cells: [0], crop: 'carrot' }).reason, 'occupied');
  eq('잠긴 밭', rules.plant(f, D0, { plot: 0, cells: [0], crop: 'carrot' }).reason, 'locked');
  eq('모르는 작물은 모양 오류', rules.plant(f, D0, { plot: P, cells: [4], crop: 'rose' }), { ok: false, reason: 'crop', bad: true });
  eq('겹친 칸은 모양 오류', rules.plant(f, D0, { plot: P, cells: [4, 4], crop: 'carrot' }).bad, true);
  eq('칸 9 는 모양 오류', rules.plant(f, D0, { plot: P, cells: [9], crop: 'carrot' }).bad, true);
  eq('빈 칸 목록은 모양 오류', rules.plant(f, D0, { plot: P, cells: [], crop: 'carrot' }).bad, true);
  eq('밭 번호 9 는 모양 오류', rules.plant(f, D0, { plot: 9, cells: [0], crop: 'carrot' }).bad, true);
}

// --- 물과 성장: 당근(3일)은 사흘 연속 물을 주면 셋째 날 다 자란다
{
  const f = fresh();
  rules.plant(f, D0, { plot: P, cells: [0], crop: 'carrot' });
  eq('심은 날은 새싹', state(f, 0), 'seed');
  eq('물 주기', rules.water(f, D0, 'u1'), { ok: true, grew: 1, revived: 0, ripened: 0 });
  eq('같은 날 또 못 준다', rules.water(f, D0, 'u2'), { ok: false, reason: 'already', by: 'u1' });
  at(f, 1); rules.water(f, day(1), 'u1');
  eq('이틀째 물 → 🌿', state(f, 1), 'grow');
  at(f, 2);
  eq('사흘째 물 → 다 자람', rules.water(f, day(2), 'u1').ripened, 1);
  eq('다 자람', state(f, 2), 'ripe');
  eq('다 자란 칸은 물을 안 먹는다', (at(f, 3), rules.water(f, day(3), 'u1').grew), 0);
  eq('사흘 지나면 과숙', state(f, 5), 'over');
  at(f, 7);
  eq('다 자란 지 닷새(과숙)여도 살아 있다', cell(f).t, 'plant');
  at(f, 8);
  eq('다 자란 날로부터 엿새째 썩는다', cell(f), { t: 'dead', why: 'rot' });
}

// --- 물을 준 날 심으면 그날치를 받는다
{
  const f = fresh();
  rules.water(f, D0, 'u1');
  rules.plant(f, D0, { plot: P, cells: [0], crop: 'potato' });
  eq('젖은 흙에 심으면 +1', cell(f).g, 1);
  at(f, 1); rules.water(f, day(1), 'u1');
  eq('감자(2일)는 이튿날 다 자람', cell(f).ripeDay, day(1));
}

// --- 시듦과 죽음
{
  const f = fresh();
  rules.plant(f, D0, { plot: P, cells: [0, 1], crop: 'carrot' });
  rules.water(f, D0, 'u1');
  at(f, 2);                              // 1일째를 건너뜀
  eq('하루 빠지면 thirst 1', cell(f).thirst, 1);
  eq('아직 안 시듦(성장만 멈춤)', [state(f, 2), cell(f).g], ['seed', 1]);
  eq('어제 못 받은 칸이 보인다', rules.view(f, day(2)).plots[P].thirsty, 2);
  at(f, 3);                              // 2일째도 건너뜀
  eq('이틀 빠지면 🍂', state(f, 3), 'dry');
  eq('시든 칸에 물 → 살아남', rules.water(f, day(3), 'u1').revived, 2);
  eq('시든 흔적이 남는다', cell(f).scar, true);
  eq('살아나며 자란다', cell(f).g, 2);
  at(f, 8);                              // 4~7일 넷을 건너뜀
  eq('나흘 빠지면 💀', cell(f), { t: 'dead', why: 'dry' });
  eq('죽은 칸 보임', state(f, 8), 'dead');
}

// --- 한 번에 몰아서 셈해도 하루씩 센 것과 같다
{
  const a = fresh(); const b = fresh();
  for (const f of [a, b]) { rules.plant(f, D0, { plot: P, cells: [0, 1, 2], crop: 'carrot' }); rules.water(f, D0, 'u1'); }
  for (let n = 1; n <= 9; n += 1) rules.tick(a, day(n));
  rules.tick(b, day(9));
  eq('몰아 세기 = 하루씩 세기', a, b);
  eq('lastTickDay 는 어제', b.lastTickDay, day(8));
  eq('두 번 세도 그대로', JSON.stringify(rules.tick(structuredClone(b), day(9))), JSON.stringify(b));
}

// --- 수확
{
  const f = fresh();
  rules.plant(f, D0, { plot: P, cells: [0, 1], crop: 'cucumber' });
  rules.plant(f, D0, { plot: P, cells: [2], crop: 'cucumber' });
  eq('익은 게 없으면 nothing', rules.harvest(f, D0).reason, 'nothing');
  rules.water(f, D0, 'u1'); at(f, 1); rules.water(f, day(1), 'u1');
  eq('오이 셋 수확', rules.harvest(f, day(1)), { ok: true, items: { cucumber: 3 }, harvested: 3, cleared: 0 });
  eq('재수확 작물은 칸이 남는다', cell(f).t, 'plant');
  eq('재수확 작물 밭은 작물이 그대로', f.plots[P].crop, 'cucumber');
  at(f, 2); rules.water(f, day(2), 'u1'); at(f, 3); rules.water(f, day(3), 'u1');
  eq('이틀 뒤 다시 익는다', rules.view(f, day(3)).plots[P].ripe, 3);
}
{
  const f = fresh();
  rules.plant(f, D0, { plot: P, cells: [0], crop: 'potato' });
  rules.plant(f, D0, { plot: P, cells: [1], crop: 'potato' });
  rules.water(f, D0, 'u1'); at(f, 1); rules.water(f, day(1), 'u1');
  f.plots[P].cells[1] = { t: 'dead', why: 'dry' };
  eq('감자 하나 거두고 하나 치움', rules.harvest(f, day(1), { plot: P }), { ok: true, items: { potato: 1 }, harvested: 1, cleared: 1 });
  eq('밭이 비면 작물도 비운다', f.plots[P].crop, null);
  eq('다른 작물을 심을 수 있다', rules.plant(f, day(1), { plot: P, cells: [0], crop: 'wheat' }).ok, true);
  eq('잠긴 밭 수확', rules.harvest(f, day(1), { plot: 0 }).reason, 'locked');
}

// --- 보기
{
  const f = fresh();
  rules.plant(f, D0, { plot: P, cells: [0, 1], crop: 'carrot' });
  rules.water(f, D0, 'u1');
  const v = rules.view(f, D0);
  eq('오늘 물 줌', [v.watered, v.waterBy], [true, 'u1']);
  eq('당근 남은 물주기', v.plots[P].left, 2);
  eq('잠긴 밭은 locked 아홉', v.plots[0].cells, Array(9).fill('locked'));
  eq('무르기 기한은 24시간 뒤', v.graceUntil, `${day(1)}T00:00:00.000Z`);
  eq('다음 날엔 물 안 줌', rules.view(f, day(1)).watered, false);
}

// ================================================================ 3. API

const app = require('../src/app');

const U = '1000001'; const V = '1000002'; const W = '1000003';
const CH = '2000001'; const CH2 = '2000002'; const G = '3000001';

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
  const gold = async (id) => (await hit(`/accounts?ids=${id}`)).body.accounts[id].gold;
  const acct = async (id) => (await hit(`/accounts?ids=${id}`)).body.accounts[id];

  try {
    eq('키 없으면 401', (await hit('/farms/crops', { headers: { 'X-Bot-Key': '' } })).status, 401);
    const crops = (await hit('/farms/crops')).body.crops;
    eq('작물표 여덟', crops.length, 8);
    eq('작물표에 씨앗값', crops.find((c) => c.key === 'carrot').seed, 1);
    eq('crops 가 채널 id 로 안 읽힌다', (await hit('/farms/crops')).status, 200);

    eq('없는 농장', (await hit(`/farms/${CH}`)).body.farm, null);
    eq('이상한 채널 id 400', (await hit('/farms/abc')).status, 400);

    // --- 등록
    eq('등록', (await post('/farms/register', { channelId: CH, guildId: G, userId: U })).body.ok, true);
    eq('파일에 써짐', Object.keys(JSON.parse(fs.readFileSync(path.join(DIR, 'farms.json'), 'utf-8')).farms), [CH]);
    eq('남의 땅', (await post('/farms/register', { channelId: CH, guildId: G, userId: V })).body, { ok: false, reason: 'taken', owner: U, today: dayKey() });
    eq('내 땅', (await post('/farms/register', { channelId: CH, guildId: G, userId: U })).body.reason, 'mine');
    eq('한 사람에 하나', (await post('/farms/register', { channelId: CH2, guildId: G, userId: U })).body.reason, 'hasFarm');
    eq('이상한 id 400', (await post('/farms/register', { channelId: 'x', guildId: G, userId: U })).status, 400);
    eq('NPC 는 못 연다', (await post('/farms/register', { channelId: CH2, guildId: G, userId: 'npc:migel' })).status, 400);
    eq('주인으로 찾기', (await hit(`/farms/by-owner/${U}`)).body.farm.channelId, CH);

    // --- 심기
    const g0 = await gold(U);
    eq('남은 못 심는다', (await post('/farms/plant', { channelId: CH, userId: V, plot: 4, cells: [0], crop: 'carrot' })).body.reason, 'notOwner');
    eq('모르는 작물 400', (await post('/farms/plant', { channelId: CH, userId: U, plot: 4, cells: [0], crop: 'rose' })).status, 400);
    const p1 = (await post('/farms/plant', { channelId: CH, userId: U, plot: 4, cells: [0, 1, 2, 3], crop: 'spinach' })).body;
    eq('시금치 네 칸 = 8골드', [p1.ok, p1.cost, p1.account.gold], [true, 8, g0 - 8]);
    eq('계정에도 빠짐', await gold(U), g0 - 8);
    eq('심은 칸이 보인다', (await hit(`/farms/${CH}`)).body.farm.plots[4].cells.slice(0, 5), ['seed', 'seed', 'seed', 'seed', 'soil']);

    // 골드가 모자라면 아무것도 안 바뀐다
    await post('/accounts/deltas', { deltas: { [U]: -(g0 - 8) + 1 } });   // 1골드만 남긴다
    const before = fs.readFileSync(path.join(DIR, 'farms.json'), 'utf-8');
    eq('골드 모자람', (await post('/farms/plant', { channelId: CH, userId: U, plot: 4, cells: [4, 5], crop: 'spinach' })).body, { ok: false, reason: 'gold', need: 4, gold: 1, today: dayKey() });
    eq('모자라면 농장 그대로', fs.readFileSync(path.join(DIR, 'farms.json'), 'utf-8'), before);
    eq('모자라면 골드 그대로', await gold(U), 1);

    // --- 물
    const w1 = (await post('/farms/water', { channelId: CH, userId: V })).body;
    eq('남이 물을 준다', [w1.ok, w1.grew, w1.helper], [true, 4, true]);
    eq('오늘 두 번은 안 된다', (await post('/farms/water', { channelId: CH, userId: U })).body.reason, 'already');
    eq('물 준 사람 전적', [(await acct(V)).stats.farmWater, (await acct(V)).stats.farmHelp], [1, 1]);
    eq('없는 농장에 물', (await post('/farms/water', { channelId: CH2, userId: U })).body.reason, 'none');

    // --- 수확: 날을 못 넘기니 파일을 고쳐 익혀 둔다
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'farms.json'), 'utf-8'));
    for (const c of raw.farms[CH].plots[4].cells.slice(0, 3)) Object.assign(c, { g: 2, ripeDay: dayKey() });
    fs.writeFileSync(path.join(DIR, 'farms.json'), JSON.stringify(raw));
    eq('남은 못 거둔다', (await post('/farms/harvest', { channelId: CH, userId: V })).body.reason, 'notOwner');
    const h1 = (await post('/farms/harvest', { channelId: CH, userId: U })).body;
    eq('시금치 셋 수확', [h1.ok, h1.items, h1.account.items.spinach], [true, { spinach: 3 }, 3]);
    eq('수확 전적', (await acct(U)).stats.farmHarvest, 3);
    eq('또 거둘 건 없다', (await post('/farms/harvest', { channelId: CH, userId: U })).body.reason, 'nothing');
    eq('안 익은 한 칸은 남는다', (await hit(`/farms/${CH}`)).body.farm.plots[4].cells.slice(0, 4), ['soil', 'soil', 'soil', 'grow']);

    // --- 폐농: 24시간 안이면 무르기
    eq('무르기', (await post('/farms/abandon', { userId: U })).body, { ok: true, channelId: CH, free: true, until: null, today: dayKey() });
    eq('없어짐', (await hit(`/farms/${CH}`)).body.farm, null);
    eq('없는 농장 폐농', (await post('/farms/abandon', { userId: U })).body.reason, 'none');
    eq('무르면 바로 다시 연다', (await post('/farms/register', { channelId: CH2, guildId: G, userId: U })).body.ok, true);

    // 24시간이 지난 폐농은 7일 쿨다운
    const raw2 = JSON.parse(fs.readFileSync(path.join(DIR, 'farms.json'), 'utf-8'));
    raw2.farms[CH2].createdAt = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    fs.writeFileSync(path.join(DIR, 'farms.json'), JSON.stringify(raw2));
    const a2 = (await post('/farms/abandon', { userId: U })).body;
    eq('24시간 지난 폐농은 쿨다운', [a2.free, a2.until], [false, rules.addDays(dayKey(), 7)]);
    eq('쿨다운 중엔 못 연다', (await post('/farms/register', { channelId: CH, guildId: G, userId: U })).body.reason, 'cooldown');
    eq('쿨다운이 보인다', (await hit(`/farms/by-owner/${U}`)).body.cooldownUntil, rules.addDays(dayKey(), 7));
    eq('다른 사람은 그 땅을 연다', (await post('/farms/register', { channelId: CH2, guildId: G, userId: W })).body.ok, true);

    // --- 손상된 파일은 0 으로 읽지 않는다
    fs.writeFileSync(path.join(DIR, 'farms.json'), '{"farms": {');
    eq('손상된 파일은 503', (await hit(`/farms/${CH2}`)).status, 503);
    eq('손상된 파일에 안 쓴다', (await post('/farms/register', { channelId: CH, guildId: G, userId: V })).status, 503);
    eq('파일은 그대로', fs.readFileSync(path.join(DIR, 'farms.json'), 'utf-8'), '{"farms": {');
  } finally {
    server.close();
    fs.rmSync(DIR, { recursive: true, force: true });
    console.log(`\n${bad ? '✗' : '✓'} ${ok + bad}건 중 통과 ${ok} · 실패 ${bad}`);
    process.exit(bad ? 1 : 0);
  }
});
