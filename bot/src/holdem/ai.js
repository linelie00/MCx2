/**
 * ai — 홀덤 NPC 판단
 *
 * 블랙잭은 베이직 스트래티지 표 하나로 끝났지만 홀덤은 그런 표가 없다. 상대 수와
 * 보드에 따라 같은 손의 값이 달라지기 때문이다. 그래서 둘로 나눈다.
 *
 *   프리플랍  두 장만 보고 점수를 낸다(Chen 공식). 보드가 없으니 시뮬레이션할 게 없다.
 *   그 뒤     **몬테카를로 승률.** 남은 카드를 무작위로 돌려 이길 확률을 센다.
 *             요트의 NPC 판단과 같은 방식이고, 거기서처럼 rand 를 주입해
 *             시뮬레이션에서는 빠른 RNG 를 쓴다.
 *
 * 판단은 늘 **승률 대 팟 오즈**다. 콜에 필요한 돈이 팟의 4분의 1이면 승률이 25%는
 * 넘어야 콜이 이득이다. 성향은 그 위에 얹는다 — 규칙을 바꾸는 게 아니라 문턱을 민다.
 */
import { SUITS, RANKS } from '../casino/cards.js';
import { best5, compare, rankOf } from '../casino/poker.js';

/**
 * 성향.
 *
 *   loose    문턱을 얼마나 낮추는지. 높을수록 넓게 본다
 *   bluff    승률이 낮아도 밀어붙일 확률
 *   raise    올릴 때의 적극성 — 큰 사이즈를 고를 확률
 *
 * 미겔은 넓게 보고 팟을 키운다. 마티암은 좁게 보고 셀 때만 올린다.
 */
export const STYLES = {
  migel: { name: '미겔', loose: 0.08, bluff: 0.16, raise: 0.62 },
  matiam: { name: '마티암', loose: -0.05, bluff: 0.03, raise: 0.34 },
};

// ---------------------------------------------------------------- 프리플랍

/**
 * 두 장의 세기를 0~1 로. Chen 공식을 그대로 쓰고 마지막에 눈금만 맞춘다.
 *
 * 널리 쓰이는 어림이라 따로 튜닝할 게 없고, 무엇보다 **왜 그 점수인지 설명이 된다** —
 * 몬테카를로로 프리플랍까지 돌리면 느리기만 하고 결과는 이것과 거의 같다.
 */
export function preflopScore(hole) {
  const [a, b] = hole.map(rankOf).sort((x, y) => y - x);
  const suited = hole[0].suit === hole[1].suit;

  const base = (r) => {
    if (r === 14) return 10;
    if (r === 13) return 8;
    if (r === 12) return 7;
    if (r === 11) return 6;
    return r / 2;
  };

  let score = base(a);
  if (a === b) score = Math.max(score * 2, 5);        // 페어
  if (suited) score += 2;

  const gap = a - b - 1;
  if (a !== b) {
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;
    // 낮은 커넥터는 스트레이트가 잘 붙는다
    if (gap <= 1 && a < 12) score += 1;
  }

  score = Math.max(0, Math.ceil(score));
  return Math.min(1, score / 20);                     // Chen 최고점이 20(AA)
}

// ---------------------------------------------------------------- 몬테카를로

const key = (c) => c.rank + c.suit;

/**
 * 이 손이 이길 확률. 찹은 나눠서 센다(둘이 갈라 가지면 0.5).
 *
 * 상대 손은 **완전히 무작위**로 둔다. 상대가 접고 남았다는 정보를 반영하면 더 정확하지만,
 * 그러려면 상대 성향을 모델링해야 하고 그건 이 규모에 과하다. 무작위로 두면 승률이
 * 조금 높게 나오는데, 문턱을 성향으로 미는 김에 같이 흡수된다.
 */
