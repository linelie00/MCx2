/**
 * state — 진행 중인 요트 판
 *
 * 채널당 한 판만 둔다. 그러면 상태 키가 채널 하나로 끝나고, 판 메시지도 하나뿐이며,
 * 청소도 단순해진다. 둘이 노는 서버에서 한 채널에 두 판을 돌릴 이유가 없다.
 *
 * 전부 메모리에만 있다. 봇이 재시작되면 판이 사라진다 — gemini.js 의 대화 세션과 같은
 * 방침이다. 서버의 JSON 스토어는 락이 없어서 다른 프로세스가 같이 쓰면 안 된다.
 *
 * 이 파일도 디스코드 API 를 부르지 않는다. Message 객체를 들고만 있고, 그리는 건
 * commands/yacht.js 가 한다.
 */
import { randomBytes } from 'node:crypto';
import { newSheet, commit, totals, isComplete, categoryOf, CATEGORY_KEYS } from './rules.js';
import { OWNER_META, ownerFor } from '../owners.js';
import { THEME_COLOR } from '../embeds.js';

export const MAX_SEATS = 4;
export const MAX_ROLLS = 3;
/** 아무도 안 누르고 이만큼 지나면 판을 접는다. */
export const IDLE_MS = 10 * 60 * 1000;

const games = new Map();   // channelId → game

const serial = () => randomBytes(3).toString('hex');

/** 사람 자리. 오너면 사이트와 같은 이름(겨울/사백)과 색을 쓴다. */
export function humanSeat(user, displayName) {
  const owner = ownerFor(user.id);
  const meta = owner ? OWNER_META[owner] : null;
  return {
    kind: 'human',
    userId: user.id,
    character: null,
    name: meta ? meta.label : (displayName || user.globalName || user.username),
    color: meta ? meta.color : THEME_COLOR,
    sheet: newSheet(),
  };
}

/** NPC 자리. 이쪽은 캐릭터 이름(미겔/마티암)을 쓴다. */
export function npcSeat(character) {
  const meta = OWNER_META[character];
  if (!meta) throw new Error(`모르는 캐릭터: ${character}`);
  return {
    kind: 'npc',
    userId: null,
    character,
    name: meta.character,
    color: meta.color,
    sheet: newSheet(),
  };
}

export function create({ channelId, guildId, starterId }) {
  const game = {
    serial: serial(),
    rev: 0,
    channelId,
    guildId,
    starterId,
    message: null,          // 판 메시지. 항상 이걸로 edit 한다(인터랙션 토큰은 15분이면 죽는다)
    phase: 'lobby',
    seats: [],
    turn: 0,
    round: 1,
    dice: null,             // null 이면 이번 턴을 아직 안 굴렸다는 뜻
    held: [false, false, false, false, false],
    rollsLeft: MAX_ROLLS,
    trail: [],              // 이번 턴에 굴린 기록. NPC 턴을 한 번에 보여줄 때 쓴다
    lastMove: null,         // 직전에 누가 어디에 몇 점을 적었는지. NPC 턴이 눈에 보이게 한다
    said: { migel: [], matiam: [] },   // NPC 가 이 판에서 한 말. 같은 말 반복을 막는 데만 쓴다
    lastAt: Date.now(),
    driving: false,         // NPC 턴 드라이버가 돌고 있는지
    endedReason: null,
  };
  games.set(channelId, game);
  return game;
}

export const get = (channelId) => games.get(channelId) || null;
export const remove = (channelId) => games.delete(channelId);

/** 상태가 바뀔 때마다 부른다. 버튼의 rev 와 비교해 지나간 클릭을 걸러내는 근거가 된다. */
export function touch(game) {
  game.rev += 1;
  game.lastAt = Date.now();
  return game;
}

export const current = (game) => game.seats[game.turn] || null;
export const seatOf = (game, userId) => game.seats.find((s) => s.userId === userId) || null;
export const hasNpc = (game, character) =>
  game.seats.some((s) => s.kind === 'npc' && s.character === character);

