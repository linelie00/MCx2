/**
 * simulate-blackjack — 규칙과 NPC 성향을 디스코드 없이 검증한다
 *
 * 두 가지를 본다.
 *
 *   1) 규칙이 맞는지 — 그중에서도 **칩 총합이 보존되는지**가 핵심이다. 플레이어가 잃은
 *      만큼 하우스가 벌어야 하고 그 반대도 마찬가지다. 어긋나면 어딘가에서 칩을
 *      만들거나 없앤 것이고, Split·Double·Insurance 정산이 제일 틀리기 쉽다.
 *   2) 성향이 실제로 다른지 — 표대로 두는 마티암은 하우스 엣지(1% 안팎)만큼만 잃고,
 *      미겔은 눈에 띄게 더 빨리 잃어야 한다.
 *
 * 사용법:
 *   node bot/scripts/simulate-blackjack.mjs [핸드수]
 */
import {
  newShoe, shuffle, draw, needsShuffle, handValue, isBlackjack,
} from '../src/casino/cards.js';
import {
  newHand, legalActions, dealerShouldHit, dealerPeeks,
  settleHand, settleInsurance, insuranceCost, MAX_HANDS_PER_SEAT,
} from '../src/blackjack/rules.js';
import { STYLES, chooseAction, chooseInsurance, chooseBet } from '../src/blackjack/ai.js';

const fastRand = (n) => Math.floor(Math.random() * n);

/** 한 핸드. 자리 하나(그 성향)와 딜러가 붙는다. 결과는 칩 증감이다. */
function playHand(styleKey, chips, lastWon) {
  const shoe = playHand.shoe;
  if (needsShuffle(shoe)) { playHand.shoe = shuffle(newShoe(6), fastRand); }

  const bet = chooseBet(styleKey, { chips, lastWon });
  if (!bet) return null;                       // 걸 돈이 없다

  const seat = { chips: chips - bet };         // 걸 때 바로 깎는다
  let staked = bet;                            // 이번 핸드에 건 칩 전부
  let returned = 0;                            // 돌아온 칩 전부
  let hands = [newHand({ seatIndex: 0, bet, cards: [draw(shoe), draw(shoe)] })];
  const dealer = [draw(shoe), draw(shoe)];

  // 인슈어런스 — 업카드가 A 일 때만
  let ins = 0;
  if (dealer[0].rank === 'a' && chooseInsurance(styleKey)
    && seat.chips >= insuranceCost(bet)) {
    ins = insuranceCost(bet);
    seat.chips -= ins;
    staked += ins;
  }

  const insResult = settleInsurance(ins, dealer);
  seat.chips += insResult.returned;
  returned += insResult.returned;

  // 딜러 피크 — 블랙잭이면 손을 더 두지 않고 바로 정산으로 간다
  const peeked = dealerPeeks(dealer[0]) && isBlackjack(dealer);

  if (!peeked) {
    for (let i = 0; i < hands.length; i += 1) {
      const hand = hands[i];
      // 쪼개서 생긴 손은 차례가 오면 바로 두 번째 장을 받는다.
      if (hand.cards.length === 1) hand.cards.push(draw(shoe));
      // 쪼갠 에이스는 그 한 장으로 끝.
      if (hand.splitAce) continue;

      for (;;) {
        const mine = hands.filter((h) => h.seatIndex === 0).length;
        const legal = legalActions(hand, seat, mine);
        if (!legal.size) break;

        const act = chooseAction(styleKey, {
          cards: hand.cards, dealerUp: dealer[0], legal, rand: Math.random,
        });

        if (act === 'stand') break;
        if (act === 'surrender') { hand.surrendered = true; break; }
        if (act === 'hit') {
          hand.cards.push(draw(shoe));
          if (handValue(hand.cards).bust) break;
          continue;
        }
        if (act === 'double') {
          seat.chips -= hand.bet;
          staked += hand.bet;
          hand.bet *= 2;
          hand.doubled = true;
          hand.cards.push(draw(shoe));
          break;
        }
        if (act === 'split') {
          if (mine >= MAX_HANDS_PER_SEAT) break;
          seat.chips -= hand.bet;
          staked += hand.bet;
          const splitAce = hand.cards[0].rank === 'a';
          const moved = hand.cards.pop();
          const extra = newHand({
            seatIndex: 0, bet: hand.bet, cards: [moved], fromSplit: true, splitAce,
          });
          hand.fromSplit = true;
          hand.splitAce = splitAce;
          hand.cards.push(draw(shoe));
          hands = [...hands.slice(0, i + 1), extra, ...hands.slice(i + 1)];
          if (splitAce) break;                 // 에이스는 한 장 받고 자동 스탠드
          continue;
        }
        break;
      }
    }

    // 딜러 차례 — 살아 있는 손이 하나라도 있을 때만
    const alive = hands.some((h) => !h.surrendered && !handValue(h.cards).bust);
    if (alive) while (dealerShouldHit(dealer)) dealer.push(draw(shoe));
  }

  const outcomes = [];
  for (const hand of hands) {
    const r = settleHand(hand, dealer);
    seat.chips += r.returned;
    returned += r.returned;
    outcomes.push(r.outcome);
  }

  const delta = seat.chips - chips;
  // 칩 총합 보존 — 증감은 정확히 (돌아온 것 − 건 것) 이어야 한다.
  // 어긋나면 어딘가에서 칩을 만들거나 없앤 것이다. Split·Double·Insurance 정산이
  // 제일 틀리기 쉬운 자리라, 이 한 줄이 이 시뮬레이터의 존재 이유다.
  const leak = delta !== returned - staked;

  return { chips: seat.chips, delta, outcomes, hands: hands.length, staked, leak };
}
playHand.shoe = shuffle(newShoe(6), fastRand);