export function equity(hole, board, opponents, { samples = 400, rand = Math.random } = {}) {
  if (opponents <= 0) return 1;

  const dead = new Set([...hole, ...board].map(key));
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const c = { rank, suit };
      if (!dead.has(key(c))) deck.push(c);
    }
  }

  const need = opponents * 2 + (5 - board.length);
  let score = 0;

  for (let s = 0; s < samples; s += 1) {
    // 필요한 만큼만 섞는다(부분 Fisher–Yates). 매번 52장을 다 섞을 이유가 없다.
    for (let i = 0; i < need; i += 1) {
      const j = i + Math.floor(rand() * (deck.length - i));
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    const drawn = deck.slice(0, need);
    const full = [...board, ...drawn.slice(opponents * 2)];
    const mine = best5([...hole, ...full]);

    let better = 0;
    let same = 0;
    for (let o = 0; o < opponents; o += 1) {
      const theirs = best5([drawn[o * 2], drawn[o * 2 + 1], ...full]);
      const c = compare(mine, theirs);
      if (c < 0) { better += 1; break; }
      if (c === 0) same += 1;
    }
    if (better === 0) score += 1 / (same + 1);
  }
  return score / samples;
}

// ---------------------------------------------------------------- 판단

/**
 * 지금 무엇을 할지. `{ action, to, strength, bluff }`.
 *
 * `strength`(0~1)와 `bluff` 는 **대사가 쓴다.** 밀고 있는 것이 진심인지 허세인지를
 * 알려 주지 않으면 NPC 가 블러프하면서 "영 별로지만 밀어 봅니다요" 하고 스스로
 * 광고한다 — 포커에서 제일 재미있는 자리가 대사에서 죽는다.
 *
 * `legal` 과 `raises` 는 state 가 준 것을 그대로 받는다 — 표가 시키는 수를 낼 수 없을 때
 * (칩이 모자라 레이즈가 불가능하다든지) 물러설 곳을 여기서 정하지 않으면 버그가 산다.
 * 블랙잭에서 겪은 그 자리다.
 */
export function chooseAction(who, {
  hole, board, opponents, toCall, pot, legal, raises, samples, rand = Math.random,
}) {
  // 미겔·마티암은 키로, 모브는 성향 객체를 그대로 넘긴다(mobs.js).
  const style = typeof who === 'string' ? (STYLES[who] ?? STYLES.matiam) : who;
  const can = (a) => legal.has(a);

  const strength = board.length === 0
    ? preflopScore(hole)
    : equity(hole, board, opponents, { samples, rand });

  // 팟 오즈 — 콜에 드는 돈이 콜한 뒤 팟에서 차지하는 비율.
  const odds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const edge = strength - odds + style.loose;

  // raises 가 하나뿐일 때(올인밖에 못 할 때) 음수 인덱스로 새지 않게 양쪽을 다 조인다.
  const pick = (i) => raises[Math.max(0, Math.min(i, raises.length - 1))];
  const bigRaise = () => (rand() < style.raise ? pick(raises.length - 2) : pick(0));

  // 셀 때는 올린다. 문턱은 프리플랍이 더 높다 — 두 장만 보고는 확신할 게 없다.
  const strongAt = board.length === 0 ? 0.62 : 0.72;
  const out = (action, to = 0, bluff = false) => ({ action, to, strength, bluff });

  if (strength >= strongAt && can('raise') && raises.length) {
    return out('raise', bigRaise().to);
  }

  // 블러프 — 이길 것 같지 않은데 밀어 본다. 미겔이 이걸로 산다.
  if (toCall === 0 && strength < 0.4 && can('raise') && raises.length && rand() < style.bluff) {
    return out('raise', pick(0).to, true);
  }

  if (toCall === 0) {
    if (strength >= 0.55 && can('raise') && raises.length) return out('raise', pick(0).to);
    return can('check') ? out('check') : out('call');
  }

  if (edge > 0) return out('call');
  if (can('fold')) return out('fold');
  return can('check') ? out('check') : out('call');
}

export default { STYLES, preflopScore, equity, chooseAction };
