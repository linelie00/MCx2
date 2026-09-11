/**
 * 요트·토너먼트 칭호 — 판이 끝날 때 무엇을 세는지. 서버 없이.
 *
 *   node scripts/check-yacht-titles.mjs
 */
import assert from 'node:assert/strict';

// 명령 파일을 불러오면 설정(config.js)이 토큰을 찾는다 — 검사에서는 빈 값이면 된다.
process.env.DISCORD_TOKEN ||= 'check';
process.env.DISCORD_CLIENT_ID ||= 'check';
process.env.DISCORD_GUILD_ID ||= 'check';
const { yachtStats } = await import('../src/commands/yacht.js');
const { tourneyStats } = await import('../src/commands/holdem.js');
const { CATEGORY_KEYS } = await import('../src/yacht/rules.js');
const { earned, TITLE_BY_KEY } = await import('../src/casino/titles.js');

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); } catch (err) { failed += 1; console.log(`  ✗ ${name}\n    ${err.message}`); }
}

/** 칸을 채운 점수표. `over` 로 몇 칸만 바꾼다. */
const sheet = (over = {}) => ({ ...Object.fromEntries(CATEGORY_KEYS.map((k) => [k, 10])), ...over });
const human = (n, sh) => ({ kind: 'human', userId: `10000000000000000${n}`, character: null, name: `사람${n}`, sheet: sh });
const npc = (c, sh) => ({ kind: 'npc', userId: null, character: c, name: c, sheet: sh });
const A = '100000000000000001';
const Bid = '100000000000000002';

console.log('\n요트');
check('끝까지 둔 판 · 최고 점수 · 1위 · 꼴찌', () => {
  const game = { seats: [human(1, sheet({ yacht: 50 })), human(2, sheet({ yacht: 0 }))] };
  const s = yachtStats(game);
  assert.equal(s[A].yachtPlayed, 1);
  assert.equal(s[A].yachtYacht, 1, '요트 칸에 점수');
  assert.equal(s[Bid].yachtYacht, undefined, '요트 칸 0 은 안 센다');
  assert.equal(s[A].yachtWon, 1);
  assert.equal(s[Bid].yachtLast, 1);
  assert.equal(s[A].yachtLast, undefined);
  assert.ok(s[A].bestYacht > s[Bid].bestYacht);
});
check('혼자 둔 판 — 1위도 꼴찌도 아니다', () => {
  const s = yachtStats({ seats: [human(1, sheet())] });
  assert.equal(s[A].yachtWon, undefined);
  assert.equal(s[A].yachtLast, undefined);
  assert.equal(s[A].yachtPlayed, 1);
});
check('동점 1위 — 선장 아님, 전원 동점이면 꼴찌도 아님', () => {
  const s = yachtStats({ seats: [human(1, sheet()), human(2, sheet())] });
  assert.equal(s[A].yachtWon, undefined);
  assert.equal(s[A].yachtLast, undefined);
});
check('윗칸 보너스 · 빈 그물(0점 칸 5개)', () => {
  const upper = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 };
  const zeros = Object.fromEntries(CATEGORY_KEYS.slice(-5).map((k) => [k, 0]));
  const s = yachtStats({ seats: [human(1, sheet(upper)), human(2, sheet(zeros))] });
  assert.equal(s[A].yachtBonus, 1, '63점이면 보너스');
  assert.equal(s[Bid].yachtEmpty, 1, '0점 칸 다섯이면 빈 그물');
  assert.equal(s[A].yachtEmpty, undefined);
});
check('미겔도 계정으로 센다', () => {
  const s = yachtStats({ seats: [npc('migel', sheet({ yacht: 50 })), human(2, sheet())] });
  assert.equal(s['npc:migel'].yachtWon, 1);
});
check('칭호 조건', () => {
  const has = (stats, key) => earned({ stats }).some((t) => t.key === key);
  assert.ok(has({ yachtPlayed: 1 }, 'firstVoyage'));
  assert.ok(has({ yachtYacht: 1 }, 'yachtShout'));
  assert.ok(!has({ yachtBonus: 4 }, 'bonusHunter') && has({ yachtBonus: 5 }, 'bonusHunter'));
  assert.ok(!has({ bestYacht: 209 }, 'fullNet') && has({ bestYacht: 210 }, 'fullNet'));
  assert.ok(!has({ yachtWon: 9 }, 'skipper') && has({ yachtWon: 10 }, 'skipper'));
  assert.ok(has({ yachtEmpty: 1 }, 'emptyNet'));
  assert.ok(!has({ yachtLast: 4 }, 'adrift') && has({ yachtLast: 5 }, 'adrift'));
  assert.equal(TITLE_BY_KEY.fullNet.name, '만선');
});

