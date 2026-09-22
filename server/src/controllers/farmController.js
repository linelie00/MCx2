/**
 * farmController — /api/farms (디스코드 봇 전용)
 *
 * 채널 하나가 농장 하나. 규칙은 전부 `farm/rules.js` 에 있고, 여기는 **읽고 · 규칙을 부르고 ·
 * 쓰는** 일만 한다. 설계는 docs/FARM.md.
 *
 * **"검사하고 쓰기" 를 서버가 한다.** 먼저 등록한 사람이 주인, 한 사람에 농장 하나, 물은 칸마다
 * 하루 한 번 — 둘이 동시에 눌러도 노드가 단일 스레드라 한쪽만 통과한다. 그래서 읽기와 쓰기 사이에
 * `await` 을 넣지 않는다(accountStore 머리말과 같은 까닭).
 *
 * **두 파일에 걸친 쓰기.** 심기는 골드를, 수확은 아이템을 계정(accounts.json)에서 같이 옮긴다.
 * 파일이 둘이라 한 번에 못 쓰므로
 *   1. 두 파일을 **다 읽고**, 규칙과 잔액 검사를 **다 끝낸 다음** 쓴다. 거절은 쓰기 전에 난다
 *   2. 쓰는 순서는 **"잃을 수는 있어도 복제되지는 않게"**
 *        심기·물 — 계정(골드·체력 빼기) 먼저, 농장 나중. 사이에 죽으면 낸 것만 날아간다
 *        수확·개간 — 농장(칸 비우기) 먼저, 계정 나중. 사이에 죽으면 그 수확·전리품만 날아간다
 *      반대로 두면 같은 칸을 두 번 거두거나 공짜로 심는 길이 생긴다.
 *
 * **못 한 것도 200 이다**(`ok: false, reason`). "이미 물을 줬다" · "주인이 따로 있다" 는 오류가
 * 아니라 답이다(`/claim` 과 같은 규약). 호출이 틀린 것(모양이 틀린 id·칸)만 400 이다.
 *
 * 조회는 셈만 하고 **쓰지 않는다.** 하루치 셈의 무작위(잡초)는 해시 난수라 몇 번 셈해도 같다.
 *
 * **물은 체력으로 준다** — 한 포기에 1. 체력이 모자라면 줄 수 있는 만큼만 준다. 1은 남긴다 —
 * 물을 주다가 쓰러지면(hp 0) 부활의 영약 없이는 아무것도 못 한다. 체력은 자원이라 심기와
 * 같은 순서(계정 먼저)로 쓴다.
 *
 * **개간 기력은 계정 기준이다**(`daily`, farms.json). 농장 기준이면 폐농 무르기 → 재등록으로
 * 돌을 새로 깔아 전리품을 되풀이해 캘 수 있다.
 */
const farmStore = require('../services/farmStore');
const accountStore = require('../services/accountStore');
const { load, publicView } = require('./accountController');
const { dayKey } = require('../services/dayKey');
const { CROPS, publicCrop } = require('../farm/crops');
const rules = require('../farm/rules');
const land = require('../farm/land');

/** 디스코드 id(유저·채널·길드). NPC 는 농장을 안 가진다. */
const SNOWFLAKE = /^\d{5,25}$/;

const now = () => new Date().toISOString();
const clone = (o) => structuredClone(o);
/** 저장된 농장 → 지금 모양으로 채우고(`upgrade`) 오늘까지 센 **사본.** 모든 읽기가 이 길로 온다. */
const current = (stored, today) => rules.tick(rules.upgrade(clone(stored)), today);
const ownedBy = (data, userId) => Object.values(data.farms).find((f) => f.owner === userId) ?? null;

/** 모양이 틀린 입력의 문구. rules 가 `bad: true` 로 돌려준 사유를 받는다. */
const BAD = {
  plot: '밭 번호는 0~8 이어야 합니다',
  cells: '칸은 0~8 의 겹치지 않는 번호 배열이어야 합니다',
  cell: '칸 번호는 0~8 이어야 합니다',
  pos: '휘두를 자리는 1~5 여야 합니다',
  crop: '모르는 작물입니다',
};

/** 물을 줘도 남겨 두는 체력. 0 이면 쓰러진다. */
const KEEP_HP = 1;

/** 오늘의 개간 기력 장부(계정 기준). 날이 바뀌었으면 새로 연다. */
function dailyOf(data, userId, today) {
  const d = data.daily[userId];
  return d && d.day === today ? d : { day: today, used: 0, fossils: 0 };
}

/** 주인의 오늘 기력 `{ left, max }`. */
function staminaFor(data, farm, userId, today) {
  const max = land.staminaOf(rules.levelOf(farm));
  return { left: Math.max(0, max - dailyOf(data, userId, today).used), max };
}

