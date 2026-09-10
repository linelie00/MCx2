/**
 * rules — 블랙잭 규칙
 *
 * 디스코드를 모르는 순수 함수만 있다. 시뮬레이터로 수천 판을 돌려 검증한다.
 *
 * 블랙잭은 집집마다 룰이 다르다. 요트에서 그랬듯 갈리는 지점을 여기 못 박아 둔다.
 *
 *   6덱 슈, 4분의 1 아래로 줄면 섞는다
 *   딜러는 17 이상에서 선다 — 소프트 17도 선다 (S17)
 *   블랙잭 3:2 · 푸시는 원금 그대로 · 서렌더는 절반 반환
 *   스플릿: 같은 **값**(10/J/Q/K 서로 가능), 한 자리 최대 4손
 *   스플릿한 에이스는 한 장만 받고 자동 스탠드, 재분할 불가
 *   스플릿 후의 21은 블랙잭이 아니다 (1:1)
 *   더블: 첫 두 장이면 언제든, 스플릿 후에도 가능 (DAS)
 *   서렌더: 레이트 서렌더 — 첫 두 장이고 스플릿·더블 전에만. 절반 반환
 *   인슈어런스: 업카드가 A 일 때만, 베팅의 절반, 2:1
 *   딜러 피크: 업카드가 A 또는 10이면 홀카드를 확인한다
 *   모든 베팅은 그 자리 최소 베팅의 배수 — 3:2 와 절반 반환이 정수로 떨어져야 한다
 *
 * 피크를 하는 이유는 정산 때문이다. 안 하면 나중에 딜러 블랙잭이 드러났을 때 이미 건
 * Double·Split 을 되돌려야 하는데, 그 경로가 아주 고약하다.
 */
import { handValue, isBlackjack, rankValue } from '../casino/cards.js';
export const MAX_HANDS_PER_SEAT = 4;

/** 한 손. 자리가 아니라 손이 게임의 단위다 — 스플릿하면 한 사람이 여럿 갖는다. */
export function newHand({ seatIndex, bet, cards = [], fromSplit = false, splitAce = false }) {
  return {
    seatIndex,
    bet,
    cards,
    fromSplit,
    splitAce,          // 스플릿한 에이스는 한 장만 받고 끝난다
    doubled: false,
    surrendered: false,
    done: false,
  };
}

/**
 * 지금 이 손으로 할 수 있는 것.
 *
 * 부르는 쪽이 버튼을 켜고 끄는 데 쓰고, NPC 판단도 이걸로 걸러진다 — 전략표가
 * 더블을 시켰는데 골드가 모자라면 히트로 물러서야 한다.
 */
export function legalActions(hand, seat, handsOfSeat) {
  const out = new Set();
  if (hand.done) return out;

  const { total, bust } = handValue(hand.cards);
  if (bust) return out;

  out.add('stand');

  const first = hand.cards.length === 2;
  const canAfford = seat.gold >= hand.bet;

  // 스플릿한 에이스는 한 장만 받고 자동으로 선다. 21이어도 더 받을 이유가 없다.
  if (!hand.splitAce && total < 21) out.add('hit');
  if (first && !hand.splitAce && canAfford) out.add('double');

  if (first && !hand.splitAce && canAfford && handsOfSeat < MAX_HANDS_PER_SEAT
    && rankValue(hand.cards[0].rank) === rankValue(hand.cards[1].rank)) {
    out.add('split');
  }

  // 레이트 서렌더 — 처음 받은 두 장 그대로일 때만.
  if (first && !hand.fromSplit && !hand.doubled) out.add('surrender');

  return out;
}

/** 인슈어런스는 업카드가 A 일 때만, 베팅의 절반을 낼 수 있을 때만. */
export const insuranceCost = (bet) => bet / 2;
export const canInsure = (seat, hand, dealerUp) =>
  dealerUp?.rank === 'a' && seat.gold >= insuranceCost(hand.bet);

/** 딜러는 17 이상에서 선다. 소프트 17도 선다(S17). */
export const dealerShouldHit = (cards) => handValue(cards).total < 17;

/** 업카드가 A 또는 10값이면 홀카드를 미리 확인한다. */
export const dealerPeeks = (upcard) => rankValue(upcard.rank) >= 10;

/**
 * 한 손의 정산.
 *
 * returned 는 **플레이어에게 돌아가는 골드**이다. 베팅은 걸 때 이미 깎았으므로
 * 여기서는 주기만 한다. 그래서 지면 0, 푸시면 원금 그대로다.
 */
export function settleHand(hand, dealerCards) {
  const bet = hand.bet;

  if (hand.surrendered) return { outcome: 'surrender', returned: bet / 2 };

  const mine = handValue(hand.cards);
  if (mine.bust) return { outcome: 'bust', returned: 0 };

  // 스플릿해서 만든 21은 블랙잭이 아니다. 그래서 fromSplit 을 본다.
  const myBJ = !hand.fromSplit && isBlackjack(hand.cards);
  const dealerBJ = isBlackjack(dealerCards);

  if (myBJ && dealerBJ) return { outcome: 'push', returned: bet };
  if (myBJ) return { outcome: 'blackjack', returned: bet * 2.5 };
  if (dealerBJ) return { outcome: 'dealerBlackjack', returned: 0 };

  const dealer = handValue(dealerCards);
  if (dealer.bust) return { outcome: 'win', returned: bet * 2 };
  if (mine.total > dealer.total) return { outcome: 'win', returned: bet * 2 };
  if (mine.total < dealer.total) return { outcome: 'lose', returned: 0 };
  return { outcome: 'push', returned: bet };
}

/**
 * 인슈어런스 정산. 낸 돈은 이미 깎였다.
 * 딜러가 블랙잭이면 2:1 — 낸 것까지 세 배가 돌아온다.
 */
export function settleInsurance(amount, dealerCards) {
  if (!amount) return { won: false, returned: 0 };
  return isBlackjack(dealerCards)
    ? { won: true, returned: amount * 3 }
    : { won: false, returned: 0 };
}

/** 정산 결과를 사람이 읽을 말로. 판과 로그가 같은 표현을 쓰게 한곳에 둔다. */
export const OUTCOME_LABEL = {
  blackjack: 'Blackjack',
  win: 'Win',
  push: 'Push',
  lose: 'Lose',
  bust: 'Bust',
  surrender: 'Surrender',
  dealerBlackjack: 'Dealer Blackjack',
};

export default {
  MAX_HANDS_PER_SEAT, OUTCOME_LABEL,
  newHand, legalActions, canInsure, insuranceCost,
  dealerShouldHit, dealerPeeks, settleHand, settleInsurance,
};
