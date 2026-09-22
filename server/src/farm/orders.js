/**
 * orders — 마을 게시판 · 개인 의뢰 (docs/FARM.md §7, 5a)
 *
 * 순수 함수다. 파일도 시간도 모르고, 무작위는 **날짜·채널 해시**뿐이다 — 조회를 몇 번 해도 같다.
 *
 *   📜 게시판  날마다 3건, **모든 농장이 같은 목록**을 본다. 먼저 납품한 농장이 가져간다.
 *             주문 자체는 날짜로 다시 만들 수 있어 저장하지 않는다. 저장하는 것은 누가 가져갔는지뿐
 *             (`farms.json` 의 `board: { [id]: { by, channelId, day } }`)
 *   ✉️ 개인 의뢰  농장마다 하루 1건, 3건까지 쌓인다. 농장 레벨에서 심을 수 있는 작물로 만들고
 *             농장 문서(`farm.requests`)에 **그날 처음 셀 때 고정**한다 — 같은 날 레벨이 올라도 안 바뀐다
 *
 * 주문은 **★ 이상만** 받는다(`minStar ≥ 1`) — 상점에서 산 보통 작물로는 못 채운다.
 * 기한은 그 작물의 성장일 + 2일 — 게시판을 보고 심어도 맞출 수 있다.
 *
 * 누가 의뢰했는지 · 한마디는 **봇이 고른다**(`bot/src/farm/requesters.js`). 여기서는 주문마다 정해진
 * 수(`seed`)만 준다 — 이름과 말투는 화면의 일이다.
 */
const { CROPS, STAR_MULT } = require('./crops');
const { hashRand, between } = require('./land');
const weather = require('./weather');

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNum = (key) => {
  const [y, m, d] = String(key).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};
const keyOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** 게시판에 하루 올라오는 주문 수 · 한 번에 보여 주는 수 · 되돌아볼 날수(기한이 가장 긴 작물). */
const BOARD_PER_DAY = 3;
const BOARD_SHOWN = 6;
const LOOKBACK = 16;
/** 개인 의뢰 — 쌓이는 한도. */
const REQUEST_MAX = 3;
/** 기한 = 성장일 + 이만큼. */
const DUE_EXTRA = 2;
/** 보상 골드 배수 — 기본가 × 수량 × 품질 배수 × 이것. 게시판은 경쟁이라 더 준다. */
const BOARD_GOLD = 1.6;
const REQUEST_GOLD = 1.2;
/** 농장 경험치 — 작물 급(Lv1~3 · 4~6 · 7+)마다. 게시판은 +5. (simulate-farm 으로 맞춘다) */
const REQUEST_XP = [5, 10, 15];
const BOARD_XP_BONUS = 5;
/** ★★ 를 요구할 확률(게시판만). */
const TWO_STAR = 0.25;

/** 작물 급 — 0 · 1 · 2. */
const tierOf = (crop) => (crop.lv <= 3 ? 0 : crop.lv <= 6 ? 1 : 2);

/** 수량 — 쌀수록 많이. 과수는 한 번에 많이 나오니 두 배. */
function qtyOf(crop, rand) {
  let q;
  if (crop.price <= 3) q = between(rand, 6, 10);
  else if (crop.price <= 6) q = between(rand, 4, 7);
  else if (crop.price <= 14) q = between(rand, 2, 4);
  else q = between(rand, 1, 2);
  return crop.tree ? q * 2 : q;
}

/** 주문 하나를 만든다. */
function makeOrder({
  id, kind, crop, day, rand, minStar = 1,
}) {
  const qty = qtyOf(crop, rand);
  const mult = kind === 'board' ? BOARD_GOLD : REQUEST_GOLD;
  return {
    id,
    kind,
    crop: crop.key,
    qty,
    minStar,
    gold: Math.ceil(crop.price * qty * STAR_MULT[minStar] * mult),
    xp: REQUEST_XP[tierOf(crop)] + (kind === 'board' ? BOARD_XP_BONUS : 0),
    day,
    due: keyOf(dayNum(day) + crop.days + DUE_EXTRA),
    seed: Math.floor(hashRand('flavor', id) * 1e9),     // 봇이 의뢰인 · 한마디를 고른다
  };
}

