/**
 * check-reads — NPC 가 상대의 수를 값에 반영하는지
 *
 *   node scripts/check-reads.mjs
 *
 * 봇은 상대 손을 읽지 않는다. 대신 **이번 핸드에 상대가 얼마나 세게 나왔는지**로
 * 그 사람 시작패의 문턱을 정하고, 몬테카를로에서 그 문턱을 넘는 패만 배분한다
 * (holdem/ai.js 의 `readRange` · `equity`).
 *
 * 이게 조용히 망가지기 쉽다 — 문턱을 안 넘겨도, 재추첨이 안 돌아도, 승률은 그럴듯한
 * 숫자로 나오기 때문이다. 그래서 **방향과 크기**를 직접 잰다.
 *
 * 몬테카를로라 값이 조금씩 흔들린다. 여유를 두고 보되, 여유보다 큰 차이만 검사한다.
 */
import assert from 'node:assert/strict';
import { equity, chooseAction, readRange, RANGE } from '../src/holdem/ai.js';

const c = (r, s) => ({ rank: r, suit: s });
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 't', 'j', 'q', 'k', 'a'];
const SUITS = ['s', 'h', 'd', 'c'];

let failed = 0;
function check(name, fn) {
  try {
    const note = fn();
    console.log(`  ✓ ${name}${note ? `\n      ${note}` : ''}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${name}\n      ${err.message.split('\n')[0]}`);
  }
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

console.log('\n행동 → 문턱');
check('블라인드·체크만 하면 아무 패나', () => {
  assert.equal(readRange(['BB', 'Check']), RANGE.quiet);
});
check('콜·레이즈·재레이즈가 갈린다', () => {
  assert.equal(readRange(['Call 20']), RANGE.called);
  assert.equal(readRange(['Raise 60', 'Check']), RANGE.raised);
  assert.equal(readRange(['Raise 60', 'Raise 180']), RANGE.pushed);
  assert.ok(RANGE.quiet < RANGE.called && RANGE.called < RANGE.raised && RANGE.raised < RANGE.pushed);
});

console.log('\n승률이 실제로 움직이는가');
const S = { samples: 6000 };
const scale = [RANGE.quiet, RANGE.called, RANGE.raised, RANGE.pushed];

check('큰 카드에 밀리는 손은 크게 떨어진다 (9♠9♦ · A♥K♣4♦)', () => {
  const row = scale.map((m) => equity([c('9', 's'), c('9', 'd')],
    [c('a', 'h'), c('k', 'c'), c('4', 'd')], [m, m], S));
  assert.ok(row[0] - row[3] > 0.15, `무작위 ${pct(row[0])} → 재레이즈 ${pct(row[3])}, 차이가 너무 작다`);
  assert.ok(row[0] > row[1] && row[1] > row[3], `단조적이지 않다: ${row.map(pct).join(' → ')}`);
  return row.map(pct).join('  →  ');
});

check('드로도 떨어진다 (J♠T♠ · 9♥8♣2♦)', () => {
  const row = scale.map((m) => equity([c('j', 's'), c('t', 's')],
    [c('9', 'h'), c('8', 'c'), c('2', 'd')], [m, m], S));
  assert.ok(row[0] - row[3] > 0.04, `차이가 너무 작다: ${row.map(pct).join(' → ')}`);
  return row.map(pct).join('  →  ');
});

// 이건 통과해야 하는 검사이자 **한계를 적어 두는 자리**다. 거르는 것은 시작 두 장의
// 세기뿐이라, 이미 만들어진 센 손은 상대 범위를 좁혀도 값이 거의 안 변한다.
check('이미 센 손은 거의 안 변한다 (A♠K♦ 톱페어) — 이게 이 방식의 한계다', () => {
  const row = scale.map((m) => equity([c('a', 's'), c('k', 'd')],
    [c('k', 'h'), c('7', 'c'), c('2', 'd')], [m, m], S));
  assert.ok(Math.abs(row[0] - row[3]) < 0.05, `예상보다 많이 움직였다: ${row.map(pct).join(' → ')}`);
  return row.map(pct).join('  →  ');
});

console.log('\n판단이 바뀌는가');
check('상대가 세게 나올수록 더 접는다 (무작위 스팟 600개)', () => {
  const deal = (n, dead) => {
    const out = [];
    while (out.length < n) {
      const card = c(RANKS[Math.floor(Math.random() * 13)], SUITS[Math.floor(Math.random() * 4)]);
      const k = card.rank + card.suit;
      if (dead.has(k)) continue;
      dead.add(k);
      out.push(card);
    }
    return out;
  };
  const foldRate = (reads) => {
    let folds = 0;
    for (let i = 0; i < 600; i += 1) {
      const dead = new Set();
      const hole = deal(2, dead);
      const board = deal(3, dead);
      const m = chooseAction('migel', {
        hole,
        board,
        opponents: reads,
        toCall: 60,
        pot: 150,
        legal: new Set(['fold', 'call', 'raise']),
        raises: [{ to: 120 }, { to: 300 }],
        samples: 300,
      });
      if (m.action === 'fold') folds += 1;
    }
    return folds / 600;
  };
  const quiet = foldRate([RANGE.quiet, RANGE.quiet]);
  const loud = foldRate([RANGE.pushed, RANGE.pushed]);
  assert.ok(loud - quiet > 0.08, `폴드율이 거의 안 바뀐다: ${pct(quiet)} → ${pct(loud)}`);
  return `조용한 상대 ${pct(quiet)} → 둘 다 재레이즈 ${pct(loud)}`;
});

console.log('\n비용');
check('여덟 자리에서도 한 판단에 20ms 아래', () => {
  const reads = new Array(7).fill(RANGE.pushed);
  const t0 = Date.now();
  for (let i = 0; i < 20; i += 1) {
    equity([c('a', 's'), c('k', 'd')], [c('q', 'h'), c('7', 'c'), c('2', 'd')], reads, { samples: 400 });
  }
  const each = (Date.now() - t0) / 20;
  assert.ok(each < 20, `한 번에 ${each.toFixed(0)}ms 걸린다`);
  return `한 번에 ${each.toFixed(0)}ms`;
});

console.log(failed ? `\n실패 ${failed}건` : '\n전부 통과');
process.exit(failed ? 1 : 0);
