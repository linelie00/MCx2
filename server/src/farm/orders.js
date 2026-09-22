/**
 * orders — 마을 게시판 · 개인 의뢰 (docs/FARM.md §7, 5a)
 *
 * 순수 함수다. 파일도 시간도 모르고, 무작위는 **날짜·채널 해시**뿐이다 — 조회를 몇 번 해도 같다.
 *
 *   📜 게시판  **급마다 한 칸, 세 칸**(Lv1~3 · 4~6 · 7+). **월·목**에 새 주문이 올라오는데, 그 칸이
 *             **비었을 때만**(누가 가져갔거나 기한이 지났을 때) 들어간다 — 게시판엔 늘 세 건 이하이고,
 *             심어 둔 주문이 새 주문에 밀려 사라지지 않는다. **모든 농장이 같은 게시판**을 본다.
 *             주문 자체는 날짜로 다시 만들 수 있어 저장하지 않는다. 저장하는 것은 누가 가져갔는지뿐
 *             (`farms.json` 의 `board: { [id]: { by, channelId, day } }`) — 칸의 역사를 다시 셈하므로 지우지 않는다
 *             작물은 지금 제철 — 계절 마지막 주(8~14일째)에는 절반이 **다음 계절 예약 주문**이다.
 *             예약 주문의 기한은 다음 계절 첫날부터 센다 — 계절이 바뀌자마자 심으면 맞출 수 있다
 *   ✉️ 개인 의뢰  **주 1회(월요일)**, 농장마다 한 건. 지금 제철 작물 **여러 종을 한꺼번에**, 수량도 많다.
 *             레벨이 오를수록 어렵다(`REQUEST_TIERS` — Lv1~3 두 종 · ×1.5 · ★★ 없음 … Lv7+ 세 종 · ×2 · ★★ 40%).
 *             크고 어려운 대신 보상이 크다. 농장 레벨에서 심을 수 있는 작물로 만들고
 *             농장 문서(`farm.requests`)에 **그날 처음 셀 때 고정**한다
 *
 * 주문의 모양 `{ id, kind, parts: [{ crop, qty }], minStar, gold, xp, day, due, reserve?, seed }`.
 * 게시판 주문은 `parts` 가 하나다. `reserve` 는 예약 주문의 계절 키.
 *
 * 주문은 **★ 이상만** 받는다(`minStar ≥ 1`) — 상점에서 산 보통 작물로는 못 채운다.
 *
 * 누가 의뢰했는지 · 한마디는 **봇이 고른다**(`bot/src/farm/requesters.js`). 여기서는 주문마다 정해진
 * 수(`seed`)만 준다 — 이름과 말투는 화면의 일이다.
 */
const { CROPS, STAR_MULT } = require('./crops');
const { hashRand, between } = require('./land');
const weather = require('./weather');

/** 그날이 몇째 주인가 — MT 주간 상한(5b)이 쓴다. `weather.weekOf` 와 같은 기준(월요일). */

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNum = (key) => {
  const [y, m, d] = String(key).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};
const keyOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
/** 요일 — 0 이 월요일(계절의 기준일 2026-09-21 이 월요일이다). */
const MONDAY = dayNum('2026-09-21');
const weekdayOf = (key) => (((dayNum(key) - MONDAY) % 7) + 7) % 7;

/** 게시판이 올라오는 요일(월 · 목) · 칸 수(급마다 하나) · 셈을 시작하는 날(5a 배포 — 그 전 주문은 없다). */
const BOARD_DAYS = [0, 3];
const BOARD_PER_POST = 3;
const BOARD_START = '2026-09-21';
/**
 * 개인 의뢰가 오는 요일(월). **쌓이는 한도는 없다** — 기한으로만 관리한다(한도가 있으면 긴 의뢰를 붙잡은
 * 주에 새 의뢰가 아예 안 왔다). 기한은 **거의 그 주 일요일**, 길어도 **두 주를 넘기지 않는다**.
 */
