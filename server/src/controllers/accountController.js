/**
 * accountController — 카지노 계정 (골드 · MT · 체력 · 칭호 · 아이템)
 *
 * 봇만 쓴다(라우트에서 requireBot). 사람은 사이트에서 이걸 만질 일이 없다.
 *
 * 쓰기는 전부 **잔액이 아니라 증감(delta)** 을 받는다. 이 스토어에는 락이 없어서,
 * 잔액을 통째로 받으면 두 판이 동시에 정산할 때 나중 것이 앞의 것을 지운다.
 * 증감은 더하기라 순서가 섞여도 결과가 같다.
 *
 * 그래서 모든 쓰기는 `read() → 고치기 → write()` 를 **한 동기 블록**으로 한다.
 * 중간에 `await` 이 하나라도 끼면 다른 요청이 그 사이에 끼어들어 갱신이 유실된다.
 *
 * account shape: { gold, mt, hp, title, items, stats, refilledAt, healedAt, updatedAt }
 *
 * **재화가 둘이다.** `gold` 는 걸고 쓰는 돈, `mt` 는 모으는 것(요트 1위·홀덤 토너먼트
 * 우승으로만 는다). 둘 다 천장이 없어서 범위를 벗어나면 버그이므로 **거절**한다.
 *
 * `hp` 는 재화가 아니라 상태값이라 혼자 다르다 — **자른다.** 95에서 회복약을 먹어
 * 넘치는 것은 버그가 아니라 설계다. `hp <= 0` 이 사망이고, **사망을 따로 저장하지
 * 않는다** — 플래그를 두면 `hp:0 · dead:false` 같은 어긋난 짝이 생긴다.
 *
 * `title` 은 **달고 있는 칭호의 키**다. 이름이 아니라 키를 두는 이유는 나중에 칭호
 * 이름을 고쳐도 달고 있던 게 안 날아가게 하려는 것이고, 무엇이 유효한 키인지는
 * 서버가 모른다 — 칭호 규칙은 봇에 있다(`casino/titles.js`).
 *
 * `stats` 는 전적 카운터다. **골드와 똑같이 더하기만 한다** — 그래서 락 없는 이 스토어에
 * 안전하게 쓸 수 있는 유일한 방식(증감)을 그대로 탄다. 최댓값(최고 팟 같은 것)도
 * 순서를 안 타므로 같이 실어도 된다.
 */
const store = require('../services/accountStore');
const { dayKey } = require('../services/dayKey');

/** 처음 보는 id 의 잔액. 등록 절차가 없다 — 없는 사람은 이 값으로 친다. */
const START_GOLD = 1000;

/** 일일 규칙(`/출첵`): 이 아래면 여기까지 채운다. 더 주지는 않는다. **사람만 쓴다.** */
const DAILY_FLOOR = 1000;

/**
 * 잔액이 여기 아래로 내려가는 delta 배치는 거절한다.
 *
 * 정상적으로는 **0 아래로 안 내려간다** — 판에 들고 앉는 스택이 이미 잔액 이하라
 * 그보다 더 잃을 수가 없다. 그러니 크게 마이너스로 가는 배치는 **같은 골드를 두 판에서
 * 겹쳐 걸었다**는 뜻이다(봇이 막지만 여기서 한 번 더 본다).
 *
 * **0 으로 깎지는 않는다** — 깎으면 없던 골드가 생기고, 총합 보존으로 버그를 잡는 길이
 * 막힌다. 거절하고 로그에 남기는 편이 낫다.
 */
const MIN_BALANCE = -1000;

/**
 * 체력 천장. **봇의 `bot/src/casino/items.js` 의 MAX_HP 와 같은 값이어야 한다.**
 * 아이템의 `heal` 이 그 값을 천장으로 적혀 있어서, 둘이 어긋나면 회복이 어긋난다.
 */
const MAX_HP = 100;

