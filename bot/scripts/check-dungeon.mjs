/**
 * check-dungeon — 던전과 토너먼트가 무엇을 저장하는지
 *
 *   node scripts/check-dungeon.mjs [판수]
 *
 * 가짜 서버를 두고 **진짜 state.js** 로 던전과 토너먼트를 끝까지 돌린다.
 *
 * 잡으려는 것은 다섯.
 *
 *   1. 던전이 **골드를 한 푼이라도 건드리는 것** — 장부에 체력이 들었으므로 그대로
 *      나가면 체력 100 이 골드 100 으로 저장된다
 *   2. 체력 총합이 안 맞는 것 (사람 + 모브). **넘긴 몫도 센다** — 최대치를 넘겨 뺏은
 *      체력은 판 안에 그대로 남아 다시 걸 수 있고, 나갈 때 골드가 된다
 *   3. 서버에 최대치를 넘겨 보내는 것 (잘리고, 그 자리에서 넘긴 몫이 사라진다)
 *   4. 토너먼트가 한 명이 남기 전에 멈추거나 영영 안 끝나는 것
 *   5. 토너먼트 상금 총합이 안 맞는 것 (골드가 생기거나 사라진다)
 */
import assert from 'node:assert/strict';
import * as hold from '../src/holdem/state.js';
import { ledger } from '../src/casino/wallet.js';
import { overOf, OVER_RATE } from '../src/holdem/payout.js';
import { boardEmbed } from '../src/holdem/render.js';
import { DUNGEON, STAKES, atLevel } from '../src/casino/stakes.js';
import { MAX_HP } from '../src/casino/items.js';
import { POOL, TIER, roll, listText } from '../src/casino/loot.js';
import { ITEM_BY_KEY } from '../src/casino/items.js';
import {
  MOBS, NORMALS, drawEnemy, drawMobs, hpOf, ELITE_CHANCE, ELITE_LOOSE_BONUS,
} from '../src/holdem/mobs.js';

const ROUNDS = Number(process.argv[2]) || 120;

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

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const user = (n) => ({ id: `10000000000000000${n}`, username: `사람${n}` });

/**
 * 가짜 서버. **진짜 accountController 처럼** 골드는 더하기만 하고 체력은 자른다.
 * 자르는 것을 흉내 내야 3번을 잡을 수 있다.
 */
const makeServer = (gold, hp) => {
  const bal = { gold: { ...gold }, hp: { ...hp }, items: {} };
  return {
    bal,
    apply({ deltas = {}, hp: hpMoves = {}, items = {} } = {}) {
      for (const [id, n] of Object.entries(deltas)) bal.gold[id] = (bal.gold[id] ?? 0) + n;
      for (const [id, n] of Object.entries(hpMoves)) {
        bal.hp[id] = Math.max(0, Math.min(MAX_HP, (bal.hp[id] ?? MAX_HP) + n));
      }
      for (const [id, moves] of Object.entries(items)) {
        bal.items[id] = bal.items[id] ?? {};
        for (const [k, n] of Object.entries(moves)) {
          bal.items[id][k] = (bal.items[id][k] ?? 0) + n;
        }
      }
      return bal;
    },
  };
};

/** 한 핸드를 끝까지 아무 수나 두고 정산한다. */
function playHand(game) {
  let guard = 0;
  while (!['showdown', 'settled', 'done'].includes(game.phase)) {
    const legal = [...hold.actionsFor(game)];
    if (!legal.length) break;
    const action = pick(legal);
    const raises = hold.raisesFor(game);
    hold.act(game, action, action === 'raise' && raises.length ? pick(raises).to : 0);
    guard += 1;
    if (guard > 400) throw new Error('베팅이 안 끝난다');
  }
  if (game.phase === 'done') return false;
  hold.settle(game);
  return true;
}

// ---------------------------------------------------------------- 던전

