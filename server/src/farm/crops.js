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
 *   family  계열(docs/FARM.md §5). 이웃 궁합·윤작·연작(`affinity.js`)과 콩 토질(+10)이 읽는다
 *   days    기본 성장일. 물을 받을 때마다 토질 배율만큼 쌓여 이만큼이 되면 다 자란다
 *           (docs/FARM.md §4 — 기본가 구간 + 작물 성격 보정)
 *   regrow  재수확. 거둔 뒤 이만큼 뒤에 다시 다 자란다. 없으면 거두면 칸이 빈다.
 *           **처음 성장일은 재수확 간격의 두 배 이상**이다(3c) — 처음은 오래, 그다음은 빨리.
 *           재수확은 두 번째부터 씨앗값이 없어 오래 두면 가장 좋은 선택이 된다(그래도 된다고
 *           정했다). 대신 첫 수확까지 오래 걸리는 것으로 값을 치른다
 *   tall    키가 크다 — 이웃 밭에 그늘을 드리운다(버섯·잎 +10%, 열매·박 −5%, `affinity.js`)
 *
 * 특수 규칙(3c) — 규칙은 `rules.js`·`affinity.js` 가 이 표시만 보고 건다
 *   thirsty    물 욕심 — 하루 굶으면 시들고 사흘이면 죽는다(보통은 이틀 · 나흘)
 *   shadeNeed  그늘이 필요하다 — 키 큰 이웃이 없으면 성장 ×0.5
 *   perennial  다년생 — 재수확이 끝나지 않고 윤작·연작을 따지지 않는다
 *   aura       이웃 밭 품질 +n(3b 가 읽는다)
 *   spread     퍼짐 — 거둘 때 같은 밭 빈 흙에 한 포기가 저절로 번진다
 *   scream     비명 — 이웃 성장 −10%, 거둘 때 귀마개가 없으면 거둔 사람 HP −5
 *   flee       도망 — 익은 날 안 거두면 같은 밭 빈 흙으로 옮겨 간다. 빈 흙이 없으면 사라진다
 *   seedOnly   희귀 — 씨앗을 살 수 없다. **주머니 씨앗**으로만 심는다(레벨 제한 없음).
 *              개간에서 나오는 것은 `land.RARE_SEEDS` 뿐이고, 황금 밀은 **주문 보상 전용**이다(5b)
 *   note       심기 창에 적을 규칙 한 줄
 *   giant      거대 작물이 될 수 있다(3b) — 한 밭 아홉 칸이 다 익으면 대왕 작물 하나로 합쳐질 수 있다
 *   seasons    제철(4a) — `spring · summer · autumn · winter`. 제철이 아니면 성장 ×0.7 · 품질 −15(`weather.js`).
 *              기획서 §12 에 겨울 보강을 더했다: 당근·양배추(봄·가·겨) · 비트(가·겨) · 딸기(겨·봄).
 *              향송이와 희귀 셋은 사계절
 *   heatLove   폭염인 날 성장 ×2(용의 고추) · rainLove 비 오는 날 ×1.2(쌀) · clearOnly 맑은 날에만 자람(월광초)
 *
 * 과수(4c) — `tree`
 *   한 그루가 **밭 하나를 통째로** 쓴다(가운데 칸이 나무, 둘레 여덟 칸은 그늘 `canopy`). 묘목값은
 *   밭에 한 번 `파는 값 × 2`. 한 번 거두면 **제철이 아니면 휴면** — 물이 필요 없고 자라지 않는다.
 *   거둘 때 토질 ★ 에 따라 `TREE_YIELD` 개. 키가 커서 이웃에 그늘을 주지만(`tall`) 폭풍엔 안 쓰러진다.
 *   다년생이라 윤작·연작을 따지지 않는다. `treeName` 은 화면용 이름(사과 아이템 이름이 "새빨간 사과"다).
 *
 * 인삼은 품평회(6단계)와 함께 넣는다. 황금 밀은 5b 에 들어왔다(주문 보상 전용).
 */
