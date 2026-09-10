/**
 * state — 진행 중인 홀덤 판
 *
 * 요트·블랙잭의 state.js 와 뼈대가 같다(채널당 한 판, 메모리에만, TTL 청소,
 * serial/rev, 에러는 문자열로 돌려주기). 홀덤만의 차이는 셋이다.
 *
 *   1. **한 핸드에 베팅 라운드가 넷이다.** phase 가 곧 스트리트다.
 *   2. **버튼이 돈다.** 블라인드 자리와 첫 행동자가 핸드마다 바뀐다.
 *   3. **숨은 정보가 있다.** `seat.hole` 은 그 사람만 본다 — 판을 그리는 쪽과
 *      대사 메모를 만드는 쪽이 각자 가려야 한다. 이 파일은 가리지 않고 들고만 있다.
 *
 * 디스코드 API 를 부르지 않는다. Message 를 들고만 있고 그리는 건 명령 쪽이다.
 */
import { randomBytes } from 'node:crypto';
import { newShoe, shuffle, draw } from '../casino/cards.js';
import { ledger } from '../casino/wallet.js';
import { stakesOf, DEFAULT_STAKES, atLevel, LEVEL_EVERY } from '../casino/stakes.js';
import {
  MAX_SEATS, BOARD_AT,
  newSeat, live, actionable, nextActor, blindSeats, put, firstToAct,
  owed, minRaiseTo, legalActions, raiseOptions, roundClosed, endStreet, potTotal, award,
} from './rules.js';
import { OWNER_META, ownerFor } from '../owners.js';
import { THEME_COLOR } from '../embeds.js';

export { MAX_SEATS };
export const IDLE_MS = 10 * 60 * 1000;

/** 홀덤 자리에 앉을 때 받는 스택. 블라인드 20 기준 50 BB — 깊어야 폴드가 의미를 갖는다. */

const games = new Map();          // channelId → game
const serial = () => randomBytes(3).toString('hex');

// ---------------------------------------------------------------- 자리

/** 사람 자리. 오너면 사이트와 같은 이름(겨울/사백)과 색을 쓴다. */
export function humanSeat(user, displayName) {
  const owner = ownerFor(user.id);
  const meta = owner ? OWNER_META[owner] : null;
  return newSeat({
    kind: 'human',
    id: user.id,
    userId: user.id,
    name: meta ? meta.label : (displayName || user.globalName || user.username),
    color: meta ? meta.color : THEME_COLOR,
    // 칭호 알림이 얼굴을 쓴다. 정산 시점에는 인터랙션이 없어서 유저 객체를
    // 다시 못 얻으므로 앉을 때 주소만 챙겨 둔다.
    avatar: user.displayAvatarURL?.({ size: 256 }) ?? null,
  });
}

/** NPC 자리. id 접두사 `npc:` 는 골드 영구 저장이 NPC 를 걸러 내는 표식이다. */
/**
 * 모브 자리. 엘리트 에너미 하나가 손님으로 앉는다.
 *
 * **지갑이 없다.** id 의 `mob:` 접두사가 그 표식이고, wallet 이 이걸 보고 서버에
 * 안 보낸다. 대신 앉을 때 최소 입장과 한 스택 사이에서 아무렇게나 들고 온다 —
 * 매번 다른 스택이라 판의 모양도 매번 달라진다.
 */
export function mobSeat(mob, index, stakes, rand = Math.random) {
  const span = stakes.stack - stakes.minBuyIn;
  const seat = newSeat({
    kind: 'mob',
    id: `mob:${index}`,
    name: mob.name,
    color: THEME_COLOR,
  });
  seat.style = { loose: mob.loose, bluff: mob.bluff, raise: mob.raise };
  seat.note = mob.note;
  seat.buyIn = stakes.minBuyIn + Math.floor(rand() * (span + 1));
  return seat;
}

