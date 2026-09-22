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
 *
 * **희귀 씨앗 주머니**(`pouches`, 3c)도 계정 기준이다. 주머니와 농장이 **같은 파일**이라, 씨앗을
 * 줍거나(개간) 쓰는(심기) 것은 칸 바꾸기와 한 번의 쓰기로 나간다 — 반쪽 상태가 없다.
 *
 * **비명 뿌리**(3c)를 거두면 한 번마다 귀마개 하나를 쓰고, 없으면 체력 −5(1 은 남긴다).
 *
 * **도감**(`book`, 3b)도 계정 기준 · 같은 파일이다. 수확이 농장을 쓸 때 같이 적는다.
 */
const farmStore = require('../services/farmStore');
const accountStore = require('../services/accountStore');
const { load, publicView } = require('./accountController');
const { dayKey } = require('../services/dayKey');
const { CROPS, CROP_BY_KEY, publicCrop } = require('../farm/crops');
const rules = require('../farm/rules');
const land = require('../farm/land');
const affinity = require('../farm/affinity');
const weather = require('../farm/weather');

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
  item: '거름은 fertilizer 나 compost 여야 합니다',
  count: '개수는 1 이상의 정수여야 합니다',
};

/** 물을 줘도 남겨 두는 체력. 0 이면 쓰러진다. */
const KEEP_HP = 1;
/** 비명 뿌리를 귀마개 없이 거두면 깎이는 체력(3c). */
const SCREAM_HP = 5;

/** 오늘의 개간 기력 장부(계정 기준). 날이 바뀌었으면 새로 연다. */
function dailyOf(data, userId, today) {
  const d = data.daily[userId];
  return d && d.day === today ? { seeds: 0, ...d } : { day: today, used: 0, fossils: 0, seeds: 0 };
}

/** 그 사람의 곡괭이 키. */
const toolOf = (data, userId) => land.pickaxeOf(data.tools[userId]).key;

/** 주인에게만 주는 것 — 기력 · 곡괭이 · (미스릴이면) 결 후보 · 희귀 씨앗 주머니. */
function meFor(data, farm, userId, today) {
  const tool = toolOf(data, userId);
  return {
    stamina: staminaFor(data, farm, userId, today),
    pickaxe: tool,
    candidates: tool === 'mithril' ? rules.candidates(farm) : null,
    pouch: { ...(data.pouches[userId] ?? {}) },
  };
}

/** 도감에 수확을 적는다 — 작물마다 거둔 칸 수 · 최고 ★ · 대왕 작물 수. */
function bookAdd(data, userId, grades, giants) {
  const book = { ...(data.book[userId] ?? {}) };
  for (const [crop, dist] of Object.entries(grades ?? {})) {
    const was = book[crop] ?? { n: 0, best: 0, giant: 0 };
    const best = dist.reduce((b, n, star) => (n ? star : b), was.best);
    book[crop] = { ...was, n: was.n + dist.reduce((a, n) => a + n, 0), best: Math.max(was.best, best) };
  }
  for (const g of giants ?? []) {
    const was = book[g.crop] ?? { n: 0, best: 0, giant: 0 };
    book[g.crop] = { ...was, n: was.n + 9, giant: (was.giant ?? 0) + 1 };
  }
  data.book[userId] = book;
}

/** 주머니에 씨앗을 넣고 뺀다. 0 이 된 칸은 지운다. */
function pouchAdd(data, userId, moves) {
  const bag = { ...(data.pouches[userId] ?? {}) };
  for (const [k, n] of Object.entries(moves)) {
    bag[k] = (bag[k] ?? 0) + n;
    if (bag[k] <= 0) delete bag[k];
  }
  data.pouches[userId] = bag;
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
  // `?user=` 가 주인이면 기력 · 곡괭이 · 결 후보도 준다(개간 창이 적는다).
  const user = String(req.query.user ?? '');
  const me = user === f.owner ? meFor(data, f, user, today) : null;
  return res.json({ farm: rules.view(f, today), me, today });
};

/**
 * GET /api/farms/:channelId/preview?plot=&crop= — 그 밭에 그 작물을 심으면 걸리는 궁합·연작.
 * `crop` 을 빼면 모든 작물의 요약(`all`)을 준다.
 *
 * 심기 창이 부른다. 셈은 서버가 한다 — 봇이 궁합표를 다시 갖지 않게. 쓰지 않는다.
 */
