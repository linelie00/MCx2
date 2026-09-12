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
  eq('옛 기록에는 만든 것이 빈 배열', old.body.accounts['1000009'].crafts, []);
  eq('옛 기록에는 도감이 빈 객체', old.body.accounts['1000009'].enemies, {});
  eq('둘 다 있으면 gold 가 이긴다', old.body.accounts['1000010'].gold, 200);
  // null 은 `null <= 0` 이 참이라 그냥 두면 멀쩡한 계정이 죽은 것으로 읽힌다.
  eq('hp: null 은 죽음이 아니다', old.body.accounts['1000011'].hp, 100);
  eq('mt: null 도 0 으로', old.body.accounts['1000011'].mt, 0);

  // 한 번 쓰면 파일에서도 넘어간다
  eq('옛 계정에 delta 적용', (await post('/deltas', { deltas: { 1000009: -777 } })).body.accounts['1000009'].gold, 7000);
  const saved = JSON.parse(fs.readFileSync(FILE, 'utf-8')).accounts['1000009'];
  eq('파일에 gold 로 적힌다', saved.gold, 7000);
  eq('파일에서 chips 가 사라진다', saved.chips, undefined);

  // --- 하루 회복 — 사람은 /출첵, 미겔·마티암은 날이 바뀌면 저절로
  fs.writeFileSync(FILE, JSON.stringify({
    accounts: {
      2000001: { gold: 5000, hp: 50 },                        // 골드는 넉넉하고 다쳤다
      2000002: { gold: 5000, hp: 90 },                        // 거의 가득
      2000003: { gold: 5000, hp: 0 },                         // 쓰러졌다
      2000004: { gold: 5000, hp: 100 },                       // 가득
      2000005: { gold: 5000, hp: 40 },                        // 던전 안
      'npc:migel': { gold: 1000, hp: 50, healedAt: '2000-01-01' },
      'npc:matiam': { gold: 1000, hp: 0, healedAt: '2000-01-01' },
    },
  }), 'utf-8');
  const DH = require('../src/controllers/accountController').DAILY_HEAL;

  const h1 = await post('/claim', { id: '2000001' });
  eq('출첵으로 체력이 오른다', [h1.body.heal.healed, h1.body.heal.hp], [true, 50 + DH]);
  eq('골드가 넉넉해도 체력은 받는다', h1.body.refilled, false);
  eq('저장됐다', (await hit('?ids=2000001')).body.accounts['2000001'].hp, 50 + DH);
  // 골드 도장을 같이 쓰면 넉넉한 사람은 도장이 안 찍혀 하루에 몇 번이고 받는다.
  const h2 = await post('/claim', { id: '2000001' });
  eq('체력도 하루 한 번', [h2.body.heal.healed, h2.body.heal.reason], [false, 'claimed']);
  eq('두 번 받지 않았다', (await hit('?ids=2000001')).body.accounts['2000001'].hp, 50 + DH);

  eq('최대치에서 멈춘다', (await post('/claim', { id: '2000002' })).body.heal.hp, 100);

  const dead = await post('/claim', { id: '2000003' });
  eq('쓰러진 사람은 안 일어난다', [dead.body.heal.healed, dead.body.heal.reason, dead.body.heal.hp], [false, 'dead', 0]);

  const full = await post('/claim', { id: '2000004' });
  eq('가득이면 안 준다', [full.body.heal.healed, full.body.heal.reason], [false, 'full']);
  await post('/deltas', { hp: { 2000004: -30 } });
  eq('그날 다치면 받을 수 있다', (await post('/claim', { id: '2000004' })).body.heal.hp, 70 + DH);

  const skip = await post('/claim', { id: '2000005', heal: false });
  eq('heal:false 면 건너뛴다', [skip.body.heal.healed, skip.body.heal.reason], [false, 'skipped']);
  eq('체력 그대로', (await hit('?ids=2000005')).body.accounts['2000005'].hp, 40);
  eq('건너뛴 날은 나중에 받을 수 있다', (await post('/claim', { id: '2000005' })).body.heal.hp, 40 + DH);

  // NPC — 읽기만 해도 오늘 몫이 보이고, 몇 번을 읽어도 두 번 붙지 않는다
  const n1 = await hit('?ids=npc:migel,npc:matiam');
  eq('미겔은 저절로 회복', n1.body.accounts['npc:migel'].hp, 50 + DH);
  eq('쓰러진 마티암은 그대로', n1.body.accounts['npc:matiam'].hp, 0);
  eq('다시 읽어도 한 번만', (await hit('?ids=npc:migel')).body.accounts['npc:migel'].hp, 50 + DH);
  // 읽기에서는 저장하지 않지만, 그날 처음 쓸 때 **같은 값으로** 저장된다
  const w1 = await post('/deltas', { hp: { 'npc:migel': -10 } });
  eq('쓰기는 회복된 값 위에 얹힌다', w1.body.accounts['npc:migel'].hp, 50 + DH - 10);
  eq('그 뒤로는 같은 날 또 안 붙는다', (await hit('?ids=npc:migel')).body.accounts['npc:migel'].hp, 50 + DH - 10);
  const w2 = await post('/deltas', { hp: { 'npc:migel': -5 } });
  eq('다친 뒤에도 같은 날은 안 붙는다(싸우는 도중에 튀면 안 된다)', w2.body.accounts['npc:migel'].hp, 50 + DH - 15);
  eq('NPC 골드는 여전히 안 채운다', w2.body.accounts['npc:migel'].gold, 1000);

  // 가득 찬 채로 하루를 시작했다가 그날 다친 경우. **여기가 제일 틀리기 쉽다** —
  // "깎였을 때만 도장" 으로 짜면 아침엔 도장이 안 찍히고, 던전에서 다치는 순간 다음
  // 핸드의 쓰기에서 회복이 끼어들어 싸우던 도중에 체력이 튄다.
  fs.writeFileSync(FILE, JSON.stringify({
    accounts: { 'npc:migel': { gold: 1000, hp: 100, healedAt: '2000-01-01' } },
  }), 'utf-8');
  eq('가득이면 읽어도 그대로', (await hit('?ids=npc:migel')).body.accounts['npc:migel'].hp, 100);
  await post('/deltas', { hp: { 'npc:migel': -30 } });
  eq('그날 다쳐도 회복이 안 끼어든다', (await hit('?ids=npc:migel')).body.accounts['npc:migel'].hp, 70);
  const w3 = await post('/deltas', { hp: { 'npc:migel': -5 } });
  eq('다음 쓰기에서도 안 끼어든다', w3.body.accounts['npc:migel'].hp, 65);

  // --- 만든 것 — 넣고 빼기. 요리는 "재료 빼기 + 결과물 넣기" 가 한 번의 쓰기다
  const CK = '3000001';
  const dish = (id, over = {}) => ({
    id, kind: '요리', name: '꿀 바른 멧돼지 구이', grade: 'gold', heal: 28, price: 85,
    mt: 0, desc: '윤이 난다.', from: ['boarRib', 'honey'], dice: 14, score: 79, ...over,
  });
  await post('/deltas', { items: { [CK]: { boarRib: 1, honey: 1 } } });
  const k1 = await post('/deltas', {
    items: { [CK]: { boarRib: -1, honey: -1 } },
    crafts: { [CK]: { add: [dish('aaaa1111')] } },
    bump: { [CK]: { cooked: 1, bestCook: 3 } },
  });
  eq('재료가 빠지고 결과물이 들어온다',
    [k1.status, k1.body.accounts[CK].items, k1.body.accounts[CK].crafts.map((c) => c.name)],
    [200, {}, ['꿀 바른 멧돼지 구이']]);
  eq('만든 날은 서버가 찍는다', typeof k1.body.accounts[CK].crafts[0].at, 'string');
  eq('전적이 쌓인다', [k1.body.accounts[CK].stats.cooked, k1.body.accounts[CK].stats.bestCook], [1, 3]);
  eq('모르는 칸은 안 담는다',
    (await post('/deltas', { crafts: { [CK]: { add: [dish('aaaa2222', { hax: 1 })] } } })).body.accounts[CK].crafts[1].hax,
    undefined);

  // 재료가 모자라면 결과물도 안 들어간다 — **한 번의 쓰기**라서다
  const k2 = await post('/deltas', {
    items: { [CK]: { boarRib: -1 } },
    crafts: { [CK]: { add: [dish('aaaa3333')] } },
  });
  eq('재료가 없으면 409', k2.status, 409);
  eq('결과물도 안 들어갔다', (await hit(`?ids=${CK}`)).body.accounts[CK].crafts.length, 2);

  // 팔기 — 빼고 골드
  const g = (await hit(`?ids=${CK}`)).body.accounts[CK].gold;
  const k3 = await post('/deltas', { deltas: { [CK]: 85 }, crafts: { [CK]: { remove: ['aaaa1111'] } } });
  eq('팔면 빠지고 골드가 는다',
    [k3.body.accounts[CK].crafts.map((c) => c.id), k3.body.accounts[CK].gold], [['aaaa2222'], g + 85]);
  const k4 = await post('/deltas', { deltas: { [CK]: 85 }, crafts: { [CK]: { remove: ['aaaa1111'] } } });
  eq('없는 것을 두 번 팔면 409', k4.status, 409);
  eq('골드도 안 들어갔다', (await hit(`?ids=${CK}`)).body.accounts[CK].gold, g + 85);

  eq('같은 id 둘은 409', (await post('/deltas', { crafts: { [CK]: { add: [dish('aaaa2222')] } } })).status, 409);
  eq('이상한 등급은 400', (await post('/deltas', { crafts: { [CK]: { add: [dish('bbbb1111', { grade: 'mythic' })] } } })).status, 400);
  eq('회복량 범위 밖은 400', (await post('/deltas', { crafts: { [CK]: { add: [dish('bbbb1112', { heal: 500 })] } } })).status, 400);
  eq('이상한 id 는 400', (await post('/deltas', { crafts: { [CK]: { add: [dish('BAD!')] } } })).status, 400);
  eq('재료가 여섯이면 400', (await post('/deltas', { crafts: { [CK]: { add: [dish('bbbb1113', { from: ['a', 'b', 'c', 'd', 'e', 'f'] })] } } })).status, 400);

  // 가득 차면 못 만든다. **빼고 나서 넣으므로** 하나 팔며 하나 만드는 것은 된다.
  const { MAX_CRAFTS } = require('../src/controllers/accountController');
  const fill = Array.from({ length: MAX_CRAFTS - 1 }, (_, i) => dish(`cccc${String(i).padStart(4, '0')}`));
  eq('가득 채운다', (await post('/deltas', { crafts: { [CK]: { add: fill } } })).body.accounts[CK].crafts.length, MAX_CRAFTS);
  eq('가득이면 409', (await post('/deltas', { crafts: { [CK]: { add: [dish('dddd0001')] } } })).status, 409);
  const swap = await post('/deltas', { crafts: { [CK]: { remove: ['cccc0000'], add: [dish('dddd0001')] } } });
  eq('하나 빼며 하나 넣기는 된다', [swap.status, swap.body.accounts[CK].crafts.length], [200, MAX_CRAFTS]);

  // 옛 기록에는 칸이 없다 — 빈 배열로 읽는다
  eq('만든 것만 넣는 쓰기도 id 로 친다', (await post('/deltas', { crafts: { 3000002: { add: [dish('eeee0001')] } } })).status, 200);

  // --- 에너미 도감 — 더하기만. 이름이 키다
  const FK = '4000001';
  const f1 = await post('/deltas', { enemies: { [FK]: { 리톨: { met: 1 } } } });
  eq('만나면 적힌다', [f1.status, f1.body.accounts[FK].enemies], [200, { 리톨: { met: 1, won: 0 } }]);
  const f2 = await post('/deltas', { enemies: { [FK]: { 리톨: { met: 1, won: 1 }, '빨간 슬라임': { met: 1 } } } });
  eq('더해진다', f2.body.accounts[FK].enemies, { 리톨: { met: 2, won: 1 }, '빨간 슬라임': { met: 1, won: 0 } });
  eq('도감만 쓰는 것도 id 로 친다', f2.status, 200);
  eq('이상한 이름은 400', (await post('/deltas', { enemies: { [FK]: { '<script>': { met: 1 } } } })).status, 400);
  eq('모르는 칸은 400', (await post('/deltas', { enemies: { [FK]: { 리톨: { kill: 1 } } } })).status, 400);
  eq('음수는 400', (await post('/deltas', { enemies: { [FK]: { 리톨: { met: -1 } } } })).status, 400);
  eq('던전 칭호 카운터를 받는다',
    (await post('/deltas', { bump: { [FK]: { eliteKill: 1, soloWon: 1, dungeonDied: 1 } } })).body.accounts[FK].stats.eliteKill, 1);

  // --- 산 것 카운터 — own + 대문자 모양이면 받는다. MT 와 한 번에
  const OK_ = '4000002';
  await post('/deltas', { mt: { [OK_]: 3 } });
  const buy = await post('/deltas', { mt: { [OK_]: -1 }, bump: { [OK_]: { ownMamul: 1 } } });
  eq('칭호를 산다', [buy.status, buy.body.accounts[OK_].mt, buy.body.accounts[OK_].stats.ownMamul], [200, 2, 1]);
  const poor = await post('/deltas', { mt: { [OK_]: -5 }, bump: { [OK_]: { ownBard: 1 } } });
  eq('MT 가 모자라면 통째로 409', poor.status, 409);
  eq('409 면 산 것도 안 적힌다', (await hit(`?ids=${OK_}`)).body.accounts[OK_].stats.ownBard, undefined);
  eq('own 뒤가 소문자면 400', (await post('/deltas', { bump: { [OK_]: { ownbard: 1 } } })).status, 400);
  eq('own 만 있으면 400', (await post('/deltas', { bump: { [OK_]: { own: 1 } } })).status, 400);

  // --- 요트·토너먼트 칭호 카운터
  const YT = '4000003';
  const yt1 = await post('/deltas', { bump: { [YT]: { yachtPlayed: 1, yachtYacht: 1, yachtBonus: 1, yachtEmpty: 1, yachtWon: 1, yachtLast: 1, bestYacht: 180, tourneyWon: 1, tourneySecond: 1, tourneyFirstOut: 1, mobHuntWon: 1, comebackWon: 1 } } });
  eq('요트·토너먼트 카운터를 받는다', [yt1.status, yt1.body.accounts[YT].stats.bestYacht], [200, 180]);
  eq('요트 최고 점수는 큰 쪽만', (await post('/deltas', { bump: { [YT]: { bestYacht: 120 } } })).body.accounts[YT].stats.bestYacht, 180);

  // --- 물고기 도감 — 마릿수는 더하고 길이는 큰 쪽만
  const FI = '4000004';
  const fi1 = await post('/deltas', { fish: { [FI]: { minnow: { caught: 1, best: 12 } } } });
  eq('낚으면 적힌다', [fi1.status, fi1.body.accounts[FI].fish], [200, { minnow: { caught: 1, best: 12 } }]);
  const fi2 = await post('/deltas', { fish: { [FI]: { minnow: { caught: 1, best: 7 } } } });
  eq('마릿수는 더하고 길이는 큰 쪽만', fi2.body.accounts[FI].fish.minnow, { caught: 2, best: 12 });
  eq('더 큰 것을 잡으면 갱신', (await post('/deltas', { fish: { [FI]: { minnow: { caught: 1, best: 30 } } } })).body.accounts[FI].fish.minnow, { caught: 3, best: 30 });
  eq('도감만 쓰는 것도 id 로 친다', (await post('/deltas', { fish: { [FI]: { chipFish: { caught: 1, best: 9 } } } })).status, 200);
  eq('아이템 키 모양이 아니면 400', (await post('/deltas', { fish: { [FI]: { Minnow: { caught: 1 } } } })).status, 400);
  eq('모르는 칸은 400', (await post('/deltas', { fish: { [FI]: { minnow: { length: 1 } } } })).status, 400);
  eq('음수는 400', (await post('/deltas', { fish: { [FI]: { minnow: { caught: -1 } } } })).status, 400);
  eq('낚시 카운터를 받는다',
    (await post('/deltas', { bump: { [FI]: { fishRounds: 1, fishCaught: 1, fishEmpty: 1, fishFirstTry: 1, fishJunk: 1, fishCentipede: 1, fishLegend: 1, legendDish: 1, bestFishCm: 40 } } })).body.accounts[FI].stats.bestFishCm, 40);
  eq('최고 길이는 큰 쪽만', (await post('/deltas', { bump: { [FI]: { bestFishCm: 20 } } })).body.accounts[FI].stats.bestFishCm, 40);
  eq('옛 기록에는 도감이 빈 객체', (await hit('?ids=1000009')).body.accounts['1000009'].fish, {});

  // --- 낚시 하루 다섯 번
  const FT = '4000005';
  const tries = [];
  for (let i = 0; i < 6; i += 1) tries.push((await post('/fish', { id: FT })).body);
  eq('다섯 번까지 된다', tries.slice(0, 5).map((t) => [t.ok, t.left]), [[true, 4], [true, 3], [true, 2], [true, 1], [true, 0]]);
  eq('여섯 번째는 거절', [tries[5].ok, tries[5].left], [false, 0]);
  eq('도장이 찍혔다', (await hit(`?ids=${FT}`)).body.accounts[FT].fishedCount, 5);
  eq('이상한 id 는 400', (await post('/fish', { id: 'drop-table' })).status, 400);

  // 엿보기는 **세기만 한다** — 미끼로 여는 판이 하루 몫을 깎으면 안 된다.
  const FP = '4000006';
  const peeked = (await post('/fish', { id: FP, peek: true })).body;
  eq('안 쓴 사람을 엿보면 다섯', [peeked.ok, peeked.left, peeked.tries, peeked.peek], [true, 5, 5, true]);
  eq('엿봐도 도장은 안 찍힌다', (await hit(`?ids=${FP}`)).body.accounts[FP].fishedCount, 0);
  eq('다 쓴 사람을 엿보면 0', (await post('/fish', { id: FT, peek: true })).body.left, 0);
  eq('다 썼으면 엿보기도 ok 가 아니다', (await post('/fish', { id: FT, peek: true })).body.ok, false);
  eq('엿본 뒤에도 도장은 다섯 그대로', (await hit(`?ids=${FT}`)).body.accounts[FT].fishedCount, 5);

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