const CROPS = [
  // ---- Lv1
  { key: 'potato',      name: '감자',     lv: 1, family: 'root',     price: 2, days: 2,            seasons: ['spring', 'autumn'], emoji: '🥔' },
  { key: 'carrot',      name: '당근',     lv: 1, family: 'root',     price: 2, days: 3,            seasons: ['spring', 'autumn', 'winter'], emoji: '🥕' },
  { key: 'spinach',     name: '시금치',   lv: 1, family: 'leaf',     price: 3, days: 2,            seasons: ['autumn', 'winter'], emoji: '🥬' },
  { key: 'cucumber',    name: '오이',     lv: 1, family: 'gourd',    price: 2, days: 4, regrow: 2, seasons: ['summer'], emoji: '🥒' },
  { key: 'radish',      name: '무',       lv: 1, family: 'root',     price: 3, days: 3, giant: true, seasons: ['autumn', 'winter'], emoji: '⚪' },
  { key: 'lettuce',     name: '상추',     lv: 1, family: 'leaf',     price: 2, days: 4, regrow: 2, seasons: ['spring', 'autumn'], emoji: '🥗' },
  { key: 'wheat',       name: '밀 이삭',  lv: 1, family: 'grain',    price: 2, days: 3,            seasons: ['spring', 'autumn'], emoji: '🌾' },
  { key: 'soybean',     name: '콩',       lv: 1, family: 'legume',   price: 3, days: 3,            seasons: ['summer'], emoji: '🫘' },
  // ---- Lv2
  { key: 'onion',       name: '양파',     lv: 2, family: 'allium',   price: 2, days: 3,            seasons: ['spring'], emoji: '🧅' },
  { key: 'garlic',      name: '마늘',     lv: 2, family: 'allium',   price: 3, days: 4,            seasons: ['autumn', 'winter'], emoji: '🧄' },
  { key: 'greenOnion',  name: '대파',     lv: 2, family: 'allium',   price: 3, days: 4, regrow: 2, seasons: ['spring', 'summer', 'autumn', 'winter'], emoji: '🎋' },
  { key: 'cabbage',     name: '양배추',   lv: 2, family: 'leaf',     price: 3, days: 3, giant: true, seasons: ['spring', 'autumn', 'winter'], emoji: '🥬' },
  { key: 'tomato',      name: '토마토',   lv: 2, family: 'fruitveg', price: 4, days: 4, regrow: 2, seasons: ['summer'], emoji: '🍅' },
  { key: 'perilla',     name: '깻잎',     lv: 2, family: 'herb',     price: 2, days: 2, regrow: 1, seasons: ['summer'], emoji: '🍃' },
  { key: 'pea',         name: '완두콩',   lv: 2, family: 'legume',   price: 3, days: 3,            seasons: ['spring'], emoji: '🫛' },
  // ---- Lv3
  { key: 'eggplant',    name: '가지',     lv: 3, family: 'fruitveg', price: 3, days: 4, regrow: 2, seasons: ['summer'], emoji: '🍆' },
  { key: 'sweetPotato', name: '고구마',   lv: 3, family: 'root',     price: 3, days: 4,            seasons: ['summer', 'autumn'], emoji: '🍠' },
  { key: 'corn',        name: '옥수수',   lv: 3, family: 'grain',    price: 3, days: 4, tall: true, seasons: ['summer'], emoji: '🌽' },
  { key: 'chili',       name: '고추',     lv: 3, family: 'fruitveg', price: 4, days: 4, regrow: 2, seasons: ['summer'], emoji: '🌶️' },
  { key: 'turnip',      name: '순무',     lv: 3, family: 'root',     price: 3, days: 3,            seasons: ['winter'], emoji: '🟣' },
  { key: 'oats',        name: '귀리',     lv: 3, family: 'grain',    price: 3, days: 3,            seasons: ['spring', 'autumn'], emoji: '🌾' },
  { key: 'barley',      name: '보리',     lv: 3, family: 'grain',    price: 3, days: 3,            seasons: ['winter', 'spring'], emoji: '🌾' },
  { key: 'kidneyBean',  name: '강낭콩',   lv: 3, family: 'legume',   price: 3, days: 3,            seasons: ['summer'], emoji: '🫘' },
  // ---- Lv4
  { key: 'napaCabbage', name: '배추',     lv: 4, family: 'leaf',     price: 3, days: 4, giant: true, seasons: ['autumn'], emoji: '🥬' },
  { key: 'broccoli',    name: '브로콜리', lv: 4, family: 'leaf',     price: 4, days: 4,            seasons: ['autumn', 'winter'], emoji: '🥦' },
  { key: 'paprika',     name: '파프리카', lv: 4, family: 'fruitveg', price: 5, days: 6, regrow: 3, seasons: ['summer'], emoji: '🫑' },
  { key: 'beet',        name: '비트',     lv: 4, family: 'root',     price: 4, days: 4,            seasons: ['autumn', 'winter'], emoji: '🔴' },
  { key: 'buckwheat',   name: '메밀',     lv: 4, family: 'grain',    price: 4, days: 3,            seasons: ['summer', 'autumn'], emoji: '🌾' },
  { key: 'strawberry',  name: '딸기',     lv: 4, family: 'berry',    price: 5, days: 4, regrow: 2, seasons: ['winter', 'spring'], emoji: '🍓' },
  { key: 'rosemary',    name: '로즈마리', lv: 4, family: 'herb',     price: 3, days: 4, regrow: 2, seasons: ['spring', 'summer', 'autumn', 'winter'], emoji: '🌲' },
  { key: 'basil',       name: '바질',     lv: 4, family: 'herb',     price: 3, days: 4, regrow: 2, seasons: ['summer'], emoji: '☘️' },
  { key: 'mint',        name: '박하',     lv: 4, family: 'herb',     price: 3, days: 3, regrow: 1, spread: true, seasons: ['spring', 'summer'], emoji: '🍀', note: '퍼짐 — 거둘 때 같은 밭 빈 흙에 한 포기가 저절로 번져요' },
  // ---- Lv5
  { key: 'pumpkin',     name: '늙은 호박', lv: 5, family: 'gourd',   price: 8, days: 6, giant: true, seasons: ['autumn'], emoji: '🎃' },
  { key: 'taro',        name: '토란',     lv: 5, family: 'root',     price: 5, days: 5,            seasons: ['autumn'], emoji: '🟤' },
  { key: 'sesame',      name: '참깨',     lv: 5, family: 'grain',    price: 4, days: 4,            seasons: ['summer'], emoji: '⚫' },
  { key: 'raspberry',   name: '산딸기',   lv: 5, family: 'berry',    price: 2, days: 4, regrow: 2, seasons: ['summer'], emoji: '🍒' },
  { key: 'blueberry',   name: '블루베리', lv: 5, family: 'berry',    price: 3, days: 4, regrow: 2, seasons: ['summer'], emoji: '🫐' },
  { key: 'rice',        name: '쌀',       lv: 5, family: 'grain',    price: 6, days: 5, thirsty: true, rainLove: true, seasons: ['summer'], emoji: '🍚', note: '물 욕심 — 하루만 굶어도 시들고, 사흘이면 죽어요. 비 오는 날엔 더 잘 자라요' },
  { key: 'sunflower',   name: '해바라기', lv: 5, family: 'grain',    price: 4, days: 5, tall: true, seasons: ['summer'], emoji: '🌻', note: '키가 커서 이웃 밭에 그늘을 드리워요 — 버섯·잎 +10%, 열매·박 −5%' },
  { key: 'lemon',       name: '레몬',     lv: 5, family: 'tree',     price: 4, days: 10, regrow: 2, tree: true, tall: true, perennial: true, treeName: '레몬나무', seasons: ['winter', 'spring'], emoji: '🍋', note: '과수 — 밭 하나를 통째로 써요. 한 번 거두면 제철이 아닐 땐 쉬어요(물이 필요 없어요)' },
  { key: 'redApple',    name: '새빨간 사과', lv: 5, family: 'tree',  price: 5, days: 10, regrow: 2, tree: true, tall: true, perennial: true, treeName: '사과나무', seasons: ['autumn', 'winter'], emoji: '🍎', note: '과수 — 밭 하나를 통째로 써요. 한 번 거두면 제철이 아닐 땐 쉬어요(물이 필요 없어요)' },
  // ---- Lv6
  { key: 'asparagus',   name: '아스파라거스', lv: 6, family: 'leaf', price: 6, days: 7, regrow: 3, perennial: true, seasons: ['spring'], emoji: '🎍', note: '다년생 — 한 번 심으면 계속 거두고, 윤작·연작을 따지지 않아요' },
  { key: 'teaLeaf',     name: '찻잎',     lv: 6, family: 'herb',     price: 6, days: 6, regrow: 3, perennial: true, seasons: ['spring'], emoji: '🍵', note: '다년생 — 한 번 심으면 계속 거두고, 윤작·연작을 따지지 않아요' },
  { key: 'ginger',      name: '생강',     lv: 6, family: 'root',     price: 4, days: 5,            seasons: ['autumn'], emoji: '🫚' },
  { key: 'lavender',    name: '라벤더',   lv: 6, family: 'herb',     price: 6, days: 6, regrow: 3, perennial: true, aura: 5, seasons: ['summer'], emoji: '💜', note: '다년생 · 향기 — 이웃 밭 작물의 품질이 올라가요' },
  { key: 'koreanMelon', name: '참외',     lv: 6, family: 'gourd',    price: 6, days: 5,            seasons: ['summer'], emoji: '🍈' },
  { key: 'grape',       name: '포도',     lv: 6, family: 'tree',     price: 4, days: 8, regrow: 2, tree: true, tall: true, perennial: true, treeName: '포도나무', seasons: ['summer', 'autumn'], emoji: '🍇', note: '과수 — 밭 하나를 통째로 써요. 한 번 거두면 제철이 아닐 땐 쉬어요(물이 필요 없어요)' },
  { key: 'peach',       name: '복숭아',   lv: 6, family: 'tree',     price: 6, days: 12, regrow: 3, tree: true, tall: true, perennial: true, treeName: '복숭아나무', seasons: ['spring', 'summer'], emoji: '🍑', note: '과수 — 밭 하나를 통째로 써요. 한 번 거두면 제철이 아닐 땐 쉬어요(물이 필요 없어요)' },
  // ---- Lv7
  { key: 'watermelon',  name: '수박',     lv: 7, family: 'gourd',    price: 12, days: 7, giant: true, seasons: ['summer'], emoji: '🍉' },
  { key: 'melon',       name: '멜론',     lv: 7, family: 'gourd',    price: 14, days: 7, giant: true, seasons: ['summer'], emoji: '🍈' },
  { key: 'pear',        name: '배',       lv: 7, family: 'tree',     price: 7, days: 12, regrow: 3, tree: true, tall: true, perennial: true, treeName: '배나무', seasons: ['autumn'], emoji: '🍐', note: '과수 — 밭 하나를 통째로 써요. 한 번 거두면 제철이 아닐 땐 쉬어요(물이 필요 없어요)' },
  // ---- Lv8
  { key: 'pineMushroom', name: '향송이',  lv: 8, family: 'fungus',   price: 25, days: 10, shadeNeed: true, seasons: ['spring', 'summer', 'autumn', 'winter'], emoji: '🍄', note: '그늘이 필요해요 — 옥수수·해바라기 옆이 아니면 절반만 자라요' },
  { key: 'saffron',     name: '사프란',   lv: 8, family: 'herb',     price: 60, days: 14,          seasons: ['autumn'], emoji: '🌸', note: '귀한 향신료 — 오래 걸리고 한 칸에서 많이 안 나와요' },
  // ---- Lv9 · 10 — 날씨를 타는 작물(4a)
  { key: 'dragonChili', name: '용의 고추', lv: 9, family: 'fruitveg', price: 15, days: 10, regrow: 4, heatLove: true, seasons: ['summer'], emoji: '🔥', note: '폭염을 좋아해요 — 폭염인 날엔 두 배로 자라요. 날로 먹으면 아파요' },
  { key: 'moonHerb',    name: '월광초',   lv: 10, family: 'herb',    price: 20, days: 10, clearOnly: true, seasons: ['spring', 'summer', 'autumn', 'winter'], emoji: '🌙', note: '맑은 날에만 자라요 — 흐리거나 비 오는 날엔 물을 받아도 그대로예요' },
  // ---- 희귀 — 개간에서 주운 주머니 씨앗으로만(레벨 제한 없음)
  { key: 'goldenWheat', name: '황금 밀',  lv: 1, family: 'grain',   price: 18, days: 10, seedOnly: true, seasons: ['summer', 'autumn'], emoji: '🥇', note: '주문 보상으로만 얻는 씨앗 — 개간에서는 안 나와요' },
  { key: 'screamRoot',  name: '비명 뿌리', lv: 1, family: 'monster', price: 14, days: 7, seedOnly: true, scream: true, seasons: ['spring', 'summer', 'autumn', 'winter'], emoji: '😱', note: '비명 — 이웃 성장 −10%, 거둘 때 귀마개가 없으면 체력 −5' },
  { key: 'walkingCap',  name: '도망가는 버섯갓', lv: 1, family: 'monster', price: 8, days: 5, seedOnly: true, flee: true, seasons: ['spring', 'summer', 'autumn', 'winter'], emoji: '🏃', note: '도망 — 익은 날 안 거두면 옆 빈 흙으로 옮겨 가요. 빈 흙이 없으면 사라져요' },
  { key: 'keeperBerry', name: '파수꾼 베리', lv: 1, family: 'berry', price: 30, days: 10, regrow: 3, seedOnly: true, seasons: ['spring', 'summer', 'autumn', 'winter'], emoji: '🛡️', note: '희귀 — 한 번 심으면 계속 거둬요' },
];

