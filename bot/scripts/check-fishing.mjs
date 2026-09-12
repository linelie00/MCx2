/**
 * check-fishing — 낚시 규칙. 서버도 디스코드도 없이 판만 돌린다.
 *
 *   node scripts/check-fishing.mjs
 *
 * 잡으려는 것은 넷.
 *
 *   1. **0점을 버려 칸을 떠보는 길** — `writable` 이 한 칸이라도 새면 낚시가 그냥 훑기가 된다
 *   2. **힌트가 위아래를 흘리는 것** — 같은 거리면 위든 아래든 **같은 갈래**여야 한다
 *   3. 전설 규칙 — 보너스는 소계 63, 요트는 같은 눈 다섯. 일반은 그 두 칸에 안 숨는다
 *   4. 기회 셈 — 여섯 번이면 끝, 낚으면 그 자리에서 끝
 */
import assert from 'node:assert/strict';
import * as fishing from '../src/yacht/fishing.js';
import {
  ROWS, COMMON_ROWS, BONUS_ROW, distance, hide, lengthOf, CATCHES, BY_KEY, LEGENDS, FISH, JUNK,
  itemOf, isFish, isLegend, LEGEND_CHANCE,
} from '../src/casino/fish.js';
import { newSheet, scoreFor, CATEGORY_KEYS, BONUS_NEED } from '../src/yacht/rules.js';

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); } catch (err) { failed += 1; console.log(`  ✗ ${name}\n    ${err.message}`); }
}

const round = (over = {}) => {
  const r = fishing.create({
    channelId: `c${Math.random()}`, homeChannelId: 'c', guildId: 'g', userId: '1', name: '사백', color: 0,
  });
  Object.assign(r, over);
  return r;
};
const drop = (r) => fishing.remove(r.channelId);

console.log('\n물속의 줄');
check('열세 줄, 보너스는 일곱째', () => {
  assert.equal(ROWS.length, 13);
  assert.equal(ROWS[6], BONUS_ROW);
  assert.deepEqual(ROWS.filter((r) => r !== BONUS_ROW), CATEGORY_KEYS);
});
check('일반은 보너스·요트에 안 숨는다', () => {
  assert.equal(COMMON_ROWS.length, 11);
  assert.ok(!COMMON_ROWS.includes(BONUS_ROW) && !COMMON_ROWS.includes('yacht'));
  for (let i = 0; i < 5000; i += 1) {
    const h = hide();
    if (h.legend) assert.ok([BONUS_ROW, 'yacht'].includes(h.row), `전설이 ${h.row} 에 있다`);
    else assert.ok(COMMON_ROWS.includes(h.row), `일반이 ${h.row} 에 있다`);
  }
});
check('전설이 뜨는 비율이 정한 값 근처', () => {
  let n = 0;
  for (let i = 0; i < 20000; i += 1) if (hide().legend) n += 1;
  const rate = n / 20000;
  assert.ok(Math.abs(rate - LEGEND_CHANCE) < 0.01, `${(rate * 100).toFixed(1)}% 가 나왔다`);
});
check('낚이는 것은 전부 명부에 있다', () => {
  for (const c of CATCHES) assert.ok(itemOf(c.key), `${c.key} 가 명부에 없다`);
  assert.equal(new Set(CATCHES.map((c) => c.key)).size, CATCHES.length, '같은 키가 두 번 있다');
  for (const c of CATCHES) {
    assert.ok(c.cm[0] >= 1 && c.cm[0] <= c.cm[1], `${c.key} 의 길이 범위가 이상하다`);
  }
});
check('전설은 던전에서 안 나온다', () => {
  for (const l of LEGENDS) assert.equal(itemOf(l.key).loot, false, `${l.key} 가 전리품 풀에 있다`);
});
check('길이는 범위 안', () => {
  for (const key of ['starRay', 'minnow', 'lordOfWater', 'twig']) {
    for (let i = 0; i < 3000; i += 1) {
      const cm = lengthOf(key);
      const [lo, hi] = BY_KEY[key].cm;
      assert.ok(cm >= lo && cm <= hi, `${key} 가 ${cm}cm 로 나왔다`);
    }
  }
});
check('도감이 세는 갈래', () => {
  assert.ok(isFish('minnow') && !isFish('twig') && !isFish('lordOfWater'));
  assert.ok(isLegend('lordOfWater') && !isLegend('minnow'));
  assert.equal(FISH.length + JUNK.length + LEGENDS.length, CATCHES.length);
});