export function npcSeat(character) {
  const meta = OWNER_META[character];
  if (!meta) throw new Error(`모르는 캐릭터: ${character}`);
  return newSeat({
    kind: 'npc',
    id: `npc:${character}`,
    character,
    name: meta.character,
    color: meta.color,
  });
}

// ---------------------------------------------------------------- 판

export function create({
  channelId, homeChannelId, guildId, starterId, stakes = DEFAULT_STAKES, mode = 'cash',
}) {
  // 판돈은 판을 열 때 정하고 **끝날 때까지 안 바뀐다.** 도중에 바뀌면 이미 건 돈의 뜻이 달라진다.
  const table = stakesOf(stakes);
  // 토너먼트가 블라인드를 올릴 때 견줄 원본. 배수를 곱하는 기준이라 안 바뀐다.
  const base = { ...table, level: 0 };
  const game = {
    /**
     * `cash` · `tourney` · `dungeon`.
     *
     * **customId 에는 모드가 없다.** 판은 채널로 찾으므로(`forChannel`) 모드는 반드시
     * 여기 있어야 한다 — 버튼만 보고는 무슨 판인지 알 수가 없다.
     */
    mode,
    stakes: base,
    base,
    serial: serial(),
    rev: 0,
    channelId,
    homeChannelId,
    guildId,
    starterId,
    message: null,
    phase: 'lobby',      // lobby → preflop → flop → turn → river → showdown → settled → done
    seats: [],
    button: -1,          // 첫 핸드에서 0 이 된다
    turn: -1,            // 지금 행동할 자리
    deck: [],
    board: [],           // 커뮤니티 카드
    toCall: 0,           // 이번 라운드에 맞춰야 할 총액(자리의 bet 기준)
    minRaise: table.bb,  // 다음 레이즈의 최소 증분
    handNo: 0,
    hist: [],           // 이번 핸드에 누가 뭘 했는지. 전부 공개 정보 — 대사가 읽는다
    results: null,       // 직전 정산. settled 에서 보여 준다
    knocked: [],         // 탈락한 순서(먼저 나간 사람이 앞). 토너먼트 등수가 이걸 쓴다
    owner: null,         // 던전 주인. 자리를 갈아 끼우면 seatOf 로는 못 알아본다
    reserves: [],        // 던전에 데려온 지원군 id. 장부에 실려 있고 자리에는 없다
    stored: null,        // 던전: **서버에 실제로 들어 있는 체력**. 장부는 최대치를 넘길 수 있다
    gold: null,         // 동기 장부(wallet.ledger)
    pendingChat: [],
    startedAt: Date.now(),   // 토너먼트 벽시계 상한이 본다
    lastAt: Date.now(),
    opened: false,
    said: new Set(),
    spoken: { migel: [], matiam: [] },
    aiHandNo: 0,
    aiLeft: 0,
    raising: false,     // 레이즈 금액을 고르는 중인지 (화면 상태)
    turnCalled: null,   // 이 차례를 이미 불렀는지 (핸드:스트리트:자리)
    boardBottom: false, // 판이 지금 맨 아래에 있는지 — 겹쳐 띄우지 않으려고
    driving: false,
    rekick: false,
    closed: false,
    saveFailed: false,  // 직전 정산에서 골드를 못 저장했는지 (판에 한 줄 띄운다)
    endedReason: null,
  };
  games.set(channelId, game);
  return game;
}

export const get = (channelId) => games.get(channelId) || null;

/**
 * 아직 살아 있는 판들. 다른 게임이 "이 사람이 어디 앉아 있나" 를 볼 때 쓴다
 * (casino/tables.js). 끝난 판은 자리가 남아 있어도 골드를 걸 수 없으니 뺀다.
 *
 * 홀덤에는 자리를 거르는 live(seats) 가 따로 있어서 이름을 달리 둔다.
 */
export function* openGames() {
  for (const game of games.values()) if (game.phase !== 'done') yield game;
}
export const remove = (channelId) => games.delete(channelId);