/** 던전 하나를 끝까지. `{ server, game, hands }`. */
function runDungeon(channelId, startHp, mobHp) {
  const ME = user(1).id;
  const server = makeServer({ [ME]: 5000 }, { [ME]: startHp });

  const game = hold.create({
    channelId, homeChannelId: channelId, guildId: 'g', starterId: ME, mode: 'dungeon',
  });
  game.stakes = DUNGEON;
  game.base = DUNGEON;
  game.owner = ME;
  hold.addSeat(game, hold.humanSeat(user(1), '사람1'));
  const mob = hold.mobSeat({ name: '적', seen: 1, loose: 0, bluff: 0.1, raise: 0.5, note: '' }, 0, DUNGEON);
  mob.buyIn = mobHp;
  hold.addSeat(game, mob);

  const err = hold.start(game, { [ME]: startHp, [mob.id]: mobHp });
  assert.equal(err, null, `던전이 안 열렸다: ${err}`);
  assert.equal(game.gold.unit, 'hp', '던전 장부가 체력이 아니다');

  let hands = 0;
  for (;;) {
    if (!playHand(game)) break;
    hands += 1;

    // payout.dungeonHand 이 하는 일 그대로 — **서버에는 최대치까지만** 보내고,
    // 넘긴 몫은 판 안에 남겨 둔다. 보낼 몫은 서버에 들어 있는 값과 견줘서 잰다.
    const want = game.gold.snapshot();
    const hp = {};
    for (const [id, n] of Object.entries(want)) {
      if (id.startsWith('mob:')) continue;
      const d = Math.min(n, MAX_HP) - game.stored[id];
      if (d) hp[id] = d;
    }
    server.apply({ hp });
    for (const id of Object.keys(hp)) {
      game.stored[id] = server.bal.hp[id];
      game.gold.reconcile(id, server.bal.hp[id] + Math.max(0, want[id] - MAX_HP));
    }
    for (const seat of game.seats) {
      if (seat.kind === 'mob') continue;
      seat.gold = game.gold.get(seat.id);
    }
    game.gold.rebase();

    if (hands > 300) throw new Error('던전이 안 끝난다');
    if (!hold.beginHand(game)) break;
  }
  return { server, game, hands, me: ME, mob };
}

console.log(`\n던전 · 토너먼트 회귀 검사 — ${ROUNDS}판\n`);

console.log('던전');
check('골드를 한 푼도 안 건드린다', () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const { server, me } = runDungeon(`d-${i}`, 100, 80);
    assert.equal(server.bal.gold[me], 5000, '던전이 골드를 움직였다');
  }
});

check('체력 총합이 언제나 보존된다', () => {
  // 천장에 닿든 안 닿든 한 톨도 새면 안 된다. **넘긴 몫은 판 안에 남기 때문이다** —
  // 예전에는 여기서 초과분이 사라져서, 최대치 위로는 아무리 뺏어도 소용이 없었다.
  for (const [start, mobHp] of [[60, 40], [100, 80], [MAX_HP, MAX_HP]]) {
    for (let i = 0; i < ROUNDS; i += 1) {
      const { game } = runDungeon(`ds-${start}-${mobHp}-${i}`, start, mobHp);
      const total = game.seats.reduce((a, s) => a + s.gold, 0);
      assert.equal(total, start + mobHp, `${start}+${mobHp} 인데 총합이 ${total} 이 됐다`);
    }
  }
});

check('넘긴 몫은 판 안에만 있다', () => {
  // 서버는 최대치를 절대 안 넘는다. 자리 값은 넘을 수 있고, 그 차이가 나갈 때
  // 골드로 바뀌는 몫이다(payout.cashOverflow).
  let sawOver = false;
  for (let i = 0; i < ROUNDS; i += 1) {
    const { server, game, me } = runDungeon(`dm-${i}`, 100, 80);
    const seat = game.seats.find((s) => s.id === me);
    assert.ok(server.bal.hp[me] <= MAX_HP, `서버 체력이 ${server.bal.hp[me]} 이다`);
    assert.equal(server.bal.hp[me], Math.min(seat.gold, MAX_HP), '서버와 자리가 어긋난다');
    if (seat.gold > MAX_HP) sawOver = true;
  }
  assert.ok(sawOver, `${ROUNDS}판을 돌렸는데 최대치를 넘긴 판이 하나도 없다`);
});

check('서버 체력과 자리 값이 같다', () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const { server, game, me } = runDungeon(`dh-${i}`, 100, 80);
    const seat = game.seats.find((s) => s.id === me);
    assert.equal(server.bal.hp[me], Math.min(seat.gold, MAX_HP), '서버와 자리가 어긋난다');
    assert.deepStrictEqual(game.gold.deltas(), { [me]: 0, [game.seats[1].id]: 0 },
      '리베이스 뒤에 밀린 몫이 남았다');
  }
});

