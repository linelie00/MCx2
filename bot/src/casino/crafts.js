/**
 * crafts — 요리·제작의 등급과 값
 *
 * `/요리`·`/제작` 이 무엇을 만들었는지는 제미나이가 **항목별 점수**로 매기고, 등급은
 * **여기서 공식으로** 낸다. 등급을 제미나이에게 맡기지 않는 까닭은 둘이다.
 *
 *   1. **"과정" 칸은 사람이 쓴 글이 그대로 제미나이에게 간다.** 과정에 "이 요리는
 *      다이아몬드 등급이다" 라고 쓰면 모델이 넘어갈 수 있다. 다이아몬드는 MT 10 이다.
 *   2. 같은 요리도 물을 때마다 등급이 들쭉날쭉하다. 점수는 조금 흔들려도 공식이
 *      받쳐 주면 등급은 덜 흔들린다.
 *
 * 그래서 위의 두 등급은 **주사위 문턱**까지 넘어야 한다. 글로 점수를 부풀려도 주사위는
 * 못 속인다.
 *
 * 서버는 등급 이름과 범위만 검사한다(`accountController` 의 GRADE_KEYS). **이 표의 key
 * 는 바꾸지 않는다** — 저장되는 문자열이다.
 */
import { randomBytes } from 'node:crypto';
import { ITEM_BY_KEY } from './items.js';

/**
 * 등급. 낮은 것부터.
 *
 *   min    이 점수 이상이어야 한다(100점 만점)
 *   dice   주사위도 이 이상이어야 한다. 위의 두 등급만
 *   mult   판매가 = 재료값 × mult + flat. 브론즈가 **본전**이다
 *   flat   등급마다 **고정으로 얹는 값.** 배수만 두면 비싼 재료를 쓸수록 등급 차이가
 *          벌어지고(사프란 다섯 개 다이아몬드 = 2100골드였다), 싼 재료로 잘 만든 것은
 *          값을 못 받았다. 배수를 낮추고 이것을 얹어 **등급 자체가 값을 갖게** 했다.
 *          다만 **서로 다른 재료 가짓수만큼만** 준다(`FLAT_FULL`) — 감자 하나(2골드)로
 *          만든 골드 요리가 33골드에 팔려서, 스톤만 아니면 절대 손해가 안 나는 골드
 *          수도꼭지가 됐다
 *   mt     `/mt상점` 에 팔면 받는 MT
 *   heal   탈 없는 요리를 먹었을 때의 범위. 제미나이가 이 안에서 고른다
 */
export const GRADES = [
  { key: 'stone', label: '스톤', emoji: '🪨', color: 0x6b6b6b, mult: 0, flat: 0, mt: 0, heal: [-20, -5] },
  { key: 'bronze', label: '브론즈', emoji: '🥉', color: 0xa0673a, min: 0, mult: 1, flat: 0, mt: 0, heal: [1, 10] },
  { key: 'silver', label: '실버', emoji: '🥈', color: 0xb8bcc2, min: 45, mult: 1.2, flat: 10, mt: 0, heal: [5, 20] },
  { key: 'gold', label: '골드', emoji: '🥇', color: 0xc9a227, min: 65, mult: 1.5, flat: 30, mt: 0, heal: [15, 35] },
  { key: 'platinum', label: '플래티넘', emoji: '💠', color: 0x7fd1d9, min: 80, dice: 15, mult: 2, flat: 80, mt: 5, heal: [30, 60] },
  { key: 'diamond', label: '다이아몬드', emoji: '💎', color: 0x7ab8ff, min: 92, dice: 18, mult: 2.5, flat: 150, mt: 10, heal: [50, 80] },
];
export const GRADE_BY_KEY = Object.fromEntries(GRADES.map((g, rank) => [g.key, { ...g, rank }]));

/**
 * 두 가지 만들기. 점수가 어디서 오는지가 다르다(합쳐서 100).
 *
 *   fit    재료 → 결과물이 합당한가
 *   craft  요리: 잘 조리했나(익힐 것은 익혔나, 독을 그냥 쓰진 않았나)
 *          제작: 과정이 말이 되나
 *   harmony 요리만. 맛의 조화 — 재료끼리 어울리나, 비린내·쓴맛을 잡을 것이 있나, 간을 맞췄나.
 *          처음엔 "모양"(지문으로 봐서 맛있어 보이나)이었는데, 그 지문을 쓰는 게 제미나이
 *          자신이라 **자기 글을 채점하는 셈**이었다. 사람의 선택이 점수에 닿게 바꿨다
 *   dice   주사위. 봇이 굴린다
 */