/** 스레드 안에서 눌렀든 원래 채널에서 명령을 쳤든 같은 판을 찾아 준다. */
export function forChannel(channelId) {
  const direct = games.get(channelId);
  if (direct) return direct;
  for (const g of games.values()) if (g.homeChannelId === channelId) return g;
  return null;
}

export function touch(game) {
  game.rev += 1;
  game.lastAt = Date.now();
  return game;
}

export const seatOf = (game, userId) => game.seats.find((s) => s.userId === userId) || null;
export const seatIndexOf = (game, userId) => game.seats.findIndex((s) => s.userId === userId);
/**
 * 던전에서 싸우는 자리의 주인을 갈아 끼운다. **자리를 더하지 않는다.**
 *
 * 자리를 하나 더 두고 쉬게 하는 방식은 안 된다 — `beginHand` 가 `out` 을 **매 핸드
 * 다시** 계산해서 쉬던 자리가 저절로 되살아나고, 그걸 막으려면 `rules.js` 의
 * `live`·`actionable`·`nextActor`·`nextIn`·`blindSeats`·`roundClosed` 를 다 손봐야 한다.
 * 그중 둘은 파일 머리말이 "제일 틀리기 쉬운 자리" 라고 적어 둔 곳이다.
 *
 * **핸드 사이에만 부른다.** 판이 도는 중에 바꾸면 `seat.committed` 의 주인이 달라져서
 * `settle` 이 엉뚱한 계정에서 빼 간다.
 *
 * `kind: 'npc'` 로 바뀌면 드라이버가 알아서 둔다(`chooseAction(seat.character)`).
 * **`userId` 를 반드시 비운다** — 안 그러면 사람이 그 자리 버튼을 계속 누를 수 있다.
 */
export function swapFighter(game, seat, who) {
  seat.kind = who.kind;
  seat.id = who.id;
  seat.userId = who.userId ?? null;
  seat.character = who.character ?? null;
  seat.name = who.name;
  seat.color = who.color;
  seat.avatar = who.avatar ?? null;
  seat.gold = game.gold.get(who.id);
  // 앞 사람이 이번 핸드에 낸 흔적은 지운다. `beginHand` 가 어차피 비우지만, 그 전에
  // 화면이 한 번 그려지면 지원군이 남의 베팅을 걸고 있는 것처럼 보인다.
  seat.bet = 0;
  seat.committed = 0;
  seat.lastAction = null;
  touch(game);
}

export const hasNpc = (game, character) =>
  game.seats.some((s) => s.kind === 'npc' && s.character === character);

export function addSeat(game, seat) {
  if (game.phase !== 'lobby') return '이미 시작한 판이에요.';
  if (game.seats.length >= MAX_SEATS) return `자리가 다 찼어요. (최대 ${MAX_SEATS}자리)`;
  if (seat.kind === 'human' && seatOf(game, seat.userId)) return '이미 앉아 있어요.';
  if (seat.kind === 'npc' && hasNpc(game, seat.character)) return `${seat.name}은(는) 이미 앉아 있어요.`;
  game.seats.push(seat);
  touch(game);
  return null;
}

/** 판을 시작한다. 잔액은 부르는 쪽이 미리 불러와서 넘긴다(load 는 async 라 여기 못 둔다). */
export function start(game, balances) {
  if (game.seats.length < 2) return '두 자리 이상이어야 시작할 수 있어요.';
  // 던전은 같은 장부에 **체력**을 담아 돈다. 무엇을 세는지 장부가 알고 있어야
  // 서버로 잘못 나가는 것을 막을 수 있다(payout.js).
  game.gold = ledger(balances, game.mode === 'dungeon' ? 'hp' : 'gold');
  // 던전은 **장부가 서버보다 클 수 있다** — 적에게서 뺏은 체력이 최대치를 넘겨도 판
  // 안에서는 그대로 걸 수 있다. 서버에 무엇이 들어 있는지 따로 들고 있어야 매 핸드
  // 보낼 몫을 잴 수 있다(holdem/payout.js).
  if (game.mode === 'dungeon') game.stored = { ...balances };
  for (const s of game.seats) s.gold = game.gold.get(s.id);
  if (game.seats.filter((s) => s.gold >= game.stakes.bb).length < 2) {
    return '빅블라인드를 낼 수 있는 사람이 둘은 있어야 해요.';
  }
  beginHand(game);
  return null;
}

