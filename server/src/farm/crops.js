/**
 * crops — 농장 작물표 (원본)
 *
 * 성장일과 씨앗값은 **서버가 판정**하므로 원본은 여기 둔다. 봇은 `GET /api/farms/crops`
 * 로 받아 그린다. 작물의 이름·설명은 봇 명부(`bot/src/casino/items.js`)가 원본이고,
 * `name` 은 서버가 오류 문구에 쓰려고 옮겨 적은 것이다.
 *
 * **`price` 는 봇 명부의 파는 값과 같아야 한다.** 서버는 아이템 값을 모른다 — 씨앗값을
 * 셈하려고 옮겨 적었다. 어긋나면 `bot/scripts/check-farm.mjs` 가 잡는다.
 *
 * `key` 는 곧 수확물의 아이템 키다. **바꾸지 않는다.**
 *
 *   lv      심을 수 있게 되는 농장 레벨
 *   family  계열(docs/FARM.md §5). 2단계는 콩 계열(토질 경험 +10)만 읽는다 — 궁합·윤작은 3단계
 *   days    기본 성장일. 물을 받을 때마다 토질 배율만큼 쌓여 이만큼이 되면 다 자란다
 *           (docs/FARM.md §4 — 기본가 구간 + 작물 성격 보정)
 *   regrow  재수확. 거둔 뒤 이만큼 뒤에 다시 다 자란다. 없으면 거두면 칸이 빈다
 *
 * 특수 규칙이 있는 작물(박하 퍼짐 · 쌀 물 욕심 · 해바라기·옥수수 그늘 · 과수)은 그 규칙이
 * 들어오는 단계에서 넣는다. 옥수수는 그늘 없이 먼저 심는다.
 */
const CROPS = [
  // ---- Lv1
  { key: 'potato',      name: '감자',     lv: 1, family: 'root',     price: 2, days: 2,            emoji: '🥔' },
  { key: 'carrot',      name: '당근',     lv: 1, family: 'root',     price: 2, days: 3,            emoji: '🥕' },
  { key: 'spinach',     name: '시금치',   lv: 1, family: 'leaf',     price: 3, days: 2,            emoji: '🥬' },
  { key: 'cucumber',    name: '오이',     lv: 1, family: 'gourd',    price: 2, days: 2, regrow: 2, emoji: '🥒' },
  { key: 'radish',      name: '무',       lv: 1, family: 'root',     price: 3, days: 3,            emoji: '⚪' },
  { key: 'lettuce',     name: '상추',     lv: 1, family: 'leaf',     price: 2, days: 2, regrow: 2, emoji: '🥗' },
  { key: 'wheat',       name: '밀 이삭',  lv: 1, family: 'grain',    price: 2, days: 3,            emoji: '🌾' },
  { key: 'soybean',     name: '콩',       lv: 1, family: 'legume',   price: 3, days: 3,            emoji: '🫘' },
  // ---- Lv2
  { key: 'onion',       name: '양파',     lv: 2, family: 'allium',   price: 2, days: 3,            emoji: '🧅' },
  { key: 'garlic',      name: '마늘',     lv: 2, family: 'allium',   price: 3, days: 4,            emoji: '🧄' },
  { key: 'greenOnion',  name: '대파',     lv: 2, family: 'allium',   price: 3, days: 3, regrow: 2, emoji: '🎋' },
  { key: 'cabbage',     name: '양배추',   lv: 2, family: 'leaf',     price: 3, days: 3,            emoji: '🥬' },
  { key: 'tomato',      name: '토마토',   lv: 2, family: 'fruitveg', price: 4, days: 4, regrow: 2, emoji: '🍅' },
  { key: 'perilla',     name: '깻잎',     lv: 2, family: 'herb',     price: 2, days: 2, regrow: 1, emoji: '🍃' },
  { key: 'pea',         name: '완두콩',   lv: 2, family: 'legume',   price: 3, days: 3,            emoji: '🫛' },
  // ---- Lv3
  { key: 'eggplant',    name: '가지',     lv: 3, family: 'fruitveg', price: 3, days: 3, regrow: 2, emoji: '🍆' },
  { key: 'sweetPotato', name: '고구마',   lv: 3, family: 'root',     price: 3, days: 4,            emoji: '🍠' },
  { key: 'corn',        name: '옥수수',   lv: 3, family: 'grain',    price: 3, days: 4,            emoji: '🌽' },
  { key: 'chili',       name: '고추',     lv: 3, family: 'fruitveg', price: 4, days: 4, regrow: 2, emoji: '🌶️' },
  { key: 'turnip',      name: '순무',     lv: 3, family: 'root',     price: 3, days: 3,            emoji: '🟣' },
  { key: 'oats',        name: '귀리',     lv: 3, family: 'grain',    price: 3, days: 3,            emoji: '🌾' },
  { key: 'barley',      name: '보리',     lv: 3, family: 'grain',    price: 3, days: 3,            emoji: '🌾' },
  { key: 'kidneyBean',  name: '강낭콩',   lv: 3, family: 'legume',   price: 3, days: 3,            emoji: '🫘' },
  // ---- Lv4
  { key: 'napaCabbage', name: '배추',     lv: 4, family: 'leaf',     price: 3, days: 4,            emoji: '🥬' },
  { key: 'broccoli',    name: '브로콜리', lv: 4, family: 'leaf',     price: 4, days: 4,            emoji: '🥦' },
  { key: 'paprika',     name: '파프리카', lv: 4, family: 'fruitveg', price: 5, days: 4, regrow: 3, emoji: '🫑' },
  { key: 'beet',        name: '비트',     lv: 4, family: 'root',     price: 4, days: 4,            emoji: '🔴' },
  { key: 'buckwheat',   name: '메밀',     lv: 4, family: 'grain',    price: 4, days: 3,            emoji: '🌾' },
  { key: 'strawberry',  name: '딸기',     lv: 4, family: 'berry',    price: 5, days: 4, regrow: 2, emoji: '🍓' },
  { key: 'rosemary',    name: '로즈마리', lv: 4, family: 'herb',     price: 3, days: 3, regrow: 2, emoji: '🌲' },
  { key: 'basil',       name: '바질',     lv: 4, family: 'herb',     price: 3, days: 3, regrow: 2, emoji: '☘️' },
  // ---- Lv5
  { key: 'pumpkin',     name: '늙은 호박', lv: 5, family: 'gourd',   price: 8, days: 6,            emoji: '🎃' },
  { key: 'taro',        name: '토란',     lv: 5, family: 'root',     price: 5, days: 5,            emoji: '🟤' },
  { key: 'sesame',      name: '참깨',     lv: 5, family: 'grain',    price: 4, days: 4,            emoji: '⚫' },
  { key: 'raspberry',   name: '산딸기',   lv: 5, family: 'berry',    price: 2, days: 2, regrow: 2, emoji: '🍒' },
  { key: 'blueberry',   name: '블루베리', lv: 5, family: 'berry',    price: 3, days: 3, regrow: 2, emoji: '🫐' },
];

