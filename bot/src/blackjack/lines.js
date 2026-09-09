/**
 * lines — 카지노에서 쓰는 미리 써 둔 대사
 *
 * 요트는 대사를 Gemini 로 만들지만 여기서는 손으로 쓴 목록에서 고른다. 이유가 셋이다.
 * 한 핸드에 대사 자리가 스무 번 넘게 오는데 그때마다 API 를 부르면 한도가 남아나지
 * 않고, 진행 멘트는 "네 차례입니다" 처럼 정형적이라 매번 새로 지을 값어치가 없으며,
 * 무엇보다 **실패하지 않는다** — 판이 도는 중에 대사가 비면 그게 더 이상하다.
 *
 * 대신 반복이 눈에 띈다. 그래서 키마다 **최근에 쓴 줄을 피한다**. 목록이 짧은 키
 * (npc 딜러는 서너 줄이면 충분하다)에서는 피할 수 있는 만큼만 피한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickRandom } from '../pickOfDay.js';
import { ownerFor } from '../owners.js';

const FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'casino-lines.json',
);

const POOL = JSON.parse(fs.readFileSync(FILE, 'utf8')).lines;

console.log(`[카지노] 대사 ${Object.values(POOL).reduce((a, v) => a + v.length, 0)}줄`
  + ` · ${Object.keys(POOL).length}개 상황`);

/** 키 → 최근에 쓴 줄들. 판이 끝나도 남는다 — 연달아 같은 판을 열어도 안 겹치게. */
const recent = new Map();
const KEEP = 3;

/**
 * 그 상황의 대사 한 줄. 없는 키면 null 을 준다 — 대사는 있으면 좋은 것이라
 * 빠진 키 때문에 판이 멈추면 안 된다.
 */
export function line(key, vars = {}) {
  const pool = POOL[key];
  if (!pool?.length) return null;

  // 목록이 짧으면 피할 수 있는 만큼만 피한다. 다 피하면 고를 게 없어진다.
  const keep = Math.min(KEEP, pool.length - 1);
  const seen = recent.get(key) ?? [];
  const fresh = keep > 0 ? pool.filter((t) => !seen.includes(t)) : pool;
  const picked = pickRandom(fresh.length ? fresh : pool);
  recent.set(key, [...seen, picked].slice(-keep));

  return picked.replace(/\{(\w+)\}/g, (whole, name) => (
    vars[name] != null ? String(vars[name]) : whole
  ));
}

/** 말할 순간인지. 자주 오는 자리를 전부 말하게 하면 판이 대사에 묻힌다. */
export const sometimes = (p = 0.38) => Math.random() < p;

/**
 * 미겔이 딜러일 때 베팅에 붙일 반응의 키.
 *
 * 미겔은 아는 사람이면 이름을 부르고(겨울·사백·마티암) 아니면 손님으로 대한다.
 * npc 딜러는 이 구분을 하지 않는다 — 그쪽은 `dealer.npc.bet` 하나로 끝난다.
 */
export function betKey(seat) {
  if (seat.kind === 'npc') return seat.character === 'matiam' ? 'matiam' : 'guest';
  const owner = ownerFor(seat.userId);
  if (owner === 'migel') return 'winter';
  if (owner === 'matiam') return 'sabaek';
  return 'guest';
}

/** 정산 결과 → 딜러가 쓸 키. 자리에서 본 결과라 이름이 플레이어 기준이다. */
export const RESULT_KEY = {
  blackjack: 'playerBlackjack',
  win: 'win',
  push: 'push',
  lose: 'lose',
  bust: 'playerBust',
  surrender: 'surrender',
  dealerBlackjack: 'lose',
};

/** 정산 결과 → 플레이어 NPC 가 쓸 키. */
export const REACT_KEY = {
  blackjack: 'blackjack',
  win: 'win',
  push: 'push',
  lose: 'lose',
  bust: 'bust',
  surrender: 'lose',
  dealerBlackjack: 'lose',
};

export default { line, sometimes, betKey, RESULT_KEY, REACT_KEY };