const REQUEST_DAYS = [0];
const REQUEST_DUE_MIN = 6;
const REQUEST_DUE_MAX = 13;
/** 큰 의뢰에 나올 수 있는 성장일의 한도 — 기한 안에 한 번은 거둘 수 있어야 한다. */
const REQUEST_MAX_DAYS = 10;
/**
 * 개인 의뢰의 난이도 — 농장 레벨에 따라. 가짓수 · 수량 배수 · ★★ 를 요구할 확률.
 * Lv1~3 은 밭이 한둘이고 토질 ★1 이라 ★★ 가 안 나온다(★1 토질 ★★ 0%) — 거기에 맞춘다.
 */
const REQUEST_TIERS = [
  { upTo: 3, kinds: [2], mult: 1.5, twoStar: 0 },
  { upTo: 6, kinds: [2, 3], mult: 2, twoStar: 0.2 },
  { upTo: 10, kinds: [3], mult: 2, twoStar: 0.4 },
];
const requestTier = (level) => REQUEST_TIERS.find((t) => level <= t.upTo) ?? REQUEST_TIERS.at(-1);
/** 기한 = (심을 수 있는 날) + 성장일 + 이만큼. */
const DUE_EXTRA = 3;
/** 예약 주문이 나오는 때 — 계절의 이날 이후. 그때 올라온 게시판 주문의 이만큼이 예약이다. */
const RESERVE_FROM = 8;
const RESERVE_SHARE = 0.5;
/** 보상 골드 배수 — 기본가 × 수량 × 품질 배수 × 이것. 게시판은 경쟁이라 더 준다. */
const BOARD_GOLD = 4;
const REQUEST_GOLD = 4;
/**
 * 기다린 값 — 성장일 하루마다 더 준다. 밭 하나를 그 주문에 며칠 내주는 셈이라, 싼 작물 주문도
 * 밭을 쓸 만하게(simulate-farm +주문 — 값 × 수량만으로는 판 수익보다 적었다).
 * 개인 의뢰는 작물마다 밭을 하나씩 내주므로 작물마다 더한다.
 */
const BOARD_DAY_GOLD = 12;
const REQUEST_DAY_GOLD = 12;
/** 농장 경험치 — 게시판은 작물 급(Lv1~3 · 4~6 · 7+)마다, 개인 의뢰는 기본 + 작물 가짓수마다. */
const BOARD_XP = [10, 15, 20];
const REQUEST_XP = 10;
const REQUEST_XP_PER_KIND = 5;
/** 게시판이 ★★ 를 요구할 확률. */
const BOARD_TWO_STAR = 0.25;
/**
 * 덤 보상(5b) — 주문마다 해시로 정해 둔다. 창에 미리 보이므로 "이건 황금 밀이 붙은 주문" 하고 노릴 수 있다.
 *   🥇 황금 밀 씨앗   Lv7+ 작물 주문에 30% · 한두 개 (주머니로)
 *   ✨ 황금 비료      큰 의뢰(Lv4+ 농장)에 50% · 하나
 *   🪙 MT            ★★ 큰 의뢰면 하나 — 계정당 **주 1개**(컨트롤러가 막는다)
 */
const SEED_CHANCE = 0.3;
const SEED_CROP = 'goldenWheat';
const GOLD_FERT_CHANCE = 0.5;

/** 작물 급 — 0 · 1 · 2. */
const tierOf = (crop) => (crop.lv <= 3 ? 0 : crop.lv <= 6 ? 1 : 2);

/** 수량 — 쌀수록 많이. 과수는 한 번에 많이 나오니 두 배. 개인 의뢰는 `mult` 배. */
function qtyOf(crop, rand, mult = 1) {
  let q;
  if (crop.price <= 3) q = between(rand, 3, 6);
  else if (crop.price <= 6) q = between(rand, 2, 4);
  else if (crop.price <= 14) q = between(rand, 1, 3);
  else q = 1;
  return Math.max(1, Math.round(q * mult)) * (crop.tree ? 2 : 1);
}

const pick = (list, r) => list[Math.floor(r * list.length)];
const CROP = Object.fromEntries(CROPS.map((c) => [c.key, c]));
const seedOf = (id) => Math.floor(hashRand('flavor', id) * 1e9);    // 봇이 의뢰인 · 한마디를 고른다

/** 다음 계절 첫날. */
function nextSeasonStart(day) {
  const s = weather.seasonOf(day);
  return keyOf(dayNum(day) + weather.SEASON_DAYS - s.day + 1);
}

