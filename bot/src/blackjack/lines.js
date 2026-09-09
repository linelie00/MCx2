/**
 * lines — 카지노 대사의 바닥
 *
 * 대사는 Gemini(ai/casinoTalk.js)로 짓는 것이 먼저지만, **여기가 늘 받쳐 준다.**
 * 한 핸드에 대사 자리가 스무 번 넘게 와서 전부 API 로 갈 수가 없고, 한도가 찼든
 * 키가 없든 API 가 죽었든 판은 말이 있는 채로 돌아야 하기 때문이다. 요트는 그럴 때
 * 대사가 그냥 비는데, 카지노는 진행 멘트라 비면 판이 멈춘 것처럼 보인다.
 *
 * 이 파일이 하는 일은 둘이다.
 *
 *   line()  미리 써 둔 목록에서 고른다. 반복이 눈에 띄므로 키마다 **최근에 쓴 줄을
 *           피한다**. 목록이 짧은 키(npc 딜러는 서너 줄이면 충분하다)에서는
 *           피할 수 있는 만큼만 피한다.
 *   memo()  Gemini 에게 넘길 상황 메모를 만든다. **캔드 대사와 같은 키**를 쓴다 —
 *           어느 쪽이 나가든 말하는 순간이 달라지지 않게.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickRandom } from '../pickOfDay.js';
import { handValue } from '../casino/cards.js';
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

// ---------------------------------------------------------------- 상황 메모
//
// Gemini 로 대사를 지을 때 넘길 메모. 캔드 대사와 달리 모델은 판을 못 보므로
// 지금 테이블이 어떻게 생겼고 방금 무슨 일이 있었는지를 글로 적어 준다.
//
// **여기서 카드는 이모지가 아니라 글자로 적는다.** 판에 쓰는 cardText 는 앱 이모지
// (`<:card_as:123…>`)를 내주는데, 모델에게는 읽을 수 없는 잡음일 뿐이다.

const RANK_TEXT = {
  a: 'A', t: '10', j: 'J', q: 'Q', k: 'K',
};
const SUIT_TEXT = { s: '♠', h: '♥', d: '♦', c: '♣' };

const plain = (card) => `${RANK_TEXT[card.rank] ?? card.rank}${SUIT_TEXT[card.suit] ?? ''}`;
const plainHand = (cards) => cards.map(plain).join(' ');

/** 지금 무슨 일이 있었는지. 키의 뒤쪽(사건)으로 고른다. */
const DEALER_MOMENT = {
  welcome: () => '판을 열었다. 앉은 사람들에게 인사한다. 아직 베팅도 카드도 시작 전이다.',
  deal: () => '이제 카드를 두 장씩 돌린다.',
  turn: (v) => `${v.name}의 차례가 되어 알려 준다. 무엇을 고를지는 그 사람이 정한다.`,
  reveal: () => '내 엎어 둔 카드를 공개할 차례다.',
  draw: () => '17이 안 돼서 규칙대로 내가 카드를 더 받는다.',
  bust: () => '내가 21을 넘겨 Bust 했다. 남은 손님들이 전부 이겼다.',
  blackjack: () => '내게 Blackjack 이 붙었다. 손님들에게는 안된 일이다.',
  insuranceOffer: () => '내 앞장이 A 라서 Insurance 를 살지 물어본다.',
  dealtBlackjack: (v) => `방금 돌린 첫 두 장에서 ${v.name}에게 Blackjack 이 떴다.`
    + ' 아직 내 밑장은 열지 않았고 정산도 안 했다. 지금은 그저 축하할 자리다.',
  made21: (v) => `${v.name}이(가) 카드를 더 받아 합이 딱 21이 됐다.`
    + ' Blackjack 은 아니지만 넘지 않고 맞춘 것이다. 아직 정산 전이다.',
  bet: (v) => `${v.name}이(가) ${v.amount}을 걸었다.`,
  'bet.allin': (v) => `${v.name}이(가) 가진 칩을 전부(${v.amount}) 걸었다. 올인이다.`,
  'result.win': (v) => `${v.name}이(가) 나를 이겼다. ${v.amount}을 내준다.`,
  'result.lose': (v) => `${v.name}이(가) 졌다. ${v.amount}을 내가 가져간다.`,
  'result.push': (v) => `${v.name}과(와) 비겼다. 건 돈을 그대로 돌려준다.`,
  'result.playerBust': (v) => `${v.name}이(가) 21을 넘겨 Bust 했다.`,
  'result.playerBlackjack': (v) => `${v.name}에게 Blackjack 이 떴다. 1.5배로 준다.`,
  'result.surrender': (v) => `${v.name}이(가) Surrender 했다. 절반만 돌려준다.`,
  close: (v) => ['판이 끝나 테이블을 닫는다. 오늘 밤은 여기까지다.',
    v.name ? `가장 많이 딴 사람은 ${v.name}(${v.amount}).` : null,
  ].filter(Boolean).join(' '),
  broke: () => '손님들 칩이 다 떨어져서 더 이상 베팅할 수가 없다. 그래서 판을 닫는다.',
};

