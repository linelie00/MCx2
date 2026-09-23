/**
 * weather — 계절과 날씨 (docs/FARM.md §6, 4a)
 *
 * **모든 농장이 같은 날씨·같은 계절**이다. 날짜(KST `YYYY-MM-DD`)만으로 정한다 — 해시 난수라
 * 몇 번을 다시 셈해도 같고, **내일 날씨를 미리 알 수 있다**(`/농장 날씨`).
 *
 * 계절은 **2주에 한 번** 바뀐다(8주가 1년). 1주면 10~14일짜리 작물이 한 계절 안에 못 자란다.
 * 시작점은 2026-09-21(월)을 가을 1일째로 잡았다 — 9월에 "봄" 이 뜨면 어색하다.
 *
 * 날씨는 계절마다 확률표에서 뽑는다(§6.2). 무지개는 **비 온 다음 날에만** — 앞날이 비·폭우가
 * 아니면 맑음으로 읽는다.
 */
const { hashRand } = require('./land');

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNum = (key) => {
  const [y, m, d] = String(key).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};
const keyOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

// ---------------------------------------------------------------- 계절

const SEASONS = [
  { key: 'spring', name: '봄', emoji: '🌸' },
  { key: 'summer', name: '여름', emoji: '☀️' },
  { key: 'autumn', name: '가을', emoji: '🍂' },
  { key: 'winter', name: '겨울', emoji: '❄️' },
];
/** 한 계절의 날수. */
const SEASON_DAYS = 14;
/** 이날이 가을 1일째. */
const ANCHOR = dayNum('2026-09-21');
const ANCHOR_SEASON = 2;          // 가을

const mod = (a, n) => ((a % n) + n) % n;

/**
 * **검사용 고정.** `pin({ weather: 'clear', inSeason: true })` 면 날씨·제철을 고정한다 — 날씨가
 * 들어오기 전에 짠 검사(성장일·시듦·수확)가 날짜마다 흔들리지 않게. `weather` 에 함수를 주면
 * 날짜마다 고른다. `pin(null)` 이면 진짜 날씨. 서버 코드는 부르지 않는다.
 */
let pinned = null;
const pin = (p) => { pinned = p; };

/** 그날의 계절 `{ key, name, emoji, day }` — `day` 는 그 계절의 몇 번째 날(1~14). */
function seasonOf(key) {
  const off = dayNum(key) - ANCHOR;
  const s = SEASONS[mod(Math.floor(off / SEASON_DAYS) + ANCHOR_SEASON, SEASONS.length)];
  return { ...s, day: mod(off, SEASON_DAYS) + 1 };
}

/** 그날이 몇째 주인가 — 가을 1일째(월)부터 7일씩. 스프링클러(4b)가 "한 주에 한 번" 을 센다. */
const weekOf = (key) => Math.floor((dayNum(key) - ANCHOR) / 7);

/** 사계절 작물인가 — `seasons` 에 넷 다 있으면. */
const allSeasons = (crop) => SEASONS.every((s) => crop?.seasons?.includes(s.key));
/** 그 작물이 그날 제철인가. `seasons` 가 없으면(옛 표) 제철로 본다. */
const inSeason = (crop, key) => {
  if (pinned && pinned.inSeason !== undefined) return pinned.inSeason;
  return !crop?.seasons || crop.seasons.includes(seasonOf(key).key);
};

/** 제철이 아닐 때 — 성장 배율 · 품질 보정. 제철이면 품질 +10. (시뮬레이션으로 맞춘다) */
const OFF_SEASON_GROWTH = 0.7;
const IN_SEASON_QUALITY = 10;
const OFF_SEASON_QUALITY = -15;

// ---------------------------------------------------------------- 날씨

/**
 * 날씨 여덟. `water` 면 체력 없이 물을 준 날로 친다. `hp` 는 물 한 포기에 드는 체력.
 * `growth` 는 그날 물 한 번의 성장 배율.
 */
const WEATHERS = {
  clear:    { key: 'clear',    name: '맑음',   emoji: '🌤️', growth: 1 },
  cloudy:   { key: 'cloudy',   name: '흐림',   emoji: '☁️', growth: 0.9 },
  rain:     { key: 'rain',     name: '비',     emoji: '☔', growth: 1, water: true },
  downpour: { key: 'downpour', name: '폭우',   emoji: '⛈️', growth: 1, water: true },
  heat:     { key: 'heat',     name: '폭염',   emoji: '🥵', growth: 1, hp: 2 },
  frost:    { key: 'frost',    name: '서리',   emoji: '🧊', growth: 1 },
  storm:    { key: 'storm',    name: '폭풍',   emoji: '🌪️', growth: 1 },
  rainbow:  { key: 'rainbow',  name: '무지개', emoji: '🌈', growth: 1 },
};