function readFarms(res) {
  try {
    return farmStore.read();
  } catch (e) {
    res.status(503).json({ error: `농장 데이터를 읽지 못했습니다: ${e.message}` });
    return null;
  }
}

function readAccounts(res) {
  try {
    return accountStore.read();
  } catch (e) {
    res.status(503).json({ error: `계정 데이터를 읽지 못했습니다: ${e.message}` });
    return null;
  }
}

/** 쓰기에 실패하면 503 을 보내고 false. */
function save(store, data, res, what) {
  try {
    store.write(data);
    return true;
  } catch (e) {
    res.status(503).json({ error: `${what} 데이터를 쓰지 못했습니다: ${e.message}` });
    return false;
  }
}

/** 본문에서 디스코드 id 들을 꺼낸다. 하나라도 이상하면 문자열(사유). */
function ids(body, names) {
  const out = {};
  for (const n of names) {
    const v = String((body && body[n]) ?? '').trim();
    if (!SNOWFLAKE.test(v)) return `${n} 모양이 아닙니다`;
    out[n] = v;
  }
  return out;
}

/** 계정 하나를 고쳐 넣는다. `fn(acct)` 가 제자리에서 고친다 — items·stats 는 복사해서 준다. */
function touch(acctData, id, today, fn) {
  const acct = load(acctData, id, today);
  acct.items = { ...acct.items };
  acct.stats = { ...acct.stats };
  fn(acct);
  acct.updatedAt = now();
  acctData.accounts[id] = acct;
  return acct;
}

const bump = (acct, key, n = 1) => { acct.stats[key] = (acct.stats[key] ?? 0) + n; };

// ---------------------------------------------------------------- 조회

/** GET /api/farms/crops — 작물표. 씨앗값까지 셈해서 준다. */
exports.crops = (req, res) => res.json({ crops: CROPS.map(publicCrop) });

/** GET /api/farms/:channelId — 그 채널의 농장. 없으면 `farm: null`. */
exports.get = (req, res) => {
  const channelId = String(req.params.channelId);
  if (!SNOWFLAKE.test(channelId)) return res.status(400).json({ error: 'channelId 모양이 아닙니다' });
  const data = readFarms(res);
  if (!data) return undefined;

  const today = dayKey();
  const farm = data.farms[channelId];
  if (!farm) return res.json({ farm: null, today });
  const f = current(farm, today);
  // `?user=` 가 주인이면 오늘 남은 개간 기력도 준다(개간 창이 적는다).
  const user = String(req.query.user ?? '');
  const me = user === f.owner ? { stamina: staminaFor(data, f, user, today) } : null;
  return res.json({ farm: rules.view(f, today), me, today });
};

/** GET /api/farms/by-owner/:userId — 그 사람의 농장. 채널이 지워졌어도 찾는다. */
exports.byOwner = (req, res) => {
  const userId = String(req.params.userId);
  if (!SNOWFLAKE.test(userId)) return res.status(400).json({ error: 'userId 모양이 아닙니다' });
  const data = readFarms(res);
  if (!data) return undefined;

  const today = dayKey();
  const farm = ownedBy(data, userId);
  const until = data.cooldowns[userId];
  return res.json({
    farm: farm ? rules.view(current(farm, today), today) : null,
    cooldownUntil: until && until > today ? until : null,
    today,
  });
};

// ---------------------------------------------------------------- 등록 · 폐농

/**
 * POST /api/farms/register — `{ channelId, guildId, userId }`
 *
 * 채널 종류(일반 텍스트 채널만)는 **봇이 본다.** 서버는 디스코드를 모른다.
 */
exports.register = (req, res) => {
  const got = ids(req.body, ['channelId', 'guildId', 'userId']);
  if (typeof got === 'string') return res.status(400).json({ error: got });
  const { channelId, guildId, userId } = got;

  const data = readFarms(res);
  if (!data) return undefined;
  const today = dayKey();

  const here = data.farms[channelId];
  if (here) return res.json({ ok: false, reason: here.owner === userId ? 'mine' : 'taken', owner: here.owner, today });
  const mine = ownedBy(data, userId);
  if (mine) return res.json({ ok: false, reason: 'hasFarm', channelId: mine.channelId, today });
  const until = data.cooldowns[userId];
  if (until && until > today) return res.json({ ok: false, reason: 'cooldown', until, today });

  delete data.cooldowns[userId];
  const farm = rules.newFarm({ channelId, guildId, owner: userId, today, now: now() });
  data.farms[channelId] = farm;
  if (!save(farmStore, data, res, '농장')) return undefined;
  return res.json({ ok: true, farm: rules.view(farm, today), today });
};

