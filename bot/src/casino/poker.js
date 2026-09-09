/**
 * poker — 7장에서 최선의 5장을 고르고, 두 손을 견준다
 *
 * `cards.js` 는 덱과 그림만 준다. 세기는 하나도 안 준다 — 거기 있는 `rankValue` 는
 * A=11 · T/J/Q/K=10 이라 **포커에서는 못 쓴다.** 10 과 K 가 같은 값이 되어 버린다.
 * 그래서 랭크 표부터 다시 만든다.
 *
 * 손은 `{ category, tiebreak[] }` 로 표현한다. 카테고리를 먼저 견주고, 같으면
 * tiebreak 를 앞에서부터 견준다. 끝까지 같으면 0 — **완전한 동점(찹)이고, 홀덤에서는
 * 실제로 흔하다**(보드 다섯 장이 그대로 최선인 경우). 이걸 0 으로 돌려주지 않으면
 * 팟을 나눌 수가 없다.
 *
 * 디스코드를 모르는 순수 함수만 있다. 시뮬레이터로 수만 판을 돌려 검증한다.
 */

/** 포커 랭크. A 는 14 지만 A-5 스트레이트에서는 1 로도 본다(아래 straightTop). */
export const POKER_RANK = {
  2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, t: 10, j: 11, q: 12, k: 13, a: 14,
};

export const rankOf = (card) => POKER_RANK[card.rank];

/** 높은 손이 앞. compare 가 이 순서를 그대로 쓴다. */
export const CATEGORIES = [
  'straightFlush', 'quads', 'fullHouse', 'flush',
  'straight', 'trips', 'twoPair', 'pair', 'high',
];

const ORDER = Object.fromEntries(CATEGORIES.map((c, i) => [c, CATEGORIES.length - i]));

export const CATEGORY_LABEL = {
  straightFlush: '스트레이트 플러시',
  quads: '포카드',
  fullHouse: '풀하우스',
  flush: '플러시',
  straight: '스트레이트',
  trips: '트리플',
  twoPair: '투페어',
  pair: '원페어',
  high: '하이카드',
};

/**
 * 이 랭크 집합에서 가장 높은 스트레이트의 꼭대기. 없으면 0.
 *
 * **A-5(휠)를 빠뜨리기 쉽다.** A 를 1 로도 넣어 두고 5부터 훑는다. 꼭대기가 5 라
 * 다른 스트레이트보다 항상 낮게 비교된다 — 그게 맞다.
 */
function straightTop(rankSet) {
  const has = new Set(rankSet);
  if (has.has(14)) has.add(1);
  for (let top = 14; top >= 5; top -= 1) {
    let run = true;
    for (let i = 0; i < 5; i += 1) if (!has.has(top - i)) { run = false; break; }
    if (run) return top;
  }
  return 0;
}

/** 그 랭크들로 이뤄진 스트레이트 다섯 장을 실제 카드에서 골라 온다. */
function straightCards(cards, top) {
  const want = [top, top - 1, top - 2, top - 3, top - 4].map((r) => (r === 1 ? 14 : r));
  return want.map((r) => cards.find((c) => rankOf(c) === r));
}

/**
 * 5~7장에서 최선의 5장. `{ category, tiebreak, cards }`.
 *
 * 21억 가지를 다 돌려 보지 않는다. 카테고리마다 어떤 카드가 필요한지 정해져 있으므로
 * 랭크 개수와 무늬 개수만 세면 곧장 나온다.
 */
