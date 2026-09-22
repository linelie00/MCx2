/**
 * farmController — /api/farms (디스코드 봇 전용)
 *
 * 채널 하나가 농장 하나. 규칙은 전부 `farm/rules.js` 에 있고, 여기는 **읽고 · 규칙을 부르고 ·
 * 쓰는** 일만 한다. 설계는 docs/FARM.md.
 *
 * **"검사하고 쓰기" 를 서버가 한다.** 먼저 등록한 사람이 주인, 한 사람에 농장 하나, 물은 하루
 * 한 번 — 둘이 동시에 눌러도 노드가 단일 스레드라 한쪽만 통과한다. 그래서 읽기와 쓰기 사이에
 * `await` 을 넣지 않는다(accountStore 머리말과 같은 까닭).
 *
 * **두 파일에 걸친 쓰기.** 심기는 골드를, 수확은 아이템을 계정(accounts.json)에서 같이 옮긴다.
 * 파일이 둘이라 한 번에 못 쓰므로
 *   1. 두 파일을 **다 읽고**, 규칙과 잔액 검사를 **다 끝낸 다음** 쓴다. 거절은 쓰기 전에 난다
 *   2. 쓰는 순서는 **"잃을 수는 있어도 복제되지는 않게"**
 *        심기 — 계정(골드 빼기) 먼저, 농장 나중. 사이에 죽으면 씨앗값만 날아간다
 *        수확 — 농장(칸 비우기) 먼저, 계정 나중. 사이에 죽으면 그 수확만 날아간다
 *      반대로 두면 같은 칸을 두 번 거두거나 공짜로 심는 길이 생긴다.
 *
 * **못 한 것도 200 이다**(`ok: false, reason`). "이미 물을 줬다" · "주인이 따로 있다" 는 오류가
 * 아니라 답이다(`/claim` 과 같은 규약). 호출이 틀린 것(모양이 틀린 id·칸)만 400 이다.
 *
 * 조회는 셈만 하고 **쓰지 않는다.** 1단계의 셈에는 무작위가 없어 몇 번 셈해도 같다.
 */
const farmStore = require('../services/farmStore');
const accountStore = require('../services/accountStore');
const { load, publicView } = require('./accountController');
const { dayKey } = require('../services/dayKey');
const { CROPS, publicCrop } = require('../farm/crops');
const rules = require('../farm/rules');

/** 디스코드 id(유저·채널·길드). NPC 는 농장을 안 가진다. */
const SNOWFLAKE = /^\d{5,25}$/;

const now = () => new Date().toISOString();
const clone = (o) => structuredClone(o);
const ownedBy = (data, userId) => Object.values(data.farms).find((f) => f.owner === userId) ?? null;

/** 모양이 틀린 입력의 문구. rules 가 `bad: true` 로 돌려준 사유를 받는다. */
const BAD = {
  plot: '밭 번호는 0~8 이어야 합니다',
  cells: '칸은 0~8 의 겹치지 않는 번호 배열이어야 합니다',
  crop: '모르는 작물입니다',
};

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
  return res.json({ farm: farm ? rules.view(rules.tick(clone(farm), today), today) : null, today });
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
    farm: farm ? rules.view(rules.tick(clone(farm), today), today) : null,
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
  return rules.tick(clone(stored), today);
}

/**
 * POST /api/farms/water — `{ channelId, userId }`. **누구나** 줄 수 있다.
 *
 * 계정에는 전적만 남긴다(`farmWater`, 남의 농장이면 `farmHelp`). 전적은 잃어도 되는 것이라
 * 농장을 먼저 쓰고, 계정 쓰기가 실패해도 물은 준 것으로 둔다.
 */
exports.water = (req, res) => {
  const got = ids(req.body, ['channelId', 'userId']);
  if (typeof got === 'string') return res.status(400).json({ error: got });
  const { channelId, userId } = got;

  const data = readFarms(res);
  if (!data) return undefined;
  const acctData = readAccounts(res);
  if (!acctData) return undefined;
  const today = dayKey();

  const farm = farmFor(data, channelId, today, res);
  if (!farm) return undefined;
  const r = rules.water(farm, today, userId);
  if (!r.ok) return res.json({ ...r, farm: rules.view(farm, today), today });

  data.farms[channelId] = farm;
  if (!save(farmStore, data, res, '농장')) return undefined;

  const helper = userId !== farm.owner;
  touch(acctData, userId, today, (acct) => {
    bump(acct, 'farmWater');
    if (helper) bump(acct, 'farmHelp');
  });
  try {
    accountStore.write(acctData);
  } catch (e) {
    console.error(`[농장] 물주기 전적을 못 썼습니다(물은 줬음): ${e.message}`);
  }
  return res.json({ ...r, helper, farm: rules.view(farm, today), today });
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