/** 그날 게시판에 올라온 주문 — 월·목만 세 건(Lv1~3 · 4~6 · 7+ 한 건씩), 다른 날은 없다. */
function boardOf(day) {
  if (!BOARD_DAYS.includes(weekdayOf(day))) return [];
  const late = weather.seasonOf(day).day >= RESERVE_FROM;
  const next = nextSeasonStart(day);
  return [0, 1, 2].slice(0, BOARD_PER_POST).map((k) => {
    const id = `b:${day}:${k}`;
    let n = 0;
    const rand = () => hashRand('board', id, n++);
    const pool = CROPS.filter((c) => !c.seedOnly && tierOf(c) === k);
    const reserve = late && rand() < RESERVE_SHARE;
    const inNow = pool.filter((c) => weather.inSeason(c, day));
    const inNext = pool.filter((c) => weather.inSeason(c, next) && !weather.inSeason(c, day));
    const list = reserve && inNext.length ? inNext : (inNow.length ? inNow : pool);
    const crop = pick(list, rand());
    const isReserve = reserve && inNext.length > 0;
    const minStar = rand() < BOARD_TWO_STAR ? 2 : 1;
    const qty = qtyOf(crop, rand);
    const from = isReserve ? next : day;
    return {
      id,
      kind: 'board',
      parts: [{ crop: crop.key, qty }],
      minStar,
      gold: Math.ceil(crop.price * qty * STAR_MULT[minStar] * BOARD_GOLD) + crop.days * BOARD_DAY_GOLD,
      xp: BOARD_XP[k],
      day,
      due: keyOf(dayNum(from) + crop.days + DUE_EXTRA),
      ...(isReserve ? { reserve: weather.seasonOf(next).key } : {}),
      ...(k === 2 && rand() < SEED_CHANCE ? { bonus: { seeds: { [SEED_CROP]: rand() < 0.5 ? 2 : 1 } } } : {}),
      seed: seedOf(id),
    };
  });
}

/**
 * 오늘 게시판 — 칸마다 지금 붙어 있는 주문(세 건 이하). `taken` 은 `farms.json` 의 `board`.
 *
 * 칸마다 `BOARD_START` 부터 올라온 날을 따라간다. 올라온 날에 그 칸이 비어 있으면(아직 없거나, 기한이
 * 지났거나, 그날까지 누가 가져갔으면) 새 주문이 들어간다. 늘 처음부터 셈하므로 몇 번 불러도 같다.
 */
function activeBoard(today, taken = {}) {
  const t = dayNum(today);
  const slots = Array(BOARD_PER_POST).fill(null);
  for (let d = dayNum(BOARD_START); d <= t; d += 1) {
    const posts = boardOf(keyOf(d));
    if (!posts.length) continue;
    slots.forEach((cur, k) => {
      const free = !cur || dayNum(cur.due) < d || (taken[cur.id] && dayNum(taken[cur.id].day) <= d);
      if (free) slots[k] = posts[k];
    });
  }
  return slots.filter((o) => o && !taken[o.id] && dayNum(o.due) >= t);
}