check('넘긴 몫이 골드로 바뀐다', () => {
  // 나갈 때 정산하는 값. 체력 1 = OVER_RATE 골드이고, 바꾼 뒤 자리는 최대치가 된다.
  const game = { gold: ledger({ a: 118, b: 90 }, 'hp'), seats: [{ id: 'a', gold: 118 }] };
  assert.equal(overOf(game, 'a'), 18);
  assert.equal(overOf(game, 'b'), 0);
  assert.ok(Number.isInteger(OVER_RATE) && OVER_RATE > 0, `환산값이 ${OVER_RATE} 이다`);
});

check('자리를 갈아 끼워도 지나간 정산은 그대로다', () => {
  // 정산 화면은 다음 핸드를 누를 때까지 남아 있고, 그 사이에 지원군을 부를 수 있다.
  // 자리 객체를 그대로 들고 있으면 **앞 사람이 잃은 몫이 지원군 이름으로 다시
  // 그려진다** — 실제로 디스코드에서 그렇게 보였다.
  const ME = user(1).id;
  const ALLY = 'npc:matiam';
  const game = hold.create({
    channelId: 'dsw', homeChannelId: 'dsw', guildId: 'g', starterId: ME, mode: 'dungeon',
  });
  game.stakes = DUNGEON;
  game.base = DUNGEON;
  game.owner = ME;
  hold.addSeat(game, hold.humanSeat(user(1), '사람1'));
  const mob = hold.mobSeat({ name: '적', seen: 1, loose: 0, bluff: 0.1, raise: 0.5, note: '' }, 0, DUNGEON);
  mob.buyIn = 80;
  hold.addSeat(game, mob);
  assert.equal(hold.start(game, { [ME]: 100, [mob.id]: 80, [ALLY]: 70 }), null);
  assert.ok(playHand(game), '한 핸드도 못 돌았다');

  const before = game.results.rows.map((r) => r.name);
  const shownBefore = game.results.shown.map((x) => x.name);
  const fighter = game.seats.find((s) => s.kind !== 'mob');
  hold.swapFighter(game, fighter, { ...hold.npcSeat('matiam'), kind: 'npc' });
  const ally = game.seats[0].name;

  assert.deepStrictEqual(game.results.rows.map((r) => r.name), before, '정산 줄의 이름이 바뀌었다');
  assert.deepStrictEqual(game.results.shown.map((x) => x.name), shownBefore, '쇼다운 줄의 이름이 바뀌었다');
  assert.notEqual(ally, before[0], '자리가 안 갈렸다');
  assert.ok(!JSON.stringify(boardEmbed(game)).includes(`**${ally}** \``),
    '지나간 정산에 지원군 이름이 끼어들었다');
  assert.equal(game.seats[0].gold, 70, '지원군이 남의 체력을 물려받았다');
  hold.remove('dsw');
});

