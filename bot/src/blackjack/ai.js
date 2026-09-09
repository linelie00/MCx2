/**
 * ai — NPC 가 어떻게 둘지 정한다
 *
 * 요트의 몬테카를로와 달리 블랙잭은 **정답이 이미 알려져 있다.** 베이직 스트래티지라는
 * 표가 있고, 그대로 두면 하우스 엣지가 0.5% 안팎까지 떨어진다. 그래서 굴려 볼 필요 없이
 * 표를 찾으면 된다.
 *
 * 성향은 그 표에서 **얼마나 벗어나는가**로 낸다.
 *
 *   미겔    경계선에서 공격적으로 튼다. Insurance 를 재미로 산다. 베팅이 들쭉날쭉하다.
 *   마티암  표대로만. Insurance 절대 안 산다. 표가 시키는 **서렌더를 실제로 한다** —
 *           그 신중함이 테이블에서 제일 잘 보이는 지점이다.
 *
 * chooseAction 은 **제안만** 한다. 부르는 쪽이 legalActions 와 교집합을 내고, 못 하는
 * 것이면 물러설 곳을 찾는다(표가 더블을 시켰는데 칩이 모자란 경우 등). 버그가 사는 곳이라
 * 물러서는 순서를 fallback 에 명시해 뒀다.
 *
 * 이 파일도 디스코드를 모른다. simulate-blackjack.mjs 로 검증한다.
 */
import { handValue, rankValue } from '../casino/cards.js';
import { BET_UNITS } from './rules.js';

/**
 * 표의 기호.
 *   H  hit          S  stand         P  split
 *   D  double, 못 하면 hit           d  double, 못 하면 stand
 *   R  surrender, 못 하면 hit
 */
const FALLBACK = { D: 'hit', d: 'stand', R: 'hit' };

/** 업카드 2~10,A 를 0~9 로. 표의 열 번호다. */
const upIndex = (up) => {
  const v = rankValue(up.rank);
  return v === 11 ? 9 : v - 2;
};

