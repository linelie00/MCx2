/**
 * quality — 수확 품질 ★ · 거대 작물 (docs/FARM.md §13, 3b)
 *
 * 수확할 때 **칸마다** 품질을 굴린다. 그 칸에서 나온 것은 모두 같은 품질이다. 무작위는 부르는
 * 쪽이 준다(`rand`) — 수확은 쓰는 요청이라 굴린 결과가 곧바로 저장된다.
 *
 *   점수 = 토질 ★×8
 *        + 한 번도 안 시듦 15
 *        + 궁합(±10 에서 자름) + 윤작 +10 / 연작 −10          ← affinity.modsFor().quality
 *        + 제철 +10                                            ← 4단계(계절) 전까지 늘 제철
 *        + 과숙 −15
 *        + 작물 등급(큰 −5 · 귀한 −10 · 아주 귀한 −15)
 *        + 거대 작물 실패 위로 +10
 *        + 난수 0~40
 *
 *   49 이하 보통 · 50~74 ★ · 75~94 ★★ · 95 이상 ★★★. 시든 적이 있으면(`scar`) ★ 까지만.
 *
 * 갓 연 ★1 밭은 최고 73점이라 ★ 까지만 나온다. ★5 밭에 궁합·윤작까지 갖추면 ★★ 가 흔하고
 * 운이 좋으면 ★★★ 다 — 땅을 가꾸는 보람이 품질로 보인다.
 */
const { gradeOf } = require('./crops');

/** 4단계에서 계절이 들어오기 전까지 모든 작물은 제철이다(제철이 아니면 −20 이 될 자리). */
const SEASON = 10;
const NO_SCAR = 15;
const OVERRIPE = -15;
const GIANT_MISS = 10;
const ROLL = 40;
/** 단계 경계 — ★ · ★★ · ★★★ */
const STEPS = [50, 75, 95];
/**
 * 품질 단계마다 칸 하나에 더 주는 농장 경험치. **0 으로 둔다**(3b, simulate-farm).
 * 기획서(§8.2)의 +1 · +2 · +4 면 Lv10 이 25~28일, 절반이어도 31~35일이라 목표(42~56일)를 한참
 * 앞질렀다. 품질은 값(★ 변형의 웃돈)과 도감으로 보상한다. 0 이면 이웃+먹으며 48일 · 먹으며 57일.
 */
const STAR_XP = [0, 0, 0, 0];

/** 작물 등급의 품질 보정 — 비쌀수록 까다롭다(§4). */
function gradeQuality(crop) {
  const g = gradeOf(crop);
  if (g === 'normal') return 0;
  if (g === 'big') return -5;
  return crop.price > 30 ? -15 : -10;
}

/** 점수 → ★ 단계(0~3). */
const starOf = (score) => STEPS.filter((s) => score >= s).length;

/**
 * 칸 하나의 품질. `{ score, star }`.
 *   soilStar  그 밭의 토질 ★(1~5)
 *   mods      affinity.modsFor() — 없으면 보정 0
 *   overripe  과숙인가
 *   bonus     그 밖의 더하기(거대 작물 실패 위로)
 */
function rollQuality({
  crop, soilStar, cell, mods = null, overripe = false, bonus = 0, rand = Math.random,
}) {
  const score = soilStar * 8
    + (cell.scar ? 0 : NO_SCAR)
    + (mods?.quality ?? 0)
    + SEASON
    + (overripe ? OVERRIPE : 0)
    + gradeQuality(crop)
    + bonus
    + Math.floor(rand() * (ROLL + 1));
  const star = starOf(score);
  return { score, star: cell.scar ? Math.min(star, 1) : star };
}

// ---------------------------------------------------------------- 거대 작물

/** 거대 작물은 농장 이 레벨부터. */
const GIANT_LEVEL = 7;
/** 거대 작물이 될 확률 — 10% + 토질 ★ × 4%. */
const giantChance = (soilStar) => 0.1 + soilStar * 0.04;

/**
 * 이 밭을 거두면 거대 작물을 굴릴 수 있나 — 거대가 되는 작물이고, 농장 Lv7 이상이고,
 * **아홉 칸이 전부** 그 작물이며 **다 익었고** **한 번도 안 시들었다.**
 */
function giantReady(plot, crop, level) {
  return Boolean(crop?.giant) && level >= GIANT_LEVEL && plot.cells.length === 9
    && plot.cells.every((c) => c.t === 'plant' && c.ripeDay && !c.scar);
}

module.exports = {
  SEASON, NO_SCAR, OVERRIPE, GIANT_MISS, ROLL, STEPS, STAR_XP, GIANT_LEVEL,
  gradeQuality, starOf, rollQuality, giantChance, giantReady,
};
