/**
 * simulate-yacht — NPC 성향을 눈으로 확인하는 도구
 *
 * 디스코드 없이 판을 수천 번 돌린다. 두 가지를 본다.
 *
 *   1) 규칙이 맞는지 — 모든 판이 12칸을 채우고 끝나는지, 총점이 상식적인 범위인지
 *   2) 성향이 실제로 다른지 — 점수 분포뿐 아니라 **턴당 평균 고정 개수**를 본다.
 *      미겔이 마티암보다 한 개쯤 적게 쥐고 있지 않으면 성향 구현이 실패한 것이다.
 *      점수만 보면 둘이 비슷하게 나올 수 있어서, 이 숫자가 진짜 판정 기준이다.
 *
 * 사용법:
 *   node bot/scripts/simulate-yacht.mjs [판수]
 *   YACHT_TRIALS=40 node bot/scripts/simulate-yacht.mjs 2000   ← 빠르게 대충 볼 때
 */
import {
  MAX_ROLLS, DICE_COUNT, CATEGORY_KEYS, UPPER_KEYS,
  rollDice, reroll, newSheet, commit, totals, isComplete,
} from '../src/yacht/rules.js';
import { STYLES, chooseHold, chooseCategory } from '../src/yacht/ai.js';

const fastRand = () => 1 + Math.floor(Math.random() * 6);

/** 한 판. 굴림 과정에서 나온 통계도 같이 돌려준다. */
function playGame(styleKey) {
  let sheet = newSheet();
  let heldTotal = 0;
  let holdDecisions = 0;

  for (let round = 0; round < CATEGORY_KEYS.length; round += 1) {
    let dice = rollDice(DICE_COUNT, fastRand);

    for (let rollsLeft = MAX_ROLLS - 1; rollsLeft > 0; rollsLeft -= 1) {
      const held = chooseHold(styleKey, dice, sheet, rollsLeft, fastRand);
      heldTotal += held.filter(Boolean).length;
      holdDecisions += 1;
      if (held.every(Boolean)) break;      // 다 쥐었으면 더 굴릴 이유가 없다
      dice = reroll(dice, held, fastRand);
    }

    sheet = commit(sheet, chooseCategory(styleKey, dice, sheet), dice).sheet;
  }

  if (!isComplete(sheet)) throw new Error('12칸을 다 못 채우고 끝났습니다');

  const t = totals(sheet);
  return {
    total: t.total,
    bonus: t.bonus > 0,
    zeros: CATEGORY_KEYS.filter((k) => sheet[k] === 0).length,
    upperZeros: UPPER_KEYS.filter((k) => sheet[k] === 0).length,
    yacht: sheet.yacht > 0,
    avgHeld: heldTotal / holdDecisions,
  };
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const f1 = (n) => n.toFixed(1);

function report(styleKey, games) {
  const rows = Array.from({ length: games }, () => playGame(styleKey));
  const totalsSorted = rows.map((r) => r.total).sort((a, b) => a - b);

  return {
    이름: STYLES[styleKey].name,
    평균: f1(avg(totalsSorted)),
    최저: totalsSorted[0],
    'p25': pct(totalsSorted, 0.25),
    중앙: pct(totalsSorted, 0.5),
    'p75': pct(totalsSorted, 0.75),
    최고: totalsSorted[totalsSorted.length - 1],
    '보너스%': f1(100 * rows.filter((r) => r.bonus).length / games),
    '야찌%': f1(100 * rows.filter((r) => r.yacht).length / games),
    '판당 0점칸': f1(avg(rows.map((r) => r.zeros))),
    '턴당 고정': f1(avg(rows.map((r) => r.avgHeld))),
  };
}

const games = Number(process.argv[2]) || 500;
console.log(`요트 시뮬레이션 — 성향별 ${games}판 (YACHT_TRIALS=${process.env.YACHT_TRIALS || 200})\n`);

const started = Date.now();
const results = Object.keys(STYLES).map((k) => report(k, games));
console.table(results);

const [migel, matiam] = results;
const heldGap = Number(matiam['턴당 고정']) - Number(migel['턴당 고정']);
console.log(`\n턴당 고정 개수 차이: ${f1(heldGap)}개 (마티암이 더 많이 쥐어야 한다)`);
console.log(
  heldGap > 0.3
    ? '→ 성향이 행동으로 갈라지고 있다.'
    : '→ 차이가 너무 작다. 사람 눈에는 같아 보일 것이다.',
);
console.log(`\n${Date.now() - started}ms`);