/**
 * 매 핸드를 같은 자금에서 시작한다.
 *
 * 자금을 이어 붙였더니 미겔이 30000핸드 도중에 파산해서 표본이 잘렸다(그래서 스플릿
 * 횟수가 마티암의 절반으로 나왔다). 여기서 재려는 건 파산까지 걸리는 시간이 아니라
 * **하우스 엣지**라, 자금이 베팅 크기에 영향을 주면 안 된다.
 */
const BANK = 1000000;

function run(styleKey, hands) {
  let net = 0;
  let staked = 0;
  let lastWon = null;
  const counts = {};
  let splits = 0;
  let surrenders = 0;
  let leaks = 0;

  for (let i = 0; i < hands; i += 1) {
    const r = playHand(styleKey, BANK, lastWon);
    if (!r) break;
    net += r.delta;
    staked += r.staked;
    lastWon = r.delta > 0 ? true : (r.delta < 0 ? false : null);
    if (r.leak) leaks += 1;
    if (r.hands > 1) splits += 1;
    for (const o of r.outcomes) counts[o] = (counts[o] || 0) + 1;
    surrenders += r.outcomes.filter((o) => o === 'surrender').length;
  }

  const lost = -net;
  return {
    이름: STYLES[styleKey].name,
    '건 칩': staked,
    '잃은 칩': lost,
    '하우스 엣지': `${((lost / staked) * 100).toFixed(2)}%`,
    '스플릿한 핸드': splits,
    '서렌더': surrenders,
    '블랙잭': counts.blackjack || 0,
    '버스트': counts.bust || 0,
    '칩 누수': leaks,
  };
}

const hands = Number(process.argv[2]) || 5000;
console.log(`블랙잭 시뮬레이션 — 성향별 ${hands}핸드\n`);

// 성향별로 **한 번만** 돌린다. 두 번 돌리면 표와 아래 결론의 숫자가 어긋나 보인다.
const rows = Object.keys(STYLES).map((k) => run(k, hands));
console.table(rows);

const [migel, matiam] = rows;
const leaks = rows.reduce((a, r) => a + r['칩 누수'], 0);

// 정산이 정수로만 떨어지는지 — 지갑이 소수를 안고 영구 저장으로 가면 안 된다.
let frac = 0;
for (let i = 0; i < 5000; i += 1) {
  const r = playHand('matiam', BANK, null);
  if (r && !Number.isInteger(r.delta)) frac += 1;
}

console.log(`\n칩 누수: ${leaks}건 ${leaks ? '← 정산이 틀렸다' : '(총합 보존됨)'}`);
console.log(`정산에 소수가 나온 핸드: ${frac}${frac ? ' ← 지갑이 소수를 안는다' : ''}`);
console.log(`\n하우스 엣지: 마티암 ${matiam['하우스 엣지']} vs 미겔 ${migel['하우스 엣지']}`);
console.log(
  parseFloat(migel['하우스 엣지']) > parseFloat(matiam['하우스 엣지'])
    ? '→ 미겔이 더 많이 잃는다. 성향이 숫자로 드러난다.'
    : '→ 차이가 안 난다. 성향 구현을 다시 봐야 한다.',
);
process.exit(leaks || frac ? 1 : 0);
