/**
 * cards — 트럼프 한 벌
 *
 * 디스코드를 모르는 순수 모듈이다. 카드 표기만 이모지를 다루는데, 그것도 문자열을
 * 만들어 줄 뿐 아무것도 보내지 않는다.
 *
 * 블랙잭 말고 다른 카드 게임을 만들어도 이 파일은 그대로 쓴다.
 */
import { randomInt } from 'node:crypto';

export const SUITS = ['s', 'h', 'd', 'c'];                       // 스페이드 하트 다이아 클럽
export const RANKS = ['a', '2', '3', '4', '5', '6', '7', '8', '9', 't', 'j', 'q', 'k'];

/** 기본 RNG. 실제 판에서 도는 카드는 반드시 이걸로 섞는다. */
const cryptoRand = (n) => randomInt(n);

/** 6덱 슈 하나. 카드는 `{ rank, suit }` 라는 평범한 객체다. */
export function newShoe(decks = 6) {
  const out = [];
  for (let d = 0; d < decks; d += 1) {
    for (const suit of SUITS) for (const rank of RANKS) out.push({ rank, suit });
  }
  return out;
}

/** 피셔-예이츠. 원본을 그대로 섞는다. */
export function shuffle(cards, rand = cryptoRand) {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = rand(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/** 슈에서 한 장. 뒤에서 뽑는다(앞에서 뽑으면 배열 전체가 밀린다). */
export const draw = (shoe) => shoe.pop();

/**
 * 슈가 얼마 안 남았는지. 남은 비율이 이 아래면 섞는다.
 * 끝까지 쓰지 않는 이유는 카지노와 같다 — 마지막 몇 장은 세어 버릴 수 있다.
 */
export const needsShuffle = (shoe, decks = 6, penetration = 0.25) =>
  shoe.length < decks * 52 * penetration;

/** 카드 한 장의 값. A 는 일단 11로 세고, 넘치면 handValue 가 1로 내린다. */
export function rankValue(rank) {
  if (rank === 'a') return 11;
  if (rank === 't' || rank === 'j' || rank === 'q' || rank === 'k') return 10;
  return Number(rank);
}

/**
 * 패의 값.
 *
 * A 를 11로 세면 넘칠 때만 하나씩 1로 내린다. soft 는 아직 11로 세고 있는 A 가
 * 남아 있다는 뜻 — 한 장 더 받아도 바로 안 죽는 상태다(전략표가 이걸로 갈린다).
 */
export function handValue(cards) {
  let total = cards.reduce((a, c) => a + rankValue(c.rank), 0);
  let aces = cards.filter((c) => c.rank === 'a').length;
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  return { total, soft: aces > 0, bust: total > 21 };
}

/** 첫 두 장으로 만든 21. 세 장으로 만든 21은 여기 해당하지 않는다. */
export const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;

// ---------------------------------------------------------------- 표기
//
// 앱 이모지를 올려 두면 그걸 쓰고, 없으면 유니코드로 그린다.
// 앱 이모지는 서버 이모지와 달리 앱당 2000개까지라 52장을 올려도 서버 슬롯을 안 먹는다.

const SUIT_CHAR = { s: '♠️', h: '♥️', d: '♦️', c: '♣️' };
const RANK_CHAR = {
  a: 'A', t: '10', j: 'J', q: 'Q', k: 'K',
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
};

/** 이모지 이름 → `<:card_as:123>`. 부팅할 때 채워진다. */
let EMOJI = null;

export const emojiName = (card) => `card_${card.rank}${card.suit}`;
export const BACK_NAME = 'card_back';

/**
 * 올려 둔 앱 이모지로 갈아 끼운다. 이름 → 이모지 문자열 맵을 받는다.
 * 하나라도 빠지면 그 카드만 유니코드로 남는다.
 */
export function useCardEmoji(map) {
  EMOJI = map && Object.keys(map).length ? map : null;
}

export const hasCardEmoji = () => EMOJI !== null;

/** 카드 한 장. 이모지가 있으면 이모지, 없으면 `**A**♠️`. */
export function cardText(card) {
  const e = EMOJI?.[emojiName(card)];
  if (e) return e;
  return `**${RANK_CHAR[card.rank]}**${SUIT_CHAR[card.suit]}`;
}

/** 엎어 둔 카드. */
export function backText() {
  return EMOJI?.[BACK_NAME] ?? '**?**';
}

/**
 * 패 한 벌을 나란히.
 * hole 이 참이면 두 번째 장을 엎어 둔다 — 딜러의 홀카드다.
 */
export function handText(cards, { hole = false } = {}) {
  return cards
    .map((c, i) => (hole && i === 1 ? backText() : cardText(c)))
    .join(' ');
}

/**
 * 이모지만 든 문자열인지.
 *
 * 디스코드는 **메시지 전체가 이모지일 때만** 크게 그린다(27개 이하). 글자가 하나라도
 * 섞이면 전부 작아지고, 임베드 안에서는 아예 적용되지 않는다. 카드를 크게 보여주려면
 * 이 조건을 지켜 별도 메시지로 보내야 해서, 보내기 전에 확인할 수 있게 열어 둔다.
 */
export const isJumboable = (text) => /^(?:<a?:\w+:\d+>\s*)+$/.test(text.trim());

export default {
  SUITS, RANKS, newShoe, shuffle, draw, needsShuffle,
  rankValue, handValue, isBlackjack,
  useCardEmoji, hasCardEmoji, cardText, backText, handText, emojiName, BACK_NAME, isJumboable,
};
