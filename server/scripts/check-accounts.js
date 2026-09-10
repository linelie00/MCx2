/**
 * check-accounts — /api/accounts 회귀 검사
 *
 *   node scripts/check-accounts.js
 *
 * 임시 DATA_DIR 에 진짜 앱을 띄워 두들긴다. 실제 데이터는 건드리지 않는다.
 * 골드는 유일본이라 손으로 curl 하며 확인할 만한 것이 아니다 — 특히 손상된 파일을
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
  eq('없는 id 는 1000', r1.body.accounts['1000001'].gold, 1000);
  eq('NPC 도 1000', r1.body.accounts['npc:migel'].gold, 1000);
  eq('아이템 틀 있음', r1.body.accounts['1000001'].items, {});
  eq('칭호 없음', r1.body.accounts['1000001'].title, null);
  eq('이상한 id 는 400', (await hit('?ids=drop-table')).status, 400);
  eq('빈 ids 400', (await hit('?ids=')).status, 400);

  // --- delta
  eq('delta 적용', (await post('/deltas', { deltas: { 1000001: -400 } })).body.accounts['1000001'].gold, 600);
  eq('같은 delta 또 보내면 또 적용(멱등 아님)',
    (await post('/deltas', { deltas: { 1000001: -400 } })).body.accounts['1000001'].gold, 200);
  eq('소수 400', (await post('/deltas', { deltas: { 1000001: 1.5 } })).status, 400);
  eq('-1000 아래로 가면 409', (await post('/deltas', { deltas: { 1000001: -5000 } })).status, 409);
  eq('409 뒤에도 잔액 그대로', (await hit('?ids=1000001')).body.accounts['1000001'].gold, 200);
  eq('본문 없으면 400', (await hit('/deltas', { method: 'POST' })).status, 400);

  // --- 전적 카운터. 골드와 같은 쓰기로 들어간다.
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
  // 카운터만 있는 쓰기도 되므로(토너먼트가 그렇게 쓴다) deltas 에 없는 id 는 이제 정상이다.
  eq('카운터만 있는 id 도 받는다', (await post('/deltas', { deltas: { 1000004: 0 }, bump: { 1000005: { hands: 1 } } })).status, 200);
  eq('이상한 id 는 여전히 400', (await post('/deltas', { bump: { 'drop-table': { hands: 1 } } })).status, 400);
  // --- 출첵
  const c1 = await post('/claim', { id: '1000001' });
  eq('출첵으로 1000', c1.body.gold, 1000);
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
  eq('미겔 파산', (await hit('?ids=npc:migel')).body.accounts['npc:migel'].gold, 0);
  eq('조회해도 안 채워진다', (await hit('?ids=npc:migel')).body.accounts['npc:migel'].gold, 0);
  eq('급여는 그냥 delta 다', (await post('/deltas', { deltas: { 'npc:migel': 1000 } })).body.accounts['npc:migel'].gold, 1000);
  eq('부를 때마다 는다', (await post('/deltas', { deltas: { 'npc:migel': 1000 } })).body.accounts['npc:migel'].gold, 2000);
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

  // --- MT · 체력 · 아이템. 넷이 **한 번의 쓰기**로 같이 움직인다.
  const A = '1000021';
  const fresh = (await hit(`?ids=${A}`)).body.accounts[A];
  eq('새 계정 MT 는 0', fresh.mt, 0);
  eq('새 계정 체력은 가득', fresh.hp, 100);
  eq('아이템은 빈 칸', fresh.items, {});

  const one = await post('/deltas', {
    deltas: { [A]: -300 }, mt: { [A]: 2 }, hp: { [A]: -40 },
    items: { [A]: { twig: 3, ruby: 1 } },
  });
  eq('한 번에 넷이 움직인다',
    [one.body.accounts[A].gold, one.body.accounts[A].mt, one.body.accounts[A].hp, one.body.accounts[A].items],
    [700, 2, 60, { twig: 3, ruby: 1 }]);

  eq('아이템은 더해진다', (await post('/deltas', { items: { [A]: { twig: 2 } } })).body.accounts[A].items.twig, 5);
  const gone = await post('/deltas', { items: { [A]: { ruby: -1 } } });
  eq('0 이 되면 칸을 지운다', 'ruby' in gone.body.accounts[A].items, false);
  eq('가진 것보다 많이 쓰면 409', (await post('/deltas', { items: { [A]: { twig: -99 } } })).status, 409);
  eq('아이템 키 모양이 아니면 400', (await post('/deltas', { items: { [A]: { '나뭇가지': 1 } } })).status, 400);
  eq('아이템 개수가 소수면 400', (await post('/deltas', { items: { [A]: { twig: 1.5 } } })).status, 400);

  // --- 골드를 하나도 안 옮기는 쓰기가 되어야 한다. 안 되면 MT 만 주는 보상이 사라진다.
  eq('MT 만 쓰기', (await post('/deltas', { mt: { [A]: 1 } })).body.accounts[A].mt, 3);
  eq('체력만 쓰기', (await post('/deltas', { hp: { [A]: 5 } })).body.accounts[A].hp, 65);
  eq('아이템만 쓰기', (await post('/deltas', { items: { [A]: { acorn: 1 } } })).body.accounts[A].items.acorn, 1);
  eq('전적만 쓰기', (await post('/deltas', { bump: { [A]: { dungeonWon: 1 } } })).body.accounts[A].stats.dungeonWon, 1);
  eq('골드는 그대로', (await hit(`?ids=${A}`)).body.accounts[A].gold, 700);
  eq('본문이 통째로 비면 400', (await hit('/deltas', { method: 'POST' })).status, 400);

  // --- MT 는 재화라 거절, 체력은 상태값이라 자른다
  eq('MT 가 모자라면 409', (await post('/deltas', { mt: { [A]: -99 } })).status, 409);
  eq('거절 뒤에도 MT 그대로', (await hit(`?ids=${A}`)).body.accounts[A].mt, 3);
  eq('체력은 위로 잘린다', (await post('/deltas', { hp: { [A]: 9999 } })).body.accounts[A].hp, 100);
  eq('체력은 아래로 잘린다', (await post('/deltas', { hp: { [A]: -9999 } })).body.accounts[A].hp, 0);
  eq('죽어도 잔액은 그대로', (await hit(`?ids=${A}`)).body.accounts[A].gold, 700);
  eq('다시 채울 수 있다', (await post('/deltas', { hp: { [A]: 100 } })).body.accounts[A].hp, 100);

  // --- **거절된 배치는 한 글자도 안 써야 한다.** 두 번 도는 구조(전부 계산 → 하나라도
  //     걸리면 아무것도 안 씀)가 사는지 본다. 아이템은 id 를 넘나들며 걸리는 유일한 값이라
  //     여기서 재는 것이 맞다.
  const B = '1000022';
  await post('/deltas', { items: { [B]: { acorn: 2 } } });
  const before = JSON.stringify((await hit(`?ids=${A},${B}`)).body.accounts);
  const nope = await post('/deltas', {
    items: { [A]: { twig: 1 }, [B]: { acorn: -5 } },   // 뒤엣것이 409
  });
  eq('한쪽이 걸리면 거절', nope.status, 409);
  eq('아무것도 안 써졌다', JSON.stringify((await hit(`?ids=${A},${B}`)).body.accounts), before);

  // --- 골드만 옮기면 나머지는 안 건드린다 (기존 호출부가 그대로 도는지)
  const keep = await post('/deltas', { deltas: { [A]: 100 } });
  eq('MT·체력·아이템 그대로',
    [keep.body.accounts[A].mt, keep.body.accounts[A].hp, keep.body.accounts[A].items.twig], [3, 100, 5]);

  // --- 옛 기록(chips)이 gold 로 넘어오는지. 돈 이름을 바꾸기 전에 저장된 계정이다.
  fs.writeFileSync(FILE, JSON.stringify({
    accounts: {
      1000009: { chips: 7777, title: 'crown', items: { twig: 2 }, stats: { hands: 5 }, refilledAt: null },
      1000010: { chips: 100, gold: 200 },
      1000011: { gold: 5, hp: null, mt: null },
    },
  }), 'utf-8');
  const old = await hit('?ids=1000009,1000010,1000011');
  eq('옛 chips 를 gold 로 읽는다', old.body.accounts['1000009'].gold, 7777);
  eq('옛 기록에도 MT·체력이 채워진다',
    [old.body.accounts['1000009'].mt, old.body.accounts['1000009'].hp], [0, 100]);
  eq('나머지 필드는 그대로', old.body.accounts['1000009'].title, 'crown');
  eq('전적도 그대로', old.body.accounts['1000009'].stats.hands, 5);
  eq('chips 는 응답에 안 나온다', old.body.accounts['1000009'].chips, undefined);
  eq('둘 다 있으면 gold 가 이긴다', old.body.accounts['1000010'].gold, 200);
  // null 은 `null <= 0` 이 참이라 그냥 두면 멀쩡한 계정이 죽은 것으로 읽힌다.
  eq('hp: null 은 죽음이 아니다', old.body.accounts['1000011'].hp, 100);
  eq('mt: null 도 0 으로', old.body.accounts['1000011'].mt, 0);

  // 한 번 쓰면 파일에서도 넘어간다
  eq('옛 계정에 delta 적용', (await post('/deltas', { deltas: { 1000009: -777 } })).body.accounts['1000009'].gold, 7000);
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf-8')).accounts['1000009'];
  eq('파일에 gold 로 적힌다', saved.gold, 7000);
  eq('파일에서 chips 가 사라진다', saved.chips, undefined);

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