check('던전도 블라인드가 오른다', () => {
  // 1/2 고정일 때는 판이 안 끝났다 — 접어도 체력 1~2 만 나가 둘 다 기다리기만 했다.
  assert.deepStrictEqual([DUNGEON.sb, DUNGEON.bb], [2, 4], '시작 블라인드가 2/4 가 아니다');
  const ME = user(1).id;
  const game = hold.create({
    channelId: 'dbl', homeChannelId: 'dbl', guildId: 'g', starterId: ME, mode: 'dungeon',
  });
  game.stakes = DUNGEON;
  game.base = DUNGEON;
  hold.addSeat(game, hold.humanSeat(user(1), '사람1'));
  const mob = hold.mobSeat({ name: '적', seen: 1, loose: 0, bluff: 0.1, raise: 0.5, note: '' }, 0, DUNGEON);
  hold.addSeat(game, mob);
  // 넉넉히 들고 앉혀 판이 도중에 안 끝나게 한다. 여기서 보려는 것은 블라인드뿐이다.
  assert.equal(hold.start(game, { [ME]: 100000, [mob.id]: 100000 }), null);

  // **무작위로 두면 안 된다.** 올인이 한 번 나오면 스택이 얼마든 7핸드 전에 판이
  // 끝나 블라인드가 오를 차례가 안 온다 — 이 검사가 그렇게 여섯에 다섯 번 흔들렸다.
  // 매 핸드를 첫 수에 접어 블라인드만 오가게 한다.
  const seen = new Map();
  for (let i = 0; i < 20 && game.phase !== 'done'; i += 1) {
    seen.set(game.handNo, game.stakes.bb);
    const legal = hold.actionsFor(game);
    hold.act(game, legal.has('fold') ? 'fold' : 'check', 0);
    if (!['showdown', 'settled'].includes(game.phase)) throw new Error('접었는데 핸드가 안 끝났다');
    hold.settle(game);
    if (!hold.beginHand(game)) break;
  }
  assert.ok(seen.size >= 13, `${seen.size}핸드밖에 못 돌았다`);
  for (const [hand, bb] of seen) {
    const want = atLevel(DUNGEON, Math.floor((hand - 1) / 6)).bb;
    assert.equal(bb, want, `${hand}핸드에서 빅블라인드가 ${bb} (기대 ${want})`);
  }
  assert.ok([...seen.values()].some((bb) => bb > 4), '20핸드 동안 한 번도 안 올랐다');
  assert.equal(DUNGEON.bb, 4, '던전 등급 원본이 바뀌었다');
  hold.remove('dbl');
});

check('현금 판은 블라인드가 안 오른다', () => {
  const game = hold.create({ channelId: 'dcash', homeChannelId: 'dcash', guildId: 'g', starterId: 'u' });
  hold.addSeat(game, hold.humanSeat(user(1), '사람1'));
  hold.addSeat(game, hold.humanSeat(user(2), '사람2'));
  const bb = game.stakes.bb;
  assert.equal(hold.start(game, { [user(1).id]: 1e6, [user(2).id]: 1e6 }), null);
  // 위와 같은 까닭으로 접기만 한다. 판이 일찍 끝나면 **아무것도 안 보고 통과한다.**
  let hands = 0;
  for (let i = 0; i < 14 && game.phase !== 'done'; i += 1) {
    const legal = hold.actionsFor(game);
    hold.act(game, legal.has('fold') ? 'fold' : 'check', 0);
    hold.settle(game);
    hands += 1;
    if (!hold.beginHand(game)) break;
  }
  assert.ok(hands >= 13, `${hands}핸드밖에 못 돌았다`);
  assert.equal(game.stakes.bb, bb, `현금 판 블라인드가 ${bb} 에서 ${game.stakes.bb} 로 올랐다`);
  hold.remove('dcash');
});

check('한쪽이 0 이 되면 끝난다', () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const { game } = runDungeon(`de-${i}`, 100, 80);
    assert.equal(game.phase, 'done');
    const zero = game.seats.filter((s) => s.gold <= 0);
    assert.equal(zero.length, 1, `0 이 된 자리가 ${zero.length} 이다`);
  }
});

check('서버가 자를 일이 아예 없다', () => {
  // 시작부터 최대치라 회복 쪽으로 넘칠 여지가 큰 판. 보내는 몫을 서버 값과 견줘서
  // 재므로 목표가 늘 0~최대치 안이고, **그래서 잘릴 일이 없다** — 자르지 않으면
  // 장부가 어긋날 일도 없다.
  for (let i = 0; i < ROUNDS; i += 1) {
    const { server, game, me } = runDungeon(`dc-${i}`, MAX_HP, MAX_HP);
    const seat = game.seats.find((s) => s.id === me);
    assert.equal(server.bal.hp[me], Math.min(seat.gold, MAX_HP));
    assert.equal(server.bal.hp[me], game.stored[me], '서버와 stored 가 어긋난다');
    assert.ok(seat.gold >= 0, `체력이 ${seat.gold} 이다`);
  }
});

