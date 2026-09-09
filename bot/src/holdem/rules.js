/**
 * rules — 텍사스 홀덤 규칙
 *
 * 디스코드를 모르는 순수 함수만 있다. 시뮬레이터로 수만 판을 돌려 검증한다.
 *
 * 룰은 못 박아 둔다.
 *
 *   노리밋 홀덤 · 한 벌(52장)을 핸드마다 새로 섞는다
 *   블라인드 10 / 20, 시작 스택 1000 (50 BB)
 *   버튼은 핸드마다 한 칸씩 왼쪽으로. 둘이면 버튼이 스몰블라인드다
 *   레이즈 최소 증분은 직전 증분 이상 (기본은 빅블라인드)
 *   **최소에 못 미치는 올인은 베팅을 다시 열지 않는다** — 안 그러면 판이 안 닫힌다
 *   팟을 나눌 때 남는 칩은 버튼 **왼쪽부터** 한 칩씩
 *
 * **`CHIP_UNIT`(50)을 쓰지 않는다.** 그 상수는 블랙잭의 3:2 배당과 서렌더 절반 반환이
 * 정수로 떨어지게 하려고 있는 것이고, 포커는 정수이기만 하면 된다. 대신 홀덤을 하고 나면
 * 잔액이 50의 배수가 아닐 수 있다(블랙잭 올인이 내림하므로 그 나머지는 못 걸 뿐, 안 사라진다).
 *
 * 이 파일에서 제일 틀리기 쉬운 곳은 둘이다.
 *   1. 사이드팟 — buildPots 의 층 자르기
 *   2. 라운드가 언제 닫히는가 — roundClosed
 * 시뮬레이터의 **칩 총합 보존** 검사가 1번을, **반복 상한**이 2번을 잡는다.
 */
import { best5, winners } from '../casino/poker.js';

/**
 * 자리 수. 온라인 포커의 8맥스와 같다.
 *
 * 카드는 넉넉하다 — 여덟이 두 장씩 받고 보드 다섯을 깔아도 21장이라 한 벌로 된다.
 * 사이드팟도 층 자르기라 자리 수를 안 탄다.
 *
 * 진짜 한계는 **시간**이다. 자리가 늘면 한 핸드에 도는 차례가 그만큼 늘고, NPC 가
 * 수를 두기 전에 쉬는 시간이 그대로 곱해진다. 그래서 자리가 많은 판에서는 그 쉬는
 * 시간을 줄인다(commands/holdem.js 의 thinkPause). 여덟을 넘기면 대사까지 겹쳐
 * 한 핸드가 너무 늘어진다.
 *
 * 요트·블랙잭은 넷 그대로다. 저 둘은 자리마다 화면이 크게 늘어난다 —
 * 요트는 열두 칸 점수표, 블랙잭은 한 자리가 스플릿으로 손을 넷까지 갖는다.
 */
export const MAX_SEATS = 8;

/** 베팅 라운드. 이 순서가 곧 phase 의 순서다. */
export const STREETS = ['preflop', 'flop', 'turn', 'river'];

/** 그 스트리트에서 보드에 깔린 카드 수. */
export const BOARD_AT = { preflop: 0, flop: 3, turn: 4, river: 5 };

/** 새 자리. 칩은 부르는 쪽이 지갑에서 받아 채운다. */
export function newSeat({ kind, id, userId = null, character = null, name, color }) {
  return {
    kind,
    id,
    userId,
    character,
    name,
    color,
    chips: 0,
    hole: [],
    committed: 0,     // 이번 핸드에 낸 총액 — 사이드팟은 이 값으로만 만든다
    bet: 0,           // 이번 라운드에 낸 액수 — 콜 금액은 이 값으로 잰다
    acted: false,     // 마지막 공격 이후에 액션했는지 — 라운드 종료 판정의 전부
    folded: false,
    allIn: false,
    out: false,       // 칩이 떨어져 판에서 빠짐
    lastAction: null, // 판에 보여 줄 직전 행동
  };
}

/** 이번 핸드에 아직 살아 있는 자리(폴드·퇴장 제외). 올인도 살아 있다. */
export const live = (seats) => seats.filter((s) => !s.folded && !s.out);

/** 아직 **행동할 수 있는** 자리. 올인은 더 낼 게 없으므로 빠진다. */
export const actionable = (seats) => live(seats).filter((s) => !s.allIn);

/**
 * from 다음으로 행동할 자리. 없으면 -1.
 * 한 바퀴만 돈다 — 자기 자신도 후보다(혼자 남았을 때).
 */
export function nextActor(seats, from) {
  for (let step = 1; step <= seats.length; step += 1) {
    const i = (from + step) % seats.length;
    const s = seats[i];
    if (!s.folded && !s.allIn && !s.out) return i;
  }
  return -1;
}

