/**
 * state — 진행 중인 블랙잭 판
 *
 * 요트의 state.js 와 뼈대가 같다(채널당 한 판, 메모리에만, TTL 청소). 다른 점은 둘이다.
 *
 *   1. **turn 이 자리가 아니라 손을 가리킨다.** 스플릿하면 한 사람이 손을 여러 개 갖게
 *      되므로 "자리 = 손" 이라는 요트의 전제가 깨진다. hands 를 진행 순서대로 늘어놓은
 *      납작한 배열로 두고 turn 은 거기를 가리킨다. 스플릿은 turn+1 자리에 끼워 넣기만
 *      하면 되고(카지노 순서와 같다), 인덱스를 손볼 곳이 한 군데도 안 생긴다.
 *
 *   2. **단계가 여럿이다.** 요트는 lobby/playing/done 셋이면 됐지만 블랙잭은 한 핸드
 *      안에 베팅·인슈어런스·플레이·딜러·정산이 차례로 온다.
 *
 * 이 파일도 디스코드 API 를 부르지 않는다. Message 를 들고만 있고 그리는 건 명령 쪽이다.
 */
import { randomBytes } from 'node:crypto';
import {
  newShoe, shuffle, draw, needsShuffle, handValue, isBlackjack,
} from '../casino/cards.js';
import { ledger, roundToUnit } from '../casino/wallet.js';
import { stakesOf, DEFAULT_STAKES } from '../casino/stakes.js';
import {
  newHand, legalActions, dealerShouldHit, dealerPeeks,
  settleHand, settleInsurance, insuranceCost, MAX_HANDS_PER_SEAT,
} from './rules.js';
import { OWNER_META, ownerFor } from '../owners.js';
import { THEME_COLOR } from '../embeds.js';

export const MAX_SEATS = 4;
export const IDLE_MS = 10 * 60 * 1000;

const games = new Map();          // channelId → game
const serial = () => randomBytes(3).toString('hex');

// ---------------------------------------------------------------- 자리

/** 사람 자리. 오너면 사이트와 같은 이름(겨울/사백)과 색을 쓴다. */
export function humanSeat(user, displayName) {
  const owner = ownerFor(user.id);
  const meta = owner ? OWNER_META[owner] : null;
  return {
    kind: 'human',
    id: user.id,
    userId: user.id,
    character: null,
    name: meta ? meta.label : (displayName || user.globalName || user.username),
    color: meta ? meta.color : THEME_COLOR,
    chips: 0,
    bet: 0,          // 이번 핸드에 걸기로 한 액수(아직 확정 전이면 stage 에 있다)
    staged: 0,
    insurance: undefined,   // undefined = 아직 답 안 함, 0 = 안 삼
    out: false,
    lastWon: null,
  };
}

/** NPC 자리. 캐릭터 이름(미겔/마티암)을 쓴다. */
export function npcSeat(character) {
  const meta = OWNER_META[character];
  if (!meta) throw new Error(`모르는 캐릭터: ${character}`);
  return {
    kind: 'npc',
    id: `npc:${character}`,
    userId: null,
    character,
    name: meta.character,
    color: meta.color,
    chips: 0,
    bet: 0,
    staged: 0,
    insurance: undefined,
    out: false,
    lastWon: null,
  };
}

// ---------------------------------------------------------------- 판

export function create({ channelId, homeChannelId, guildId, starterId, stakes = DEFAULT_STAKES }) {
  // 판돈은 판을 열 때 정하고 **끝날 때까지 안 바뀐다.** 도중에 바뀌면 이미 건 돈의 뜻이 달라진다.
  const table = stakesOf(stakes);
  const game = {
    stakes: table,
    serial: serial(),
    rev: 0,
    channelId,
    homeChannelId,
    guildId,
    starterId,
    message: null,
    phase: 'lobby',      // lobby → betting → insurance → playing → dealer → settled → done
    seats: [],
    hands: [],           // 진행 순서대로 납작하게. turn 이 여기를 가리킨다
    turn: 0,
    dealer: [],          // 딜러 패
    dealerCharacter: null,   // start() 에서 얼린다
    holeUp: false,       // 홀카드를 깠는지
    shoe: shuffle(newShoe(6)),
    handNo: 0,
    results: [],         // 직전 정산 결과. settled 단계에서 보여준다
    chips: null,         // 동기 장부(wallet.ledger)
    pendingChat: [],     // 판을 그린 뒤 내보낼 알림. 인터랙션 응답을 늦추지 않으려고 미룬다
    lastAt: Date.now(),
    opened: false,       // 환영 인사를 했는지
    // 이미 말한 자리. `핸드:자리` 꼴로 넣는다 — 사람이 버튼을 누를 때마다 드라이버가
    // 다시 도는데, 그때마다 같은 베팅·같은 차례를 또 말하면 안 된다. 판이 사라질 때
    // 같이 사라지므로 따로 비우지 않는다.
    said: new Set(),
    // 캐릭터별로 이 판에서 실제로 한 말. Gemini 로 지을 때 되풀이를 막으려고 얹는다.
    spoken: { migel: [], matiam: [] },
    aiHandNo: 0,         // Gemini 예산을 몇 번째 핸드 것으로 잡아 뒀는지
    aiLeft: 0,
    driving: false,
    rekick: false,       // 드라이버가 도는 동안 들어온 클릭이 있었는지
    closed: false,       // 마무리 인사를 했는지
    saveFailed: false,  // 직전 정산에서 칩을 못 저장했는지 (판에 한 줄 띄운다)
    endedReason: null,
  };
  games.set(channelId, game);
  return game;
}