console.log('\n적을 수 있는 칸');
check('위칸은 같은 눈 셋부터', () => {
  const s = newSheet();
  assert.deepEqual(fishing.writable(s, [1, 1, 1, 4, 5]), ['aces']);
  assert.deepEqual(fishing.writable(s, [1, 1, 4, 4, 5]), []);
  assert.ok(fishing.canWrite(s, 'sixes', [6, 6, 6, 6, 1]));
});
check('초이스는 합 21 부터', () => {
  const s = newSheet();
  assert.ok(fishing.canWrite(s, 'choice', [6, 6, 6, 2, 1]));
  assert.ok(!fishing.canWrite(s, 'choice', [6, 6, 5, 2, 1]));
});
check('나머지는 0점이면 못 쓴다', () => {
  const s = newSheet();
  for (const key of ['fourKind', 'fullHouse', 'sStraight', 'lStraight', 'yacht']) {
    assert.equal(fishing.canWrite(s, key, [1, 2, 4, 6, 6]), scoreFor(key, [1, 2, 4, 6, 6]) > 0, key);
  }
  assert.ok(fishing.canWrite(s, 'yacht', [3, 3, 3, 3, 3]));
  assert.ok(!fishing.canWrite(s, 'yacht', [3, 3, 3, 3, 2]));
});
check('아무 눈으로도 0점 칸은 안 열린다', () => {
  const s = newSheet();
  for (let i = 0; i < 10000; i += 1) {
    const dice = Array.from({ length: 5 }, () => 1 + Math.floor(Math.random() * 6));
    for (const key of fishing.writable(s, dice)) {
      assert.ok(scoreFor(key, dice) > 0, `${key} 가 0점인데 열렸다: ${dice}`);
    }
  }
});
check('보너스는 적는 칸이 아니다', () => {
  const s = newSheet();
  assert.ok(!fishing.canWrite(s, BONUS_ROW, [6, 6, 6, 6, 6]));
  assert.ok(!fishing.writable(s, [6, 6, 6, 6, 6]).includes(BONUS_ROW));
});
check('이미 적은 칸은 다시 못 쓴다', () => {
  const s = { ...newSheet(), aces: 3 };
  assert.ok(!fishing.canWrite(s, 'aces', [1, 1, 1, 2, 3]));
});

console.log('\n기척');
check('같은 거리면 위아래가 같은 갈래', () => {
  // **이 검사가 "방향을 안 흘린다" 의 증거다.** 열세 줄의 모든 짝을 뒤집어 본다.
  const tier = (gap) => (gap === 1 ? 'near' : gap === 2 ? 'faint' : 'far');
  for (const a of ROWS) {
    for (const b of ROWS) {
      assert.equal(tier(distance(a, b)), tier(distance(b, a)), `${a} ↔ ${b}`);
    }
  }
});
check('지문에 위·아래가 안 들어간다', () => {
  const all = [...fishing.NEAR, ...fishing.FAINT, ...fishing.NOTHING, ...fishing.LEGEND_MISS, fishing.NO_ROOM];
  for (const line of all) {
    assert.ok(!/위|아래|↑|↓|above|below/.test(line), `방향이 새는 지문: ${line}`);
  }
});
check('거리마다 다른 통에서 뽑는다', () => {
  const rand = () => 0;
  assert.ok(fishing.NEAR.includes(fishing.hintFor(1, { rand })));
  assert.ok(fishing.FAINT.includes(fishing.hintFor(2, { rand })));
  for (const gap of [3, 4, 5, 12]) assert.ok(fishing.NOTHING.includes(fishing.hintFor(gap, { rand })));
  assert.ok(fishing.LEGEND_MISS.includes(fishing.hintFor(1, { legend: true, rand })));
});