const CROP_BY_KEY = Object.fromEntries(CROPS.map((c) => [c.key, c]));

/**
 * 나무 한 번 거둘 때의 열매 수 `[토질 ★1 … ★5]` 마다 `[최소, 최대]`(4c). 밭 하나에서 나온다.
 * 최소가 묘목값(`파는 값 × 2`)을 넘어 **첫 수확에서 이미 남는다.**
 * 기획서의 3~9개는 한 칸짜리 아홉 포기(9~27개)보다 한참 적었다 — simulate-farm 에서 나무 밭이 작물 밭의
 * 1/20 을 벌었다. 휴면(한 해의 절반)과 물 한 포기(체력 1)를 셈에 넣어 다시 맞췄다.
 */
const TREE_YIELD = [[18, 21], [21, 27], [27, 33], [33, 40], [40, 48]];
/** 묘목값 — 밭에 한 번. */
const SAPLING_MULT = 2;
const sapling = (c) => c.price * SAPLING_MULT;

/**
 * 보장 이익 — 수확만 하면 칸마다 **반드시** 남는 골드.
 *
 * 가격이 아니라 **성장일**로 정한다(docs/FARM.md §4). 비싼 작물이라고 더 남으면 모두가
 * 비싼 것만 심는다. 파는 값을 넘을 수는 없으므로 `price − 1` 에서 자른다.
 */