/**
 * 하루에 한 번 되찾는 체력. 사람은 `/출첵` 으로, 미겔·마티암은 날이 바뀌면 저절로.
 *
 * **쓰러진 사람은 안 일어난다.** 부활은 부활의 영약으로만 — 시간이 되살려 주면
 * 영약이 쓸모없어지고 죽음이 무게를 잃는다(처음 정한 규칙이다).
 */
const DAILY_HEAL = 20;

/** 처음 보는 id 의 MT. 얻는 길이 좁아서 0 에서 시작한다. */
const START_MT = 0;

/**
 * 아이템 키 모양. **명부는 안 본다** — 무엇이 유효한 아이템인지는 봇이 안다
 * (`casino/items.js`). 칭호 키와 같은 원칙이다.
 */
const ITEM_KEY_RE = /^[a-z][A-Za-z0-9]{0,39}$/;

/** 한 번에 다룰 수 있는 계정 수. 자리는 넷이지만 넉넉히 둔다. */
const MAX_IDS = 16;

/** 디스코드 유저 id, 또는 NPC. 이 밖의 문자열은 장부에 들이지 않는다. */
const ID_RE = /^(?:\d{5,25}|npc:(?:migel|matiam))$/;

const now = () => new Date().toISOString();
const isNpc = (id) => id.startsWith('npc:');

const blank = () => ({
  gold: START_GOLD,
  mt: START_MT,
  // **0 으로 두면 안 된다.** normalize 가 읽을 때 채우므로, 0 이면 기존 계정이 전부
  // 죽은 것으로 읽힌다.
  hp: MAX_HP,
  title: null,
  items: {},
  stats: {},
  refilledAt: null,
  healedAt: null,       // 오늘 체력을 되찾았는지. 골드 도장(refilledAt)과 **따로** 센다
  updatedAt: null,
});

/**
 * 저장된 계정을 빠진 필드까지 채워서 준다. 뒤에 필드가 늘어도 옛 기록이 안 깨진다.
 *
 * **`chips` 를 받아 준다.** 돈 이름을 칩에서 골드로 바꾸기 전에 저장된 기록이라,
 * 그냥 읽으면 잔액이 통째로 0 이 된다. 쓸 때는 늘 `gold` 로 쓰므로 계정마다 **처음
 * 저장되는 순간 넘어간다** — 전부 넘어간 뒤에는 이 줄을 지워도 된다.
 */
const normalize = (raw) => {
  const acct = { ...blank(), ...(raw || {}) };
  if (raw && raw.gold === undefined && Number.isFinite(raw.chips)) acct.gold = raw.chips;
  delete acct.chips;

  // 저장된 값이 숫자가 아니면 기본값으로. **`null` 이 특히 위험하다** — `null <= 0` 이
  // 참이라 그냥 두면 멀쩡한 계정이 죽은 것으로 읽힌다.
  if (!Number.isFinite(acct.mt)) acct.mt = START_MT;
  if (!Number.isFinite(acct.hp)) acct.hp = MAX_HP;
  if (!acct.items || typeof acct.items !== 'object') acct.items = {};
  return acct;
};

/** 밖으로 내보내는 모양. 내부 필드가 늘어도 응답이 저절로 새지 않게 골라 담는다. */
const publicView = (acct) => ({
  gold: acct.gold,
  mt: acct.mt,
  hp: acct.hp,
  title: acct.title,
  items: acct.items,
  stats: acct.stats,
  refilledAt: acct.refilledAt,
});

/**
 * 하루 한 번, 기준선 미만이면 기준선까지 채운다. **사람 전용이다.**
 *
 * 미겔·마티암은 자동으로 안 채운다 — 사람이 `/급여` 로 일당을 줄 때만 늘어난다.
 * 일해서 번 돈이라는 설정이라 시간이 준다기보다 누가 줘야 하는 것이다.
 *
 * `refilledAt` 은 **실제로 채웠을 때만** 찍는다. 1200 가진 사람이 출첵하면 도장을
 * 안 찍으므로, 그날 파산한 뒤에 받을 수 있다. "하루 한 번 시도" 가 아니라
 * "하루 한 번, 진짜로 모자랐을 때" 다.
 */