/** 그 농장의 그날 개인 의뢰 — 월요일에만. 지금 제철인 작물(심을 수 있는 것)로, 레벨에 따라 2~3종. */
function requestOf(channelId, day, level) {
  if (!REQUEST_DAYS.includes(weekdayOf(day))) return null;
  const id = `r:${channelId}:${day}`;
  let n = 0;
  const rand = () => hashRand('request', id, n++);
  const pool = CROPS.filter((c) => !c.seedOnly && !c.tree && c.lv <= level && c.days <= REQUEST_MAX_DAYS);
  const now = pool.filter((c) => weather.inSeason(c, day));
  const from = [...(now.length >= 2 ? now : pool)];
  const tier = requestTier(level);
  const kinds = Math.min(from.length, tier.kinds[Math.floor(rand() * tier.kinds.length)]);
  const chosen = [];
  for (let k = 0; k < kinds; k += 1) chosen.push(...from.splice(Math.floor(rand() * from.length), 1));
  const minStar = rand() < tier.twoStar ? 2 : 1;
  const parts = chosen.map((c) => ({ crop: c.key, qty: qtyOf(c, rand, tier.mult) }));
  const gold = parts.reduce((a, p) => {
    const c = CROP[p.crop];
    return a + Math.ceil(c.price * p.qty * STAR_MULT[minStar] * REQUEST_GOLD) + c.days * REQUEST_DAY_GOLD;
  }, 0);
  const longest = Math.max(...chosen.map((c) => c.days));
  const bonus = {};
  if (level >= 4 && rand() < GOLD_FERT_CHANCE) bonus.goldFert = 1;
  if (minStar >= 2) bonus.mt = 1;
  if (level >= 7 && rand() < SEED_CHANCE) bonus.seeds = { [SEED_CROP]: 1 };
  return {
    id,
    kind: 'mine',
    parts,
    minStar,
    gold,
    xp: REQUEST_XP + REQUEST_XP_PER_KIND * parts.length,
    day,
    // 거의 그 주 일요일 — 성장이 긴 작물이 끼면 늘어나되 두 주는 안 넘긴다
    due: keyOf(dayNum(day) + Math.min(REQUEST_DUE_MAX, Math.max(REQUEST_DUE_MIN, longest + DUE_EXTRA))),
    ...(Object.keys(bonus).length ? { bonus } : {}),
    seed: seedOf(id),
  };
}

/**
 * 개인 의뢰를 챙긴다 — 기한이 지난 것을 지우고, 오늘이 의뢰 오는 날이면 하나 넣는다(한도 없음 — 기한으로만).
 * **제자리에서 고친다.** 하루치 셈(`rules.tick`)이 부른다. 오늘 것은 (날짜, 채널) 해시라 몇 번 셈해도 같다.
 */
function ensureRequests(farm, today, level) {
  if (!Array.isArray(farm.requests)) farm.requests = [];
  const t = dayNum(today);
  // 옛 모양(작물 하나 — 5a 첫 배포 전 모양)은 버린다
  farm.requests = farm.requests.filter((o) => Array.isArray(o.parts) && dayNum(o.due) >= t);
  if (farm.requestDay === today) return farm;
  farm.requestDay = today;
  const r = requestOf(farm.channelId, today, level);
  if (r) farm.requests.push(r);
  return farm;
}

/**
 * 그 주문을 채울 계정 아이템 — 작물마다 요구 ★ 이상을 **낮은 ★ 부터**.
 * 하나라도 모자라면 `take: null`. `have` 는 작물마다 가진 수 `{ 작물: n }`.
 */
function takeFor(order, items = {}) {
  const take = {};
  const have = {};
  let short = false;
  for (const { crop, qty } of order.parts) {
    const keys = [1, 2, 3].filter((s) => s >= order.minStar).map((s) => `${crop}S${s}`);
    have[crop] = keys.reduce((a, k) => a + (items[k] ?? 0), 0);
    if (have[crop] < qty) { short = true; continue; }
    let left = qty;
    for (const k of keys) {
      const n = Math.min(left, items[k] ?? 0);
      if (n) { take[k] = (take[k] ?? 0) + n; left -= n; }
    }
  }
  return { take: short ? null : take, have };
}

/**
 * 가져간 기록 — **지우지 않는다.** 게시판 칸을 처음부터 다시 셈하므로, 지우면 그 칸에 지난 주문이 되살아난다.
 * 주에 여섯 건쯤이라 1년에 300줄 남짓이다.
 */
const pruneTaken = (taken) => ({ ...(taken ?? {}) });

module.exports = {
  BOARD_DAYS, BOARD_PER_POST, BOARD_START, REQUEST_DAYS, REQUEST_DUE_MIN, REQUEST_DUE_MAX, REQUEST_MAX_DAYS, REQUEST_TIERS, requestTier, DUE_EXTRA, RESERVE_FROM,
  BOARD_GOLD, REQUEST_GOLD, BOARD_DAY_GOLD, REQUEST_DAY_GOLD, BOARD_XP, REQUEST_XP, REQUEST_XP_PER_KIND,
  SEED_CHANCE, SEED_CROP, GOLD_FERT_CHANCE, weekdayOf, tierOf, nextSeasonStart, boardOf, activeBoard, requestOf, ensureRequests, takeFor, pruneTaken,
};