const PLAYER_MOMENT = {
  welcome: () => '오늘은 손님 자리에 앉았다. 판이 막 열렸고 아직 베팅도 카드도 시작 전이다.',
  hit: () => '한 장 더 받기로 하고 Hit 을 부른다.',
  stand: () => '더 받지 않기로 하고 Stand 한다.',
  double: () => '건 돈을 두 배로 올리고 한 장만 더 받는다. Double 이다.',
  split: () => '같은 값 두 장을 갈라 손을 둘로 만든다. Split 이다.',
  surrender: () => '승산이 없어 보여 절반만 잃고 물러난다. Surrender 다.',
  insurance: () => '딜러 앞장이 A 라 Insurance 를 사기로 한다.',
  insuranceDecline: () => '딜러 앞장이 A 지만 Insurance 는 사지 않는다.',
  win: (v) => `내가 이겼다. ${v.amount}을 땄다.`,
  lose: (v) => `내가 졌다. ${v.amount}을 잃었다.`,
  push: () => '딜러와 비겼다. 건 돈은 그대로 돌아온다.',
  bust: () => '한 장을 더 받았다가 21을 넘겨 Bust 했다.',
  blackjack: () => '방금 받은 첫 두 장이 21이다. Blackjack 이다.'
    + ' 아직 딜러 밑장은 안 열렸고 정산도 안 했다.',
  made21: () => '카드를 더 받아 합이 딱 21이 됐다. Blackjack 은 아니지만 넘지 않고 맞췄다.'
    + ' 여기서 더 받을 이유는 없다.',
  closeWin: (v) => `판이 끝났다. 오늘 밤 나는 ${v.amount}을 따고 일어난다.`,
  closeLose: (v) => `판이 끝났다. 오늘 밤 나는 ${v.amount}을 잃었다.`,
  closeEven: () => '판이 끝났다. 따지도 잃지도 않고 본전이다.',
};

// 옆자리 반응은 **구경하는 자리**다. 이걸 못 박아 두지 않으면 남이 Bust 한 것을
// 보고 자기가 "Stand!" 를 선언하며 끝낸다(실제로 그랬다).
const WATCHING = '지금 내 차례가 아니고, 나는 아무 수도 두지 않는다.';

const BANTER_MOMENT = {
  bust: (v) => `옆자리 ${v.name}이(가) 21을 넘겨 Bust 했다. ${WATCHING}`,
  blackjack: (v) => `옆자리 ${v.name}에게 Blackjack 이 떴다. ${WATCHING}`,
  made21: (v) => `옆자리 ${v.name}이(가) 카드를 더 받아 합을 딱 21로 맞췄다. ${WATCHING}`,
  double: (v) => `옆자리 ${v.name}이(가) Double 을 걸었다. ${WATCHING}`,
  split: (v) => `옆자리 ${v.name}이(가) Split 했다. ${WATCHING}`,
  surrender: (v) => `옆자리 ${v.name}이(가) Surrender 했다. ${WATCHING}`,
  dealerBust: () => `딜러인 미겔이 21을 넘겨 Bust 했다. 미겔에게 한마디 한다. ${WATCHING}`,
  dealerBlackjack: () => `딜러인 미겔에게 Blackjack 이 붙었다. 미겔에게 한마디 한다. ${WATCHING}`,
};

