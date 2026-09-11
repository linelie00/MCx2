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
 *   mult   판매가 = 재료값 × mult. 브론즈가 **본전**이다
 *   mt     `/mt상점` 에 팔면 받는 MT
 *   heal   요리를 먹었을 때의 범위. 제미나이가 이 안에서 고른다
 */
export const GRADES = [
  { key: 'stone', label: '스톤', emoji: '🪨', color: 0x6b6b6b, mult: 0, mt: 0, heal: [-20, -5] },
  { key: 'bronze', label: '브론즈', emoji: '🥉', color: 0xa0673a, min: 0, mult: 1, mt: 0, heal: [1, 10] },
  { key: 'silver', label: '실버', emoji: '🥈', color: 0xb8bcc2, min: 45, mult: 1.5, mt: 0, heal: [5, 20] },
  { key: 'gold', label: '골드', emoji: '🥇', color: 0xc9a227, min: 65, mult: 2.5, mt: 0, heal: [15, 35] },
  { key: 'platinum', label: '플래티넘', emoji: '💠', color: 0x7fd1d9, min: 80, dice: 15, mult: 4, mt: 5, heal: [30, 60] },
  { key: 'diamond', label: '다이아몬드', emoji: '💎', color: 0x7ab8ff, min: 92, dice: 18, mult: 7, mt: 10, heal: [50, 80] },
];
export const GRADE_BY_KEY = Object.fromEntries(GRADES.map((g, rank) => [g.key, { ...g, rank }]));

/**
 * 두 가지 만들기. 점수가 어디서 오는지가 다르다(합쳐서 100).
 *
 *   fit    재료 → 결과물이 합당한가
 *   craft  요리: 잘 조리했나(익힐 것은 익혔나, 독을 그냥 쓰진 않았나)
 *          제작: 과정이 말이 되나
 *   look   요리만. 지문으로 봐서 맛있어 보이나
 *   dice   주사위. 봇이 굴린다
 */
export const MODES = {
  요리: { key: 'cook', verb: '요리', icon: '🍳', parts: { fit: 30, craft: 30, look: 10, dice: 30 }, edible: true },
  제작: { key: 'craft', verb: '제작', icon: '🔨', parts: { fit: 50, craft: 20, dice: 30 }, edible: false },
};

/** 점수 칸의 이름. 결과 화면이 쓴다. */
export const PART_LABEL = { fit: '합당함', craft: '조리', look: '모양', dice: '주사위' };
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
 * 등급. `{ grade, capped }` — `capped` 는 점수로는 더 높았는데 주사위가 막은 등급.
 *
 * **주사위 1 은 점수와 상관없이 스톤이다.** 대실패는 대실패다.
 */
export function gradeOf(total, d) {
  if (d === 1) return { grade: GRADE_BY_KEY.stone, capped: null };
  let capped = null;
  for (let i = GRADES.length - 1; i >= 1; i -= 1) {
    const g = GRADES[i];
    if (total < g.min) continue;
    if (g.dice && d < g.dice) { capped ??= GRADE_BY_KEY[g.key]; continue; }
    return { grade: GRADE_BY_KEY[g.key], capped };
  }
  return { grade: GRADE_BY_KEY.bronze, capped };
}

/** 재료값. 값이 0 인 것(젖은 이끼 같은)은 0 으로 센다. */
export const worthOf = (keys) => keys.reduce((a, k) => a + (ITEM_BY_KEY[k]?.price ?? 0), 0);

/**
 * 판매가. 스톤은 0, 나머지는 **재료값 × 배수**이고 적어도 1골드.
 * 값이 0 인 재료만 써도 브론즈 이상이면 팔 수는 있어야 한다.
 */
export function priceOf(keys, grade) {
  if (!grade.mult) return 0;
  return Math.max(1, Math.round(worthOf(keys) * grade.mult));
}

/**
 * 먹었을 때. 제작은 0.
 *
 * 제미나이가 음수를 적었으면(독을 그냥 썼다든가) **등급과 상관없이 아프다** — 잘 만든
 * 독요리도 독요리다. 그 밖에는 등급의 범위 안으로 자른다. 스톤은 늘 아프다.
 */
export function healOf(mode, grade, proposed) {
  if (!mode.edible) return 0;
  const [lo, hi] = grade.heal;
  const want = Number.isFinite(Number(proposed)) ? Math.round(Number(proposed)) : Math.round((lo + hi) / 2);
  if (grade.key !== 'stone' && want < 0) return clamp(want, -30, -1);
  return clamp(want, lo, hi);
}

/** 만든 것의 id. 서버가 `^[a-z0-9]{8,16}$` 를 본다. */
export const newId = () => randomBytes(8).toString('hex').slice(0, 12);

export default {
  GRADES, GRADE_BY_KEY, MODES, PART_LABEL, partLabel, MAX_CRAFTS, DICE, roll, diceMeaning, dicePoints,
  scoreOf, gradeOf, worthOf, priceOf, healOf, newId,
};