const guaranteed = (c) => (c.tree
  ? TREE_YIELD[0][0] * c.price - sapling(c)                 // 나무 — 첫 수확 최소 개수에서 묘목값을 뺀 것(밭 하나)
  : Math.max(1, Math.min(Math.ceil(c.days / 2), c.price - 1)));

/**
 * 칸 하나의 씨앗값. 수확이 최소 1개라 `price − 씨앗값 = 보장 이익` 이 남는다.
 * 희귀 작물(`seedOnly`)은 골드가 아니라 주머니 씨앗을 쓴다 — 0.
 */
const seedPrice = (c) => {
  if (c.seedOnly) return 0;
  if (c.tree) return sapling(c);
  return c.price - guaranteed(c);
};

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

/**
 * 품질 ★ 변형의 아이템 키(3b). **바꾸지 않는다** — 계정에 저장되는 문자열이다.
 * 봇 명부(`bot/src/casino/items.js`)가 같은 규칙으로 이름·값을 만든다.
 */
const STAR_MULT = [1, 1.2, 1.5, 2];
const starKey = (key, star) => (star ? `${key}S${star}` : key);
/** 대왕 작물의 아이템 키와 값 배수. `giantRadish` · `giantNapaCabbage` … */
const giantKey = (key) => `giant${key[0].toUpperCase()}${key.slice(1)}`;
const GIANT_MULT = 45;

/** 봇에 주는 모양. 씨앗값까지 셈해서 준다 — 봇이 공식을 다시 갖지 않게. */
const publicCrop = (c) => ({
  ...c, regrow: c.regrow ?? null, seed: seedPrice(c), profit: c.seedOnly ? c.price : guaranteed(c), grade: gradeOf(c),
});

module.exports = {
  CROPS, CROP_BY_KEY, guaranteed, seedPrice, gradeOf, YIELD, TREE_YIELD, publicCrop, STAR_MULT, starKey, giantKey, GIANT_MULT,
};