exports.preview = (req, res) => {
  const channelId = String(req.params.channelId);
  if (!SNOWFLAKE.test(channelId)) return res.status(400).json({ error: 'channelId 모양이 아닙니다' });
  const plot = Number(req.query.plot);
  const crop = req.query.crop == null ? null : String(req.query.crop);
  if (!Number.isInteger(plot) || plot < 0 || plot >= rules.PLOTS) return res.status(400).json({ error: BAD.plot });
  if (crop !== null && !CROP_BY_KEY[crop]) return res.status(400).json({ error: BAD.crop });
  const data = readFarms(res);
  if (!data) return undefined;
  const farm = data.farms[channelId];
  if (!farm) return res.json({ mods: null, all: null });
  const f = current(farm, dayKey());
  if (crop !== null) return res.json({ mods: affinity.modsFor(f, plot, crop) });
  // 작물을 안 주면 **모든 작물의 요약** — 심기 셀렉트가 줄마다 🤝/⚔️ 를 붙인다. 한 번에 준다.
  const all = {};
  for (const c of CROPS) {
    const m = affinity.modsFor(f, plot, c.key);
    if (m) all[c.key] = { rate: Math.round(m.rate * 1000) / 1000, quality: m.quality, rotation: m.rotation };
  }
  return res.json({ all });
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
 * 한 포기에 체력 1 — **폭염이면 2**(4a). 체력은 1 을 남기고 줄 수 있는 만큼만. 모자라면 급한 칸
 * (시든 칸 → 목마른 칸)부터 주고 나머지는 남긴다 — 다른 사람이 이어서 줄 수 있다.
 * 비·폭우인 날은 비가 이미 줬다(`reason: 'rain'`).
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
  const cost = weather.hpCost(today);
  const r = rules.water(farm, today, userId, { budget: Math.floor(Math.max(0, hp - KEEP_HP) / cost), plot });
  if (r.bad) return res.status(400).json({ error: BAD[r.reason] });
  if (!r.ok) return res.json({ ...r, hp, cost, farm: rules.view(farm, today), today });

  // 계정 먼저 — 체력은 자원이다(§ 머리말 2). 여기서 실패하면 물은 안 준 채로 끝난다.
  const helper = userId !== farm.owner;
  const acct = touch(acctData, userId, today, (a) => {
    a.hp -= r.watered * cost;
    bump(a, 'farmWater');
    if (helper) bump(a, 'farmHelp');
  });
  if (!save(accountStore, acctData, res, '계정')) return undefined;
  data.farms[channelId] = farm;
  if (!save(farmStore, data, res, '농장')) return undefined;

  return res.json({
    ...r, helper, cost, hp: acct.hp, account: publicView(acct), farm: rules.view(farm, today), today,
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

  const r = rules.plant(farm, today, { plot, cells, crop }, { pouch: data.pouches[userId]?.[crop] ?? 0 });
  if (r.bad) return res.status(400).json({ error: BAD[r.reason] });
  if (!r.ok) return res.json({ ...r, farm: rules.view(farm, today), today });
  if (r.seeds) pouchAdd(data, userId, { [crop]: -r.seeds });   // 칸과 같은 파일 · 같은 쓰기

  const have = load(acctData, userId, today).gold;
  if (have < r.cost) return res.json({ ok: false, reason: 'gold', need: r.cost, gold: have, today });

  // 계정 먼저(§ 머리말 2). 여기서 실패하면 농장은 안 건드린 채 끝난다.
  const acct = touch(acctData, userId, today, (a) => { a.gold -= r.cost; });
  if (!save(accountStore, acctData, res, '계정')) return undefined;
  data.farms[channelId] = farm;
  if (!save(farmStore, data, res, '농장')) return undefined;

  return res.json({
    ...r, account: publicView(acct), me: meFor(data, farm, userId, today), farm: rules.view(farm, today), today,
  });
};

/**
 * POST /api/farms/harvest — `{ channelId, userId, plot? }`. 주인만. `plot` 이 없으면 전부.
 *
 * 다 자란 칸을 거둬 아이템으로 넣고, 죽은 칸을 치운다. 전적 `farmHarvest` 는 거둔 칸 수.
 * 비명 뿌리를 거뒀으면(`screams`) 귀마개를 쓰고, 모자란 만큼 체력 −5(1 은 남긴다).
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
  bookAdd(data, userId, r.grades, r.giants);                 // 도감 — 농장과 같은 파일 · 같은 쓰기
  if (!save(farmStore, data, res, '농장')) return undefined;
  let plugs = 0; let hpLost = 0;
  const acct = touch(acctData, userId, today, (a) => {
    for (const [key, n] of Object.entries(r.items)) a.items[key] = (a.items[key] ?? 0) + n;
    if (r.harvested) bump(a, 'farmHarvest', r.harvested);
    if (r.screams) {
      plugs = Math.min(r.screams, a.items.earPlug ?? 0);
      if (plugs) { a.items.earPlug -= plugs; if (!a.items.earPlug) delete a.items.earPlug; }
      hpLost = Math.min((r.screams - plugs) * SCREAM_HP, Math.max(0, a.hp - KEEP_HP));
      a.hp -= hpLost;
    }
  });
  if (!save(accountStore, acctData, res, '계정')) return undefined;

  return res.json({
    ...r, plugs, hpLost, hp: acct.hp, account: publicView(acct), farm: rules.view(farm, today), today,
  });
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
    stamina: stamina.left,
    fossilLeft: land.FOSSIL_PER_DAY - daily.fossils,
    seedLeft: land.SEED_PER_DAY - daily.seeds,
    tool: toolOf(data, userId),
  });
  if (r.bad) return res.status(400).json({ error: BAD[r.reason] });
  if (!r.ok) return res.json({ ...r, stamina, farm: rules.view(farm, today), today });

  data.daily[userId] = {
    ...daily, used: daily.used + r.used, fossils: daily.fossils + r.fossils, seeds: daily.seeds + r.found,
  };
  if (r.found) pouchAdd(data, userId, r.seeds);        // 주머니 — 농장과 같은 파일 · 같은 쓰기
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
    me: meFor(data, farm, userId, today),
    account: publicView(acct),
    farm: rules.view(farm, today),
    today,
  });
};

// ---------------------------------------------------------------- 거름 · 퇴비 · 곡괭이 (2b)

/**
 * POST /api/farms/fertilize — `{ channelId, userId, plot, item, count? }`. 주인만.
 *
 * 계정의 비료·퇴비를 빼고 밭 토질 경험을 올린다. 밭마다 하루 한도(`land.FERTS`)를 넘는 몫과
 * 가진 것보다 많은 몫은 안 넣고 안 뺀다(`capped`). 계정 먼저, 농장 나중 — 사이에 죽으면
 * 거름만 잃는다.
 */
exports.fertilize = (req, res) => {
  const got = ids(req.body, ['channelId', 'userId']);
  if (typeof got === 'string') return res.status(400).json({ error: got });
  const { channelId, userId } = got;
  const { plot, item } = req.body;
  const count = req.body.count ?? 1;
  if (!land.FERTS[item]) return res.status(400).json({ error: BAD.item });
  if (!Number.isInteger(count) || count < 1) return res.status(400).json({ error: BAD.count });

  const data = readFarms(res);
  if (!data) return undefined;
  const acctData = readAccounts(res);
  if (!acctData) return undefined;
  const today = dayKey();

  const farm = farmFor(data, channelId, today, res);
  if (!farm) return undefined;
  if (farm.owner !== userId) return res.json({ ok: false, reason: 'notOwner', owner: farm.owner, today });

  const have = load(acctData, userId, today).items[item] ?? 0;
  if (have < 1) return res.json({ ok: false, reason: 'noItem', item, have, need: 1, today });
  const r = rules.fertilize(farm, today, { plot, item, count: Math.min(count, have) });
  if (r.bad) return res.status(400).json({ error: BAD[r.reason] });
  if (!r.ok) return res.json({ ...r, farm: rules.view(farm, today), today });

  const acct = touch(acctData, userId, today, (a) => {
    a.items[item] -= r.used;
    if (!a.items[item]) delete a.items[item];
  });
  if (!save(accountStore, acctData, res, '계정')) return undefined;
  data.farms[channelId] = farm;
  if (!save(farmStore, data, res, '농장')) return undefined;
  return res.json({
    ...r, capped: r.capped || r.used < count, account: publicView(acct), farm: rules.view(farm, today), today,
  });
};

/**
 * POST /api/farms/compost — `{ userId, crop, count? }`. 거둔 작물 `COMPOST_CROPS` 개 → 퇴비 하나.
 *
 * 계정 안에서만 옮긴다(한 번의 쓰기). 농장이 없어도 된다 — 작물만 있으면 퇴비는 만든다.
 * 농장 작물표에 있는 것만 받는다. 고기나 물고기를 거름으로 만들지는 않는다.
 */
exports.compost = (req, res) => {
  const got = ids(req.body, ['userId']);
  if (typeof got === 'string') return res.status(400).json({ error: got });
  const { userId } = got;
  const { crop } = req.body;
  const count = req.body.count ?? 1;
  if (!CROP_BY_KEY[crop]) return res.status(400).json({ error: BAD.crop });
  if (!Number.isInteger(count) || count < 1 || count > 100) return res.status(400).json({ error: BAD.count });

  const acctData = readAccounts(res);
  if (!acctData) return undefined;
  const today = dayKey();
  const need = count * land.COMPOST_CROPS;
  const have = load(acctData, userId, today).items[crop] ?? 0;
  if (have < need) return res.json({ ok: false, reason: 'noItem', item: crop, have, need, today });

  const acct = touch(acctData, userId, today, (a) => {
    a.items[crop] -= need;
    if (!a.items[crop]) delete a.items[crop];
    a.items.compost = (a.items.compost ?? 0) + count;
  });
  if (!save(accountStore, acctData, res, '계정')) return undefined;
  return res.json({
    ok: true, crop, used: need, made: count, account: publicView(acct), today,
  });
};

/**
 * POST /api/farms/pickaxe — `{ userId }`. 곡괭이를 한 단계 올린다.
 *
 * 해금은 **자기 농장 레벨**로 본다(농장이 있어야 한다). 값은 골드 + 재료. 원석(`ore`)은
 * 여섯 가지 아무거나 — 많이 가진 것부터 뺀다. 계정 먼저, 곡괭이 나중.
 */
exports.pickaxe = (req, res) => {
  const got = ids(req.body, ['userId']);
  if (typeof got === 'string') return res.status(400).json({ error: got });
  const { userId } = got;

  const data = readFarms(res);
  if (!data) return undefined;
  const acctData = readAccounts(res);
  if (!acctData) return undefined;
  const today = dayKey();

  const farm = ownedBy(data, userId);
  if (!farm) return res.json({ ok: false, reason: 'noFarm', today });
  const now = land.pickaxeOf(data.tools[userId]);
  const next = land.nextPickaxe(now.key);
  if (!next) return res.json({ ok: false, reason: 'maxTool', tool: now.key, today });
  const level = rules.levelOf(rules.upgrade(clone(farm)));
  if (level < next.lv) return res.json({ ok: false, reason: 'toolLevel', need: next.lv, tool: next.key, today });

  const acct0 = load(acctData, userId, today);
  if (acct0.gold < next.gold) return res.json({ ok: false, reason: 'gold', need: next.gold, gold: acct0.gold, today });
  // 재료 — 원석은 많이 가진 것부터
  const take = {};
  for (const [key, n] of Object.entries(next.items)) {
    if (key !== 'ore') {
      const h = acct0.items[key] ?? 0;
      if (h < n) return res.json({ ok: false, reason: 'noItem', item: key, have: h, need: n, today });
      take[key] = n;
    } else {
      let left = n;
      const ores = land.ORES.map((k) => [k, acct0.items[k] ?? 0]).sort((a, b) => b[1] - a[1]);
      for (const [k, h] of ores) {
        const t = Math.min(h, left);
        if (t) { take[k] = t; left -= t; }
      }
      if (left > 0) return res.json({ ok: false, reason: 'noItem', item: 'ore', have: n - left, need: n, today });
    }
  }

  const acct = touch(acctData, userId, today, (a) => {
    a.gold -= next.gold;
    for (const [k, n] of Object.entries(take)) {
      a.items[k] -= n;
      if (!a.items[k]) delete a.items[k];
    }
  });
  if (!save(accountStore, acctData, res, '계정')) return undefined;
  data.tools[userId] = next.key;
  if (!save(farmStore, data, res, '농장')) return undefined;
  return res.json({
    ok: true, tool: next.key, paid: { gold: next.gold, items: take }, account: publicView(acct), today,
  });
};

/**
 * GET /api/farms/weather — 오늘·내일 날씨와 계절, 오늘 제철인 작물(4a). 모든 농장이 같다.
 * `?days=n` 이면 앞으로 n 일(최대 14)의 날씨도.
 */
exports.weather = (req, res) => {
  const today = dayKey();
  const days = Math.max(0, Math.min(14, Number(req.query.days) || 0));
  const ahead = [];
  for (let n = 0; n < days; n += 1) {
    const day = rules.addDays(today, n);
    ahead.push({ day, weather: weather.weatherOf(day), season: weather.seasonOf(day) });
  }
  return res.json({
    ...weather.forecast(today),
    inSeason: CROPS.filter((c) => weather.inSeason(c, today)).map((c) => c.key),
    ahead,
    today,
  });
};

/** GET /api/farms/book/:userId — 그 사람의 도감과 작물표 크기(수집률 셈용). */
exports.book = (req, res) => {
  const userId = String(req.params.userId);
  if (!SNOWFLAKE.test(userId)) return res.status(400).json({ error: 'userId 모양이 아닙니다' });
  const data = readFarms(res);
  if (!data) return undefined;
  return res.json({ book: data.book[userId] ?? {}, total: CROPS.length });
};

/** GET /api/farms/tools/:userId — 곡괭이 표와 그 사람의 곡괭이 · 농장 레벨. */
exports.tools = (req, res) => {
  const userId = String(req.params.userId);
  if (!SNOWFLAKE.test(userId)) return res.status(400).json({ error: 'userId 모양이 아닙니다' });
  const data = readFarms(res);
  if (!data) return undefined;
  const farm = ownedBy(data, userId);
  return res.json({
    pickaxes: land.PICKAXES,
    tool: toolOf(data, userId),
    level: farm ? rules.levelOf(rules.upgrade(clone(farm))) : null,
  });
};