// ---------------------------------------------------------------- 한 핸드

const card = (game) => draw(game.deck);

/**
 * 새 핸드. 버튼을 한 칸 옮기고, 블라인드를 걷고, 두 장씩 돌린다.
 *
 * **덱은 핸드마다 한 벌을 새로 섞는다.** 블랙잭처럼 6덱 슈를 이어 쓰면 같은 카드가
 * 두 장 나와 플러시·페어 판정이 깨진다.
 */
export function beginHand(game) {
  for (const s of game.seats) {
    s.out = s.gold < game.stakes.bb && s.gold <= 0 ? true : s.gold <= 0;
    s.hole = [];
    s.committed = 0;
    s.bet = 0;
    s.acted = false;
    s.folded = false;
    s.allIn = false;
    s.lastAction = null;
    s.stance = null;        // 이번 수를 무슨 마음으로 뒀는지 (대사용)
  }

  // **탈락 순서를 남긴다.** 지금까지는 아무 데도 안 적혀서 등수를 만들 수가 없었다.
  // 둘이 안 남아 빠지는 자리보다 **먼저** 적어야 마지막 탈락자가 빠지지 않는다.
  for (const s of game.seats) {
    if (s.out && !game.knocked.includes(s.id)) game.knocked.push(s.id);
  }

  const playing = game.seats.filter((s) => !s.out);
  if (playing.length < 2) { end(game, 'broke'); return false; }

  game.handNo += 1;

  // **블라인드는 여기서만 올린다.** 핸드와 핸드 사이, 블라인드를 걷기 전 딱 한 곳이다.
  // 판 도중에 바뀌면 이미 건 돈의 뜻이 달라진다. `sb`·`bb` 와 표시용 `level` 만 갈고,
  // `stack`·`minBuyIn` 은 판을 열 때만 쓰이므로 1단계 값 그대로 둔다.
  if (game.mode === 'tourney') {
    const level = Math.floor((game.handNo - 1) / LEVEL_EVERY);
    if (level !== (game.stakes.level ?? 0)) game.stakes = atLevel(game.base, level);
    game.minRaise = game.stakes.bb;
  }

  game.deck = shuffle(newShoe(1));
  game.board = [];
  game.hist = [];
  game.results = null;

  // 버튼을 다음 참가자로.
  let b = game.button;
  do { b = (b + 1) % game.seats.length; } while (game.seats[b].out);
  game.button = b;

  // 블라인드. 못 내면 있는 만큼 내고 올인이다.
  const { small, big } = blindSeats(game.seats, game.button);
  put(game.seats[small], game.stakes.sb);
  put(game.seats[big], game.stakes.bb);
  game.seats[small].lastAction = 'SB';
  game.seats[big].lastAction = 'BB';

  for (let i = 0; i < 2; i += 1) {
    for (const s of playing) s.hole.push(card(game));
  }

  game.phase = 'preflop';
  note(game, game.seats[small]);
  note(game, game.seats[big]);
  game.toCall = game.stakes.bb;
  game.minRaise = game.stakes.bb;
  game.turn = firstToAct(game.seats, game.button, 'preflop');

  // 블라인드가 이미 전원 올인이면 곧장 흘려보낸다.
  settleIfNoAction(game);
  touch(game);
  return true;
}

export const currentSeat = (game) => (game.turn >= 0 ? game.seats[game.turn] ?? null : null);
export const pot = (game) => potTotal(game.seats);

