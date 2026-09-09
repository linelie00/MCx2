/**
 * check-wallet — 장부와 서버 잔액이 어긋나지 않는지
 *
 *   node scripts/check-wallet.mjs [핸드수]
 *
 * 가짜 서버를 하나 두고 **진짜 state.js** 로 판을 돌린다. 핸드가 끝날 때마다
 * `deltas()` 를 서버에 얹고 `rebase()` 한 뒤, 서버 잔액이 장부와 **id 별로** 같은지 본다.
 *
 * **총합이 아니라 id 별로** 봐야 한다. 블랙잭은 하우스가 무한한 원천이자 구멍이라
 * 총합 검사가 늘 통과한다 — 누가 얼마를 가졌는지 어긋나도 안 걸린다.
 * 그래서 simulate-blackjack.mjs 는 이 결함을 절대 못 잡는다(그쪽은 state.js 를 안 쓰고
 * rules.js 로 직접 돈다). 이 자리를 메우려고 만든 검사다.
 *
 * 잡으려는 것은 넷.
 *
 *   1. 누적 증감을 핸드마다 그대로 보내서 앞 핸드 몫이 겹쳐 얹히는 것 (rebase 없음)
 *   2. 커밋이 실패한 핸드의 몫이 사라지는 것 (실패했는데 rebase 함)
 *   3. rebase 가 화면용 결산까지 0으로 만드는 것 (net 과 deltas 를 안 나눔)
 *   4. 판에 들고 앉는 상한이 계정 잔액에 잘못 적용되는 것 (남은 돈이 증발)
 */
import assert from 'node:assert/strict';
import * as bj from '../src/blackjack/state.js';
import * as hold from '../src/holdem/state.js';
import { buyIn, ledger } from '../src/casino/wallet.js';
import { STAKES } from '../src/casino/stakes.js';

/** 기본 등급(로우)으로 검사한다. 등급마다 비율이 같아서 하나만 봐도 된다. */
const LOW = STAKES.low;
const TABLE_STACK = LOW.stack;

const HANDS = Number(process.argv[2]) || 600;

