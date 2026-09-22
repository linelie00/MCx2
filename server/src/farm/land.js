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

/**
 * 레벨마다 필요한 누적 경험치. index 0 이 Lv1.
 *
 * `bot/scripts/simulate-farm.mjs` 로 맞췄다(70일 × 12판, 중앙값). 기획서 초안(…, 3000)의 0.35배.
 *   먹으며(거둔 작물로 체력을 채움) Lv10 47일 · 이웃이 물을 도움 52일 · 둘 다 41일
 *   혼자 먹지도 않으면 70일에 Lv9 — 물 한 포기에 체력 1이라 **체력이 속도의 천장**이다
 * Lv2 는 나흘, Lv3 는 엿새 — 초반에 금방 밭이 늘어나는 맛이 있어야 한다.
 */
const LEVEL_XP = [0, 20, 50, 110, 180, 280, 420, 600, 810, 1050];
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
  regrow: 0.5,      // 재수확으로 거둔 칸마다 — 절반(3c). 재수확 작물이 레벨을 너무 빨리 올린다(simulate-farm)
  firstCrop: 10,    // 그 농장에서 처음 거둔 작물
  water: 2,         // 그날 첫 물(누가 줬든)
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

/** 하루 개간 기력(계정 기준). 5 + 레벨 보너스(Lv3 +1). */
const staminaOf = (level) => 5 + (level >= 3 ? 1 : 0);

/** 바위 한 개에 휘두를 수 있는 횟수(나무 곡괭이). 다 빗나가면 금이 간다. */
const MAX_SWINGS = 3;

/** 돌을 치웠을 때 전리품이 나올 확률. 바위는 늘 나온다. */
const ROCK_LOOT = 0.3;

/**
 * 전리품 표(§9). 가중치는 %. `seed` 는 희귀 씨앗(`RARE_SEEDS` 가운데 하나) — 아이템이 아니라
 * **주머니**로 간다(3c). 2a~3a 동안 화석으로 돌려 두었던 몫을 되돌렸다.
 * 키는 봇 명부에 있어야 한다(`bot/scripts/check-farm.mjs` 가 본다).
 */
const ORES = ['oreBlue', 'oreRed', 'oreGold', 'oreGreen', 'oreBlack', 'oreWhite'];
const LOOT = {
  normal: [
    ['crackleStone', 40], ['twig', 15], ['earthworm', 15], ['brokenArrowhead', 10],
    ['ore', 8], ['ironLump', 5], ['oldCoin', 4], ['seed', 2], ['oddFossil', 1],
  ],
  perfect: [
    ['crackleStone', 25], ['twig', 10], ['earthworm', 15], ['brokenArrowhead', 10],
    ['ore', 15], ['ironLump', 8], ['oldCoin', 8], ['seed', 5], ['oddFossil', 4],
  ],
};
/** 계정마다 하루에 나올 수 있는 화석 수. 넘으면 파삭돌로 바꾼다. */
const FOSSIL_PER_DAY = 1;
/** 희귀 씨앗 — 개간 전리품에서 나와 주머니로 간다(3c). 계정마다 하루 이만큼. */
const RARE_SEEDS = ['screamRoot', 'walkingCap', 'keeperBerry'];
const SEED_PER_DAY = 1;

/**
 * 표에서 하나 뽑는다. 화석·씨앗이 하루 상한에 막혔으면 파삭돌.
 * 희귀 씨앗은 `seed:<작물>` 로 돌려준다 — 부르는 쪽이 아이템과 갈라 주머니에 넣는다.
 */
function rollLoot(table, rand, { fossilLeft = 0, seedLeft = 0 } = {}) {
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
  if (key === 'seed') return seedLeft > 0 ? `seed:${RARE_SEEDS[Math.floor(rand() * RARE_SEEDS.length)]}` : 'crackleStone';
  return key;
}

/**
 * 빗나간 휘두름의 힌트. `dir` 은 결이 있는 쪽, `near` 는 바로 옆.
 * 철 곡괭이부터는 `dist`(몇 칸 떨어졌나)까지 준다.
 */
