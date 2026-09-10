/**
 * check-poker — 핸드 평가기 검증
 *
 * 홀덤에서 골드를 잘못 나눠 주는 사고는 거의 다 여기서 시작한다. 손으로 고른 사례로
 * 카테고리·킥커·찹을 확인하고, 무작위로 수만 판을 돌려 불변식이 깨지지 않는지 본다.
 *
 *   node bot/scripts/check-poker.mjs [무작위 판 수]
 */
import { newShoe, shuffle } from '../src/casino/cards.js';
import { best5, compare, winners, describe } from '../src/casino/poker.js';

const C = (s) => ({ rank: s[0].toLowerCase(), suit: s[1] });
const hand = (str) => str.split(' ').map(C);

let fail = 0;
const eq = (what, got, want) => {
  const ok = String(got) === String(want);
  if (!ok) { fail += 1; console.error(`  ✗ ${what}\n      나온 것: ${got}\n      기댓값:  ${want}`); }
  return ok;
};

// ---------------------------------------------------------------- 카테고리
console.log('## 카테고리');
const cases = [
  ['로열 플러시', 'As Ks Qs Js Ts 2h 3d', 'straightFlush', 14],
  ['스트레이트 플러시', '9s 8s 7s 6s 5s Ah Kd', 'straightFlush', 9],
  ['스티플 휠 (A2345 같은 무늬)', 'As 2s 3s 4s 5s Kh Qd', 'straightFlush', 5],
  ['포카드', '7s 7h 7d 7c As Kh 2d', 'quads', 7],
  ['풀하우스', 'Ks Kh Kd 4s 4h 2c 7d', 'fullHouse', 13],
  ['풀하우스 — 트리플 둘이면 높은 쪽이 셋', 'Ks Kh Kd 4s 4h 4c 7d', 'fullHouse', 13],
  ['플러시', 'As Js 9s 5s 2s Kh Qd', 'flush', 14],
  ['스트레이트', '9s 8h 7d 6c 5s Ah Kd', 'straight', 9],
  ['스트레이트 휠 (A2345)', 'As 2h 3d 4c 5s Kh Qd', 'straight', 5],
  ['트리플', '7s 7h 7d As Kh 4c 2d', 'trips', 7],
  ['투페어', 'Ks Kh 7d 7c As 4h 2d', 'twoPair', 13],
  ['원페어', 'Ks Kh As Qd 9c 4h 2d', 'pair', 13],
  ['하이카드', 'As Kh Qd 9c 7h 4s 2d', 'high', 14],
];
for (const [what, cards, category, top] of cases) {
  const h = best5(hand(cards));
  eq(what, `${h.category}/${h.tiebreak[0]}`, `${category}/${top}`);
}

// A2345 는 6 하이 스트레이트보다 낮아야 한다 — 휠을 14 로 두면 여기서 뒤집힌다.
eq('휠 < 6하이 스트레이트',
  compare(best5(hand('As 2h 3d 4c 5s Kh Qd')), best5(hand('2s 3h 4d 5c 6s Kh Qd'))), -1);

// ---------------------------------------------------------------- 킥커·찹
console.log('## 킥커와 찹');
eq('같은 페어면 킥커로 갈린다',
  compare(best5(hand('Ks Kh As Qd 9c 4h 2d')), best5(hand('Kd Kc Js Qh 9s 4d 2h'))), 1);
eq('플러시는 두 번째 카드까지 본다',
  compare(best5(hand('As Qs 9s 5s 2s Kh 3d')), best5(hand('Ah Js 9h 5h 2h Kd 3c'))), 1);
eq('보드가 최선이면 완전한 찹',
  compare(best5(hand('2c 3d As Ks Qs Js Ts')), best5(hand('4c 5d As Ks Qs Js Ts'))), 0);
eq('같은 손이면 0', compare(best5(hand('As Kh Qd Jc Ts 2h 3d')),
  best5(hand('Ad Kc Qh Js Th 2s 3c'))), 0);
eq('찹이면 winners 가 둘',
  winners([best5(hand('2c 3d As Ks Qs Js Ts')), best5(hand('4c 5d As Ks Qs Js Ts'))]).length, 2);

// 플러시 vs 스트레이트 — 카테고리 순서가 뒤집히면 팟이 엉뚱한 데로 간다.
eq('플러시 > 스트레이트',
  compare(best5(hand('As Js 9s 5s 2s Kh Qd')), best5(hand('9s 8h 7d 6c 5s Ah Kd'))), 1);
eq('풀하우스 > 플러시',
  compare(best5(hand('Ks Kh Kd 4s 4h 2c 7d')), best5(hand('As Js 9s 5s 2s Kh Qd'))), 1);

// 무늬 다섯 장이 있어도 그 안에 스트레이트가 없으면 스티플이 아니다.
eq('무늬만 다섯이고 스트레이트는 섞였으면 스티플이 아니다',
  best5(hand('5s 6s 7s 9s Ts 8h Kd')).category, 'flush');
eq('그 경우 스트레이트도 따로 성립한다면 더 센 쪽(플러시)을 고른다',
  compare(best5(hand('5s 6s 7s 9s Ts 8h Kd')), best5(hand('5c 6d 7h 8s 9c 2h Kd'))), 1);

// ---------------------------------------------------------------- 무작위
const n = Number(process.argv[2] || 20000);
console.log(`## 무작위 ${n.toLocaleString()}판 불변식`);
const seen = {};
let bad = 0;
for (let i = 0; i < n; i += 1) {
  const deck = shuffle(newShoe(1));
  const a = deck.slice(0, 2);
  const b = deck.slice(2, 4);
  const board = deck.slice(4, 9);
  const ha = best5([...a, ...board]);
  const hb = best5([...b, ...board]);

  seen[ha.category] = (seen[ha.category] || 0) + 1;

  if (ha.cards.length !== 5 || hb.cards.length !== 5) { bad += 1; continue; }
  // 고른 다섯 장은 반드시 준 카드 안에 있어야 한다(같은 카드를 두 번 쓰지 않았는지).
  const pool = [...a, ...board];
  const uniq = new Set(ha.cards.map((c) => c.rank + c.suit));
  if (uniq.size !== 5 || ha.cards.some((c) => !pool.includes(c))) { bad += 1; continue; }
  // 비교는 반대칭이어야 한다.
  if (compare(ha, hb) !== -compare(hb, ha)) { bad += 1; }
}
eq('불변식 위반', bad, 0);

const total = Object.values(seen).reduce((x, y) => x + y, 0);
console.log('\n7장 기준 카테고리 분포 (참고: 실제 확률과 비슷해야 한다)');
for (const [k, v] of Object.entries(seen).sort((x, y) => y[1] - x[1])) {
  console.log(`  ${k.padEnd(14)} ${((v / total) * 100).toFixed(2)}%`);
}

console.log(`\n예시: ${describe(best5(hand('Ks Kh 7d 7c As 4h 2d')))}`);
console.log(fail ? `\n실패 ${fail}건` : '\n전부 통과');
process.exit(fail ? 1 : 0);