/** 지금이나 다음 계절 제철인 작물(희귀 빼고). */
function seasonal(day, pool) {
  const next = keyOf(dayNum(day) + weather.SEASON_DAYS);
  const out = pool.filter((c) => weather.inSeason(c, day) || weather.inSeason(c, next));
  return out.length ? out : pool;
}

const pick = (list, r) => list[Math.floor(r * list.length)];

/** 그날 게시판에 올라온 주문 셋 — Lv1~3 · Lv4~6 · Lv7+ 한 건씩. */
function boardOf(day) {
  const tiers = [0, 1, 2].map((t) => CROPS.filter((c) => !c.seedOnly && tierOf(c) === t));
  return tiers.slice(0, BOARD_PER_DAY).map((pool, k) => {
    const id = `b:${day}:${k}`;
    let n = 0;
    const rand = () => hashRand('board', id, n++);
    const crop = pick(seasonal(day, pool), rand());
    const minStar = rand() < TWO_STAR ? 2 : 1;
    return makeOrder({
      id, kind: 'board', crop, day, rand, minStar,
    });
  });
}

/**
 * 오늘 게시판 — 기한이 남았고 아직 아무도 안 가져간 주문. 새것부터 `BOARD_SHOWN` 건.
 * `taken` 은 `farms.json` 의 `board`.
 */
function activeBoard(today, taken = {}) {
  const t = dayNum(today);
  const out = [];
  for (let d = t; d > t - LOOKBACK; d -= 1) {
    for (const o of boardOf(keyOf(d))) {
      if (!taken[o.id] && dayNum(o.due) >= t) out.push(o);
    }
  }
  return out.slice(0, BOARD_SHOWN);
}

/**
 * 개인 의뢰를 챙긴다 — 기한이 지난 것을 지우고, 오늘 것이 아직 없으면 하나 넣는다(3건까지).
 * **제자리에서 고친다.** 하루치 셈(`rules.tick`)이 부른다. 오늘 것은 (날짜, 채널) 해시라 몇 번 셈해도 같다.
 */
function ensureRequests(farm, today, level) {
  if (!Array.isArray(farm.requests)) farm.requests = [];
  const t = dayNum(today);
  farm.requests = farm.requests.filter((o) => dayNum(o.due) >= t);
  if (farm.requestDay === today) return farm;
  farm.requestDay = today;
  if (farm.requests.length >= REQUEST_MAX) return farm;
  const id = `r:${farm.channelId}:${today}`;
  let n = 0;
  const rand = () => hashRand('request', id, n++);
  const pool = CROPS.filter((c) => !c.seedOnly && c.lv <= level);
  const now = pool.filter((c) => weather.inSeason(c, today));
  const crop = pick(now.length ? now : pool, rand());
  farm.requests.push(makeOrder({
    id, kind: 'mine', crop, day: today, rand,
  }));
  return farm;
}

/** 그 주문을 채울 계정 아이템 — 요구 ★ 이상을 **낮은 ★ 부터**. 모자라면 `null` 과 가진 수. */
function takeFor(order, items = {}) {
  const keys = [1, 2, 3].filter((s) => s >= order.minStar).map((s) => `${order.crop}S${s}`);
  const have = keys.reduce((a, k) => a + (items[k] ?? 0), 0);
  if (have < order.qty) return { take: null, have };
  const take = {};
  let left = order.qty;
  for (const k of keys) {
    const n = Math.min(left, items[k] ?? 0);
    if (n) { take[k] = n; left -= n; }
  }
  return { take, have };
}

/** 가져간 기록을 줄인다 — 되돌아보는 날수보다 오래된 것은 지운다. */
function pruneTaken(taken, today) {
  const t = dayNum(today);
  return Object.fromEntries(Object.entries(taken ?? {}).filter(([, v]) => dayNum(v.day) > t - LOOKBACK - 1));
}

module.exports = {
  BOARD_PER_DAY, BOARD_SHOWN, LOOKBACK, REQUEST_MAX, DUE_EXTRA, BOARD_GOLD, REQUEST_GOLD, REQUEST_XP, BOARD_XP_BONUS,
  tierOf, boardOf, activeBoard, ensureRequests, takeFor, pruneTaken,
};