function hintOf(grain, pos, { exact = false } = {}) {
  const hint = { dir: grain < pos ? 'left' : 'right', near: Math.abs(grain - pos) === 1 };
  if (exact) hint.dist = Math.abs(grain - pos);
  return hint;
}

// ---------------------------------------------------------------- 곡괭이 (2b)

/**
 * 곡괭이. **기력이 아니라 전리품 쪽**이다 — 돌은 기력보다 먼저 바닥난다(simulate-farm).
 *   철      빗나가면 결까지 **정확한 거리**를 준다
 *   미스릴  휘두르기 전에 결 후보를 **두 자리로** 좁혀 준다 — 완벽 확률 20% → 50%
 * `items` 의 `ore` 는 원석 아무거나(여섯 가지 섞어서) 그만큼.
 * 계정 기준(`tools`, farms.json) — 폐농해도 남는다. 해금은 **자기 농장 레벨**로 본다.
 */
const PICKAXES = [
  { key: 'wood', name: '나무 곡괭이', emoji: '🪓', lv: 1, gold: 0, items: {} },
  { key: 'iron', name: '철 곡괭이', emoji: '⛏️', lv: 6, gold: 300, items: { ironLump: 2 } },
  { key: 'mithril', name: '미스릴 곡괭이', emoji: '💎', lv: 9, gold: 1000, items: { ore: 3 } },
];
const PICKAXE_BY_KEY = Object.fromEntries(PICKAXES.map((t) => [t.key, t]));
const pickaxeOf = (key) => PICKAXE_BY_KEY[key] ?? PICKAXES[0];
const nextPickaxe = (key) => PICKAXES[PICKAXES.indexOf(pickaxeOf(key)) + 1] ?? null;
const exactHint = (key) => pickaxeOf(key).key !== 'wood';

/**
 * 미스릴 곡괭이의 결 후보 두 자리 — 진짜 결과 다른 한 자리. **해시로 정한다** — 창을 다시
 * 열어도, 서버를 다시 셈해도 같은 두 자리여야 한다(다르면 두 번 보고 결을 알아낸다).
 */
function candidatesOf(channelId, plot, cell, grain) {
  const others = Array.from({ length: GRAIN_SPOTS }, (_, i) => i + 1).filter((x) => x !== grain);
  const other = others[Math.floor(hashRand(channelId, plot, cell, 'mithril') * others.length)];
  return [grain, other].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- 거름 (2b)

/**
 * 거름. 토질 경험을 올린다. **밭마다 하루 몇 개**까지 — 골드만으로 단숨에 ★5 가 되면
 * 땅을 가꾸는 맛이 없다. 값(비료 60)은 봇 명부에 있고 상점이 판다. 서버는 넣기만 한다.
 */
const FERTS = {
  fertilizer: { soil: 15, perDay: 1 },
  compost: { soil: 5, perDay: 3 },
};
/** 퇴비 조각(잡초·죽은 칸) 이만큼이면 퇴비 하나. */
const COMPOST_BITS = 3;
/** 거둔 작물 이만큼이면 퇴비 하나(`/농장 퇴비`). 남는 싼 작물을 토질로 바꾸는 길이다. */
const COMPOST_CROPS = 5;

module.exports = {
  hashRand, between, shuffle,
  SOIL_XP, SOIL_SPEED, soilStar, WEED_SLOW, WEED_CHANCE, DEATH_SOIL, LEGUME_SOIL,
  LEVEL_XP, MAX_LEVEL, PLOT_ORDER, levelOf, nextLevelXp, signOf, XP,
  GRAIN_SPOTS, makePlot,
  staminaOf, MAX_SWINGS, ROCK_LOOT, ORES, LOOT, FOSSIL_PER_DAY, RARE_SEEDS, SEED_PER_DAY, rollLoot, hintOf,
  PICKAXES, pickaxeOf, nextPickaxe, exactHint, candidatesOf,
  FERTS, COMPOST_BITS, COMPOST_CROPS,
};
