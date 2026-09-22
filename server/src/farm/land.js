/**
 * land — 땅 · 토질 · 레벨 · 개간 (docs/FARM.md §8·§9)
 *
 * `rules.js` 가 부르는 표와 계산. 파일도 시간도 모르는 순수 함수다.
 *
 * **무작위는 둘로 나눈다.**
 *   - `hashRand(...)` — 같은 입력이면 늘 같은 값. 하루치 셈(`tick`)이 쓴다. 조회(GET)는 셈만
 *     하고 안 쓰므로, 몇 번 다시 셈해도 같은 칸에 같은 잡초가 나야 한다
 *   - `rand` 인자 — 쓰는 요청(POST)에서만 굴린다. 새 밭의 돌 자리 · 바위의 결 · 수확량 ·
 *     전리품. 굴린 결과는 곧바로 저장된다. 검사는 여기에 정해진 수열을 넣는다
 */

// ---------------------------------------------------------------- 난수

/**
 * FNV-1a 32비트 + murmur3 마무리 → [0, 1). 암호가 아니라 "날마다 다르고 늘 같은" 값이면 된다.
 *
 * **마무리(fmix)를 빼면 안 된다.** FNV 만으로는 끝 글자만 다른 입력(옆 칸)의 상위 비트가 거의
 * 안 바뀌어 값이 한데 몰린다 — 한 밭에 잡초가 한꺼번에 돋았다.
 */