console.log('\n판');
check('여섯 번 빗나가면 끝난다', () => {
  const r = round({ hidden: { key: 'minnow', row: 'yacht', legend: false } });
  for (let i = 0; i < 6; i += 1) {
    assert.equal(r.phase, 'fishing', `${i + 1}번째에 이미 끝났다`);
    r.dice = [1, 1, 1, 2, 3];
    r.sheet = { ...newSheet(), ...r.sheet };
    const key = fishing.writable(r.sheet, r.dice)[0] ?? null;
    if (key) fishing.writeTo(r, key); else fishing.skipTurn(r);
  }
  assert.equal(r.phase, 'done');
  assert.equal(r.endedReason, 'out');
  assert.equal(r.caught, null);
  drop(r);
});
check('맞히면 그 자리에서 끝난다', () => {
  const r = round({ hidden: { key: 'catfish', row: 'aces', legend: false } });
  r.dice = [1, 1, 1, 4, 5];
  const out = fishing.writeTo(r, 'aces');
  assert.ok(out.caught, '안 잡혔다');
  assert.equal(out.caught.key, 'catfish');
  assert.ok(out.caught.cm >= 20 && out.caught.cm <= 60);
  assert.equal(r.phase, 'done');
  assert.equal(r.endedReason, 'caught');
  assert.equal(r.triesLeft, 6, '기회가 줄었다');
  assert.equal(r.firstTry, true, '첫 기회에 잡은 것을 안 적었다');
  drop(r);
});
check('전설 — 보너스는 소계 63 에서 낚인다', () => {
  const r = round({ hidden: { key: 'lordOfWater', row: BONUS_ROW, legend: true } });
  // 6·5·4 를 셋씩: 18 + 15 + 12 = 45 — 아직이다
  for (const [key, dice] of [['sixes', [6, 6, 6, 1, 2]], ['fives', [5, 5, 5, 1, 2]], ['fours', [4, 4, 4, 1, 2]]]) {
    r.dice = dice;
    const out = fishing.writeTo(r, key);
    assert.ok(!out.caught, `${key} 에서 벌써 잡혔다`);
  }
  // 3·2·1 을 셋씩 더하면 9 + 6 + 3 = 18, 합계 63
  r.dice = [3, 3, 3, 1, 2]; fishing.writeTo(r, 'threes');
  r.dice = [2, 2, 2, 1, 3]; fishing.writeTo(r, 'deuces');
  r.dice = [1, 1, 1, 2, 3];
  const last = fishing.writeTo(r, 'aces');
  assert.ok(last.caught, '소계 63 인데 안 잡혔다');
  assert.equal(last.caught.key, 'lordOfWater');
  drop(r);
});
check('전설 — 요트는 같은 눈 다섯이어야 한다', () => {
  const r = round({ hidden: { key: 'goldChipShark', row: 'yacht', legend: true } });
  r.dice = [3, 3, 3, 3, 2];
  assert.equal(fishing.writeTo(r, 'yacht'), null, '요트가 아닌데 적혔다');
  r.dice = [3, 3, 3, 3, 3];
  const out = fishing.writeTo(r, 'yacht');
  assert.ok(out.caught && out.caught.key === 'goldChipShark');
  drop(r);
});
check('여섯 기회면 소계 63 이 닿는다', () => {
  // 기회가 다섯이면 3×(2+3+4+5+6)=60 이라 구조적으로 막혔다. 여섯이면 1~6 을 셋씩 채워 63.
  assert.equal(fishing.TRIES, 6);
  assert.equal([1, 2, 3, 4, 5, 6].reduce((a, n) => a + n * 3, 0), BONUS_NEED);
});
check('숨은 것은 화면에 낼 수 있는 어떤 값에도 안 들어간다', () => {
  const r = round({ hidden: { key: 'starRay', row: 'fullHouse', legend: false } });
  r.dice = [1, 1, 1, 2, 3];
  fishing.writeTo(r, 'aces');
  const shown = JSON.stringify({ log: r.log, trail: r.trail, turn: r.turn, triesLeft: r.triesLeft });
  assert.ok(!shown.includes('starRay') && !shown.includes(itemOf('starRay').name), shown);
  // 점수표는 숨은 줄과 상관없이 **모양이 같다** — 칸 이름은 열세 줄 모두에 늘 있다.
  const other = round({ hidden: { key: 'minnow', row: 'aces', legend: false } });
  assert.deepEqual(Object.keys(r.sheet), Object.keys(other.sheet));
  drop(other);
  drop(r);
});
check('적을 수 없는 칸은 거절한다', () => {
  const r = round();
  r.dice = [1, 1, 4, 5, 6];
  assert.equal(fishing.writeTo(r, 'aces'), null);
  assert.equal(r.triesLeft, 6, '거절했는데 기회가 줄었다');
  drop(r);
});
check('허탕도 기회를 쓴다', () => {
  const r = round();
  fishing.skipTurn(r);
  assert.equal(r.triesLeft, 5);
  assert.equal(r.log.at(-1).hint, fishing.NO_ROOM);
  drop(r);
});

console.log(failed ? `\n실패 ${failed}건` : '\n전부 통과');
process.exit(failed ? 1 : 0);