function dailyRule(acct, today) {
  const floor = DAILY_FLOOR;
  if (acct.refilledAt === today) return { refilled: false, reason: 'claimed', gold: acct.gold };
  if (acct.gold >= floor) return { refilled: false, reason: 'enough', gold: acct.gold };

  const before = acct.gold;
  acct.gold = floor;
  acct.refilledAt = today;
  acct.updatedAt = now();
  return { refilled: true, before, gold: acct.gold };
}

/**
 * 사람의 하루 회복(`/출첵`). 골드와 **같은 모양의 규칙**이다 — 하루 한 번, 진짜로
 * 깎였을 때만 도장을 찍는다. 가득 찬 채로 누르면 그냥 넘어가고, 그날 다치면 그때 받는다.
 *
 * **도장은 골드와 따로 둔다.** 같은 `refilledAt` 을 쓰면, 골드가 넉넉한 사람은 골드
 * 도장이 안 찍히니 **체력을 하루에 몇 번이고 받는다.**
 */
function healRule(acct, today) {
  if (acct.healedAt === today) return { healed: false, reason: 'claimed', hp: acct.hp };
  if (acct.hp <= 0) return { healed: false, reason: 'dead', hp: acct.hp };
  if (acct.hp >= MAX_HP) return { healed: false, reason: 'full', hp: acct.hp };

  const before = acct.hp;
  acct.hp = Math.min(MAX_HP, acct.hp + DAILY_HEAL);
  acct.healedAt = today;
  acct.updatedAt = now();
  return { healed: true, before, hp: acct.hp };
}

/**
 * 미겔·마티암의 하루 회복. **날이 바뀌고 처음 읽힐 때** 저절로 붙는다.
 *
 * 사람과 달리 **다쳤든 아니든 도장을 찍는다.** 사람 규칙처럼 "깎였을 때만" 이면,
 * 아침에 가득 찼던 마티암이 던전에서 다치는 순간 그 핸드의 쓰기에서 회복이 끼어들어
 * **싸우던 도중에 체력이 20 튄다.** 하루의 몫은 그날 처음 볼 때 정해져야 한다.
 *
 * 읽기(`list`)에서도 붙이되 **거기서는 저장하지 않는다.** 날짜와 저장된 값만으로
 * 정해지는 값이라 몇 번을 다시 계산해도 같고, 그날 처음 쓰는 순간 함께 저장된다.
 * 그래서 봇이 읽은 체력과 서버가 쓰기 직전에 보는 체력이 늘 같다.
 */
function npcDaily(acct, today) {
  if (acct.healedAt === today) return acct;
  if (acct.hp > 0) acct.hp = Math.min(MAX_HP, acct.hp + DAILY_HEAL);
  acct.healedAt = today;
  return acct;
}

/** 저장된 계정을 **오늘 기준으로** 읽는다. 모든 핸들러가 이 길로만 읽는다. */
const load = (data, id, today) => {
  const acct = normalize(data.accounts[id]);
  return isNpc(id) ? npcDaily(acct, today) : acct;
};

/** `?ids=a,b,c` 또는 본문의 배열을 검사해서 준다. 이상하면 문자열(사유)을 돌려준다. */
function parseIds(raw) {
  const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(','))
    .map((s) => String(s).trim())
    .filter(Boolean);

  if (!list.length) return 'ids 가 필요합니다';
  if (list.length > MAX_IDS) return `id 는 한 번에 ${MAX_IDS}개까지입니다`;
  const bad = list.find((id) => !ID_RE.test(id));
  if (bad) return `id 모양이 아닙니다: ${bad}`;
  return [...new Set(list)];
}

/** 스토어가 못 읽히면 503. 손상된 파일 위에 덮어쓰지 않는 것이 제일 중요하다. */
function readOr503(res) {
  try {
    return store.read();
  } catch (e) {
    res.status(503).json({ error: `계정 데이터를 읽지 못했습니다: ${e.message}` });
    return null;
  }
}