const MOMENT = { dealer: DEALER_MOMENT, player: PLAYER_MOMENT, banter: BANTER_MOMENT };

/** 지금 테이블이 어떻게 생겼는지. 판이 안 돌고 있으면 빈 문자열. */
function table(game, speaker) {
  const rows = [];
  if (game.dealer?.length) {
    const shown = game.holeUp
      ? `${plainHand(game.dealer)} (${handValue(game.dealer).total})`
      : `${plain(game.dealer[0])} + 엎어 둔 카드 한 장`;
    rows.push(`딜러: ${shown}${game.dealerCharacter === speaker ? ' ← 나' : ''}`);
  }
  for (const seat of game.seats) {
    if (seat.out) continue;
    const hands = game.hands.filter((h) => h.seatIndex === game.seats.indexOf(seat));
    const me = seat.character === speaker ? ' ← 나' : '';
    if (!hands.length) {
      rows.push(`${seat.name}: ${seat.bet ? `${seat.bet}칩 걺` : '아직 안 걺'}`
        + ` · 남은 칩 ${seat.chips}${me}`);
      continue;
    }
    for (const hand of hands) {
      const { total, bust } = handValue(hand.cards);
      const tag = bust ? ' Bust' : '';
      rows.push(`${seat.name}: ${plainHand(hand.cards)} (${total}${tag})`
        + ` · ${hand.bet}칩 걺 · 남은 칩 ${seat.chips}${me}`);
    }
  }
  return rows.length ? ['## 판', ...rows].join('\n') : '';
}

/**
 * 판을 접을 때 보여 줄 것. 카드가 아니라 **오늘 얼마를 따고 잃었는지**다.
 *
 * 마무리 인사에 마지막 핸드 테이블을 그대로 넘겼더니 마티암이 판이 끝난 줄 모르고
 * 방금 터진 패 이야기를 했다. 끝난 자리에서는 끝난 것만 보여 준다.
 */
function closing(game, speaker) {
  const deltas = game.chips?.deltas() ?? {};
  const rows = game.seats.map((s) => {
    const d = deltas[s.id] ?? 0;
    const me = s.character === speaker ? ' ← 나' : '';
    return `${s.name}: ${d > 0 ? `+${d}` : d}칩 (남은 칩 ${s.chips})${me}`;
  });
  return ['## 오늘의 결산', ...rows].join('\n');
}

/**
 * Gemini 에게 넘길 상황 메모. 캔드 대사와 **같은 키**로 만든다 —
 * 어느 쪽이 나가든 말하는 순간이 달라지지 않게 하려는 것이다.
 */
export function memo(game, key, vars = {}, speaker = null) {
  const [kind, , ...rest] = key.split('.');
  const event = rest.join('.');
  const make = MOMENT[kind]?.[event] ?? MOMENT[kind]?.[event.split('.')[0]];
  if (!make) return null;

  const closes = event === 'broke' || event.startsWith('close');
  const head = closes ? closing(game, speaker) : table(game, speaker);

  // 홀 카드를 깔 때까지는 아무도 그걸 못 본다. 표에 "엎어 둔 카드 한 장" 이라고
  // 적어 두는 것만으로는 부족했다 — 미겔이 배분이나 차례 알림에서 "(제 엎어 둔
  // 카드를 탁 소리 나게 뒤집으며)" 같은 지문을 지어냈다. 말로 못 박는다.
  // reveal 은 뒤집는 순간 그 자체라 빼야 한다(그 자리에서만 holeUp 이 아직 false 다).
  const hidden = event !== 'reveal' && !closes && game.dealer?.length && !game.holeUp
    ? '딜러가 엎어 둔 카드는 아직 아무도 못 봤다.'
      + ' 그것을 뒤집거나 무슨 카드인지 아는 것처럼 말하지 않는다.'
    : null;

  return [head, '', '## 지금', make(vars), hidden]
    .filter((s) => s !== null).join('\n').trim();
}

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

export default { line, sometimes, betKey, memo, RESULT_KEY, REACT_KEY };