//                    2    3    4    5    6    7    8    9    10   A
const HARD = {
  5:  ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
  6:  ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
  7:  ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
  8:  ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
  9:  ['H', 'D', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
  10: ['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'H', 'H'],
  11: ['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'H'],
  12: ['H', 'H', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
  13: ['S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
  14: ['S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
  15: ['S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'R', 'H'],
  16: ['S', 'S', 'S', 'S', 'S', 'H', 'H', 'R', 'R', 'R'],
  17: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
  18: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
  19: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
  20: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
  21: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
};

/** A 를 11로 세고 있을 때. 키는 A 를 뺀 나머지 합(A,2 면 2). */
const SOFT = {
  2:  ['H', 'H', 'H', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
  3:  ['H', 'H', 'H', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
  4:  ['H', 'H', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
  5:  ['H', 'H', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
  6:  ['H', 'D', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
  7:  ['d', 'd', 'd', 'd', 'd', 'S', 'S', 'H', 'H', 'H'],
  8:  ['S', 'S', 'S', 'S', 'd', 'S', 'S', 'S', 'S', 'S'],
  9:  ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
  10: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
};

/** 페어. 키는 카드 한 장의 값(A 는 11). */
const PAIRS = {
  2:  ['P', 'P', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H'],
  3:  ['P', 'P', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H'],
  4:  ['H', 'H', 'H', 'P', 'P', 'H', 'H', 'H', 'H', 'H'],
  5:  ['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'H', 'H'],
  6:  ['P', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H', 'H'],
  7:  ['P', 'P', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H'],
  8:  ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
  9:  ['P', 'P', 'P', 'P', 'P', 'S', 'P', 'P', 'S', 'S'],
  10: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
  11: ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
};

export const STYLES = {
  migel: {
    name: '미겔',
    /** 경계선에서 이 확률로 공격적인 쪽으로 튼다. */
    aggression: 0.25,
    /** 재미로 산다. 기댓값으로는 손해다. */
    insurance: true,
    /** 서렌더를 안 한다 — 물러서는 걸 싫어한다. */
    surrender: false,
    /** 베팅이 들쭉날쭉하다. 직전 결과에 끌린다. */
    betSpread: true,
  },
  matiam: {
    name: '마티암',
    aggression: 0,
    insurance: false,
    surrender: true,
    betSpread: false,
  },
};

/** 표에서 이 손의 권장 수를 찾는다. 성향을 타지 않은 순수한 답이다. */
export function chartAction(cards, dealerUp, { canSplit = true } = {}) {
  const col = upIndex(dealerUp);
  const { total, soft } = handValue(cards);

  if (canSplit && cards.length === 2
    && rankValue(cards[0].rank) === rankValue(cards[1].rank)) {
    const row = PAIRS[rankValue(cards[0].rank)];
    if (row) return row[col];
  }

  if (soft) {
    const row = SOFT[total - 11];
    if (row) return row[col];
  }

  return HARD[Math.min(21, Math.max(5, total))][col];
}

/** 표 기호를 실제 액션 이름으로. 못 하는 것이면 물러설 곳으로. */
function resolve(code, legal) {
  const wanted = { H: 'hit', S: 'stand', P: 'split', D: 'double', d: 'double', R: 'surrender' }[code];
  if (legal.has(wanted)) return wanted;
  const back = FALLBACK[code];
  if (back && legal.has(back)) return back;
  return legal.has('stand') ? 'stand' : [...legal][0];
}

/**
 * NPC 가 이번 손에 무엇을 할지.
 * legal 은 rules.legalActions 가 준 집합이다 — 여기 없는 것은 절대 안 고른다.
 */
export function chooseAction(styleKey, { cards, dealerUp, legal, rand = Math.random }) {
  const style = STYLES[styleKey];
  if (!style) throw new Error(`모르는 성향: ${styleKey}`);
  if (!legal.size) return 'stand';

  let code = chartAction(cards, dealerUp, { canSplit: legal.has('split') });

  // 서렌더를 싫어하는 쪽은 표가 시켜도 안 한다. 그만큼 더 잃지만 그게 성격이다.
  if (code === 'R' && !style.surrender) code = 'H';

  // 경계선에서 공격적으로 튼다. 스탠드할 자리에서 한 장 더 받거나, 히트할 자리에서
  // 더블로 지른다. 16 vs 10 에서 히트하는 미겔이 여기서 나온다.
  if (style.aggression && rand() < style.aggression) {
    const { total, soft } = handValue(cards);
    if (code === 'S' && !soft && total >= 12 && total <= 16 && legal.has('hit')) code = 'H';
    else if (code === 'H' && legal.has('double') && total >= 9 && total <= 11) code = 'D';
  }

  return resolve(code, legal);
}

/** 인슈어런스를 살지. 기댓값으로는 늘 손해라 성향으로만 갈린다. */
export const chooseInsurance = (styleKey) => Boolean(STYLES[styleKey]?.insurance);

/**
 * 얼마를 걸지. 남은 칩에서 낼 수 있는 것 중에 고른다.
 *
 * 미겔은 직전에 이겼으면 키우고 졌으면 더 키운다(본전 생각). 마티암은 늘 같은 액수.
 */
export function chooseBet(styleKey, { chips, lastBet = 0, lastWon = null, rand = Math.random }) {
  const style = STYLES[styleKey];
  const affordable = BET_UNITS.filter((b) => b <= chips);
  if (!affordable.length) return 0;

  if (!style.betSpread) {
    // 마티암 — 두 번째로 작은 것을 꾸준히. 없으면 제일 작은 것.
    return affordable[Math.min(1, affordable.length - 1)];
  }

  // 미겔 — 기본은 가운데, 직전 판에 끌려 위아래로 흔들린다.
  let i = Math.min(affordable.length - 1, Math.floor(affordable.length / 2));
  if (lastWon === true && rand() < 0.5) i = Math.min(affordable.length - 1, i + 1);
  if (lastWon === false && rand() < 0.35) i = Math.min(affordable.length - 1, i + 1);
  if (rand() < 0.2) i = Math.max(0, i - 1);
  return affordable[i];
}

export default { STYLES, chartAction, chooseAction, chooseInsurance, chooseBet };
