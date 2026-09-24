/**
 * daily/angler — 미겔·마티암이 버튼 없이 낚시를 한다 (`/일상`)
 *
 * `/요트 낚시` 와 **같은 판**(`yacht/fishing.js`)을 같은 규칙으로 둔다. 사람이 버튼으로 하던
 * 두 가지 — 무엇을 남기고 다시 굴릴지, 어느 칸에 적을지 — 를 여기서 대신 고른다.
 *
 * **사람처럼 기척을 읽는다.** 빗나가면 거리만 온다 — 가깝다(1) · 조금 멀다(2) · 아무 기척 없음(3 이상).
 * 그 거리와 맞지 않는 줄을 후보에서 지우고, 남은 후보 가운데 **이 눈으로 만들 수 있을 법한
 * 칸**을 노린다. 적을 때는 후보 칸이 먼저고, 그중에서도 빗나갔을 때 후보가 가장 잘 갈리는 칸이다.
 * 전설 판은 자리를 이미 알려 준다 — 그 칸만 노린다.
 *
 * 숨은 것(`round.hidden`)은 **판정에만** 쓴다. 고르는 쪽은 사람이 보는 것(기척·자기 눈)만 본다.
 *
 * 순수 함수다 — 주사위는 `die`(1~6) 를 받아 굴린다. 실제 판은 요트와 같은 굴림을 쓴다.
 */
import {
  rollDice, reroll, scoreFor, categoryOf, openCategories, UPPER_KEYS, MAX_ROLLS,
} from '../yacht/rules.js';
import { canWrite, writable, writeTo, skipTurn, bonusLegend } from '../yacht/fishing.js';
import { COMMON_ROWS, distance } from '../casino/fish.js';

/** 노릴 칸마다 앞으로의 굴림을 몇 번씩 그려 볼지. 한 기회에 많아야 11칸 × 2번이다. */
const TRIALS = 60;

/** 시뮬레이션용 주사위. 한 번 고르는 데 천 번 넘게 굴리니 암호학적 난수를 쓸 까닭이 없다. */
const fastDie = () => 1 + Math.floor(Math.random() * 6);

/** 기척의 갈래. 사람이 받는 것도 이 셋뿐이다(`fishing.hintFor`). */
const bucket = (gap) => Math.min(gap, 3);

/** 판을 열 때의 후보 — 전설이면 그 자리 하나, 아니면 일반이 숨을 수 있는 줄 전부. */
export const candidatesOf = (round) => (round.hidden.legend ? [round.hidden.row] : [...COMMON_ROWS]);

/** 빗나간 기척으로 후보를 좁힌다. 적은 칸 자체는 당연히 빠진다(거리 0 은 어느 갈래에도 없다). */
export const narrow = (cands, key, gap) => cands.filter((r) => r !== key && bucket(distance(key, r)) === bucket(gap));

const countOf = (dice) => {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d] += 1;
  return c;
};

/** 가장 많은 눈(같으면 큰 눈). */
function mostFace(dice, exclude = 0) {
  const c = countOf(dice);
  let best = 0;
  for (let f = 6; f >= 1; f -= 1) if (f !== exclude && c[f] > (best ? c[best] : 0)) best = f;
  return best || (exclude === 6 ? 5 : 6);
}

/** 연속 칸 가운데 지금 눈이 가장 많이 들어간 창. 그 창의 눈만 하나씩 남긴다. */
function runHold(dice, length) {
  let bestFaces = null;
  let bestHit = -1;
  for (let lo = 1; lo + length - 1 <= 6; lo += 1) {
    const want = Array.from({ length }, (_, i) => lo + i);
    const hit = want.filter((f) => dice.includes(f)).length;
    if (hit > bestHit) { bestHit = hit; bestFaces = want; }
  }
  const taken = new Set();
  return dice.map((d) => {
    if (!bestFaces.includes(d) || taken.has(d)) return false;
    taken.add(d);
    return true;
  });
}

/**
 * 그 칸을 노릴 때 무엇을 남길지. `true` 인 자리를 남긴다.
 * 소계 전설(`bonus`)이면 그 판에서 노리는 눈(`face`)을 따로 받는다.
 */
export function holdFor(target, dice, face = 0) {
  const cat = categoryOf(target);
  if (target === 'bonus' || cat?.section === 'upper') {
    const f = cat?.face ?? face;
    return dice.map((d) => d === f);
  }
  if (target === 'choice') return dice.map((d) => d >= 4);
  if (target === 'fourKind' || target === 'yacht') {
    const f = mostFace(dice);
    return dice.map((d) => d === f);
  }
  if (target === 'fullHouse') {
    const a = mostFace(dice);
    const b = mostFace(dice, a);
    let na = 0;
    let nb = 0;
    return dice.map((d) => {
      if (d === a && na < 3) { na += 1; return true; }
      if (d === b && nb < 2) { nb += 1; return true; }
      return false;
    });
  }
  if (target === 'sStraight') return runHold(dice, 4);
  if (target === 'lStraight') return runHold(dice, 5);
  return dice.map(() => false);
}

/** 앞으로 `rollsLeft` 번 더 굴려 그 칸을 적을 수 있게 될 확률(어림). */
function chance(round, target, dice, rollsLeft) {
  let hit = 0;
  for (let t = 0; t < TRIALS; t += 1) {
    let d = dice;
    for (let r = 0; r < rollsLeft && !canWrite(round.sheet, target, d, round.hidden); r += 1) {
      d = reroll(d, holdFor(target, d), fastDie);
    }
    if (canWrite(round.sheet, target, d, round.hidden)) hit += 1;
  }
  return hit / TRIALS;
}