/** 지금 차례인 사람이 고를 수 있는 것. */
export const actionsFor = (game) => (currentSeat(game)
  ? legalActions(currentSeat(game), { toCall: game.toCall, minRaise: game.minRaise })
  : new Set());

/** 레이즈 버튼에 걸 금액들. */
export const raisesFor = (game) => (currentSeat(game)
  ? raiseOptions(currentSeat(game), {
    toCall: game.toCall, minRaise: game.minRaise, pot: pot(game),
  })
  : []);

export const toCallFor = (game, seat) => owed(seat, game.toCall);

/**
 * 한 수 둔다. **동기다** — 인터랙션 처리 안에서 부르므로 await 이 끼면 안 된다.
 * `to` 는 레이즈일 때 이번 라운드에 맞출 총액.
 */
/**
 * 방금 한 수를 흐름에 적는다.
 *
 * 화면 표의 "방금" 칸은 **마지막 하나**만 보여 준다. 그걸로는 "미겔이 플랍부터 계속
 * 올린다" 같은 말을 할 수가 없다 — 포커 잡담의 절반이 그런 말인데. 전부 화면에
 * 보였던 공개 정보라 대사에 넘겨도 새는 것이 없다.
 */
const note = (game, seat) => game.hist.push(
  // id 도 같이 남긴다. 대사는 이름만 쓰지만 NPC 판단은 **누구의 행동인지** 정확히
  // 골라야 해서(ai 의 readRange), 표시 이름이 겹치는 사람 둘이 있으면 섞인다.
  { street: game.phase, id: seat.id, name: seat.name, act: seat.lastAction },
);

export function act(game, action, to = 0) {
  const seat = currentSeat(game);
  if (!seat) return '지금은 둘 수 없어요.';
  if (!actionsFor(game).has(action)) return '지금은 못 하는 수예요.';

  if (action === 'fold') {
    seat.folded = true;
    seat.acted = true;
    seat.lastAction = 'Fold';
  } else if (action === 'check') {
    seat.acted = true;
    seat.lastAction = 'Check';
  } else if (action === 'call') {
    const paid = put(seat, owed(seat, game.toCall));
    seat.acted = true;
    seat.lastAction = seat.allIn ? `All-in ${paid}` : `Call ${paid}`;
  } else {
    // raise / allin — 둘 다 "얼마까지 올리느냐" 로 다룬다.
    const target = action === 'allin' ? seat.bet + seat.gold : to;
    const full = target >= minRaiseTo(game.toCall, game.minRaise);
    const before = game.toCall;

    put(seat, target - seat.bet);
    seat.acted = true;
    seat.lastAction = seat.allIn ? `All-in ${seat.bet}` : `Raise ${seat.bet}`;

    if (seat.bet > before) {
      // 최소에 못 미치는 올인은 **베팅을 다시 열지 않는다.** 열어 주면 이미 액션한
      // 사람들이 다시 돌고, 그게 라운드가 안 닫히는 흔한 원인이다.
      if (full) {
        game.minRaise = seat.bet - before;
        for (const s of game.seats) if (s !== seat && !s.folded && !s.allIn) s.acted = false;
      }
      game.toCall = seat.bet;
    }
  }

  note(game, seat);
  advance(game);
  touch(game);
  return null;
}

/** 다음 행동자로. 라운드가 닫혔으면 스트리트를 넘기고, 더 넘길 게 없으면 쇼다운. */
export function advance(game) {
  if (live(game.seats).length <= 1) { game.phase = 'showdown'; game.turn = -1; return; }

  if (!roundClosed(game.seats, game.toCall)) {
    game.turn = nextActor(game.seats, game.turn);
    if (game.turn >= 0) return;
  }

  nextStreet(game);
}

