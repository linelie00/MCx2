/**
 * accountController — 카지노 계정 (칩 · 칭호 · 아이템)
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
 * account shape: { chips, title, items, refilledAt, updatedAt }
 */
const store = require('../services/accountStore');
const { dayKey } = require('../services/dayKey');

/** 처음 보는 id 의 잔액. 등록 절차가 없다 — 없는 사람은 이 값으로 친다. */
const START_CHIPS = 1000;

/** 일일 규칙: 이 아래면 여기까지 채운다. 더 주지는 않는다. */
const DAILY_FLOOR = 1000;

/**
 * 잔액이 여기 아래로 내려가는 delta 배치는 거절한다.
 *
 * 정상적으로는 **0 아래로 안 내려간다** — 판에 들고 앉는 스택이 이미 잔액 이하라
 * 그보다 더 잃을 수가 없다. 그러니 크게 마이너스로 가는 배치는 **같은 칩을 두 판에서
 * 겹쳐 걸었다**는 뜻이다(봇이 막지만 여기서 한 번 더 본다).
 *
 * **0 으로 깎지는 않는다** — 깎으면 없던 칩이 생기고, 총합 보존으로 버그를 잡는 길이
 * 막힌다. 거절하고 로그에 남기는 편이 낫다.
 */
const MIN_BALANCE = -1000;

/** 한 번에 다룰 수 있는 계정 수. 자리는 넷이지만 넉넉히 둔다. */
const MAX_IDS = 16;

/** 디스코드 유저 id, 또는 NPC. 이 밖의 문자열은 장부에 들이지 않는다. */
const ID_RE = /^(?:\d{5,25}|npc:(?:migel|matiam))$/;

const now = () => new Date().toISOString();
const isNpc = (id) => id.startsWith('npc:');

const blank = () => ({
  chips: START_CHIPS, title: null, items: {}, refilledAt: null, updatedAt: null,
});

/** 저장된 계정을 빠진 필드까지 채워서 준다. 뒤에 필드가 늘어도 옛 기록이 안 깨진다. */
const normalize = (raw) => ({ ...blank(), ...(raw || {}) });

/** 밖으로 내보내는 모양. 내부 필드가 늘어도 응답이 저절로 새지 않게 골라 담는다. */
const publicView = (acct) => ({
  chips: acct.chips,
  title: acct.title,
  items: acct.items,
  refilledAt: acct.refilledAt,
});

/**
 * 하루 한 번, 1000 미만이면 1000으로.
 *
 * 사람(`/출첵`)과 NPC(판을 열 때 자동)가 **같은 규칙**을 쓰므로 여기 한 곳에만 둔다.
 *
 * `refilledAt` 은 **실제로 채웠을 때만** 찍는다. 1200 가진 사람이 출첵하면 도장을
 * 안 찍으므로, 그날 파산한 뒤에 받을 수 있다. "하루 한 번 시도" 가 아니라
 * "하루 한 번, 진짜로 모자랐을 때" 다.
 */
function dailyRule(acct, today) {
  if (acct.refilledAt === today) return { refilled: false, reason: 'claimed', chips: acct.chips };
  if (acct.chips >= DAILY_FLOOR) return { refilled: false, reason: 'enough', chips: acct.chips };

  const before = acct.chips;
  acct.chips = DAILY_FLOOR;
  acct.refilledAt = today;
  acct.updatedAt = now();
  return { refilled: true, before, chips: acct.chips };
}

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

  const accounts = {};
  for (const id of ids) accounts[id] = publicView(normalize(data.accounts[id]));
  return res.json({ accounts, today: dayKey() });
};

// ---------------------------------------------------------------- 판 열기

/**
 * POST /api/accounts/open — `{ ids }`
 *
 * 판을 열 때 봇이 부른다. **due 한 NPC 만** 일일 규칙을 적용하고 전원 잔액을 준다.
 * 사람은 여기서 안 채운다 — 사람은 `/출첵` 으로 직접 받는다.
 */
exports.open = (req, res) => {
  const ids = parseIds(req.body && req.body.ids);
  if (typeof ids === 'string') return res.status(400).json({ error: ids });

  const data = readOr503(res);
  if (!data) return undefined;

  const today = dayKey();
  const refilled = [];
  for (const id of ids) {
    if (!isNpc(id)) continue;
    const acct = normalize(data.accounts[id]);
    const out = dailyRule(acct, today);
    data.accounts[id] = acct;
    if (out.refilled) refilled.push({ id, before: out.before, chips: out.chips });
  }

  // 채운 게 없으면 굳이 쓰지 않는다. 판을 열 때마다 파일을 건드릴 이유가 없다.
  if (refilled.length) {
    try {
      store.write(data);
    } catch (e) {
      return res.status(503).json({ error: `계정 데이터를 쓰지 못했습니다: ${e.message}` });
    }
  }

  const accounts = {};
  for (const id of ids) accounts[id] = publicView(normalize(data.accounts[id]));
  return res.json({ accounts, refilled, today });
};

// ---------------------------------------------------------------- 정산

/** POST /api/accounts/deltas — `{ deltas: { id: ±n } }` */
exports.applyDeltas = (req, res) => {
  const deltas = req.body && req.body.deltas;
  if (!deltas || typeof deltas !== 'object' || Array.isArray(deltas)) {
    return res.status(400).json({ error: 'deltas 객체가 필요합니다' });
  }

  const ids = parseIds(Object.keys(deltas));
  if (typeof ids === 'string') return res.status(400).json({ error: ids });

  for (const id of ids) {
    const n = deltas[id];
    // 소수가 들어오면 지갑이 영영 소수를 안고 간다. 여기서 막는다.
    if (!Number.isSafeInteger(n)) return res.status(400).json({ error: `정수가 아닙니다: ${id}=${n}` });
  }

  const data = readOr503(res);
  if (!data) return undefined;

  // 먼저 전부 계산해 보고, 하나라도 선을 넘으면 **아무것도 안 쓴다.**
  const next = {};
  for (const id of ids) {
    const acct = normalize(data.accounts[id]);
    const after = acct.chips + deltas[id];
    if (after < MIN_BALANCE) {
      return res.status(409).json({
        error: `잔액이 너무 내려갑니다: ${id} ${acct.chips} → ${after}`
          + ' (같은 칩을 두 판에서 겹쳐 걸었을 수 있습니다)',
      });
    }
    next[id] = { ...acct, chips: after, updatedAt: now() };
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

/** POST /api/accounts/claim — `{ id }`. 사람이 `/출첵` 으로 부른다. */
exports.claim = (req, res) => {
  const id = String((req.body && req.body.id) || '').trim();
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'id 모양이 아닙니다' });

  const data = readOr503(res);
  if (!data) return undefined;

  const today = dayKey();
  const acct = normalize(data.accounts[id]);
  const out = dailyRule(acct, today);

  if (out.refilled) {
    data.accounts[id] = acct;
    try {
      store.write(data);
    } catch (e) {
      return res.status(503).json({ error: `계정 데이터를 쓰지 못했습니다: ${e.message}` });
    }
  }

  // 못 받은 것도 **200 이다.** "오늘 이미 받았다" 와 "아직 넉넉하다" 는 오류가 아니라
  // 답이다. 봇이 사유를 그대로 읽어 다른 말을 하면 된다.
  return res.json({ ...out, floor: DAILY_FLOOR, today });
};

module.exports.START_CHIPS = START_CHIPS;
module.exports.DAILY_FLOOR = DAILY_FLOOR;