/** 소계 전설 판에서 이번 기회에 모을 눈 — 남은 윗칸 가운데 (개수 × 눈) 이 가장 큰 것. */
function bonusFace(round, dice) {
  const c = countOf(dice);
  const open = UPPER_KEYS.filter((k) => round.sheet[k] === null).map((k) => categoryOf(k).face);
  if (!open.length) return 0;
  return open.reduce((best, f) => (c[f] * f + f / 10 > c[best] * best + best / 10 ? f : best), open[0]);
}

/**
 * 이번 굴림에서 노릴 칸. 후보 가운데 **만들 수 있을 법한** 것 — 남은 굴림으로 그 칸을 적을 수 있게
 * 될 확률이 가장 큰 칸이다. 전설 판은 자리가 정해져 있다.
 */
export function aim(round, cands, dice, rollsLeft) {
  if (round.hidden.legend) return round.hidden.row;
  const open = new Set(openCategories(round.sheet));
  const pool = cands.filter((r) => open.has(r));
  if (!pool.length) return null;
  let best = null;
  let bestP = -1;
  for (const r of pool) {
    const p = chance(round, r, dice, rollsLeft);
    if (p > bestP) { best = r; bestP = p; }
  }
  return best;
}

/** 적었는데 빗나가면 후보가 얼마나 남을지(기댓값). 작을수록 잘 가르는 칸이다. */
function expectedLeft(key, cands) {
  const groups = new Map();
  for (const r of cands) {
    if (r === key) continue;
    const b = bucket(distance(key, r));
    groups.set(b, (groups.get(b) ?? 0) + 1);
  }
  const n = cands.length || 1;
  return [...groups.values()].reduce((a, g) => a + g * g, 0) / n;
}

/**
 * 어느 칸에 적을지. 적을 수 있는 칸이 없으면 null(그 기회는 흘려보낸다).
 *
 *   전설(요트)  요트 칸이 되면 그것. 아니면 **가장 덜 아까운** 칸에 적는다 — 적을 수 있는 칸이
 *               있으면 넘길 수 없다는 규칙은 사람과 같다
 *   전설(소계)  윗칸 가운데 점수가 가장 큰 칸. 윗칸이 안 되면 아래 칸 아무 데나
 *   일반        후보 칸이 먼저, 그중 빗나가도 후보가 가장 잘 갈리는 칸. 후보 칸이 없으면
 *               기척이라도 얻게 **후보를 가장 잘 가르는** 칸에 적는다
 */
export function pickWrite(round, cands, rand = Math.random) {
  const open = writable(round.sheet, round.dice, round.hidden);
  if (!open.length) return null;
  const { hidden, dice } = round;
  if (hidden.legend) {
    if (open.includes(hidden.row)) return hidden.row;
    if (bonusLegend(hidden)) {
      const ups = open.filter((k) => UPPER_KEYS.includes(k));
      if (ups.length) return ups.reduce((a, b) => (scoreFor(b, dice) > scoreFor(a, dice) ? b : a));
    }
    return open.reduce((a, b) => (scoreFor(b, dice) < scoreFor(a, dice) ? b : a));
  }
  const inCands = open.filter((k) => cands.includes(k));
  const pool = inCands.length ? inCands : open;
  const scored = pool.map((k) => [k, expectedLeft(k, cands)]);
  const min = Math.min(...scored.map(([, v]) => v));
  const best = scored.filter(([, v]) => v === min).map(([k]) => k);
  return best[Math.floor(rand() * best.length)];
}

/**
 * 한 기회를 둔다 — 굴리고, 남기고, 다시 굴리고, 적는다. 판이 그만큼 나아간다.
 * `{ key, dice, caught?, hint?, gap? }` — key 가 null 이면 적을 칸이 없어 흘려보냈다.
 *
 * `die` 는 주사위 한 개(1~6). 기본은 요트와 같은 굴림(`rules.rollDice`)이다.
 */
export function takeTurn(round, cands, { die, rand = Math.random } = {}) {
  round.dice = die ? rollDice(5, die) : rollDice();
  round.held = [false, false, false, false, false];
  round.rollsLeft = MAX_ROLLS - 1;
  for (; round.rollsLeft > 0; round.rollsLeft -= 1) {
    const target = aim(round, cands, round.dice, round.rollsLeft);
    if (!target) break;
    const face = target === 'bonus' ? bonusFace(round, round.dice) : 0;
    // 그 칸이 이미 되면 멈춘다. 소계 전설은 **많을수록 좋아서** 다섯이 다 모일 때까지 굴린다.
    if (target !== 'bonus' && canWrite(round.sheet, target, round.dice, round.hidden)) break;
    const held = holdFor(target, round.dice, face);
    if (held.every(Boolean)) break;
    round.held = held;
    round.dice = die ? reroll(round.dice, held, die) : reroll(round.dice, held);
  }

  const dice = [...round.dice];
  const key = pickWrite(round, cands, rand);
  if (!key) return { key: null, dice, ...skipTurn(round) };
  return { key, dice, ...writeTo(round, key, rand) };
}

export default { candidatesOf, narrow, holdFor, aim, pickWrite, takeTurn };