// ---------------------------------------------------------------- 조회

/** GET /api/accounts?ids=a,b — 순수 조회. 아무것도 안 쓴다. */
exports.list = (req, res) => {
  const ids = parseIds(req.query.ids);
  if (typeof ids === 'string') return res.status(400).json({ error: ids });

  const data = readOr503(res);
  if (!data) return undefined;

  const today = dayKey();
  const accounts = {};
  for (const id of ids) accounts[id] = publicView(load(data, id, today));
  return res.json({ accounts, today });
};

// ---------------------------------------------------------------- 정산

/** 카운터 이름. 여기 없는 키는 안 받는다 — 오타 하나로 전적이 둘로 갈리면 못 고친다. */
const BUMP_KEYS = new Set([
  'hands', 'won', 'earned', 'lost',                 // 공통
  'holdemHands', 'holdemWon', 'blackjackHands', 'blackjackWon', 'blackjacks',
  'allInWon', 'allInLost', 'allInHigh',             // 올인 — 칭호가 읽는다
  // 쇼다운에서 깐 족보. **최댓값이 아니라 족보마다 따로** 센다 — 칭호가 묻는 것이
  // "그 족보를 직접 만들어 봤나" 라서, 최댓값으로 두면 아래가 전부 딸려 온다.
  'handStraight', 'handFlush', 'handFullHouse', 'handQuads', 'handStraightFlush',
  'dungeonWon', 'dungeonLost',                     // 던전 — 골드 전적과 섞지 않는다
]);

/** 더하지 않고 **큰 쪽만 남기는** 값들. 순서를 안 타는 건 더하기와 같다. */
const MAX_KEYS = new Set(['bestPot', 'bestHand', 'bestBet']);

/**
 * POST /api/accounts/deltas — 계정 하나의 네 가지를 **한 번에** 옮긴다.
 *
 * `{ deltas: {id: ±n}, mt: {id: ±n}, hp: {id: ±n}, items: {id: {키: ±n}}, bump: {id: {카운터: n}} }`
 *
 * **다섯 다 선택이다.** 상점은 골드를 빼고 아이템을 넣는 **한 번의 쓰기**여야 하고,
 * 던전은 체력과 아이템을 같이 써야 한다. 둘로 나누면 락 없는 이 스토어에서 두 번째
 * 읽기가 첫 번째 쓰기를 통째로 놓치고, 중간에 죽으면 반쪽만 남는다.
 *
 * 다루는 id 는 **다섯 맵 키의 합집합**이다. `deltas` 를 필수로 두면 MT 만 주는 보상이
 * `deltas: { id: 0 }` 을 억지로 끼워야 하는데, 봇의 `wallet.apply` 가 0 을 걸러 내서
 * 그 쓰기가 통째로 사라진다.
 */
