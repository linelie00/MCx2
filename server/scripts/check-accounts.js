/**
 * check-accounts — /api/accounts 회귀 검사
 *
 *   node scripts/check-accounts.js
 *
 * 임시 DATA_DIR 에 진짜 앱을 띄워 두들긴다. 실제 데이터는 건드리지 않는다.
 * 칩은 유일본이라 손으로 curl 하며 확인할 만한 것이 아니다 — 특히 손상된 파일을
 * 0 으로 읽지 않는지, 같은 delta 를 두 번 보내면 두 번 적용되는지(멱등이 아니라서
 * 봇 쪽 ledger 에 rebase 가 필요하다)는 매번 확인해야 한다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-'));
process.env.DATA_DIR = DIR;
process.env.BOT_KEY = 'test-key';

const app = require('../src/app');
const { DAILY_FLOOR, NPC_FLOOR } = require('../src/controllers/accountController');
const FILE = path.join(DIR, 'accounts.json');

let ok = 0; let bad = 0;
const eq = (name, got, want) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { ok += 1; } else { bad += 1; console.log(`  ✗ ${name}\n     받음: ${JSON.stringify(got)}\n     기대: ${JSON.stringify(want)}`); }
};

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}/api/accounts`;
  const hit = async (p, init = {}) => {
    const r = await fetch(base + p, {
      ...init,
      headers: { 'X-Bot-Key': 'test-key', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const post = (p, obj, headers) => hit(p, { method: 'POST', body: JSON.stringify(obj), headers });

  // --- 인증
  eq('키 없으면 401', (await hit('?ids=1000001', { headers: { 'X-Bot-Key': '' } })).status, 401);
  eq('틀린 키 401', (await hit('?ids=1000001', { headers: { 'X-Bot-Key': 'nope' } })).status, 401);

  // --- 조회
  const r1 = await hit('?ids=1000001,npc:migel');
  eq('없는 id 는 1000', r1.body.accounts['1000001'].chips, 1000);
  eq('NPC 도 1000', r1.body.accounts['npc:migel'].chips, 1000);
  eq('아이템 틀 있음', r1.body.accounts['1000001'].items, {});
  eq('칭호 없음', r1.body.accounts['1000001'].title, null);
  eq('이상한 id 는 400', (await hit('?ids=drop-table')).status, 400);
  eq('빈 ids 400', (await hit('?ids=')).status, 400);

  // --- delta
  eq('delta 적용', (await post('/deltas', { deltas: { 1000001: -400 } })).body.accounts['1000001'].chips, 600);
  eq('같은 delta 또 보내면 또 적용(멱등 아님)',
    (await post('/deltas', { deltas: { 1000001: -400 } })).body.accounts['1000001'].chips, 200);
  eq('소수 400', (await post('/deltas', { deltas: { 1000001: 1.5 } })).status, 400);
  eq('-1000 아래로 가면 409', (await post('/deltas', { deltas: { 1000001: -5000 } })).status, 409);
  eq('409 뒤에도 잔액 그대로', (await hit('?ids=1000001')).body.accounts['1000001'].chips, 200);
  eq('본문 없으면 400', (await hit('/deltas', { method: 'POST' })).status, 400);

  // --- 출첵
  const c1 = await post('/claim', { id: '1000001' });
  eq('출첵으로 1000', c1.body.chips, 1000);
  eq('채웠다고 표시', c1.body.refilled, true);
  const c2 = await post('/claim', { id: '1000001' });
  eq('하루 한 번', c2.body.refilled, false);
  eq('사유는 오늘 이미 받음', c2.body.reason, 'claimed');
  await post('/deltas', { deltas: { 1000001: -1000 } });
  eq('받은 날 또 파산해도 다시는 못 받는다', (await post('/claim', { id: '1000001' })).body.refilled, false);

  // 넉넉해서 못 받은 날은 **도장이 안 찍힌다** — 그날 파산하면 받을 수 있어야 한다
  const rich = await post('/claim', { id: '1000003' });
  eq('넉넉하면 안 준다', rich.body.refilled, false);
  eq('사유는 넉넉함', rich.body.reason, 'enough');
  await post('/deltas', { deltas: { 1000003: -1000 } });
  eq('그날 파산하면 받을 수 있다', (await post('/claim', { id: '1000003' })).body.refilled, true);

  // --- open (NPC 자동 충전). 사람보다 기준선이 높다 — 미들 자리에 앉을 수 있어야 해서.
  await post('/deltas', { deltas: { 'npc:migel': -900, 'npc:matiam': -100 } });
  const o1 = await post('/open', { ids: ['1000002', 'npc:migel', 'npc:matiam'] });
  eq('미겔은 NPC 기준선까지 채워짐', o1.body.accounts['npc:migel'].chips, NPC_FLOOR);
  eq('마티암도 마찬가지', o1.body.accounts['npc:matiam'].chips, NPC_FLOOR);
  eq('사람은 open 에서 안 채운다', o1.body.accounts['1000002'].chips, DAILY_FLOOR);
  eq('사람 기준선보다 높다 (미들 자리에 앉을 수 있어야 한다)', NPC_FLOOR > DAILY_FLOOR, true);
  await post('/deltas', { deltas: { 'npc:migel': -900 } });
  const o2 = await post('/open', { ids: ['npc:migel'] });
  eq('같은 날 두 번째 open 은 안 채운다', o2.body.accounts['npc:migel'].chips, NPC_FLOOR - 900);

  // --- 손상 파일
  fs.writeFileSync(FILE, '{ "accounts": {"1000001": ', 'utf-8');
  const broken = await hit('?ids=1000001');
  eq('반쪽 난 파일은 0 이 아니라 503', broken.status, 503);
  eq('손상 상태에서 쓰기도 503', (await post('/deltas', { deltas: { 1000001: 100 } })).status, 503);

  console.log(`\n${ok + bad}건 중 통과 ${ok} · 실패 ${bad}`);
  server.close();
  fs.rmSync(DIR, { recursive: true, force: true });
  process.exit(bad ? 1 : 0);
});
