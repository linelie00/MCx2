/**
 * rules — 요트 다이스 규칙 엔진
 *
 * 디스코드를 전혀 모른다. 순수 함수만 있어서 시뮬레이터로 수만 판을 돌려 볼 수 있고,
 * NPC 판단 로직도 이 파일만 보고 만든다.
 *
 * 룰은 한국식 요트 12칸이다. 서양 Yahtzee 와 갈리는 지점이 몇 군데 있어서 못 박아 둔다.
 *
 *   4 of a Kind   같은 눈 네 개 이상 → **주사위 다섯 개 전부의 합** (네 개만 더하지 않는다)
 *   Full House    3+2 → **다섯 개 전부의 합** (고정 25점이 아니다)
 *   야찌(5개 동일) 는 Full House 에도 4 of a Kind 에도 적을 수 있다
 *   S.Straight    연속 4개면 15점 고정. 큰 스트레이트도 작은 쪽을 만족한다
 *   L.Straight    연속 5개면 30점 고정
 *   Yacht         50점 고정. 두 번 이상 나와도 추가 보너스는 없다
 *   상단 합 63 이상이면 +35
 *
 * 어느 칸에든 0점을 적는 것은 언제나 허용된다 — 안 그러면 넣을 데가 없어 판이 막힌다.
 */
import { randomInt } from 'node:crypto';

/**
 * 표시 순서 그대로.
 * label 은 고를 때(셀렉트 메뉴), short 는 좁은 점수표용. 둘 다 한국어로 통일한다 —
 * 표에는 '포카드' 라고 써 놓고 메뉴에는 '4 of a Kind' 라고 쓰면 같은 칸인지 헷갈린다.
 */
export const CATEGORIES = [
  { key: 'aces', label: '1의 눈', short: '1', section: 'upper', face: 1 },
  { key: 'deuces', label: '2의 눈', short: '2', section: 'upper', face: 2 },
  { key: 'threes', label: '3의 눈', short: '3', section: 'upper', face: 3 },
  { key: 'fours', label: '4의 눈', short: '4', section: 'upper', face: 4 },
  { key: 'fives', label: '5의 눈', short: '5', section: 'upper', face: 5 },
  { key: 'sixes', label: '6의 눈', short: '6', section: 'upper', face: 6 },
  { key: 'choice', label: '초이스', short: '초이스', section: 'lower' },
  { key: 'fourKind', label: '포카드 (같은 눈 4개)', short: '포카드', section: 'lower' },
  { key: 'fullHouse', label: '풀하우스 (3개 + 2개)', short: '풀하우스', section: 'lower' },
  { key: 'sStraight', label: '스몰 스트레이트 (연속 4개)', short: 'S스트', section: 'lower' },
  { key: 'lStraight', label: '라지 스트레이트 (연속 5개)', short: 'L스트', section: 'lower' },
  { key: 'yacht', label: '요트 (같은 눈 5개)', short: '요트', section: 'lower' },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
const BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

export const UPPER_KEYS = CATEGORIES.filter((c) => c.section === 'upper').map((c) => c.key);
export const BONUS_NEED = 63;
export const BONUS_SCORE = 35;
export const ROUNDS = CATEGORIES.length;
export const DICE_COUNT = 5;
export const MAX_ROLLS = 3;

/** 기본 RNG. 실제 판의 눈은 반드시 이걸로 굴린다. */
const cryptoRand = () => randomInt(1, 7);

/**
 * 주사위를 굴린다.
 * rand 를 갈아끼울 수 있게 열어 둔 이유는 NPC 시뮬레이션 때문이다 — 판단 한 번에 3만 번을
 * 굴리는데 그걸 암호학적 RNG 로 할 이유가 없다. ai.js 가 Math.random 기반을 넘긴다.
 */
export function rollDice(n = DICE_COUNT, rand = cryptoRand) {
  return Array.from({ length: n }, () => rand());
}

/** 고정하지 않은 자리만 다시 굴린다. 자리는 그대로 둔다 — 버튼 위치가 안 흔들려야 한다. */
export function reroll(dice, held, rand = cryptoRand) {
  return dice.map((d, i) => (held[i] ? d : rand()));
}

/** 눈금별 개수. counts[3] 은 3이 몇 개인지. */
function counts(dice) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d] += 1;
  return c;
}

const sum = (dice) => dice.reduce((a, b) => a + b, 0);