exports.applyDeltas = (req, res) => {
  const body = req.body || {};
  const maps = { deltas: body.deltas, mt: body.mt, hp: body.hp, items: body.items };
  for (const [name, m] of Object.entries(maps)) {
    if (m === undefined) { maps[name] = {}; continue; }
    if (!m || typeof m !== 'object' || Array.isArray(m)) {
      return res.status(400).json({ error: `${name} 는 객체여야 합니다` });
    }
  }
  // 전적 카운터. 없어도 된다 — 골드만 옮기는 호출(`/급여`)이 대부분이다.
  const bump = body.bump || {};
  if (typeof bump !== 'object' || Array.isArray(bump)) {
    return res.status(400).json({ error: 'bump 는 객체여야 합니다' });
  }

  // **bump 도 합집합에 넣는다.** 토너먼트는 핸드마다 전적만 적고 골드는 끝에 한 번
  // 옮기므로, 카운터만 있는 쓰기가 실제로 온다.
  const ids = parseIds([...new Set(
    [...Object.values(maps), bump].flatMap((m) => Object.keys(m)),
  )]);
  if (typeof ids === 'string') return res.status(400).json({ error: ids });

  // 소수가 들어오면 지갑이 영영 소수를 안고 간다. 여기서 막는다.
  for (const name of ['deltas', 'mt', 'hp']) {
    for (const [id, n] of Object.entries(maps[name])) {
      if (!Number.isSafeInteger(n)) {
        return res.status(400).json({ error: `정수가 아닙니다: ${name}.${id}=${n}` });
      }
    }
  }
  for (const [id, moves] of Object.entries(maps.items)) {
    if (!moves || typeof moves !== 'object' || Array.isArray(moves)) {
      return res.status(400).json({ error: `items.${id} 가 객체가 아닙니다` });
    }
    for (const [key, n] of Object.entries(moves)) {
      if (!ITEM_KEY_RE.test(key)) return res.status(400).json({ error: `아이템 키 모양이 아닙니다: ${key}` });
      if (!Number.isSafeInteger(n)) return res.status(400).json({ error: `정수가 아닙니다: items.${id}.${key}=${n}` });
    }
  }
  for (const [id, counters] of Object.entries(bump)) {
    if (!counters || typeof counters !== 'object') return res.status(400).json({ error: `bump.${id} 가 객체가 아닙니다` });
    for (const [k, v] of Object.entries(counters)) {
      if (!BUMP_KEYS.has(k) && !MAX_KEYS.has(k)) return res.status(400).json({ error: `모르는 카운터: ${k}` });
      if (!Number.isSafeInteger(v) || v < 0) return res.status(400).json({ error: `카운터가 0 이상 정수가 아닙니다: ${k}=${v}` });
    }
  }

  const data = readOr503(res);
  if (!data) return undefined;

  // 먼저 전부 계산해 보고, 하나라도 선을 넘으면 **아무것도 안 쓴다.**
  const today = dayKey();
  const next = {};
  for (const id of ids) {
    const acct = load(data, id, today);

    const gold = acct.gold + (maps.deltas[id] ?? 0);
    if (gold < MIN_BALANCE) {
      return res.status(409).json({
        error: `잔액이 너무 내려갑니다: ${id} ${acct.gold} → ${gold}`
          + ' (같은 골드를 두 판에서 겹쳐 걸었을 수 있습니다)',
      });
    }

    // MT 는 재화라 골드와 같은 규칙 — 모자라면 거절하고 0 으로 깎지 않는다.
    const mt = acct.mt + (maps.mt[id] ?? 0);
    if (mt < 0) return res.status(409).json({ error: `MT 가 모자랍니다: ${id} ${acct.mt} → ${mt}` });

    // 체력만 **자른다.** 재화가 아니라 상태값이고, 천장을 넘는 회복은 정상이다.
    const hp = Math.max(0, Math.min(MAX_HP, acct.hp + (maps.hp[id] ?? 0)));

    // **복사해서 고친다.** normalize 는 저장된 객체를 그대로 물려준다(`{...blank(), ...raw}`
    // 는 얕은 복사라 items 는 같은 객체다). 지금은 store.read() 가 요청마다 파일을 다시
    // 파싱하므로 제자리에서 고쳐도 그 객체가 버려지지만, 스토어가 언젠가 파싱 결과를
    // 들고 있게 되면 그 순간 409 를 내고도 절반이 써진다. 한 줄로 막아 둔다.
    const items = { ...acct.items };
    for (const [key, n] of Object.entries(maps.items[id] ?? {})) {
      const have = items[key] ?? 0;
      if (have + n < 0) {
        return res.status(409).json({ error: `가진 것보다 많이 씁니다: ${id} ${key} ${have} → ${have + n}` });
      }
      // 0 이 된 칸은 지운다. 빈 칸이 쌓이면 창고 화면이 지저분해진다.
      if (have + n === 0) delete items[key];
      else items[key] = have + n;
    }

    // 최고 잔액은 **서버가 알아서** 센다. 봇은 새 잔액을 모르는 채로 증감만 보내므로
    // (그게 이 설계의 핵심이다) 여기서 재는 것이 유일하게 맞는 자리다.
    const stats = { ...acct.stats, peak: Math.max(acct.stats?.peak ?? 0, gold) };
    for (const [k, v] of Object.entries(bump[id] ?? {})) {
      stats[k] = MAX_KEYS.has(k) ? Math.max(stats[k] ?? 0, v) : (stats[k] ?? 0) + v;
    }

    next[id] = { ...acct, gold, mt, hp, items, stats, updatedAt: now() };
  }

  Object.assign(data.accounts, next);
  try {
    store.write(data);
  } catch (e) {
    return res.status(503).json({ error: `계정 데이터를 쓰지 못했습니다: ${e.message}` });
  }

  const accounts = {};
  for (const id of ids) accounts[id] = publicView(next[id]);
  return res.json({ accounts });
};

