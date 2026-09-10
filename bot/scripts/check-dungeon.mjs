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
 *   2. 체력 총합이 안 맞는 것 (사람 + 모브). 다만 **천장을 넘긴 몫은 버려진다** —
 *      싸워서 최대치 위로 회복할 수는 없다는 뜻이고 그게 의도다
 *   3. 서버가 체력을 자른 뒤 장부가 어긋난 채로 리베이스되는 것 (눈덩이가 된다)
 *   4. 토너먼트가 한 명이 남기 전에 멈추거나 영영 안 끝나는 것
 *   5. 토너먼트 상금 총합이 안 맞는 것 (골드가 생기거나 사라진다)
 */
import assert from 'node:assert/strict';
import * as hold from '../src/holdem/state.js';
import { ledger } from '../src/casino/wallet.js';
import { DUNGEON, STAKES, atLevel } from '../src/casino/stakes.js';
import { MAX_HP } from '../src/casino/items.js';
import { POOL, roll, LEAST, MOST } from '../src/casino/loot.js';
import { MOBS, NORMALS, drawEnemy, hpOf, ELITE_CHANCE } from '../src/holdem/mobs.js';

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

    // payout.dungeonHand 이 하는 일 그대로 — 체력만 보내고, 응답으로 장부를 맞춘 뒤 리베이스.
    const sent = game.gold.deltas();
    for (const id of Object.keys(sent)) {
      if (id.startsWith('mob:')) delete sent[id];
    }
    server.apply({ hp: sent });
    for (const seat of game.seats) {
      if (seat.id.startsWith('mob:')) continue;
      game.gold.reconcile(seat.id, server.bal.hp[seat.id]);
      seat.gold = server.bal.hp[seat.id];
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

check('천장에 안 닿으면 체력 총합이 보존된다', () => {
  // 둘을 합쳐도 최대치를 안 넘는 판. 여기서는 한 톨도 새면 안 된다.
  for (let i = 0; i < ROUNDS; i += 1) {
    const { game } = runDungeon(`ds-${i}`, 60, 40);
    const total = game.seats.reduce((a, s) => a + s.gold, 0);
    assert.equal(total, 100, `체력 총합이 ${total} 이 됐다`);
  }
});

check('천장을 넘긴 몫만 버려진다', () => {
  // 이겨서 최대치를 넘어가면 그 초과분은 사라진다 — 싸워서 최대치 위로 회복할 수는
  // 없다는 뜻이고, 그게 의도다. 대신 **줄어드는 것은 딱 그만큼**이어야 한다.
  for (let i = 0; i < ROUNDS; i += 1) {
    const { game, me } = runDungeon(`dm-${i}`, 100, 80);
    const seat = game.seats.find((s) => s.id === me);
    const total = game.seats.reduce((a, s) => a + s.gold, 0);
    assert.ok(seat.gold <= MAX_HP, `체력이 ${seat.gold} 이다`);
    assert.ok(total <= 180, `총합이 ${total} 로 늘었다`);
    assert.ok(total >= 80, `총합이 ${total} 로 너무 줄었다`);
  }
});

check('서버 체력과 자리 값이 같다', () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const { server, game, me } = runDungeon(`dh-${i}`, 100, 80);
    const seat = game.seats.find((s) => s.id === me);
    assert.equal(server.bal.hp[me], seat.gold, '서버와 자리가 어긋난다');
    assert.deepStrictEqual(game.gold.deltas(), { [me]: 0, [game.seats[1].id]: 0 },
      '리베이스 뒤에 밀린 몫이 남았다');
  }
});

check('한쪽이 0 이 되면 끝난다', () => {
  for (let i = 0; i < ROUNDS; i += 1) {
    const { game } = runDungeon(`de-${i}`, 100, 80);
    assert.equal(game.phase, 'done');
    const zero = game.seats.filter((s) => s.gold <= 0);
    assert.equal(zero.length, 1, `0 이 된 자리가 ${zero.length} 이다`);
  }
});

check('서버가 자른 뒤에도 장부가 안 어긋난다', () => {
  // 시작 체력이 최대치라 회복 쪽으로 넘칠 여지가 있는 판. 잘리는 순간 reconcile 이
  // 없으면 다음 핸드부터 장부가 비뚤어진다.
  for (let i = 0; i < ROUNDS; i += 1) {
    const { server, game, me } = runDungeon(`dc-${i}`, MAX_HP, MAX_HP);
    const seat = game.seats.find((s) => s.id === me);
    assert.equal(server.bal.hp[me], seat.gold);
    assert.ok(seat.gold >= 0 && seat.gold <= MAX_HP, `체력이 범위를 벗어났다: ${seat.gold}`);
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

console.log('\n떨구는 것');
check('잡화만, 막은 것은 안 나온다', () => {
  assert.ok(POOL.every((i) => i.kind === '잡화' && i.loot !== false));
  for (const key of ['ruby', 'dragonBlood', 'sinew', 'prisonKey', 'potionSmall']) {
    assert.ok(!POOL.some((i) => i.key === key), `${key} 가 풀에 있다`);
  }
  assert.ok(POOL.some((i) => i.key === 'oreBlue'), '원석이 빠졌다');
});
check('한 번에 2~5개', () => {
  for (let i = 0; i < 2000; i += 1) {
    const n = Object.values(roll()).reduce((a, b) => a + b, 0);
    assert.ok(n >= LEAST && n <= MOST, `${n}개가 나왔다`);
  }
});
check('싼 것이 비싼 것보다 흔하다', () => {
  const tally = {};
  for (let i = 0; i < 60_000; i += 1) {
    for (const [k, n] of Object.entries(roll())) tally[k] = (tally[k] ?? 0) + n;
  }
  const cheap = tally.twig ?? 0;             // 1골드
  const dear = tally.oddFossil ?? 0;         // 100골드
  assert.ok(cheap > dear * 3, `나뭇가지 ${cheap} vs 화석 ${dear}`);
  // 값 0 짜리가 1골드짜리보다 크게 흔하면 안 된다 — 그 무리에 센 것이 섞여 있다.
  const free = tally.wetMoss ?? 0;           // 0골드
  assert.ok(free < cheap * 1.5, `값 0 짜리가 너무 흔하다: ${free} vs ${cheap}`);
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