console.log('\n에너미');
check('일반이 엘리트보다 약하다', () => {
  const eliteHp = MOBS.map((m) => hpOf({ ...m, elite: true }));
  const normalHp = NORMALS.map((m) => hpOf({ ...m, elite: false }));
  assert.ok(Math.max(...normalHp) < Math.min(...eliteHp),
    `일반 최대 ${Math.max(...normalHp)} vs 엘리트 최소 ${Math.min(...eliteHp)}`);
  // 넓게 볼수록 승산 없는 콜을 한다(ai.js 의 edge). 그게 약함의 실체다.
  const eliteLoose = MOBS.reduce((a2, m) => a2 + m.loose, 0) / MOBS.length;
  const normalLoose = NORMALS.reduce((a2, m) => a2 + m.loose, 0) / NORMALS.length;
  assert.ok(normalLoose > eliteLoose + 0.1, `일반 ${normalLoose.toFixed(2)} vs 엘리트 ${eliteLoose.toFixed(2)}`);
});
check('모양이 성하다', () => {
  for (const m of NORMALS) {
    assert.ok(m.name && m.note, `${m.name}: 이름이나 소개가 빈다`);
    assert.ok(Number.isInteger(m.seen) && m.seen > 0, `${m.name}: 처치 수가 이상하다`);
    for (const k of ['loose', 'bluff', 'raise']) {
      assert.ok(Number.isFinite(m[k]), `${m.name}.${k} 가 숫자가 아니다`);
    }
    assert.ok(m.bluff >= 0 && m.bluff <= 0.35, `${m.name}.bluff ${m.bluff}`);
    assert.ok(m.raise >= 0.2 && m.raise <= 0.8, `${m.name}.raise ${m.raise}`);
  }
  assert.equal(new Set(NORMALS.map((m) => m.name)).size, NORMALS.length, '이름이 겹친다');
});
check('다섯에 한 번쯤 엘리트가 나온다', () => {
  let elite = 0;
  for (let i = 0; i < 40_000; i += 1) if (drawEnemy().elite) elite += 1;
  const rate = elite / 40_000;
  assert.ok(Math.abs(rate - ELITE_CHANCE) < 0.02, `${(rate * 100).toFixed(1)}% 가 나왔다`);
});
check('두 통을 따로 뽑는다', () => {
  // 한 통에 넣고 뽑으면 수가 많은 쪽(일반 40종)이 등급 확률을 삼킨다.
  const names = new Set();
  for (let i = 0; i < 5000; i += 1) names.add(drawEnemy().name);
  assert.ok(MOBS.some((m) => names.has(m.name)), '엘리트가 한 번도 안 나왔다');
  assert.ok(NORMALS.some((m) => names.has(m.name)), '일반이 한 번도 안 나왔다');
});

check('던전 엘리트만 무르게, 표는 그대로', () => {
  // 더한 값이 표에 새면 현금 판 모브까지 물러진다.
  const raw = new Map(MOBS.map((m) => [m.name, m.loose]));
  let elites = 0;
  for (let i = 0; i < 4000; i += 1) {
    const e = drawEnemy();
    if (!e.elite) continue;
    elites += 1;
    assert.equal(e.loose, raw.get(e.name) + ELITE_LOOSE_BONUS, `${e.name}: ${e.loose}`);
  }
  assert.ok(elites > 0, '엘리트가 한 번도 안 나왔다');
  for (const m of MOBS) assert.equal(m.loose, raw.get(m.name), `${m.name} 의 표가 바뀌었다`);
  for (const m of drawMobs(8)) assert.equal(m.loose, raw.get(m.name), `현금 판 ${m.name} 이 물러졌다`);

  // 더해도 일반보다는 단단해야 엘리트다.
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const elite = avg(MOBS.map((m) => m.loose + ELITE_LOOSE_BONUS));
  const normal = avg(NORMALS.map((m) => m.loose));
  assert.ok(elite < normal, `던전 엘리트 ${elite.toFixed(3)} 가 일반 ${normal.toFixed(3)} 보다 무르다`);
});

console.log('\n떨구는 것');
check('잡화·재료만, 막은 것은 안 나온다', () => {
  assert.ok(POOL.every((i) => ['잡화', '재료'].includes(i.kind) && i.loot !== false));
  // 가게에서만 파는 재료(밀가루·후추)도 막는다 — 던전 바닥에 밀가루 포대가 굴러다니면 안 된다.
  for (const key of ['ruby', 'dragonBlood', 'sinew', 'prisonKey', 'potionSmall', 'flour', 'pepper']) {
    assert.ok(!POOL.some((i) => i.key === key), `${key} 가 풀에 있다`);
  }
  assert.ok(POOL.some((i) => i.key === 'oreBlue'), '원석이 빠졌다');
  assert.ok(POOL.some((i) => i.key === 'raspberry'), '재료가 안 나온다');
  assert.equal(POOL.length, 100, `풀이 ${POOL.length}종이다 (잡화 76 + 재료 24)`);
});

