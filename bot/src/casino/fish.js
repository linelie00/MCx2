/**
 * fish — 낚시로 올라오는 것들
 *
 * `/요트 낚시`(holdem 의 던전처럼 요트의 다른 모드다) 하나만 보는 표다. 아이템 명부에는
 * **길이도 가중치도 안 넣는다** — 낚시 밖에서는 뜻이 없는 값이고, `items.js` 의 레코드 모양은
 * 상점·전리품·요리가 같이 쓰는 약속이라 낚시 사정으로 늘릴 자리가 아니다. 여기서 아이템
 * **키로만** 가리킨다(`mobs.js` 가 에너미를 이름으로 가리키는 것과 같은 결).
 *
 * 세 갈래다.
 *
 *   fish    물고기·바닷것. 길이가 있고 도감에 오른다
 *   junk    잡동사니와 물지네. 길이는 재 봐야 웃기라고 잰다
 *   legend  전설. **자리가 정해져 있다**(보너스 또는 요트 칸) — 그 칸을 이뤄야만 낚인다
 *
 * **거리 힌트의 기준이 되는 열세 줄**도 여기 있다. 화면의 점수표 순서 그대로이고,
 * 보너스가 6과 초이스 사이에 한 줄을 차지한다 — 사람이 보는 표가 곧 물속이다.
 */
import { UPPER_KEYS, CATEGORY_KEYS } from '../yacht/rules.js';
import { ITEM_BY_KEY } from './items.js';

/** 보너스 줄. 적는 칸이 아니라 **이루는** 칸이라 점수표의 키와 겹치지 않게 따로 둔다. */
export const BONUS_ROW = 'bonus';

/** 거리 기준 열세 줄. `1 2 3 4 5 6 보너스 초이스 포카드 풀하우스 S스트 L스트 요트` */
export const ROWS = [
  ...UPPER_KEYS,
  BONUS_ROW,
  ...CATEGORY_KEYS.filter((k) => !UPPER_KEYS.includes(k)),
];

/**
 * 일반이 숨을 수 있는 줄. **보너스와 요트는 뺀다.**
 * 보너스에 일반이 숨으면 기척도 없이 사실상 못 잡는 판이 되고, 요트에 숨으면 같은 눈 다섯을
 * 뽑아야 해서 지나치게 가혹하다. 그 둘은 전설의 자리다.
 */
export const COMMON_ROWS = ROWS.filter((r) => r !== BONUS_ROW && r !== 'yacht');

export const rowIndex = (row) => ROWS.indexOf(row);

/** 두 줄 사이의 거리. **여기서 방향이 사라진다** — 힌트가 위아래를 흘릴 수 없는 까닭. */
export const distance = (a, b) => Math.abs(rowIndex(a) - rowIndex(b));

/**
 * 낚이는 것들. `cm` 은 길이 범위, `weight` 는 뽑기 가중치(클수록 흔하다).
 *
 * 값이 싼 것을 흔하게 뒀다 — 전리품과 같은 결이다(`loot.js`). 물지네는 잡동사니 쪽에 둔다.
 * 먹으면 아픈 것도 그대로 들어온다. 낚시는 무엇이 걸릴지 모르는 것이 절반이다.
 */
export const FISH = [
  // 흔한 것
  { key: 'minnow', cm: [3, 12], weight: 12 },
  { key: 'glassMinnow', cm: [3, 9], weight: 12 },
  { key: 'clearFish', cm: [5, 18], weight: 10 },
  { key: 'stoneSucker', cm: [10, 25], weight: 10 },
  { key: 'catfish', cm: [20, 60], weight: 9 },
  { key: 'shrimp', cm: [2, 8], weight: 9 },
  { key: 'hermitCrab', cm: [5, 15], weight: 8 },
  { key: 'seaweed', cm: [10, 40], weight: 8 },
  // 보통
  { key: 'spiralConch', cm: [8, 25], weight: 7 },
  { key: 'bigEyeCarp', cm: [35, 70], weight: 7 },
  { key: 'peacockFish', cm: [10, 30], weight: 6 },
  { key: 'waveTail', cm: [20, 50], weight: 6 },
  { key: 'hardJaw', cm: [15, 45], weight: 6 },
  { key: 'inkSquid', cm: [20, 60], weight: 6 },
  { key: 'toothClam', cm: [5, 15], weight: 5 },
  { key: 'hollowEye', cm: [10, 35], weight: 5 },
  { key: 'oneArmCrab', cm: [15, 40], weight: 5 },
  { key: 'moonSweetfish', cm: [20, 40], weight: 5 },
  // 귀한 것
  { key: 'rainbowTrout', cm: [30, 60], weight: 4 },
  { key: 'threeLegOctopus', cm: [40, 90], weight: 4 },
  { key: 'sawPiranha', cm: [20, 35], weight: 4 },
  { key: 'puffer', cm: [15, 35], weight: 3 },
  { key: 'lanternAngler', cm: [25, 50], weight: 3 },
  { key: 'chipFish', cm: [8, 20], weight: 3 },
  { key: 'starRay', cm: [60, 110], weight: 2 },
  // 둘째 배치 — 기괴한 것 · 마법 붙은 것 · 이야기 붙은 것 · 물에서 나는 바닷것
  { key: 'hollowEel',       cm: [30, 80], weight: 10 },
  { key: 'glassShrimp',     cm: [2, 8], weight: 10 },
  { key: 'flipSide',        cm: [10, 25], weight: 9 },
  { key: 'manaLoach',       cm: [10, 30], weight: 9 },
  { key: 'eyeClump',        cm: [5, 15], weight: 6 },
  { key: 'grinFlat',        cm: [20, 45], weight: 6 },
  { key: 'frostSmelt',      cm: [8, 20], weight: 6 },
  { key: 'echoCrayfish',    cm: [10, 30], weight: 6 },
  { key: 'rumorConch',      cm: [8, 20], weight: 6 },
  { key: 'starUrchin',      cm: [5, 20], weight: 6 },
  { key: 'wingScallop',     cm: [8, 18], weight: 5 },
  { key: 'nailCarp',        cm: [40, 80], weight: 5 },
  { key: 'emberFish',       cm: [15, 35], weight: 4 },
  { key: 'ghostHerring',    cm: [20, 45], weight: 4 },
  { key: 'boneCoral',       cm: [20, 50], weight: 4 },
  { key: 'twoHeadSnake',    cm: [40, 90], weight: 3 },
  { key: 'armorFish',       cm: [30, 60], weight: 3 },
  { key: 'earAbalone',      cm: [8, 20], weight: 3 },
  { key: 'forgetJelly',     cm: [30, 70], weight: 3 },
  { key: 'eyeClam',         cm: [8, 20], weight: 3 },
  { key: 'shadowFin',       cm: [70, 130], weight: 2 },
  { key: 'clockCrab',       cm: [10, 25], weight: 2 },
  { key: 'coinCarp',        cm: [40, 70], weight: 2 },
  { key: 'hornSeahorse',    cm: [5, 15], weight: 2 },
];