/** 자리를 하나 앉힌다. 꽉 찼으면 안 되는 이유를 돌려준다. */
export function addSeat(game, seat) {
  if (game.phase !== 'lobby') return '이미 시작한 판이에요.';
  if (game.seats.length >= MAX_SEATS) return `자리가 다 찼어요. (최대 ${MAX_SEATS}자리)`;
  if (seat.kind === 'human' && seatOf(game, seat.userId)) return '이미 앉아 있어요.';
  if (seat.kind === 'npc' && hasNpc(game, seat.character)) return `${seat.name}은(는) 이미 앉아 있어요.`;
  game.seats.push(seat);
  touch(game);
  return null;
}

export function start(game) {
  if (game.seats.length < 2) return '두 자리 이상이어야 시작할 수 있어요.';
  game.phase = 'playing';
  game.turn = 0;
  game.round = 1;
  beginTurn(game);
  return null;
}

/**
 * 새 턴. 주사위와 고정을 반드시 비운다 — 안 비우면 앞 사람 고정이 남아 아주 헷갈린다.
 * lastMove 는 일부러 남긴다. NPC 가 순식간에 두고 지나가면 뭘 했는지 알 수가 없다.
 */
export function beginTurn(game) {
  game.dice = null;
  game.held = [false, false, false, false, false];
  game.rollsLeft = MAX_ROLLS;
  game.trail = [];
  touch(game);
}

/**
 * 다음 자리로. 한 바퀴 돌면 라운드가 오른다.
 * 모두 12칸을 채웠으면 판을 끝낸다.
 */
export function advance(game) {
  game.turn += 1;
  if (game.turn >= game.seats.length) {
    game.turn = 0;
    game.round += 1;
  }
  if (game.seats.every((s) => isComplete(s.sheet))) {
    game.phase = 'done';
    game.endedReason = 'finished';
    touch(game);
    return;
  }
  beginTurn(game);
}

/** 지금 자리의 점수표에 적고 다음 자리로 넘긴다. */
export function commitTo(game, key) {
  const seat = current(game);
  const { sheet, gained } = commit(seat.sheet, key, game.dice);
  seat.sheet = sheet;
  game.lastMove = {
    name: seat.name,
    dice: [...game.dice],
    label: categoryOf(key).short,
    gained,
  };
  advance(game);
  return gained;
}

/** 순위. 동점이면 같은 등수로 묶는다. */
export function ranking(game) {
  const rows = game.seats
    .map((seat) => ({ seat, total: totals(seat.sheet).total }))
    .sort((a, b) => b.total - a.total);
  let rank = 0;
  let prev = null;
  return rows.map((row, i) => {
    if (row.total !== prev) { rank = i + 1; prev = row.total; }
    return { ...row, rank };
  });
}

export function end(game, reason) {
  game.phase = 'done';
  game.endedReason = reason;
  touch(game);
}

/**
 * 오래 방치된 판을 골라 낸다. 실제로 메시지를 고치는 것은 부르는 쪽이 한다 —
 * 이 파일은 디스코드를 모른다.
 */
export function expired(now = Date.now()) {
  const out = [];
  for (const game of games.values()) {
    if (game.phase === 'done') {
      // 끝난 판은 조금 더 두었다가 지운다. 바로 지우면 마지막 버튼 클릭이 미아가 된다.
      if (now - game.lastAt > IDLE_MS) games.delete(game.channelId);
      continue;
    }
    if (now - game.lastAt > IDLE_MS && !game.driving) {
      end(game, 'idle');
      out.push(game);
    }
  }
  return out;
}

export const filledCount = (sheet) => CATEGORY_KEYS.filter((k) => sheet[k] !== null).length;

export default {
  MAX_SEATS, MAX_ROLLS, IDLE_MS,
  create, get, remove, touch, current, seatOf, hasNpc, humanSeat, npcSeat,
  addSeat, start, beginTurn, advance, commitTo, ranking, end, expired, filledCount,
};