const CROP_BY_KEY = Object.fromEntries(CROPS.map((c) => [c.key, c]));

/**
 * 보장 이익 — 수확만 하면 칸마다 **반드시** 남는 골드.
 *
 * 가격이 아니라 **성장일**로 정한다(docs/FARM.md §4). 비싼 작물이라고 더 남으면 모두가
 * 비싼 것만 심는다. 파는 값을 넘을 수는 없으므로 `price − 1` 에서 자른다.
 */
const guaranteed = (c) => Math.max(1, Math.min(Math.ceil(c.days / 2), c.price - 1));

/** 칸 하나의 씨앗값. 수확이 최소 1개라 `price − 씨앗값 = 보장 이익` 이 남는다. */
const seedPrice = (c) => c.price - guaranteed(c);

/**
 * 작물 등급 — 비쌀수록 까다롭다(docs/FARM.md §4). 한 칸에서 덜 나온다.
 * 품질 점수 보정(−5 · −10 · −15)은 3단계에서 읽는다.
 */
const gradeOf = (c) => {
  if (c.price <= 8) return 'normal';
  if (c.price <= 14) return 'big';
  return 'rare';
};

/**
 * 칸 하나의 수확량 후보. `[토질 ★1 … ★5]` 마다 `[최소, 최대]`. 최소는 늘 1 이상이다 —
 * 보장 이익은 이 1개 위에 서 있다.
 */
const YIELD = {
  normal: [[1, 1], [1, 2], [2, 2], [2, 3], [3, 3]],
  big: [[1, 1], [1, 1], [1, 2], [2, 2], [2, 3]],
  rare: [[1, 1], [1, 1], [1, 1], [1, 2], [1, 2]],
};

/** 봇에 주는 모양. 씨앗값까지 셈해서 준다 — 봇이 공식을 다시 갖지 않게. */
const publicCrop = (c) => ({
  ...c, regrow: c.regrow ?? null, seed: seedPrice(c), profit: guaranteed(c), grade: gradeOf(c),
});

module.exports = {
  CROPS, CROP_BY_KEY, guaranteed, seedPrice, gradeOf, YIELD, publicCrop,
};