// ---------------------------------------------------------------- 출첵

/**
 * POST /api/accounts/title — `{ id, title }`
 *
 * 달고 있을 칭호의 키를 바꾼다. `null` 이면 벗는다. **서버는 그 키가 유효한지 모른다** —
 * 칭호 규칙은 봇에 있고, 이 라우트는 봇만 부른다. 길이와 글자만 본다.
 */
exports.setTitle = (req, res) => {
  const id = String((req.body && req.body.id) || '').trim();
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'id 모양이 아닙니다' });

  const raw = req.body && req.body.title;
  const title = raw == null || raw === '' ? null : String(raw).trim();
  if (title !== null && !/^[A-Za-z0-9_-]{1,40}$/.test(title)) {
    return res.status(400).json({ error: '칭호 키 모양이 아닙니다' });
  }

  const data = readOr503(res);
  if (!data) return undefined;

  const acct = load(data, id, dayKey());
  acct.title = title;
  acct.updatedAt = now();
  data.accounts[id] = acct;
  try {
    store.write(data);
  } catch (e) {
    return res.status(503).json({ error: `계정 데이터를 쓰지 못했습니다: ${e.message}` });
  }
  return res.json({ accounts: { [id]: publicView(acct) } });
};

/**
 * POST /api/accounts/claim — `{ id, heal? }`. 사람이 `/출첵` 으로 부른다.
 *
 * 골드와 체력을 **한 번의 쓰기로** 같이 준다. 둘의 도장은 따로라 한쪽만 받을 수도 있다.
 *
 * `heal: false` 면 체력은 건너뛴다(도장도 안 찍는다). 봇이 **던전에 앉아 있는 사람**에게
 * 그렇게 보낸다 — 판이 도는 동안 체력은 판의 장부에 있어서, 여기서 고치면 다음 핸드의
 * 쓰기에 섞여 들어가 "던전 안에서는 회복 못 한다" 는 규칙이 뚫린다.
 */
exports.claim = (req, res) => {
  const id = String((req.body && req.body.id) || '').trim();
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'id 모양이 아닙니다' });
  const wantHeal = !(req.body && req.body.heal === false);

  const data = readOr503(res);
  if (!data) return undefined;

  const today = dayKey();
  const acct = load(data, id, today);
  const out = dailyRule(acct, today);
  const heal = wantHeal ? healRule(acct, today) : { healed: false, reason: 'skipped', hp: acct.hp };

  if (out.refilled || heal.healed) {
    data.accounts[id] = acct;
    try {
      store.write(data);
    } catch (e) {
      return res.status(503).json({ error: `계정 데이터를 쓰지 못했습니다: ${e.message}` });
    }
  }

  // 못 받은 것도 **200 이다.** "오늘 이미 받았다" 와 "아직 넉넉하다" 는 오류가 아니라
  // 답이다. 봇이 사유를 그대로 읽어 다른 말을 하면 된다.
  return res.json({ ...out, heal: { ...heal, amount: DAILY_HEAL, max: MAX_HP }, floor: DAILY_FLOOR, today });
};

module.exports.START_GOLD = START_GOLD;
module.exports.DAILY_FLOOR = DAILY_FLOOR;
module.exports.DAILY_HEAL = DAILY_HEAL;