/**
 * POST /api/farms/abandon — `{ userId }`. **내 농장**을 없앤다(채널과 상관없다).
 *
 * 등록 뒤 24시간 안이면 '무르기' — 쿨다운이 없다. 그 뒤로는 7일 동안 다시 못 연다.
 */
exports.abandon = (req, res) => {
  const got = ids(req.body, ['userId']);
  if (typeof got === 'string') return res.status(400).json({ error: got });
  const { userId } = got;

  const data = readFarms(res);
  if (!data) return undefined;
  const today = dayKey();

  const farm = ownedBy(data, userId);
  if (!farm) return res.json({ ok: false, reason: 'none', today });

  const free = Date.now() - Date.parse(farm.createdAt) < rules.GRACE_MS;
  delete data.farms[farm.channelId];
  const until = free ? null : rules.addDays(today, rules.COOLDOWN_DAYS);
  if (until) data.cooldowns[userId] = until;
  if (!save(farmStore, data, res, '농장')) return undefined;
  return res.json({ ok: true, channelId: farm.channelId, free, until, today });
};

// ---------------------------------------------------------------- 물 · 심기 · 수확

/** 농장을 찾아 오늘까지 센 사본을 준다. 없으면 응답을 보내고 null. */
function farmFor(data, channelId, today, res) {
  const stored = data.farms[channelId];
  if (!stored) {
    res.json({ ok: false, reason: 'none', today });
    return null;
  }
  return current(stored, today);
}

/**
 * POST /api/farms/water — `{ channelId, userId, plot? }`. **누구나** 줄 수 있다.
 *
 * 한 포기에 체력 1. 줄 수 있는 것은 `hp − 1` 포기까지다. 모자라면 급한 칸(시든 칸 → 목마른 칸)
 * 부터 주고 나머지는 남긴다 — 다른 사람이 이어서 줄 수 있다.
 * 계정에는 체력과 전적(`farmWater`, 남의 농장이면 `farmHelp`)이 같이 나간다.
 */
exports.water = (req, res) => {
  const got = ids(req.body, ['channelId', 'userId']);
  if (typeof got === 'string') return res.status(400).json({ error: got });
  const { channelId, userId } = got;
  const plot = req.body.plot ?? null;

  const data = readFarms(res);
  if (!data) return undefined;
  const acctData = readAccounts(res);
  if (!acctData) return undefined;
  const today = dayKey();

  const farm = farmFor(data, channelId, today, res);
  if (!farm) return undefined;
  const hp = load(acctData, userId, today).hp;
  const r = rules.water(farm, today, userId, { budget: Math.max(0, hp - KEEP_HP), plot });
  if (r.bad) return res.status(400).json({ error: BAD[r.reason] });
  if (!r.ok) return res.json({ ...r, hp, farm: rules.view(farm, today), today });

  // 계정 먼저 — 체력은 자원이다(§ 머리말 2). 여기서 실패하면 물은 안 준 채로 끝난다.
  const helper = userId !== farm.owner;
  const acct = touch(acctData, userId, today, (a) => {
    a.hp -= r.watered;
    bump(a, 'farmWater');
    if (helper) bump(a, 'farmHelp');
  });
  if (!save(accountStore, acctData, res, '계정')) return undefined;
  data.farms[channelId] = farm;
  if (!save(farmStore, data, res, '농장')) return undefined;

  return res.json({
    ...r, helper, hp: acct.hp, account: publicView(acct), farm: rules.view(farm, today), today,
  });
};

/**
 * POST /api/farms/plant — `{ channelId, userId, plot, cells, crop }`. 주인만.
 *
 * 씨앗값은 **가진 골드 안에서만** 낸다. 계정의 −1000 하한까지 빌려 쓰게 하지 않는다 —
 * 씨앗값으로 빚지는 농사는 보장 이익(수확하면 반드시 남는다)의 취지와 안 맞는다.
 */
exports.plant = (req, res) => {
  const got = ids(req.body, ['channelId', 'userId']);
  if (typeof got === 'string') return res.status(400).json({ error: got });
  const { channelId, userId } = got;
  const { plot, cells, crop } = req.body;

  const data = readFarms(res);
  if (!data) return undefined;
  const acctData = readAccounts(res);
  if (!acctData) return undefined;
  const today = dayKey();

  const farm = farmFor(data, channelId, today, res);
  if (!farm) return undefined;
  if (farm.owner !== userId) return res.json({ ok: false, reason: 'notOwner', owner: farm.owner, today });

  const r = rules.plant(farm, today, { plot, cells, crop });
  if (r.bad) return res.status(400).json({ error: BAD[r.reason] });
  if (!r.ok) return res.json({ ...r, farm: rules.view(farm, today), today });

  const have = load(acctData, userId, today).gold;
  if (have < r.cost) return res.json({ ok: false, reason: 'gold', need: r.cost, gold: have, today });

  // 계정 먼저(§ 머리말 2). 여기서 실패하면 농장은 안 건드린 채 끝난다.
  const acct = touch(acctData, userId, today, (a) => { a.gold -= r.cost; });
  if (!save(accountStore, acctData, res, '계정')) return undefined;
  data.farms[channelId] = farm;
  if (!save(farmStore, data, res, '농장')) return undefined;

  return res.json({ ...r, account: publicView(acct), farm: rules.view(farm, today), today });
};