/** 계절별 확률(%) — §6.2 표. 합은 100. */
const TABLE = {
  spring: { clear: 40, cloudy: 20, rain: 25, downpour: 5, storm: 5, rainbow: 5 },
  summer: { clear: 35, cloudy: 15, rain: 15, downpour: 10, heat: 20, storm: 5 },
  autumn: { clear: 45, cloudy: 20, rain: 20, downpour: 5, frost: 5, storm: 5 },
  winter: { clear: 35, cloudy: 25, rain: 10, frost: 30 },
};

/** 표에서 뽑은 날씨(무지개 규칙 전). */
function rolled(key) {
  const table = TABLE[seasonOf(key).key];
  let x = hashRand('weather', key) * 100;
  for (const [w, p] of Object.entries(table)) {
    if (x < p) return w;
    x -= p;
  }
  return 'clear';
}

/** 그날의 날씨 `{ key, name, emoji, growth, water?, hp? }`. */
function weatherOf(key) {
  if (pinned?.weather) return WEATHERS[typeof pinned.weather === 'function' ? pinned.weather(key) : pinned.weather];
  let w = rolled(key);
  if (w === 'rainbow') {
    const before = rolled(keyOf(dayNum(key) - 1));
    if (before !== 'rain' && before !== 'downpour') w = 'clear';
  }
  return WEATHERS[w];
}

/** 물 한 포기에 드는 체력. 폭염이면 2. */
const hpCost = (key) => weatherOf(key).hp ?? 1;

/** 폭풍 날 쓰러지는 칸의 몫(키 큰 작물). */
const STORM_FALL = 0.3;
/** 폭우 날 거둔 뿌리 작물 · 무지개 날 거둔 작물의 품질 보정. */
const DOWNPOUR_ROOT_QUALITY = -10;
const RAINBOW_QUALITY = 10;

/**
 * 그날 그 작물에 물 한 번이 주는 성장 배율 — 제철 · 날씨 · 날씨를 타는 작물.
 *   흐림 ×0.9 · 제철이 아니면 ×0.7 · 용의 고추 폭염 ×2 · 쌀 비 ×1.2 · 월광초는 맑은 날에만
 */
function growthOf(crop, key) {
  const w = weatherOf(key);
  let g = w.growth * (inSeason(crop, key) ? 1 : OFF_SEASON_GROWTH);
  if (crop?.heatLove && w.key === 'heat') g *= 2;
  if (crop?.rainLove && w.water) g *= 1.2;
  if (crop?.clearOnly && w.key !== 'clear' && w.key !== 'rainbow') g = 0;
  return g;
}

/** 수확 품질의 날씨·계절 몫. 배수로(`drain`, 4b)가 있으면 폭우 날 뿌리 −10 을 뺀다. */
function qualityOf(crop, key, { drain = false } = {}) {
  const w = weatherOf(key);
  let q = inSeason(crop, key) ? IN_SEASON_QUALITY : OFF_SEASON_QUALITY;
  if (w.key === 'downpour' && crop?.family === 'root' && !drain) q += DOWNPOUR_ROOT_QUALITY;
  if (w.key === 'rainbow') q += RAINBOW_QUALITY;
  return q;
}

/** 화면용 — 오늘과 내일. */
function forecast(key) {
  const tomorrow = keyOf(dayNum(key) + 1);
  return {
    today: { day: key, weather: weatherOf(key), season: seasonOf(key) },
    tomorrow: { day: tomorrow, weather: weatherOf(tomorrow), season: seasonOf(tomorrow) },
  };
}

module.exports = {
  SEASONS, SEASON_DAYS, WEATHERS, TABLE,
  OFF_SEASON_GROWTH, IN_SEASON_QUALITY, OFF_SEASON_QUALITY, STORM_FALL, DOWNPOUR_ROOT_QUALITY, RAINBOW_QUALITY,
  seasonOf, weekOf, allSeasons, inSeason, weatherOf, hpCost, growthOf, qualityOf, forecast, pin,
};