/** 버튼 다음으로 이번 핸드에 참여할 자리. 블라인드 자리를 정할 때 쓴다. */
function nextIn(seats, from) {
  for (let step = 1; step <= seats.length; step += 1) {
    const i = (from + step) % seats.length;
    if (!seats[i].out) return i;
  }
  return -1;
}

/**
 * 블라인드 자리. **둘이면 버튼이 스몰블라인드**다(헤즈업 규칙).
 * 셋 이상이면 버튼 다음이 스몰, 그 다음이 빅.
 */
export function blindSeats(seats, button) {
  const inHand = seats.filter((s) => !s.out).length;
  if (inHand === 2) {
    return { small: button, big: nextIn(seats, button) };
  }
  const small = nextIn(seats, button);
  return { small, big: nextIn(seats, small) };
}

/**
 * 그 자리가 낼 수 있는 만큼 낸다. 모자라면 있는 만큼 내고 올인.
 * ledger.take 는 모자라면 아무것도 안 하고 false 를 주므로 그대로는 못 쓴다.
 */
export function put(seat, amount) {
  const paid = Math.min(amount, seat.chips);
  seat.chips -= paid;
  seat.bet += paid;
  seat.committed += paid;
  if (seat.chips === 0) seat.allIn = true;
  return paid;
}

/** 프리플랍 첫 행동은 빅블라인드 다음. 이후 스트리트는 버튼 다음. */
export function firstToAct(seats, button, street) {
  if (street === 'preflop') {
    const { big } = blindSeats(seats, button);
    return nextActor(seats, big);
  }
  return nextActor(seats, button);
}

/** 지금 맞추려면 더 내야 하는 액수. 스택보다 크면 올인 콜이 된다. */
export const owed = (seat, toCall) => Math.max(0, toCall - seat.bet);

/**
 * 레이즈는 **얼마까지 올리느냐(to)** 로 표현한다. 증분이 아니라 총액이다 —
 * 올인이 섞이면 증분으로 두는 쪽이 훨씬 헷갈린다.
 */
export const minRaiseTo = (toCall, minRaise) => toCall + minRaise;

/** 지금 고를 수 있는 것. */
export function legalActions(seat, { toCall, minRaise }) {
  const set = new Set();
  if (seat.folded || seat.allIn || seat.out) return set;

  const need = owed(seat, toCall);
  if (need > 0) {
    set.add('fold');
    set.add('call');                       // 스택이 모자라면 올인 콜
  } else {
    set.add('check');
  }

  // 올릴 여지가 있으면 레이즈. 스택이 최소 레이즈에 못 미쳐도 올인으로는 갈 수 있다.
  if (seat.chips > need) {
    if (seat.bet + seat.chips >= minRaiseTo(toCall, minRaise)) set.add('raise');
    set.add('allin');
  }
  return set;
}

/**
 * 레이즈 버튼에 걸 금액들. 디스코드는 숫자 입력이 없으니 미리 골라 준다.
 * 값은 전부 **to**(이번 라운드 총액)이고, 스택을 넘는 것과 겹치는 것은 뺀다.
 */
export function raiseOptions(seat, { toCall, minRaise, pot }) {
  const max = seat.bet + seat.chips;                 // 올인했을 때의 to
  const min = Math.min(minRaiseTo(toCall, minRaise), max);
  const half = Math.round(toCall + (pot + toCall) * 0.5);
  const full = Math.round(toCall + (pot + toCall));

  const out = [];
  const push = (key, label, to) => {
    const v = Math.min(Math.max(to, min), max);
    if (v < min || out.some((o) => o.to === v) || v >= max) return;
    out.push({ key, label, to: v });
  };
  push('min', `최소 ${min}`, min);
  push('half', `½팟 ${half}`, half);
  push('pot', `팟 ${full}`, full);
  out.push({ key: 'allin', label: `올인 ${max}`, to: max });
  return out;
}

/**
 * 라운드가 닫혔는가.
 *
 * **행동할 수 있는 사람이 전부 액션했고, 낸 액수가 같으면** 닫힌다.
 * `acted` 는 누가 올릴 때마다 나머지에게서 걷어 내므로, "액션이 마지막 공격자에게
 * 돌아왔다" 와 같은 뜻이 된다. 빅블라인드가 프리플랍에 옵션을 갖는 것도 이걸로 따라온다 —
 * 다들 콜만 했으면 빅블라인드는 아직 `acted` 가 false 다.
 */
