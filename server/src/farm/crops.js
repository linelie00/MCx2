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
 *   days    기본 성장일. 물을 받은 날마다 1씩 쌓여 이만큼이 되면 다 자란다
 *           (docs/FARM.md §4 — 기본가 구간 + 작물 성격 보정)
 *   regrow  재수확. 거둔 뒤 이만큼 뒤에 다시 다 자란다. 없으면 거두면 칸이 빈다
 *
 * 1단계(MVP)는 **Lv1 작물 여덟**만 둔다. 레벨이 없는 단계라, Lv2 작물을 미리 열면
 * 레벨을 들일 때 도로 잠가야 한다.
 */
const CROPS = [
  { key: 'potato',   name: '감자',   price: 2, days: 2,            emoji: '🥔' },
  { key: 'carrot',   name: '당근',   price: 2, days: 3,            emoji: '🥕' },
  { key: 'spinach',  name: '시금치', price: 3, days: 2,            emoji: '🥬' },
  { key: 'cucumber', name: '오이',   price: 2, days: 2, regrow: 2, emoji: '🥒' },
  { key: 'radish',   name: '무',     price: 3, days: 3,            emoji: '⚪' },
  { key: 'lettuce',  name: '상추',   price: 2, days: 2, regrow: 2, emoji: '🥗' },
  { key: 'wheat',    name: '밀 이삭', price: 2, days: 3,           emoji: '🌾' },
  { key: 'soybean',  name: '콩',     price: 3, days: 3,            emoji: '🫘' },
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

/** 봇에 주는 모양. 씨앗값까지 셈해서 준다 — 봇이 공식을 다시 갖지 않게. */
const publicCrop = (c) => ({ ...c, regrow: c.regrow ?? null, seed: seedPrice(c), profit: guaranteed(c) });

module.exports = { CROPS, CROP_BY_KEY, guaranteed, seedPrice, publicCrop };