/** 스트리트를 넘긴다. 행동할 사람이 없으면 남은 보드를 끝까지 깐다. */
function nextStreet(game) {
  const order = ['preflop', 'flop', 'turn', 'river'];
  let at = order.indexOf(game.phase);

  for (;;) {
    if (at >= order.length - 1) { game.phase = 'showdown'; game.turn = -1; return; }
    at += 1;
    const street = order[at];

    endStreet(game.seats);
    game.toCall = 0;
    game.minRaise = game.stakes.bb;
    game.phase = street;
    while (game.board.length < BOARD_AT[street]) game.board.push(card(game));

    // 아직 베팅할 사람이 둘 이상이면 여기서 멈추고 차례를 준다.
    if (actionable(game.seats).length >= 2) {
      game.turn = firstToAct(game.seats, game.button, street);
      if (game.turn >= 0) return;
    }
    // 아니면 다음 스트리트로 계속 — 보드만 깔면서 쇼다운까지 간다.
    game.turn = -1;
  }
}

/** 블라인드만으로 이미 판이 끝난 경우(전원 올인)를 흘려보낸다. */
function settleIfNoAction(game) {
  if (live(game.seats).length <= 1 || actionable(game.seats).length >= 2) return;
  if (actionable(game.seats).length === 1 && game.toCall > 0) {
    const one = actionable(game.seats)[0];
    if (owed(one, game.toCall) > 0) return;        // 아직 콜/폴드를 골라야 한다
  }
  nextStreet(game);
}

// ---------------------------------------------------------------- 정산

/** 팟을 나눠 준다. 골드는 여기서만 움직인다. */
export function settle(game) {
  const { gain, pots, shown } = award(game.seats, game.board, game.button);

  for (let i = 0; i < game.seats.length; i += 1) {
    const s = game.seats[i];
    if (s.committed) game.gold.take(s.id, s.committed);
    if (gain[i]) game.gold.give(s.id, gain[i]);
    s.gold = game.gold.get(s.id);
  }

  // **화면에 쓸 것은 여기서 떠 둔다.** 정산 결과는 다음 핸드를 누를 때까지 화면에
  // 남아 있는데, 그 사이에 던전에서 자리를 갈아 끼울 수 있다(swapFighter). 자리
  // 객체를 그대로 들고 있으면 **앞 사람이 잃은 몫이 지원군 이름으로 다시 그려진다** —
  // 지나간 핸드는 그때 싸운 사람을 가리켜야 한다.
  game.results = {
    pots,
    shown: shown.map((x) => ({
      ...x,
      name: game.seats[x.seatIndex]?.name,
      hole: [...(game.seats[x.seatIndex]?.hole ?? [])],
    })),
    rows: game.seats.map((s, i) => ({
      seat: s, name: s.name, net: gain[i] - s.committed, won: gain[i], put: s.committed,
    })),
  };
  game.phase = 'settled';
  touch(game);
}

/** 다음 핸드로. 둘이 안 남으면 판이 끝난다. */
export function nextHand(game) {
  return beginHand(game);
}

export function end(game, reason) {
  game.phase = 'done';
  game.turn = -1;
  game.endedReason = reason;
  touch(game);
}

/** 시작할 때와 견준 증감. 결과 화면과 wallet.commit 이 쓴다. */
export const standings = (game) => game.seats
  .map((seat) => ({ seat, gold: seat.gold, delta: game.gold?.net()[seat.id] ?? 0 }))
  .sort((a, b) => b.gold - a.gold);

export function expired(now = Date.now()) {
  const out = [];
  for (const game of games.values()) {
    if (game.phase === 'done') {
      if (now - game.lastAt > IDLE_MS) games.delete(game.channelId);
      continue;
    }
    if (now - game.lastAt > IDLE_MS && !game.driving) {
      end(game, 'idle');
      out.push(game);
    }
  }
  return out;
}

export default {
  MAX_SEATS, IDLE_MS,
  create, get, remove, forChannel, touch, seatOf, seatIndexOf, hasNpc,
  humanSeat, npcSeat, addSeat, swapFighter, start, beginHand, currentSeat, pot,
  actionsFor, raisesFor, toCallFor, act, advance, settle, nextHand, end,
  standings, expired,
};
