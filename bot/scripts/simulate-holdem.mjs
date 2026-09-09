/**
 * simulate-holdem — 디스코드 없이 홀덤을 수만 판 돌린다
 *
 * 이 게임에서 제일 틀리기 쉬운 곳 둘을 잡는 장치다.
 *
 *   1. **칩 총합 보존** — 사이드팟이나 찹에서 칩을 만들거나 없애면 여기서 어긋난다.
 *      팟을 나눌 때 내림으로 버리는 실수가 대표적이다.
 *   2. **베팅 라운드가 안 닫히는 것** — 반복 상한에 걸리면 무한 루프다.
 *
 *   node bot/scripts/simulate-holdem.mjs [핸드 수] [자리 수]
 */
import * as st from '../src/holdem/state.js';
import { potTotal } from '../src/holdem/rules.js';

const hands = Number(process.argv[2] || 20000);
const seatCount = Math.min(Math.max(Number(process.argv[3] || 4), 2), st.MAX_SEATS);

/** 아무렇게나 두는 상대. 규칙이 버티는지 보려는 것이지 실력을 보려는 게 아니다. */
function randomAction(game) {
  const legal = [...st.actionsFor(game)];
  if (!legal.length) return null;
  // 폴드만 계속 고르면 판이 금방 끝나 경로를 못 훑는다. 공격 쪽에 무게를 준다.
  const weight = { fold: 1, check: 4, call: 4, raise: 3, allin: 1 };
  const pool = legal.flatMap((a) => Array(weight[a] ?? 1).fill(a));
  const action = pool[Math.floor(Math.random() * pool.length)];
  if (action !== 'raise') return { action, to: 0 };
  const opts = st.raisesFor(game);
  if (!opts.length) return { action: 'call', to: 0 };
  return { action, to: opts[Math.floor(Math.random() * opts.length)].to };
}

const ids = Array.from({ length: seatCount }, (_, i) => `u${i}`);
const TOTAL = seatCount * st.BUY_IN;

/** 새 판. 누군가 파산해 판이 끝나면 다시 연다 — 그래야 경로를 많이 훑는다. */
function freshGame() {
  st.remove('sim');
  const g = st.create({ channelId: 'sim', homeChannelId: 'sim', guildId: 'g', starterId: 'u0' });
  for (let i = 0; i < seatCount; i += 1) {
    g.seats.push(st.humanSeat({ id: ids[i], username: `P${i}` }, `P${i}`));
  }
  const e = st.start(g, Object.fromEntries(ids.map((id) => [id, st.BUY_IN])));
  if (e) { console.error('시작 실패:', e); process.exit(1); }
  return g;
}

let game = freshGame();
let tables = 1;
let played = 0;
let leaks = 0;
let stuck = 0;
let showdowns = 0;
let chops = 0;
let sidePots = 0;
let allInHands = 0;
const wins = Object.fromEntries(ids.map((id) => [id, 0]));

for (let h = 0; h < hands; h += 1) {
  if (game.phase === 'done') break;

  // beginHand 가 이미 블라인드를 걷었다. committed 를 더해야 이 핸드의 총합이다.
  const before = game.seats.reduce((a, s) => a + s.chips + s.committed, 0);
  let guard = 0;

  while (game.phase !== 'showdown' && game.phase !== 'done') {
    if ((guard += 1) > 400) { stuck += 1; break; }
    const seat = st.currentSeat(game);
    if (!seat) { st.advance(game); continue; }
    const move = randomAction(game);
    if (!move) { st.advance(game); continue; }
    const e = st.act(game, move.action, move.to);
    if (e) { console.error('둘 수 없다:', e, move); process.exit(1); }
  }
  if (game.phase === 'done') continue;
  if (guard > 400) continue;

  // 팟에 들어간 칩 + 남은 스택 = 시작 총합. 정산 전에 한 번 본다.
  const inPot = potTotal(game.seats);
  const onTable = game.seats.reduce((a, s) => a + s.chips, 0);
  if (inPot + onTable !== before) {
    leaks += 1;
    console.error(`핸드 ${h}: 정산 전 총합이 어긋남 — 팟 ${inPot} + 스택 ${onTable} ≠ ${before}`);
  }

  if (game.seats.some((s) => s.allIn)) allInHands += 1;
  st.settle(game);

  const after = game.seats.reduce((a, s) => a + s.chips, 0);
  if (after !== before) {
    leaks += 1;
    console.error(`핸드 ${h}: 정산 후 총합이 ${before} → ${after}`);
  }
  if (after !== TOTAL) {
    leaks += 1;
    console.error(`핸드 ${h}: 판 전체 총합이 ${TOTAL} 이어야 하는데 ${after}`);
  }

  const r = game.results;

  // 팟에 들어간 칩과 나눠 준 칩이 같아야 한다. 총합 검사보다 날카롭다 —
  // 자격자가 없는 층이 생기면 그 층이 통째로 사라지는데 여기서 바로 잡힌다.
  const paidOut = r.rows.reduce((a, x) => a + x.won, 0);
  if (paidOut !== inPot) {
    leaks += 1;
    console.error(`핸드 ${h}: 팟 ${inPot} 인데 ${paidOut} 만 나갔다`);
    console.error('  자리:', game.seats.map((x) => `${x.name} 냄${x.committed}${x.folded ? ' 폴드' : ''}${x.allIn ? ' 올인' : ''}`).join(' · '));
    console.error('  팟:', JSON.stringify(r.pots));
    process.exit(1);
  }

  if (r.pots.length > 1) sidePots += 1;
  if (r.shown.length) {
    showdowns += 1;
    const top = r.rows.filter((x) => x.won > 0);
    if (top.length > 1) chops += 1;
  }
  for (const row of r.rows) if (row.won > 0) wins[row.seat.id] += 1;

  // 팟이 정수인지 — 나눌 때 소수가 생기면 지갑이 깨진다.
  if (r.pots.some((p) => !Number.isInteger(p.amount))) {
    leaks += 1;
    console.error(`핸드 ${h}: 팟이 정수가 아님`, r.pots);
  }

  played += 1;
  if (!st.nextHand(game)) { game = freshGame(); tables += 1; }
}

console.log(`홀덤 시뮬레이션 — ${seatCount}자리 · ${played.toLocaleString()}핸드\n`);
console.table([{
  '판 총합': TOTAL,
  '지금 총합': game.seats.reduce((a, s) => a + s.chips, 0),
  '칩 누수': leaks,
  '무한루프 의심': stuck,
  '쇼다운': showdowns,
  '찹': chops,
  '사이드팟': sidePots,
  '올인 낀 핸드': allInHands,
}]);

console.log('자리별 팟을 가져간 횟수');
for (const s of game.seats) {
  console.log(`  ${s.name.padEnd(4)} ${String(wins[s.id]).padStart(6)}회 · 남은 칩 ${s.chips}`);
}

const ok = leaks === 0 && stuck === 0;
console.log(ok
  ? '\n칩 누수 0건 · 무한루프 0건 — 총합 보존됨'
  : `\n실패 — 누수 ${leaks}건 · 멈춤 ${stuck}건`);

process.exit(ok ? 0 : 1);