/** 서버는 **더하기만** 한다. 실제 accountController 와 같다. */
const makeServer = (balances) => {
  const bal = { ...balances };
  return {
    bal,
    apply(deltas) {
      for (const [id, n] of Object.entries(deltas)) bal[id] = (bal[id] ?? 0) + n;
    },
  };
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const user = (n) => ({ id: `10000000000000000${n}`, username: `사람${n}` });

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${name}\n     ${err.message.split('\n').slice(0, 6).join('\n     ')}`);
  }
}

// ---------------------------------------------------------------- 게임 몰기

/** 한 판을 만들고 자리를 채운다. `balances` 는 **계정 잔액**(상한 적용 전). */
function table(mod, channelId, seats, balances) {
  const game = mod.create({ channelId, homeChannelId: channelId, guildId: 'g', starterId: 'u1' });
  for (const s of seats) {
    mod.addSeat(game, s.npc ? mod.npcSeat(s.npc) : mod.humanSeat(user(s.n), `사람${s.n}`));
  }
  const err = mod.start(game, buyIn(balances, game.stakes.stack));
  assert.equal(err, null, `판이 안 열렸다: ${err}`);
  return game;
}

/** 블랙잭 한 핸드를 끝까지. 정산까지 마치고 돌아온다. */
function blackjackHand(game) {
  for (const seat of bj.active(game)) {
    const most = Math.min(bj.allIn(game, seat), 200);
    bj.placeBet(game, seat, Math.max(game.stakes.minBet, most));
  }
  if (!bj.allBetsIn(game)) return false;

  bj.deal(game);
  if (bj.needsInsurance(game)) {
    bj.beginInsurance(game);
    for (const seat of bj.active(game)) bj.answerInsurance(game, seat, Math.random() < 0.3);
  }
  if (!bj.peek(game)) bj.beginPlaying(game);

  let guard = 0;
  while (game.phase === 'playing') {
    const legal = [...bj.actionsFor(game)];
    if (!legal.length) break;
    // 오래 끄는 수(split·double)도 섞어야 take 가 여러 번 도는 길을 밟는다.
    bj.act(game, pick(legal));
    guard += 1;
    if (guard > 200) throw new Error('블랙잭 플레이가 안 끝난다');
  }

  bj.revealHole(game);
  while (bj.anyoneAlive(game) && bj.dealerDraw(game));
  bj.settle(game);
  return true;
}

/** 홀덤 한 핸드를 끝까지. */
function holdemHand(game) {
  let guard = 0;
  while (game.phase !== 'showdown' && game.phase !== 'settled' && game.phase !== 'done') {
    const legal = [...hold.actionsFor(game)];
    if (!legal.length) break;
    const action = pick(legal);
    const raises = hold.raisesFor(game);
    hold.act(game, action, action === 'raise' && raises.length ? pick(raises).to : 0);
    guard += 1;
    if (guard > 400) throw new Error('홀덤 베팅이 안 끝난다');
  }
  if (game.phase === 'done') return false;
  hold.settle(game);
  return true;
}

/**
 * 핸드마다 서버와 맞춰 보며 정해진 수만큼 논다.
 *
 * 판 하나로는 얼마 못 간다 — 아무 수나 두다 보면 몇 핸드 만에 자리가 빈다. 그래서
 * **판이 끝나면 새로 연다.** 마침 그게 실제 흐름이기도 해서, 판을 여닫는 경계까지
 * 같이 검사하게 된다. 저장이 붙으면 그 경계가 제일 틀리기 쉬운 자리다.
 *
 * 판을 열기 전에 모자란 계정은 한 스택까지 채운다 — 일일 규칙(`/출첵`)과 같은 모양이다.
 *
 * `dropEvery` 가 있으면 그 배수 번째 핸드는 커밋이 실패한 셈 친다 — 서버에 안 얹고
 * rebase 도 안 한다. 다음 커밋에서 밀린 몫까지 한 번에 맞아야 한다.
 */
function playTable(kind, hands, { dropEvery = 0 } = {}) {
  const mod = kind === 'bj' ? bj : hold;
  const seats = kind === 'bj'
    ? [{ n: 1 }, { n: 2 }, { npc: 'migel' }]
    : [{ n: 1 }, { n: 2 }, { npc: 'migel' }, { npc: 'matiam' }];

  const server = makeServer({
    100000000000000001: 5000, 100000000000000002: 1000, 'npc:migel': 1000, 'npc:matiam': 1000,
  });
  let played = 0;
  let tables = 0;

  while (played < hands && tables < hands) {
    tables += 1;
    for (const id of Object.keys(server.bal)) {
      if (server.bal[id] < TABLE_STACK) server.bal[id] = TABLE_STACK;
    }

    const opening = { ...server.bal };
    // 상한 밖의 돈은 계정에 남아 있어야 한다 — 판이 그걸 알 필요도, 건드릴 일도 없다.
    const parked = Object.fromEntries(Object.entries(opening)
      .map(([id, n]) => [id, Math.max(0, n - TABLE_STACK)]));
    const game = table(mod, `c-${kind}-${tables}`, seats, opening);

    for (;;) {
      const ran = kind === 'bj' ? blackjackHand(game) : holdemHand(game);
      if (!ran) break;
      played += 1;

      if (!(dropEvery && played % dropEvery === 0)) {
        server.apply(game.chips.deltas());
        game.chips.rebase();

        // 서버 잔액 = 판에 들고 온 몫 + 남겨 둔 몫. **id 별로** 같아야 한다.
        const want = Object.fromEntries(Object.entries(game.chips.snapshot())
          .map(([id, n]) => [id, n + parked[id]]));
        assert.deepStrictEqual(
          Object.fromEntries(Object.entries(server.bal).filter(([id]) => id in want)),
          want,
          `${kind} ${tables}번째 판 ${played}핸드: 서버와 장부가 어긋난다`,
        );
      }

      if (played >= hands || game.phase === 'done') break;
      if (kind === 'bj') { if (!bj.nextHand(game)) break; } else if (!hold.beginHand(game)) break;
    }

    // 판을 접을 때 밀린 몫이 있으면 마저 보낸다. 여기서 흘리면 칩이 사라진다.
    server.apply(game.chips.deltas());
    game.chips.rebase();
    mod.remove(game.channelId);
  }
  return { server, played, tables };
}

// ---------------------------------------------------------------- 검사

console.log(`\n지갑 회귀 검사 — 판마다 ${HANDS}핸드\n`);

console.log('블랙잭');
check('핸드마다 서버 잔액이 장부와 id 별로 같다', () => {
  const { played, tables } = playTable('bj', HANDS);
  assert.equal(played, HANDS, `핸드가 ${played}번밖에 안 돌았다`);
  assert.ok(tables > 1, `판이 ${tables}번밖에 안 열렸다 — 경계를 안 밟았다`);
});
check('커밋이 한 번 실패해도 다음 커밋에서 밀린 몫까지 맞는다', () => {
  const { played, tables } = playTable('bj', HANDS, { dropEvery: 3 });
  assert.equal(played, HANDS, `핸드가 ${played}번밖에 안 돌았다`);
  assert.ok(tables > 1, `판이 ${tables}번밖에 안 열렸다 — 경계를 안 밟았다`);
});

console.log('\n홀덤');
check('핸드마다 서버 잔액이 장부와 id 별로 같다', () => {
  const { played, tables } = playTable('hold', HANDS);
  assert.equal(played, HANDS, `핸드가 ${played}번밖에 안 돌았다`);
  assert.ok(tables > 1, `판이 ${tables}번밖에 안 열렸다 — 경계를 안 밟았다`);
});
check('커밋이 한 번 실패해도 다음 커밋에서 밀린 몫까지 맞는다', () => {
  const { played, tables } = playTable('hold', HANDS, { dropEvery: 3 });
  assert.equal(played, HANDS, `핸드가 ${played}번밖에 안 돌았다`);
  assert.ok(tables > 1, `판이 ${tables}번밖에 안 열렸다 — 경계를 안 밟았다`);
});

console.log('\n기준점');
check('rebase 뒤에도 net 은 판 전체를, deltas 는 0 을 준다', () => {
  const book = ledger({ a: 1000, b: 1000 });
  book.take('a', 300);
  book.give('b', 300);
  assert.deepStrictEqual(book.deltas(), { a: -300, b: 300 }, '커밋 전 deltas');
  assert.deepStrictEqual(book.net(), { a: -300, b: 300 }, '커밋 전 net');

  book.rebase();
  assert.deepStrictEqual(book.deltas(), { a: 0, b: 0 }, '리베이스 직후 deltas 는 0 이어야 한다');
  assert.deepStrictEqual(book.net(), { a: -300, b: 300 }, '리베이스가 화면용 결산까지 지웠다');

  book.take('a', 200);
  book.give('b', 200);
  assert.deepStrictEqual(book.deltas(), { a: -200, b: 200 }, '리베이스 이후분만 담아야 한다');
  assert.deepStrictEqual(book.net(), { a: -500, b: 500 }, 'net 은 판 시작 대비 누적이어야 한다');
});

console.log('\n한 판 상한');
check('부자는 상한만큼만 들고 앉는다', () => {
  assert.deepStrictEqual(buyIn({ u: 5000, v: 200 }, TABLE_STACK), { u: TABLE_STACK, v: 200 });
});
check('상한만큼 다 잃어도 남긴 돈은 그대로다', () => {
  const accounts = { u: 5000 };
  const server = makeServer(accounts);
  const book = ledger(buyIn(accounts, TABLE_STACK));
  book.take('u', TABLE_STACK);                       // 한 스택을 통째로 잃었다
  server.apply(book.deltas());
  book.rebase();
  assert.equal(server.bal.u, 5000 - TABLE_STACK, '남겨 둔 돈까지 사라졌다');
});

console.log(failed ? `\n실패 ${failed}건` : '\n전부 통과');
process.exit(failed ? 1 : 0);