/**
 * POST /api/farms/harvest — `{ channelId, userId, plot? }`. 주인만. `plot` 이 없으면 전부.
 *
 * 다 자란 칸을 거둬 아이템으로 넣고, 죽은 칸을 치운다. 전적 `farmHarvest` 는 거둔 칸 수.
 */
exports.harvest = (req, res) => {
  const got = ids(req.body, ['channelId', 'userId']);
  if (typeof got === 'string') return res.status(400).json({ error: got });
  const { channelId, userId } = got;
  const plot = req.body.plot ?? null;

  const data = readFarms(res);
  if (!data) return undefined;
  const acctData = readAccounts(res);
  if (!acctData) return undefined;
  const today = dayKey();

  const farm = farmFor(data, channelId, today, res);
  if (!farm) return undefined;
  if (farm.owner !== userId) return res.json({ ok: false, reason: 'notOwner', owner: farm.owner, today });

  const r = rules.harvest(farm, today, { plot });
  if (r.bad) return res.status(400).json({ error: BAD[r.reason] });
  if (!r.ok) return res.json({ ...r, farm: rules.view(farm, today), today });

  // 농장 먼저(§ 머리말 2). 계정 쓰기가 실패하면 이 수확은 잃는다 — 두 번 거두는 것보다 낫다.
  data.farms[channelId] = farm;
  if (!save(farmStore, data, res, '농장')) return undefined;
  const acct = touch(acctData, userId, today, (a) => {
    for (const [key, n] of Object.entries(r.items)) a.items[key] = (a.items[key] ?? 0) + n;
    if (r.harvested) bump(a, 'farmHarvest', r.harvested);
  });
  if (!save(accountStore, acctData, res, '계정')) return undefined;

  return res.json({ ...r, account: publicView(acct), farm: rules.view(farm, today), today });
};

/**
 * POST /api/farms/clear — `{ channelId, userId, plot, cell?, pos?, all? }`. 주인만.
 *
 * 돌은 기력 1, 바위는 휘두를 때마다 1, 잡초는 공짜(§9). 기력과 화석 상한은 **계정 기준**
 * (`daily`) — 농장 파일에 같이 적으므로 한 번의 쓰기로 나간다. 전리품은 계정으로.
 * 농장 먼저, 계정 나중(수확과 같은 순서) — 사이에 죽으면 그 전리품만 잃는다.
 */
exports.clear = (req, res) => {
  const got = ids(req.body, ['channelId', 'userId']);
  if (typeof got === 'string') return res.status(400).json({ error: got });
  const { channelId, userId } = got;
  const { plot, cell = null, pos = null, all = false } = req.body;

  const data = readFarms(res);
  if (!data) return undefined;
  const acctData = readAccounts(res);
  if (!acctData) return undefined;
  const today = dayKey();

  const farm = farmFor(data, channelId, today, res);
  if (!farm) return undefined;
  if (farm.owner !== userId) return res.json({ ok: false, reason: 'notOwner', owner: farm.owner, today });

  const daily = dailyOf(data, userId, today);
  const stamina = staminaFor(data, farm, userId, today);
  const r = rules.clear(farm, today, { plot, cell, pos, all: all === true }, {
    stamina: stamina.left, fossilLeft: land.FOSSIL_PER_DAY - daily.fossils,
  });
  if (r.bad) return res.status(400).json({ error: BAD[r.reason] });
  if (!r.ok) return res.json({ ...r, stamina, farm: rules.view(farm, today), today });

  data.daily[userId] = { ...daily, used: daily.used + r.used, fossils: daily.fossils + r.fossils };
  data.farms[channelId] = farm;
  if (!save(farmStore, data, res, '농장')) return undefined;

  const cleared = r.cleared ?? 0;
  const acct = touch(acctData, userId, today, (a) => {
    for (const [key, n] of Object.entries(r.loot)) a.items[key] = (a.items[key] ?? 0) + n;
    if (cleared || r.broke) bump(a, 'farmClear', cleared + (r.broke ? 1 : 0));
    if (r.perfect) bump(a, 'farmPerfect');
  });
  if (!save(accountStore, acctData, res, '계정')) return undefined;

  return res.json({
    ...r,
    stamina: staminaFor(data, farm, userId, today),
    account: publicView(acct),
    farm: rules.view(farm, today),
    today,
  });
};