console.log('\n토너먼트');
const seat = (id, kind = 'human') => ({ id, kind });
check('1위 · 2위 · 제일 먼저 탈락', () => {
  const [a, b, c, d] = [seat(A), seat(Bid), seat('npc:migel', 'npc'), seat('npc:matiam', 'npc')];
  const game = { seats: [a, b, c, d], knocked: [d.id, c.id, b.id], lowBB: {} };
  const s = tourneyStats(game, [a, b, c, d]);
  assert.deepEqual(s, { [A]: { tourneyWon: 1 }, [Bid]: { tourneySecond: 1 }, 'npc:matiam': { tourneyFirstOut: 1 } });
});
check('모브 자리는 안 센다 — 모브가 1위·먼저 탈락이어도', () => {
  const [m0, m1, a, b] = [seat('mob:0', 'mob'), seat('mob:1', 'mob'), seat(A), seat(Bid)];
  const s = tourneyStats({ seats: [m0, m1, a, b], knocked: [m1.id, b.id, a.id], lowBB: {} }, [m0, a, b, m1]);
  assert.deepEqual(s, { [A]: { tourneySecond: 1 } });
});
check('마물 사냥 — 모브가 둘 이상 앉은 판 우승', () => {
  const [a, m0, m1, b] = [seat(A), seat('mob:0', 'mob'), seat('mob:1', 'mob'), seat(Bid)];
  const s = tourneyStats({ seats: [a, m0, m1, b], knocked: [], lowBB: {} }, [a, b, m0, m1]);
  assert.equal(s[A].mobHuntWon, 1);
  const one = tourneyStats({ seats: [a, m0, b, seat('npc:migel', 'npc')], knocked: [], lowBB: {} }, [a, b]);
  assert.equal(one[A].mobHuntWon, undefined, '모브 하나는 아니다');
});
check('기사회생 — 5BB 이하까지 몰렸다가 우승', () => {
  const [a, b, c, d] = [seat(A), seat(Bid), seat('npc:migel', 'npc'), seat('npc:matiam', 'npc')];
  const s = tourneyStats({ seats: [a, b, c, d], knocked: [], lowBB: { [A]: 4.5 } }, [a, b]);
  assert.equal(s[A].comebackWon, 1);
  const no = tourneyStats({ seats: [a, b, c, d], knocked: [], lowBB: { [A]: 6 } }, [a, b]);
  assert.equal(no[A].comebackWon, undefined);
});
check('칭호 조건', () => {
  const has = (stats, key) => earned({ stats }).some((t) => t.key === key);
  assert.ok(!has({ tourneyWon: 4 }, 'champion') && has({ tourneyWon: 5 }, 'champion'));
  assert.ok(!has({ tourneySecond: 4 }, 'eternalSecond') && has({ tourneySecond: 5 }, 'eternalSecond'));
  assert.ok(has({ tourneyFirstOut: 1 }, 'earlyLeave'));
  assert.ok(has({ mobHuntWon: 1 }, 'monsterHunt'));
  assert.ok(has({ comebackWon: 1 }, 'comeback'));
  assert.equal(TITLE_BY_KEY.monsterHunt.name, '마물 사냥');
});

console.log(failed ? `\n실패 ${failed}건` : '\n전부 통과');
process.exit(failed ? 1 : 0);