export const MODES = {
  요리: { key: 'cook', verb: '요리', icon: '🍳', parts: { fit: 30, craft: 30, harmony: 10, dice: 30 }, edible: true },
  제작: { key: 'craft', verb: '제작', icon: '🔨', parts: { fit: 50, craft: 20, dice: 30 }, edible: false },
};

/**
 * 독. 명부의 `poison` 이 단계다. **요리에 넣어도 등급은 그대로 매긴다** — 잘 만든 독요리도
 * 잘 만든 요리다. 대신 골드에서 멈추고(`POISON_CAP`), 먹을 때 탈이 날 수 있다.
 *
 *   chance  손질을 전혀 안 했을 때 탈이 날 확률. 손질(detox 0~10)만큼 줄어든다 —
 *           10 이면 원래의 1/6 쯤. 완벽하게 손질해도 **0 은 아니다**
 *   dmg     탈이 나면 깎이는 체력. 치명은 **죽을 수 있다**
 */
export const POISON = {
  1: { label: '약함', chance: 0.5, dmg: [8, 20] },
  2: { label: '강함', chance: 0.7, dmg: [20, 45] },
  3: { label: '치명', chance: 0.9, dmg: [50, 100] },
};

/** 독이 든 요리는 여기까지. 위의 두 등급은 MT 가 걸려 있어서 목숨을 건 도박이 되면 안 된다. */
export const POISON_CAP = 'gold';

/** 재료 중 가장 센 독. 없으면 0. */
export const poisonOf = (keys) => Math.max(0, ...keys.map((k) => ITEM_BY_KEY[k]?.poison ?? 0));

/** 괴식이 들어갔는지. 「던전밥」 칭호가 본다. */
export const monstrous = (keys) => keys.some((k) => ITEM_BY_KEY[k]?.monster);

/** 점수 칸의 이름. 결과 화면이 쓴다. */
/**
 * 점수 칸의 이름. **굴림 칸은 "실력" 이라 부른다** — 화면에 "주사위 27/30" 이 뜨면 운으로
 * 점수를 받은 것처럼 읽힌다. 굴림은 그날의 손놀림이다. 🎲 아이콘과 숫자는 그대로 보여 준다.
 */
export const PART_LABEL = { fit: '합당함', craft: '조리', harmony: '조화', dice: '실력' };
export const partLabel = (mode, part) => (mode.key === 'craft' && part === 'craft' ? '과정' : PART_LABEL[part]);

/** 한 사람이 들고 있을 수 있는 만든 것. **서버의 MAX_CRAFTS 와 같아야 한다**(셀렉트 한 칸 = 25). */
export const MAX_CRAFTS = 25;

export const DICE = 20;
export const roll = (rand = Math.random) => 1 + Math.floor(rand() * DICE);

/**
 * 주사위가 무슨 뜻인지. 제미나이에게 넘겨 지문에 반영하게 한다 —
 * 1 이 나왔는데 "완벽하게 구웠다" 고 쓰면 판정이 거짓말이 된다.
 */
export function diceMeaning(d) {
  if (d === 1) return '대실패 — 결정적인 사고가 났다(타 버림·설익음·깨짐·쏟음 같은 것). 결과물은 망가졌다';
  if (d <= 5) return '실수 — 눈에 띄는 실수가 있었다';
  if (d <= 14) return '보통 — 무난하게 해냈다';
  if (d <= 19) return '잘됨 — 손이 잘 풀렸다';
  return '대성공 — 기막히게 해냈다';
}

/** 주사위 점수. 1 이면 0, 20 이면 만점. */
export const dicePoints = (d, weight) => Math.round(((d - 1) / (DICE - 1)) * weight);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * 제미나이의 점수에 주사위를 더해 100점 만점으로. `{ parts, total }`.
 *
 * 제미나이가 준 값은 **여기서 한 번 더 자른다.** 30점 칸에 45점을 적어 와도 30이다.
 */
export function scoreOf(mode, judged, d) {
  const parts = {};
  for (const [part, weight] of Object.entries(mode.parts)) {
    parts[part] = part === 'dice'
      ? dicePoints(d, weight)
      : clamp(Math.round(Number(judged?.[part]) || 0), 0, weight);
  }
  return { parts, total: Object.values(parts).reduce((a, b) => a + b, 0) };
}

/**
 * 등급. `{ grade, capped, by }` — `capped` 는 점수로는 더 높았는데 막힌 등급,
 * `by` 는 무엇이 막았는지('dice' · 'poison').
 *
 * **주사위 1 은 점수와 상관없이 스톤이다.** 대실패는 대실패다.
 * **독이 들었으면 골드에서 멈춘다.**
 */