export const get = (channelId) => games.get(channelId) || null;

/**
 * 아직 살아 있는 판들. 다른 게임이 "이 사람이 어디 앉아 있나" 를 볼 때 쓴다
 * (casino/tables.js). 끝난 판은 자리가 남아 있어도 칩을 걸 수 없으니 뺀다.
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
export const hasNpc = (game, character) =>
  game.seats.some((s) => s.kind === 'npc' && s.character === character);

/**
 * 딜러는 누구인가. 미겔이 플레이어로 앉아 있으면 npc 가 대신 맡는다.
 * 미겔은 대기실이 열린 뒤에도 앉을 수 있으므로 파생값이어야 한다.
 */
export const dealerCharacter = (game) =>
  (game.seats.some((s) => s.character === 'migel') ? 'npc' : 'migel');

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
  if (game.seats.length < 1) return '한 자리 이상이어야 시작할 수 있어요.';
  game.dealerCharacter = dealerCharacter(game);      // 판 도중에 바뀌지 않게 얼린다
  game.chips = ledger(balances);
  for (const s of game.seats) s.chips = game.chips.get(s.id);
  if (!game.seats.some((s) => s.chips >= game.stakes.minBet)) {
    return `${game.stakes.minBet}칩 이상 가진 사람이 한 명은 있어야 해요.`;
  }
  beginBetting(game);
  return null;
}

// ---------------------------------------------------------------- 베팅

export function beginBetting(game) {
  game.phase = 'betting';
  game.handNo += 1;
  game.hands = [];
  game.dealer = [];
  game.holeUp = false;
  game.turn = 0;
  game.results = [];
  for (const s of game.seats) {
    s.bet = 0;
    s.staged = 0;
    s.insurance = undefined;
    if (s.chips < game.stakes.minBet) s.out = true;  // 최소 베팅도 못 걸면 빠진다
  }
  touch(game);
}

/** 이번 핸드에 참여할 수 있는 자리. */
export const active = (game) => game.seats.filter((s) => !s.out);
export const allBetsIn = (game) => active(game).every((s) => s.bet > 0);

/** 베팅을 올린다. 아직 확정 전이라 지울 수 있다. */
export function stageBet(game, seat, amount) {
  if (seat.bet) return '이미 베팅했어요.';
  const next = seat.staged + amount;
  if (next > seat.chips) return `칩이 모자라요. (${seat.chips}칩 남음)`;
  seat.staged = next;
  touch(game);
  return null;
}

export function clearBet(game, seat) {
  if (seat.bet) return '이미 베팅했어요.';
  seat.staged = 0;
  touch(game);
  return null;
}

/** 올린 액수로 확정한다. 이때 칩을 바로 깎는다. */
export function placeBet(game, seat, amount = seat.staged) {
  if (seat.bet) return '이미 베팅했어요.';
  const bet = roundToUnit(amount, game.stakes.unit);
  if (bet < game.stakes.minBet) return `${game.stakes.minBet}칩 이상 걸어야 해요.`;
  if (!game.chips.take(seat.id, bet)) return `칩이 모자라요. (${seat.chips}칩 남음)`;
  seat.chips = game.chips.get(seat.id);
  seat.bet = bet;
  seat.staged = 0;
  touch(game);
  return null;
}

export const allIn = (game, seat) => roundToUnit(seat.chips, game.stakes.unit);

// ---------------------------------------------------------------- 배분

const card = (game) => {
  if (needsShuffle(game.shoe)) game.shoe = shuffle(newShoe(6));
  return draw(game.shoe);
};

/** 자리마다 손 하나씩, 딜러는 두 장. 그 다음 단계는 인슈어런스나 플레이다. */
export function deal(game) {
  game.hands = active(game).map((seat) => newHand({
    seatIndex: game.seats.indexOf(seat),
    bet: seat.bet,
    cards: [card(game), card(game)],
  }));
  game.dealer = [card(game), card(game)];
  game.turn = 0;
  touch(game);
}