export function roundClosed(seats, toCall) {
  if (live(seats).length <= 1) return true;
  const can = actionable(seats);
  if (can.length === 0) return true;               // 전원 올인
  if (can.length === 1 && live(seats).length - can.length > 0) {
    // 하나만 행동할 수 있는데 이미 맞췄으면 더 할 게 없다(나머지는 올인).
    return can[0].acted && can[0].bet >= toCall;
  }
  return can.every((s) => s.acted && s.bet === toCall);
}

/** 한 스트리트를 끝내고 다음으로. bet/acted 를 비운다(committed 는 핸드 내내 쌓인다). */
export function endStreet(seats) {
  for (const s of seats) { s.bet = 0; s.acted = false; }
}

/**
 * 이번 핸드에 낸 총액으로 메인팟·사이드팟을 층층이 만든다.
 *
 *   사백 1000 올인 · 겨울 300 올인 · 미겔 1000 콜
 *   → 300 층: (1000→300) + 300 + (1000→300) = 900, 셋 다 자격
 *   → 1000 층: 700 + 700 = 1400, 사백·미겔만
 *
 * **폴드한 사람이 낸 칩도 팟에 들어간다.** 자격만 없다.
 *
 * 그래서 **자격자가 아무도 없는 층이 생길 수 있다.** 아무도 콜하지 않은 초과분을
 * 낸 사람이 접었을 때다 — 예를 들어 빅블라인드 10을 낸 사람이 폴드하고, 남은 사람이
 * 스몰블라인드 8로 이미 올인이면 그 2칩은 아무도 자격이 없다. 그건 **아무도 안 받은
 * 돈**이므로 낸 사람에게 그대로 돌아가야 한다. 그러려면 층마다 누가 얼마를 넣었는지를
 * 알아야 해서 `by` 를 같이 들고 있는다. (처음엔 이걸 빠뜨려서 칩이 사라졌다.)
 */
export function buildPots(seats) {
  const levels = [...new Set(seats.filter((s) => s.committed > 0).map((s) => s.committed))]
    .sort((a, b) => a - b);

  const pots = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    const by = {};
    const eligible = [];
    for (let i = 0; i < seats.length; i += 1) {
      const s = seats[i];
      const put_ = Math.max(0, Math.min(s.committed, level) - prev);
      if (put_ > 0) { by[i] = put_; amount += put_; }
      if (!s.folded && s.committed >= level) eligible.push(i);
    }
    if (amount > 0) pots.push({ amount, eligible, by });
    prev = level;
  }
  return pots;
}

/** 팟 전체. 화면에 보여 줄 때 쓴다. */
export const potTotal = (seats) => seats.reduce((a, s) => a + s.committed, 0);

/**
 * 팟을 나눠 준다. `{ gain: [자리별 받는 칩], shown: [{seatIndex, hand}] }`.
 *
 * 남는 칩은 **버튼 왼쪽부터 한 칩씩.** 내림으로 버리면 칩이 사라진다 —
 * 시뮬레이터의 총합 보존 검사가 바로 잡아낸다.
 */
export function award(seats, board, button) {
  const pots = buildPots(seats);
  const gain = new Array(seats.length).fill(0);
  const rank = new Map();                     // seatIndex → best5 결과 (한 번만 계산)

  const handOf = (i) => {
    if (!rank.has(i)) rank.set(i, best5([...seats[i].hole, ...board]));
    return rank.get(i);
  };

  for (const pot of pots) {
    // 자격자가 없는 층 — 아무도 콜하지 않은 초과분이다. 낸 사람에게 그대로 돌려준다.
    if (pot.eligible.length === 0) {
      for (const [i, put_] of Object.entries(pot.by)) gain[Number(i)] += put_;
      continue;
    }
    if (pot.eligible.length === 1) { gain[pot.eligible[0]] += pot.amount; continue; }

    const hands = pot.eligible.map(handOf);
    const win = winners(hands).map((k) => pot.eligible[k]);

    const each = Math.floor(pot.amount / win.length);
    for (const i of win) gain[i] += each;

    let odd = pot.amount - each * win.length;
    for (let step = 1; odd > 0; step += 1) {
      const i = (button + step) % seats.length;
      if (win.includes(i)) { gain[i] += 1; odd -= 1; }
    }
  }

  // 쇼다운까지 간 사람만 패를 깐다. 한 명만 남았으면 아무도 안 깐다.
  const contested = pots.some((p) => p.eligible.length > 1);
  const shown = contested
    ? live(seats).map((s) => ({ seatIndex: seats.indexOf(s), hand: handOf(seats.indexOf(s)) }))
    : [];

  return { gain, pots, shown };
}

export default {
  MAX_SEATS, STREETS, BOARD_AT,
  newSeat, live, actionable, nextActor, blindSeats, put, firstToAct,
  owed, minRaiseTo, legalActions, raiseOptions, roundClosed, endStreet,
  buildPots, potTotal, award,
};