check('재료가 실제로 떨어진다', () => {
  let food = 0;
  let all = 0;
  for (let i = 0; i < 4000; i += 1) {
    for (const [key, n] of Object.entries(roll().items)) {
      all += n;
      if (ITEM_BY_KEY[key].kind === '재료') food += n;
    }
  }
  // 풀에서 재료가 차지하는 몫(24/100)과 비슷하게 나온다 — 재보니 일반 23% · 엘리트 24%.
  const share = food / all;
  assert.ok(share > 0.15 && share < 0.45, `재료가 ${(share * 100).toFixed(1)}% 나왔다`);
});
check('가짓수가 등급대로', () => {
  for (const [key, t] of Object.entries(TIER)) {
    for (let i = 0; i < 2000; i += 1) {
      const n = Object.values(roll(Math.random, { elite: key === 'elite' }).items)
        .reduce((a, b) => a + b, 0);
      assert.ok(n >= t.least && n <= t.most, `${key}: ${n}개가 나왔다`);
    }
  }
});
check('싼 것이 비싼 것보다 흔하다', () => {
  const tally = {};
  for (let i = 0; i < 60_000; i += 1) {
    for (const [k, n] of Object.entries(roll().items)) tally[k] = (tally[k] ?? 0) + n;
  }
  const cheap = tally.twig ?? 0;             // 1골드
  const dear = tally.oddFossil ?? 0;         // 100골드
  assert.ok(cheap > dear * 3, `나뭇가지 ${cheap} vs 화석 ${dear}`);
  // 값 0 짜리가 1골드짜리보다 크게 흔하면 안 된다 — 그 무리에 센 것이 섞여 있다.
  const free = tally.wetMoss ?? 0;           // 0골드
  assert.ok(free < cheap * 1.5, `값 0 짜리가 너무 흔하다: ${free} vs ${cheap}`);
});

/** 한 판 보상의 값어치(아이템 값 + 골드). */
function haul(elite, n = 20_000) {
  let worth = 0; let gold = 0; let mt = 0;
  for (let i = 0; i < n; i += 1) {
    const r = roll(Math.random, { elite });
    for (const [k, c] of Object.entries(r.items)) worth += (ITEM_BY_KEY[k]?.price ?? 0) * c;
    gold += r.gold;
    mt += r.mt;
  }
  return { worth: worth / n, gold: gold / n, mt: mt / n };
}

check('엘리트가 더 좋은 것을 준다', () => {
  const a = haul(false);
  const b = haul(true);
  assert.ok(b.worth > a.worth * 1.5, `값어치 일반 ${a.worth.toFixed(0)} vs 엘리트 ${b.worth.toFixed(0)}`);
  assert.ok(b.gold > a.gold * 1.5, `골드 일반 ${a.gold.toFixed(0)} vs 엘리트 ${b.gold.toFixed(0)}`);
  assert.ok(b.mt > a.mt * 3, `MT 일반 ${(a.mt * 100).toFixed(1)}% vs 엘리트 ${(b.mt * 100).toFixed(1)}%`);
});

check('골드는 범위 안에서 10 단위로', () => {
  for (const [key, t] of Object.entries(TIER)) {
    for (let i = 0; i < 3000; i += 1) {
      const { gold } = roll(Math.random, { elite: key === 'elite' });
      assert.equal(gold % 10, 0, `${key}: ${gold} 은 10 단위가 아니다`);
      assert.ok(gold >= t.gold[0] - 5 && gold <= t.gold[1] + 5, `${key}: ${gold} 이 범위 밖`);
    }
  }
});

check('MT 는 0 아니면 1', () => {
  for (let i = 0; i < 5000; i += 1) {
    assert.ok([0, 1].includes(roll(Math.random, { elite: i % 2 === 0 }).mt));
  }
});