export const dealerUp = (game) => game.dealer[0] ?? null;

/** 업카드가 A 면 인슈어런스를 물어본다. */
export const needsInsurance = (game) => dealerUp(game)?.rank === 'a';

/**
 * 인슈어런스를 묻는다.
 *
 * 낼 칩이 없는 자리는 **묻지 않고 바로 0 으로 답해 둔다.** 안 그러면 그 사람은 어느
 * 버튼을 눌러도 "칩이 모자라요" 로 거절당하는데, 단계는 전원이 답해야 끝나므로
 * 판이 영영 멈춘다(실제로 4자리 시뮬레이션에서 그렇게 걸렸다).
 */
export function beginInsurance(game) {
  game.phase = 'insurance';
  for (const s of active(game)) {
    s.insurance = s.chips >= insuranceCost(s.bet) ? undefined : 0;
  }
  touch(game);
}

export function answerInsurance(game, seat, take) {
  if (seat.insurance !== undefined) return '이미 답했어요.';
  if (!take) { seat.insurance = 0; touch(game); return null; }

  const cost = insuranceCost(seat.bet);
  if (!game.chips.take(seat.id, cost)) return `칩이 모자라요. (${seat.chips}칩 남음)`;
  seat.chips = game.chips.get(seat.id);
  seat.insurance = cost;
  touch(game);
  return null;
}

export const allInsuranceIn = (game) => active(game).every((s) => s.insurance !== undefined);

/**
 * 딜러 피크. 업카드가 A 나 10 이면 홀카드를 확인하고, 블랙잭이면 그 자리에서 정산으로 간다.
 * 안 하면 나중에 딜러 블랙잭이 드러났을 때 이미 건 Double·Split 을 되돌려야 한다.
 */
export function peek(game) {
  if (!dealerPeeks(dealerUp(game))) return false;
  if (!isBlackjack(game.dealer)) return false;
  game.holeUp = true;
  touch(game);
  return true;
}

export function beginPlaying(game) {
  game.phase = 'playing';
  game.turn = 0;
  touch(game);
  skipFinished(game);
}

// ---------------------------------------------------------------- 플레이

export const currentHand = (game) => game.hands[game.turn] ?? null;
export const seatOfHand = (game, hand) => (hand ? game.seats[hand.seatIndex] : null);
export const currentSeat = (game) => seatOfHand(game, currentHand(game));
export const handsOfSeat = (game, seatIndex) =>
  game.hands.filter((h) => h.seatIndex === seatIndex).length;

/** 지금 손으로 할 수 있는 것. */
export function actionsFor(game, hand = currentHand(game)) {
  if (!hand) return new Set();
  const seat = seatOfHand(game, hand);
  return legalActions(hand, seat, handsOfSeat(game, hand.seatIndex));
}

/** 다음 손으로. 다 끝났으면 딜러 차례다. */
export function advanceHand(game) {
  game.turn += 1;
  touch(game);
  skipFinished(game);
}

/** 이미 끝난 손(버스트·스탠드·서렌더)은 건너뛴다. 다 지나면 딜러 단계로. */
function skipFinished(game) {
  while (game.turn < game.hands.length) {
    const hand = game.hands[game.turn];
    if (hand.done || handValue(hand.cards).bust) { game.turn += 1; continue; }

    // 쪼개서 생긴 손은 차례가 오면 **바로 두 번째 장을 받는다.** 카지노와 같다.
    // 이걸 빠뜨리면 한 장짜리 손으로 스탠드하게 된다(실제로 그렇게 나왔다).
    if (hand.cards.length === 1) hand.cards.push(card(game));

    // 쪼갠 에이스는 그 한 장으로 끝. 21이어도 더 못 받는다.
    if (hand.splitAce) { hand.done = true; game.turn += 1; continue; }

    return;
  }
  game.phase = 'dealer';
  touch(game);
}

/**
 * 한 수 둔다. 부르는 쪽이 actionsFor 로 미리 걸러 준다는 전제다.
 * 돌려주는 값은 무슨 일이 있었는지 — 채팅 알림과 대사가 이걸 본다.
 */