function hashRand(...parts) {
  let h = 0x811c9dc5;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/** `[lo, hi]` 사이 정수. */
const between = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

/** 제자리 섞기(피셔–예이츠). */
function shuffle(list, rand) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// ---------------------------------------------------------------- 토질

/** 토질 ★ 마다 필요한 누적 경험. index 0 이 ★1. */
const SOIL_XP = [0, 20, 60, 140, 300];
/** 토질 ★ 마다 물 한 번에 쌓이는 성장. */
const SOIL_SPEED = [1, 1.1, 1.2, 1.35, 1.5];

/** 토질 ★(1~5). */
const soilStar = (soilXp) => SOIL_XP.filter((need) => (soilXp ?? 0) >= need).length;

/** 잡초가 한 포기라도 있는 밭은 성장이 이만큼으로 준다. */
const WEED_SLOW = 0.95;
/** 빈 흙에 하루 동안 잡초가 날 확률. */
const WEED_CHANCE = 0.05;

/** 작물이 말라 죽거나 썩으면 그 밭 토질 경험이 칸마다 이만큼 준다. */
const DEATH_SOIL = 3;
/** 콩 계열을 거두면 밭마다(한 번의 수확에) 토질 경험을 이만큼 더 준다 — 질소 고정. */
const LEGUME_SOIL = 10;

// ---------------------------------------------------------------- 레벨

/** 레벨마다 필요한 누적 경험치. index 0 이 Lv1. */
const LEVEL_XP = [0, 60, 150, 300, 500, 800, 1200, 1700, 2300, 3000];
const MAX_LEVEL = LEVEL_XP.length;

/**
 * 밭이 열리는 순서. 레벨 L 이면 앞에서 L 개가 열려 있다.
 * 키패드로 5 → 2 → 4 → 6 → 8(십자) → 1 → 3 → 7 → 9(모서리). 십자가 먼저라 초반부터
 * 이웃한 밭이 생긴다(3단계 궁합).
 */
const PLOT_ORDER = [4, 1, 3, 5, 7, 0, 2, 6, 8];

const levelOf = (xp) => LEVEL_XP.filter((need) => (xp ?? 0) >= need).length;
const nextLevelXp = (level) => (level >= MAX_LEVEL ? null : LEVEL_XP[level]);

/** 레벨 간판(§8.2). */
function signOf(level) {
  if (level >= 10) return '🏰';
  if (level >= 9) return '🏯';
  if (level >= 6) return '🏡';
  if (level >= 3) return '🏠';
  return '🛖';
}

/** 농장 경험치(§8.2). */
const XP = {
  harvest: 1,       // 거둔 칸마다
  firstCrop: 10,    // 그 농장에서 처음 거둔 작물
  ownerWater: 2,    // 주인이 그날 처음 물을 줄 때
  rock: 1,
  boulder: 3,
  perfect: 2,       // 바위를 첫 휘두름에 깼을 때 더
};

// ---------------------------------------------------------------- 새 밭

const CELLS = 9;
/** 바위의 결 자리 수. 봇은 `[1]`~`[5]` 버튼을 그린다. */
const GRAIN_SPOTS = 5;

const rock = () => ({ t: 'rock' });
const boulder = (rand) => ({ t: 'boulder', grain: between(rand, 1, GRAIN_SPOTS), swings: 0, cracked: false });

/**
 * 막 열린 밭. **처음 밭(5번)은 빈 흙 셋 · 돌 넷 · 바위 둘** — 첫날부터 심을 수 있게.
 * 나중에 열리는 밭은 돌 3~5 · 바위 2~3, 나머지가 빈 흙.
 */
function makePlot(rand, { first = false } = {}) {
  const rocks = first ? 4 : between(rand, 3, 5);
  const boulders = first ? 2 : between(rand, 2, 3);
  const kinds = [...Array(rocks).fill('rock'), ...Array(boulders).fill('boulder')];
  while (kinds.length < CELLS) kinds.push('soil');
  shuffle(kinds, rand);
  return {
    open: true,
    crop: null,
    soilXp: 0,
    cells: kinds.map((k) => {
      if (k === 'rock') return rock();
      if (k === 'boulder') return boulder(rand);
      return { t: 'soil' };
    }),
  };
}

// ---------------------------------------------------------------- 개간

/** 하루 개간 기력(계정 기준). 5 + 레벨 보너스(Lv3 +1). 곡괭이 보너스는 2b. */
const staminaOf = (level) => 5 + (level >= 3 ? 1 : 0);

/** 바위 한 개에 휘두를 수 있는 횟수(나무 곡괭이). 다 빗나가면 금이 간다. */
const MAX_SWINGS = 3;

/** 돌을 치웠을 때 전리품이 나올 확률. 바위는 늘 나온다. */
const ROCK_LOOT = 0.3;

/**
 * 전리품 표(§9). 가중치는 %. **희귀 씨앗(2%·5%)은 3단계까지 화석으로 돌린다** — 특수 규칙이
 * 없으면 심을 수 없는 작물이라 주머니에 쌓여만 있게 된다.
 * 키는 봇 명부에 있어야 한다(`bot/scripts/check-farm.mjs` 가 본다).
 */
const ORES = ['oreBlue', 'oreRed', 'oreGold', 'oreGreen', 'oreBlack', 'oreWhite'];
const LOOT = {
  normal: [
    ['crackleStone', 40], ['twig', 15], ['earthworm', 15], ['brokenArrowhead', 10],
    ['ore', 8], ['ironLump', 5], ['oldCoin', 4], ['oddFossil', 3],
  ],
  perfect: [
    ['crackleStone', 25], ['twig', 10], ['earthworm', 15], ['brokenArrowhead', 10],
    ['ore', 15], ['ironLump', 8], ['oldCoin', 8], ['oddFossil', 9],
  ],
};
/** 계정마다 하루에 나올 수 있는 화석 수. 넘으면 파삭돌로 바꾼다. */
const FOSSIL_PER_DAY = 1;

/** 표에서 하나 뽑는다. 화석이 막혔으면 파삭돌. */
function rollLoot(table, rand, { fossilLeft = 0 } = {}) {
  const rows = LOOT[table];
  const total = rows.reduce((a, [, w]) => a + w, 0);
  let x = rand() * total;
  let key = rows[rows.length - 1][0];
  for (const [k, w] of rows) {
    if (x < w) { key = k; break; }
    x -= w;
  }
  if (key === 'ore') return ORES[Math.floor(rand() * ORES.length)];
  if (key === 'oddFossil' && fossilLeft <= 0) return 'crackleStone';
  return key;
}

/** 빗나간 휘두름의 힌트. `dir` 은 결이 있는 쪽, `near` 는 바로 옆. */
const hintOf = (grain, pos) => ({ dir: grain < pos ? 'left' : 'right', near: Math.abs(grain - pos) === 1 });

module.exports = {
  hashRand, between, shuffle,
  SOIL_XP, SOIL_SPEED, soilStar, WEED_SLOW, WEED_CHANCE, DEATH_SOIL, LEGUME_SOIL,
  LEVEL_XP, MAX_LEVEL, PLOT_ORDER, levelOf, nextLevelXp, signOf, XP,
  GRAIN_SPOTS, makePlot,
  staminaOf, MAX_SWINGS, ROCK_LOOT, ORES, LOOT, FOSSIL_PER_DAY, rollLoot, hintOf,
};