export function best5(cards) {
  const byRank = new Map();          // 랭크 → 그 랭크의 카드들
  const bySuit = new Map();          // 무늬 → 그 무늬의 카드들
  for (const c of cards) {
    const r = rankOf(c);
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push(c);
    if (!bySuit.has(c.suit)) bySuit.set(c.suit, []);
    bySuit.get(c.suit).push(c);
  }

  const flushSuit = [...bySuit.entries()].find(([, list]) => list.length >= 5)?.[0] ?? null;
  const ranksDesc = [...byRank.keys()].sort((a, b) => b - a);

  // 스트레이트 플러시 — 같은 무늬 안에서만 스트레이트를 찾는다.
  // (무늬를 섞어 찾은 뒤 무늬를 확인하면 틀린다. 예: ♠5♠6♠7♥8♠9 는 스트레이트지
  //  스트레이트 플러시가 아닌데, ♠8 이 따로 있으면 그쪽으로 성립할 수도 있다.)
  if (flushSuit) {
    const suited = bySuit.get(flushSuit);
    const top = straightTop(suited.map(rankOf));
    if (top) {
      return { category: 'straightFlush', tiebreak: [top], cards: straightCards(suited, top) };
    }
  }

  // 랭크를 (개수, 랭크) 순으로 — 포카드·풀하우스·트리플·투페어·페어가 전부 여기서 나온다.
  const groups = [...byRank.entries()]
    .map(([rank, list]) => ({ rank, n: list.length, list }))
    .sort((a, b) => (b.n - a.n) || (b.rank - a.rank));

  const kickers = (used, n) => cards
    .filter((c) => !used.includes(c))
    .sort((a, b) => rankOf(b) - rankOf(a))
    .slice(0, n);

  if (groups[0].n === 4) {
    const four = groups[0].list;
    const k = kickers(four, 1);
    return { category: 'quads', tiebreak: [groups[0].rank, rankOf(k[0])], cards: [...four, ...k] };
  }

  if (groups[0].n === 3 && groups[1] && groups[1].n >= 2) {
    const three = groups[0].list;
    const pair = groups[1].list.slice(0, 2);
    return {
      category: 'fullHouse',
      tiebreak: [groups[0].rank, groups[1].rank],
      cards: [...three, ...pair],
    };
  }

  if (flushSuit) {
    const five = bySuit.get(flushSuit).sort((a, b) => rankOf(b) - rankOf(a)).slice(0, 5);
    return { category: 'flush', tiebreak: five.map(rankOf), cards: five };
  }

  const top = straightTop(ranksDesc);
  if (top) return { category: 'straight', tiebreak: [top], cards: straightCards(cards, top) };

  if (groups[0].n === 3) {
    const three = groups[0].list;
    const k = kickers(three, 2);
    return {
      category: 'trips',
      tiebreak: [groups[0].rank, ...k.map(rankOf)],
      cards: [...three, ...k],
    };
  }

  if (groups[0].n === 2 && groups[1] && groups[1].n === 2) {
    const hi = groups[0].list;
    const lo = groups[1].list;
    const k = kickers([...hi, ...lo], 1);
    return {
      category: 'twoPair',
      tiebreak: [groups[0].rank, groups[1].rank, rankOf(k[0])],
      cards: [...hi, ...lo, ...k],
    };
  }

  if (groups[0].n === 2) {
    const pair = groups[0].list;
    const k = kickers(pair, 3);
    return {
      category: 'pair',
      tiebreak: [groups[0].rank, ...k.map(rankOf)],
      cards: [...pair, ...k],
    };
  }

  const five = [...cards].sort((a, b) => rankOf(b) - rankOf(a)).slice(0, 5);
  return { category: 'high', tiebreak: five.map(rankOf), cards: five };
}

/**
 * 두 손을 견준다. a 가 세면 1, b 가 세면 -1, **완전히 같으면 0**.
 * 0 은 버그가 아니라 찹이다 — 부르는 쪽이 팟을 나눠야 한다.
 */
export function compare(a, b) {
  if (ORDER[a.category] !== ORDER[b.category]) {
    return ORDER[a.category] > ORDER[b.category] ? 1 : -1;
  }
  for (let i = 0; i < Math.max(a.tiebreak.length, b.tiebreak.length); i += 1) {
    const x = a.tiebreak[i] ?? 0;
    const y = b.tiebreak[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * 이긴 손들의 인덱스. 찹이면 여럿이다.
 * `hands` 는 best5() 결과 배열이고, 접은 자리는 부르는 쪽이 미리 빼고 넘긴다.
 */
export function winners(hands) {
  let best = [];
  for (let i = 0; i < hands.length; i += 1) {
    if (!best.length) { best = [i]; continue; }
    const c = compare(hands[i], hands[best[0]]);
    if (c > 0) best = [i];
    else if (c === 0) best.push(i);
  }
  return best;
}

/** "투페어 (K · 7)" 처럼 사람이 읽을 한 줄. */
export function describe(hand) {
  const R = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10' };
  const name = (r) => R[r] ?? String(r);
  const t = hand.tiebreak;
  switch (hand.category) {
    case 'straightFlush':
      return t[0] === 14 ? '로열 플러시' : `스트레이트 플러시 (${name(t[0])} 하이)`;
    case 'quads': return `포카드 (${name(t[0])})`;
    case 'fullHouse': return `풀하우스 (${name(t[0])} · ${name(t[1])})`;
    case 'flush': return `플러시 (${name(t[0])} 하이)`;
    case 'straight': return `스트레이트 (${name(t[0])} 하이)`;
    case 'trips': return `트리플 (${name(t[0])})`;
    case 'twoPair': return `투페어 (${name(t[0])} · ${name(t[1])})`;
    case 'pair': return `원페어 (${name(t[0])})`;
    default: return `하이카드 (${name(t[0])})`;
  }
}

export default {
  POKER_RANK, rankOf, CATEGORIES, CATEGORY_LABEL, best5, compare, winners, describe,
};