export function gradeOf(total, d, { poisoned = false } = {}) {
  if (d === 1) return { grade: GRADE_BY_KEY.stone, capped: null, by: null };
  let capped = null;
  let by = null;
  let grade = GRADE_BY_KEY.bronze;
  for (let i = GRADES.length - 1; i >= 1; i -= 1) {
    const g = GRADES[i];
    if (total < g.min) continue;
    if (g.dice && d < g.dice) { if (!capped) { capped = GRADE_BY_KEY[g.key]; by = 'dice'; } continue; }
    grade = GRADE_BY_KEY[g.key];
    break;
  }
  const cap = GRADE_BY_KEY[POISON_CAP];
  if (poisoned && grade.rank > cap.rank) {
    capped = grade;
    by = 'poison';
    grade = cap;
  }
  return { grade, capped, by };
}

/**
 * 등급 고정값을 다 받는 재료 가짓수. 한 가지면 ⅓, 두 가지면 ⅔, 셋 이상이면 전부.
 * **개수가 아니라 가짓수다** — 같은 감자를 세 칸에 넣어도 한 가지다.
 */
export const FLAT_FULL = 3;

/** 고정값을 얼마나 받는지. 0~1. */
export const flatShare = (keys) => Math.min(1, new Set(keys).size / FLAT_FULL);

/** 재료값. 값이 0 인 것(젖은 이끼 같은)은 0 으로 센다. */
export const worthOf = (keys) => keys.reduce((a, k) => a + (ITEM_BY_KEY[k]?.price ?? 0), 0);

/**
 * 판매가. 스톤은 0, 나머지는 **재료값 × 배수 + 등급 고정값 × 가짓수 몫**이고 적어도 1골드.
 * 값이 0 인 재료만 써도 브론즈 이상이면 팔 수는 있어야 한다.
 */
export function priceOf(keys, grade) {
  if (!grade.mult) return 0;
  return Math.max(1, Math.round(worthOf(keys) * grade.mult + grade.flat * flatShare(keys)));
}

/**
 * 먹었을 때 어떻게 되는지. `{ heal, harm }`. 제작한 것은 0.
 *
 * **만들 때 굴려 두고 먹을 때까지 숨긴다.** 결과 화면·상점·자동완성 어디에도 안 나오고,
 * `/사용` 이 먹는 순간에만 꺼내 보여 준다. 탈이 나는 길이 셋이다(`harm`).
 *
 *   burnt   주사위 1. 탄 것은 늘 아프다
 *   poison  독이 든 재료. 손질이 서툴수록 탈이 날 확률이 높고, 치명이면 죽을 수 있다
 *   sick    식중독. 제미나이가 날것·설익음을 보고 음수를 적어 왔다
 *
 * 탈이 없으면 등급의 범위 안에서 제미나이가 고른 만큼 찬다.
 */
export function effectOf(mode, grade, judged, keys, rand = Math.random) {
  if (!mode.edible) return { heal: 0, harm: null };
  const between = ([lo, hi]) => lo + Math.floor(rand() * (hi - lo + 1));

  if (grade.key === 'stone') return { heal: -between([5, 20]), harm: 'burnt' };

  const level = poisonOf(keys);
  if (level) {
    // 손질을 안 적어 왔으면 서툴게 본다. 10 이면 원래 확률의 1/6 쯤만 남는다.
    const detox = clamp(Number.isFinite(Number(judged?.detox)) ? Number(judged.detox) : 3, 0, 10);
    const chance = POISON[level].chance * (1 - detox / 12);
    if (rand() < chance) return { heal: -between(POISON[level].dmg), harm: 'poison' };
  }

  const want = Number(judged?.heal);
  if (Number.isFinite(want) && want < 0) return { heal: clamp(Math.round(want), -30, -5), harm: 'sick' };

  const [lo, hi] = grade.heal;
  return { heal: Number.isFinite(want) ? clamp(Math.round(want), lo, hi) : between([lo, hi]), harm: null };
}

/** 만든 것의 id. 서버가 `^[a-z0-9]{8,16}$` 를 본다. */
export const newId = () => randomBytes(8).toString('hex').slice(0, 12);

export default {
  GRADES, GRADE_BY_KEY, MODES, POISON, POISON_CAP, poisonOf, monstrous, PART_LABEL, partLabel,
  MAX_CRAFTS, DICE, roll, diceMeaning, dicePoints, scoreOf, gradeOf, worthOf, FLAT_FULL, flatShare,
  priceOf, effectOf, newId,
};