/** 연속으로 n개가 있는지. 1~6 을 훑는다. */
function hasRun(c, n) {
  let run = 0;
  for (let face = 1; face <= 6; face += 1) {
    run = c[face] ? run + 1 : 0;
    if (run >= n) return true;
  }
  return false;
}

/**
 * 이 눈으로 그 칸에 적으면 몇 점인지. 규칙의 전부가 여기 있다.
 * 못 적는 조합이면 0 — 못 적는 게 아니라 0점으로 적히는 것이다.
 */
export function scoreFor(key, dice) {
  const cat = BY_KEY[key];
  if (!cat) throw new Error(`모르는 칸: ${key}`);

  if (cat.section === 'upper') {
    return dice.filter((d) => d === cat.face).length * cat.face;
  }

  const c = counts(dice);
  const most = Math.max(...c.slice(1));

  switch (key) {
    case 'choice':
      return sum(dice);
    // 네 개만 더하는 변형도 있지만 국내 앱은 다섯 개 전부를 더한다.
    case 'fourKind':
      return most >= 4 ? sum(dice) : 0;
    // 3+2 거나 다섯 개가 전부 같거나. 4+1 은 아니다.
    case 'fullHouse': {
      const isFull = most === 5 || (c.includes(3) && c.includes(2));
      return isFull ? sum(dice) : 0;
    }
    // 큰 스트레이트는 작은 쪽도 만족한다(12345 안에 1234 가 있다).
    case 'sStraight':
      return hasRun(c, 4) ? 15 : 0;
    case 'lStraight':
      return hasRun(c, 5) ? 30 : 0;
    case 'yacht':
      return most === 5 ? 50 : 0;
    default:
      throw new Error(`점수 규칙이 없는 칸: ${key}`);
  }
}

/** 12칸 전부의 점수. 셀렉트 메뉴가 이걸 그대로 쓴다. */
export function scoreAll(dice) {
  return Object.fromEntries(CATEGORY_KEYS.map((k) => [k, scoreFor(k, dice)]));
}

/** 빈 점수표. null 은 "아직 안 적음"이고 0 은 "0점으로 적음"이다 — 구분이 중요하다. */
export function newSheet() {
  return Object.fromEntries(CATEGORY_KEYS.map((k) => [k, null]));
}

export function openCategories(sheet) {
  return CATEGORY_KEYS.filter((k) => sheet[k] === null);
}

/** 칸에 적는다. 점수표는 새로 만들어 돌려준다(원본을 안 건드린다). */
export function commit(sheet, key, dice) {
  if (!(key in sheet)) throw new Error(`모르는 칸: ${key}`);
  if (sheet[key] !== null) throw new Error(`이미 적은 칸: ${key}`);
  const gained = scoreFor(key, dice);
  return { sheet: { ...sheet, [key]: gained }, gained };
}

/** 상단/보너스/하단/총점. bonusNeed 는 보너스까지 몇 점 남았는지(이미 받았으면 0). */
export function totals(sheet) {
  const upper = UPPER_KEYS.reduce((a, k) => a + (sheet[k] ?? 0), 0);
  const lower = CATEGORY_KEYS
    .filter((k) => !UPPER_KEYS.includes(k))
    .reduce((a, k) => a + (sheet[k] ?? 0), 0);
  const bonus = upper >= BONUS_NEED ? BONUS_SCORE : 0;
  return {
    upper,
    bonus,
    bonusNeed: Math.max(0, BONUS_NEED - upper),
    lower,
    total: upper + bonus + lower,
  };
}

/** 상단이 다 찼는데 63을 못 넘겼으면 보너스는 이제 불가능하다. 판에 표시할 때 쓴다. */
export function bonusLost(sheet) {
  const filled = UPPER_KEYS.every((k) => sheet[k] !== null);
  return filled && totals(sheet).upper < BONUS_NEED;
}

export function isComplete(sheet) {
  return CATEGORY_KEYS.every((k) => sheet[k] !== null);
}

export const categoryOf = (key) => BY_KEY[key];

export default {
  CATEGORIES, CATEGORY_KEYS, UPPER_KEYS, BONUS_NEED, BONUS_SCORE, ROUNDS, DICE_COUNT, MAX_ROLLS,
  rollDice, reroll, scoreFor, scoreAll, newSheet, openCategories, commit, totals,
  bonusLost, isComplete, categoryOf,
};