check('보상 한 줄에 셋이 다 보인다', () => {
  const text = listText({ items: { twig: 2 }, gold: 480, mt: 1 }, ITEM_BY_KEY);
  assert.ok(/나뭇가지.*×2/.test(text), text);
  assert.ok(/480골드/.test(text), text);
  assert.ok(/MT ×1/.test(text), text);
  // 없는 것은 안 적는다
  assert.equal(/골드|MT/.test(listText({ items: { twig: 1 }, gold: 0, mt: 0 }, ITEM_BY_KEY)), false);
});

// ---------------------------------------------------------------- 토너먼트

function runTourney(channelId, seats) {
  const gold = Object.fromEntries(seats.map((n) => [user(n).id, 1000]));
  const server = makeServer(gold, {});
  const game = hold.create({
    channelId, homeChannelId: channelId, guildId: 'g', starterId: user(seats[0]).id, mode: 'tourney',
  });
  for (const n of seats) hold.addSeat(game, hold.humanSeat(user(n), `사람${n}`));
  const err = hold.start(game, { ...gold });
  assert.equal(err, null, `토너먼트가 안 열렸다: ${err}`);

  let hands = 0;
  for (;;) {
    if (!playHand(game)) break;
    hands += 1;
    // 토너먼트는 **핸드마다 골드를 안 옮긴다.** 리베이스도 안 한다.
    if (hands > 400) throw new Error('토너먼트가 안 끝난다');
    if (!hold.beginHand(game)) break;
  }
  server.apply({ deltas: game.gold.net() });
  return { server, game, hands };
}

console.log('\n토너먼트');
check('반드시 한 명이 남는다', () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const { game } = runTourney(`t-${i}`, [1, 2, 3]);
    assert.equal(game.phase, 'done');
    const alive = game.seats.filter((s) => s.gold > 0);
    assert.equal(alive.length, 1, `${alive.length} 명이 남았다`);
  }
});

check('골드 총합이 보존된다', () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const { server } = runTourney(`tg-${i}`, [1, 2, 3, 4]);
    const total = Object.values(server.bal.gold).reduce((a, b) => a + b, 0);
    assert.equal(total, 4000, `총합이 ${total} 이 됐다`);
  }
});

check('탈락 순서가 인원과 맞는다', () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const { game } = runTourney(`tk-${i}`, [1, 2, 3, 4]);
    assert.equal(game.knocked.length, game.seats.length - 1,
      `탈락이 ${game.knocked.length} 명이다`);
    assert.equal(new Set(game.knocked).size, game.knocked.length, '같은 사람이 두 번 탈락했다');
    const winner = game.seats.find((s) => s.gold > 0);
    assert.ok(!game.knocked.includes(winner.id), '우승자가 탈락 목록에 있다');
  }
});

check('블라인드가 오른다', () => {
  const { game } = runTourney('tb-x', [1, 2, 3, 4]);
  assert.ok(game.handNo >= 1);
  const want = atLevel({ ...STAKES.low, level: 0 }, Math.floor((game.handNo - 1) / 6));
  assert.equal(game.stakes.bb, want.bb, `${game.handNo}핸드에서 블라인드가 ${game.stakes.bb}`);
  assert.equal(game.stakes.stack, STAKES.low.stack, '스택까지 같이 올랐다');
});

check('등급 원본이 안 바뀐다', () => {
  // 지금은 `atLevel` 이 **새 객체를 만들어 갈아 끼우므로** 원본을 건드릴 길이 없다.
  // 그래도 이 검사를 두는 것은, 누군가 `game.stakes.bb = …` 로 바꾸는 편이 간단해
  // 보여서 그렇게 고치는 날 곧바로 걸리게 하려는 것이다. 그러면 돌고 있던 현금 판도
  // 블랙잭도 같이 블라인드가 오른다.
  runTourney('ts-x', [1, 2, 3]);
  assert.equal(STAKES.low.bb, 20, 'STAKES.low 가 바뀌었다');
  const fresh = hold.create({ channelId: 'ts-y', homeChannelId: 'ts-y', guildId: 'g', starterId: 'u' });
  assert.equal(fresh.stakes.bb, 20, '새 판이 오른 블라인드를 물려받았다');
  hold.remove('ts-y');
});

console.log(failed ? `\n실패 ${failed}건` : '\n전부 통과');
process.exit(failed ? 1 : 0);