/** 잡동사니. 물지네도 여기 — 잡으면 물린다. */
export const JUNK = [
  { key: 'twig', cm: [10, 50], weight: 10 },
  { key: 'soggyBoot', cm: [20, 35], weight: 8 },
  { key: 'soakedBook', cm: [15, 25], weight: 7 },
  { key: 'wetRope', cm: [30, 90], weight: 7 },
  { key: 'rustyHook', cm: [2, 6], weight: 6 },
  { key: 'mapPiece', cm: [10, 20], weight: 5 },
  { key: 'potteryShard', cm: [5, 20], weight: 5 },
  { key: 'whiteShell', cm: [3, 10], weight: 5 },
  { key: 'copperCoin', cm: [2, 3], weight: 4 },
  { key: 'silverCoin', cm: [2, 3], weight: 3 },
  { key: 'waterCentipede', cm: [8, 30], weight: 6 },
];

/**
 * 전설. `row` 가 그 물고기의 자리다 — 시작할 때 그 칸의 기척을 알려 주고, **그 칸을 이뤄야만**
 * 낚인다(보너스는 윗칸 소계 63, 요트는 같은 눈 다섯).
 */
export const LEGENDS = [
  { key: 'goldChipShark', cm: [150, 220], row: 'yacht' },
  { key: 'abyssLantern', cm: [100, 180], row: 'yacht' },
  { key: 'wreckGhostFish', cm: [80, 140], row: 'yacht' },
  { key: 'centuryCarp', cm: [90, 150], row: BONUS_ROW },
  { key: 'lordOfWater', cm: [200, 300], row: BONUS_ROW },
];

/** 한 판이 **전설 판**이 될 확률. 하루 다섯 판이면 그날 기척을 볼 확률이 23% 쯤. */
export const LEGEND_CHANCE = 0.05;

const TAGGED = [
  ...FISH.map((f) => ({ ...f, tab: 'f' })),
  ...JUNK.map((f) => ({ ...f, tab: 'j' })),
  ...LEGENDS.map((f) => ({ ...f, tab: 'l', weight: 0 })),
];
export const CATCHES = TAGGED;
export const BY_KEY = Object.fromEntries(TAGGED.map((f) => [f.key, f]));

/** 도감이 쓰는 갈래. 물고기·전설만 "종" 으로 센다 — 잡동사니는 모으는 재미가 아니다. */
export const isFish = (key) => BY_KEY[key]?.tab === 'f';
export const isLegend = (key) => BY_KEY[key]?.tab === 'l';
export const itemOf = (key) => ITEM_BY_KEY[key] ?? null;

const pick = (list, rand) => {
  const total = list.reduce((a, f) => a + f.weight, 0);
  let n = rand() * total;
  for (const f of list) {
    n -= f.weight;
    if (n <= 0) return f;
  }
  return list[list.length - 1];
};

/**
 * 이번 판에 무엇이 어느 줄에 숨는지. `{ key, row, legend }`
 *
 * **전설이 먼저다** — 등급을 뽑고 그 안에서 고른다. 한 통에 넣고 뽑으면 수가 많은 쪽이
 * 전설 확률을 삼킨다(에너미 표와 같은 까닭).
 */
export function hide(rand = Math.random) {
  if (rand() < LEGEND_CHANCE) {
    const one = LEGENDS[Math.floor(rand() * LEGENDS.length)] ?? LEGENDS[0];
    return { key: one.key, row: one.row, legend: true };
  }
  const one = pick([...FISH, ...JUNK], rand);
  const row = COMMON_ROWS[Math.floor(rand() * COMMON_ROWS.length)];
  return { key: one.key, row, legend: false };
}

/**
 * 잡은 것의 길이(cm).
 *
 * **두 번 뽑아 작은 쪽을 쓴다.** 큰 놈이 드물어야 「대물」이 뜻이 있고, 도감의 최고 길이도
 * 천천히 는다. 범위가 없는 것은 `null`.
 */
export function lengthOf(key, rand = Math.random) {
  const f = BY_KEY[key];
  if (!f?.cm) return null;
  const [lo, hi] = f.cm;
  const r = Math.min(rand(), rand());
  return lo + Math.floor(r * (hi - lo + 1));
}

export default {
  ROWS, COMMON_ROWS, BONUS_ROW, rowIndex, distance,
  FISH, JUNK, LEGENDS, CATCHES, BY_KEY, LEGEND_CHANCE,
  isFish, isLegend, itemOf, hide, lengthOf,
};