export function act(game, action) {
  const hand = currentHand(game);
  const seat = seatOfHand(game, hand);

  if (action === 'stand') {
    hand.done = true;
    advanceHand(game);
    return { action, hand, seat, moved: true };
  }

  if (action === 'surrender') {
    hand.surrendered = true;
    hand.done = true;
    advanceHand(game);
    return { action, hand, seat, moved: true };
  }

  if (action === 'hit') {
    hand.cards.push(card(game));
    const { total, bust } = handValue(hand.cards);
    if (bust || total === 21) { hand.done = true; advanceHand(game); }
    else touch(game);
    return { action, hand, seat, bust, moved: bust || total === 21 };
  }

  if (action === 'double') {
    game.chips.take(seat.id, hand.bet);
    seat.chips = game.chips.get(seat.id);
    hand.bet *= 2;
    hand.doubled = true;
    hand.cards.push(card(game));
    hand.done = true;
    const { bust } = handValue(hand.cards);
    advanceHand(game);
    return { action, hand, seat, bust, moved: true };
  }

  if (action === 'split') {
    game.chips.take(seat.id, hand.bet);
    seat.chips = game.chips.get(seat.id);
    const splitAce = hand.cards[0].rank === 'a';
    const moved = hand.cards.pop();

    hand.fromSplit = true;
    hand.splitAce = splitAce;
    hand.cards.push(card(game));

    // 쪼갠 손을 **바로 다음 자리**에 끼운다. 카지노 순서와 같고, 인덱스를 손볼 데가 없다.
    game.hands.splice(game.turn + 1, 0, newHand({
      seatIndex: hand.seatIndex,
      bet: hand.bet,
      cards: [moved],
      fromSplit: true,
      splitAce,
    }));

    if (splitAce) { hand.done = true; advanceHand(game); }
    else touch(game);
    return { action, hand, seat, moved: splitAce };
  }

  throw new Error(`모르는 액션: ${action}`);
}

// ---------------------------------------------------------------- 딜러와 정산

/** 홀카드를 깐다. 뽑는 것과 분리해 둔다 — 아무도 안 남았으면 까기만 하고 끝이다. */
export function revealHole(game) {
  game.holeUp = true;
  touch(game);
}

/** 딜러가 한 장 뽑는다. 더 뽑을 게 없으면 false. */
export function dealerDraw(game) {
  if (!dealerShouldHit(game.dealer)) return false;
  game.dealer.push(card(game));
  touch(game);
  return true;
}

/** 살아 있는 손이 하나라도 있는지. 없으면 딜러는 더 뽑을 이유가 없다. */
export const anyoneAlive = (game) =>
  game.hands.some((h) => !h.surrendered && !handValue(h.cards).bust);

/** 정산. 칩은 여기서 **주기만** 한다 — 걸 때 이미 깎았다. */
export function settle(game) {
  game.holeUp = true;
  game.results = [];

  for (const seat of active(game)) {
    const ins = settleInsurance(seat.insurance || 0, game.dealer);
    if (ins.returned) game.chips.give(seat.id, ins.returned);

    for (const hand of game.hands.filter((h) => h.seatIndex === game.seats.indexOf(seat))) {
      const r = settleHand(hand, game.dealer);
      if (r.returned) game.chips.give(seat.id, r.returned);
      game.results.push({
        seatIndex: hand.seatIndex,
        seat,
        hand,
        outcome: r.outcome,
        returned: r.returned,
        net: r.returned - hand.bet,
      });
    }

    seat.chips = game.chips.get(seat.id);
    const net = game.results
      .filter((r) => r.seat === seat)
      .reduce((a, r) => a + r.net, 0) + (ins.returned - (seat.insurance || 0));
    seat.lastWon = net > 0 ? true : (net < 0 ? false : null);
  }

  game.phase = 'settled';
  touch(game);
}

/** 다음 핸드로. 아무도 못 걸면 판이 끝난다. */
export function nextHand(game) {
  beginBetting(game);
  if (!active(game).length) {
    end(game, 'broke');
    return false;
  }
  return true;
}

export function end(game, reason) {
  game.phase = 'done';
  game.endedReason = reason;
  touch(game);
}

/** 시작할 때와 견준 증감. 결과 화면과 wallet.commit 이 쓴다. */
export const standings = (game) => game.seats
  .map((seat) => ({ seat, chips: seat.chips, delta: game.chips?.net()[seat.id] ?? 0 }))
  .sort((a, b) => b.chips - a.chips);

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

export {
  MAX_HANDS_PER_SEAT, handValue, isBlackjack, insuranceCost,
};

export default {
  MAX_SEATS, IDLE_MS, create, get, remove, forChannel, touch, seatOf, hasNpc,
  humanSeat, npcSeat, dealerCharacter, addSeat, start,
  beginBetting, active, allBetsIn, stageBet, clearBet, placeBet, allIn,
  deal, dealerUp, needsInsurance, beginInsurance, answerInsurance, allInsuranceIn,
  peek, beginPlaying, currentHand, seatOfHand, currentSeat, handsOfSeat,
  actionsFor, advanceHand, act, revealHole, dealerDraw, anyoneAlive, settle, nextHand, end,
  standings, expired,
};
