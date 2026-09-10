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
const { DAILY_FLOOR } = require('../src/controllers/accountController');
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

  // --- 전적 카운터. 칩과 같은 쓰기로 들어간다.
  const st1 = await post('/deltas', { deltas: { 1000004: 100 }, bump: { 1000004: { hands: 1, won: 1 } } });
  eq('카운터가 쌓인다', st1.body.accounts['1000004'].stats.hands, 1);
  const st2 = await post('/deltas', { deltas: { 1000004: -50 }, bump: { 1000004: { hands: 1 } } });
  eq('더해진다', st2.body.accounts['1000004'].stats.hands, 2);
  eq('안 보낸 카운터는 그대로', st2.body.accounts['1000004'].stats.won, 1);
  eq('최고 잔액은 서버가 잰다', st2.body.accounts['1000004'].stats.peak, 1100);
  const mx = await post('/deltas', { deltas: { 1000004: 0 }, bump: { 1000004: { bestPot: 500 } } });
  eq('최댓값 갱신', mx.body.accounts['1000004'].stats.bestPot, 500);
  const mx2 = await post('/deltas', { deltas: { 1000004: 0 }, bump: { 1000004: { bestPot: 300 } } });
  eq('작은 값은 안 덮는다', mx2.body.accounts['1000004'].stats.bestPot, 500);
  eq('모르는 카운터는 400', (await post('/deltas', { deltas: { 1000004: 0 }, bump: { 1000004: { hax: 1 } } })).status, 400);
  eq('음수 카운터는 400', (await post('/deltas', { deltas: { 1000004: 0 }, bump: { 1000004: { hands: -1 } } })).status, 400);
  eq('deltas 에 없는 id 는 400', (await post('/deltas', { deltas: { 1000004: 0 }, bump: { 1000005: { hands: 1 } } })).status, 400);
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

  // --- NPC 는 자동으로 안 채워진다. `/급여` 가 delta 로 넣어 준다.
  await post('/deltas', { deltas: { 'npc:migel': -1000 } });
  eq('미겔 파산', (await hit('?ids=npc:migel')).body.accounts['npc:migel'].chips, 0);
  eq('조회해도 안 채워진다', (await hit('?ids=npc:migel')).body.accounts['npc:migel'].chips, 0);
  eq('급여는 그냥 delta 다', (await post('/deltas', { deltas: { 'npc:migel': 1000 } })).body.accounts['npc:migel'].chips, 1000);
  eq('부를 때마다 는다', (await post('/deltas', { deltas: { 'npc:migel': 1000 } })).body.accounts['npc:migel'].chips, 2000);
  eq('NPC 는 출첵 규칙을 안 탄다(사람 기준선 그대로)', DAILY_FLOOR, 1000);
  // --- 칭호. **이름이 아니라 키를 저장한다** — 나중에 이름을 고쳐도 달고 있던 게 안 날아간다.
  const t1 = await post('/title', { id: '1000004', title: 'puyo' });
  eq('칭호가 붙는다', t1.body.accounts['1000004'].title, 'puyo');
  eq('조회에도 나온다', (await hit('?ids=1000004')).body.accounts['1000004'].title, 'puyo');
  eq('칭호를 바꿔도 전적은 그대로', t1.body.accounts['1000004'].stats.hands, 2);
  eq('빈 값이면 벗는다', (await post('/title', { id: '1000004', title: '' })).body.accounts['1000004'].title, null);
  await post('/title', { id: '1000004', title: 'crown' });
  eq('null 로도 벗는다', (await post('/title', { id: '1000004', title: null })).body.accounts['1000004'].title, null);
  eq('한글 이름은 400(키만 받는다)', (await post('/title', { id: '1000004', title: '왕관' })).status, 400);
  eq('너무 긴 키 400', (await post('/title', { id: '1000004', title: 'x'.repeat(41) })).status, 400);
  eq('이상한 id 400', (await post('/title', { id: 'drop-table', title: 'crown' })).status, 400);
  eq('NPC 도 달 수 있다', (await post('/title', { id: 'npc:migel', title: 'firstStep' })).body.accounts['npc:migel'].title, 'firstStep');
  eq('본문 없으면 400', (await hit('/title', { method: 'POST' })).status, 400);
  eq('키 없으면 401', (await post('/title', { id: '1000004', title: 'crown' }, { 'X-Bot-Key': 'nope' })).status, 401);

  // --- 칭호가 보는 카운터들. 하나라도 빠지면 그 칭호는 영영 안 나온다.
  const titleKeys = ['allInWon', 'allInLost', 'allInHigh', 'handStraight', 'handFlush',
    'handFullHouse', 'handQuads', 'handStraightFlush', 'blackjacks', 'holdemHands', 'blackjackHands'];
  const tc = await post('/deltas', {
    deltas: { 1000004: 1 },
    bump: { 1000004: Object.fromEntries(titleKeys.map((k) => [k, 1])) },
  });
  eq('칭호가 보는 카운터를 전부 받는다', tc.status, 200);
  eq('전부 1 로 쌓였다', titleKeys.map((k) => tc.body.accounts['1000004'].stats[k]), titleKeys.map(() => 1));
  const bb = await post('/deltas', { deltas: { 1000004: 0 }, bump: { 1000004: { bestBet: 1000, bestHand: 5 } } });
  eq('최대 베팅은 큰 쪽만', bb.body.accounts['1000004'].stats.bestBet, 1000);
  eq('최고 족보도 큰 쪽만',
    (await post('/deltas', { deltas: { 1000004: 0 }, bump: { 1000004: { bestHand: 2 } } })).body.accounts['1000004'].stats.bestHand, 5);

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
