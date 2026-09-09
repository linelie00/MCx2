/**
 * lines — 홀덤 대사의 바닥, 그리고 Gemini 에게 넘길 상황 메모
 *
 * 블랙잭의 lines.js 와 같은 구조다. Gemini 로 먼저 지어 보고 안 되면 여기서 고른다.
 *
 * **다만 메모를 만드는 방식이 다르다.** 블랙잭의 `table()` 은 모든 자리의 카드를 그대로
 * 적어 모델에 넘긴다 — 판이 전부 공개라 그래도 됐다. 홀덤에서 그대로 하면 NPC 가
 * 남의 홀 카드를 말한다.
 *
 * 그래서 **쇼다운 전에는 어느 카드도 메모에 안 넣는다 — 말하는 사람 자기 것까지.**
 * 자기 것은 줘도 된다고 봤다가 미겔이 자기 패를 흘리는 걸 보고 바꿨다(table 참고).
 *
 * 판을 그리는 쪽(render.js)과 여기, 그리고 쇼다운 — 홀 카드가 샐 수 있는 자리가 셋이고
 * 여기가 제일 놓치기 쉽다. 화면에는 안 보이는데 모델에게만 새기 때문이다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickRandom } from '../pickOfDay.js';
import { describe, best5 } from '../casino/poker.js';

const FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'holdem-lines.json',
);

const POOL = JSON.parse(fs.readFileSync(FILE, 'utf8')).lines;

console.log(`[홀덤] 대사 ${Object.values(POOL).reduce((a, v) => a + v.length, 0)}줄`
  + ` · ${Object.keys(POOL).length}개 상황`);

const recent = new Map();
const KEEP = 3;

/** 그 줄이 쓰는 자리표시자들. `'{name}씨 {amount}'` → ['name','amount'] */
const holes = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

/** 그 상황의 대사 한 줄. 없는 키면 null — 대사 때문에 판이 멈추면 안 된다. */
export function line(key, vars = {}) {
  const all = POOL[key];
  if (!all?.length) return null;

  // **채울 수 없는 자리표시자가 든 줄은 아예 안 고른다.**
  // 안 그러면 "{hand} 였습니다요" 가 그대로 나간다 — 쇼다운 없이 이겼을 때처럼
  // 값이 없는 경우가 실제로 있다. 다 못 채우면 자리표시자가 없는 줄로 물러선다.
  // 하나도 못 채우면 **아무 말도 안 한다.** 깨진 줄을 내보내느니 조용한 편이 낫다.
  const usable = all.filter((t) => holes(t).every((k) => vars[k] != null));
  const plain = all.filter((t) => holes(t).length === 0);
  const pool = usable.length ? usable : plain;
  if (!pool.length) return null;

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
export const sometimes = (p = 0.34) => Math.random() < p;

// ---------------------------------------------------------------- 상황 메모

const RANK_TEXT = { a: 'A', t: '10', j: 'J', q: 'Q', k: 'K' };
const SUIT_TEXT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const plain = (card) => `${RANK_TEXT[card.rank] ?? card.rank}${SUIT_TEXT[card.suit] ?? ''}`;
const plainHand = (cards) => cards.map(plain).join(' ');

const STREET = {
  preflop: '프리플랍(보드 없음)', flop: '플랍(3장)', turn: '턴(4장)', river: '리버(5장)',
};

const MOMENT = {
  welcome: () => '판을 열었다. 앉은 사람들에게 인사한다. 아직 카드도 안 돌렸다.',
  street: (v) => `${v.street} 카드가 깔렸다.`,
  fold: () => '이번 판은 접는다. 낸 돈은 두고 물러난다.',
  check: () => '걸린 돈이 없어 그냥 넘긴다. Check 다.',
  call: (v) => `상대가 건 만큼(${v.amount}) 맞춘다. Call 이다.`,
  raise: (v) => `${v.amount}까지 올린다. Raise 다.`,
  allin: (v) => `가진 칩 전부(${v.amount})를 민다. All-in 이다.`,
  win: (v) => `이번 판을 이겨 ${v.amount}을 가져간다.${v.hand ? ` 내 손은 ${v.hand}.` : ''}`,
  lose: (v) => `이번 판에서 ${v.amount}을 잃었다.`,
  chop: (v) => `똑같은 손이 나와 팟을 나눠 가졌다. 내 몫은 ${v.amount}.`,
  close: () => '판을 접는다. 오늘은 여기까지다.',
};

const BANTER = {
  // 옆자리를 구경하는 자리다. 이걸 못 박아 두지 않으면 자기가 수를 두는 것처럼 말한다.
  allin: (v) => `옆자리 ${v.name}이(가) All-in 했다. 지금 내 차례가 아니고 나는 아무 수도 두지 않는다.`,
  raise: (v) => `옆자리 ${v.name}이(가) ${v.amount}까지 올렸다. 지금 내 차례가 아니고 나는 아무 수도 두지 않는다.`,
  fold: (v) => `옆자리 ${v.name}이(가) 접었다. 지금 내 차례가 아니고 나는 아무 수도 두지 않는다.`,
};

/** 카드를 밝히지 않고 손이 얼마나 센지만. 성격을 실을 만큼은 되고 스포는 안 된다. */
const FEEL = {
  straightFlush: '아주 좋다', quads: '아주 좋다', fullHouse: '아주 좋다',
  flush: '아주 좋다', straight: '아주 좋다',
  trips: '좋다', twoPair: '좋다',
  pair: '그저 그렇다', high: '별로다',
};

/**
 * 지금 판이 어떻게 생겼는지.
 *
 * 남의 두 장은 여기 절대 안 들어간다. 화면에는 안 보이는데 모델에게만 새는 길이다.
 *
 * **쇼다운 전에는 말하는 사람 자기 카드도 안 준다.** 처음에는 자기 것은 줘도 된다고
 * 봤는데, 미겔이 "손에 쥔 10의 쌍을 톡톡 두드리며" 하고 자기 패를 흘렸다. 프롬프트에
 * "밝히지 마라" 를 적어 두는 것만으로는 안 막힌다 — **모르는 것은 흘릴 수가 없으므로**
 * 아예 안 준다. 대신 얼마나 센지만 한마디로 준다. 그 정도면 신나거나 시무룩한 티는
 * 낼 수 있고, 어떤 카드인지는 여전히 아무도 모른다.
 */
function table(game, speaker) {
  const open = game.phase === 'showdown' || game.phase === 'settled';
  const rows = [`판: ${STREET[game.phase] ?? game.phase} · 팟 ${game.seats.reduce((a, s) => a + s.committed, 0)}`];
  if (game.board.length) rows.push(`보드: ${plainHand(game.board)}`);

  for (const s of game.seats) {
    if (s.out) continue;
    const me = s.character === speaker;
    const tag = [
      s.folded ? '접음' : null,
      s.allIn ? '올인' : null,
      s.bet ? `이번 ${s.bet}` : null,
    ].filter(Boolean).join(' · ');

    let mine = '';
    if (me && s.hole.length) {
      mine = open
        ? ` · 내 패 ${plainHand(s.hole)} ← 나`
        : ` · 내 손 느낌: ${FEEL[best5([...s.hole, ...game.board]).category]} ← 나`;
    }
    rows.push(`${s.name}: 칩 ${s.chips}${tag ? ` · ${tag}` : ''}${mine}`);
  }

  rows.push(open
    ? '※ 카드를 깐 뒤다. 이제는 말해도 된다.'
    : '※ **아직 아무도 카드를 안 깠다.** 내가 무슨 카드를 들고 있는지 말하거나 암시하지'
      + ' 않는다. 손에 쥔 것을 묘사하지도 않는다. 셀 때 신난 티, 나쁠 때 시무룩한 티만 낸다.');
  return ['## 판', ...rows].join('\n');
}

/**
 * Gemini 에게 넘길 상황 메모. 캔드 대사와 **같은 키**로 만든다 —
 * 어느 쪽이 나가든 말하는 순간이 달라지지 않게.
 */
export function memo(game, key, vars = {}, speaker = null) {
  const [kind, , ...rest] = key.split('.');
  const event = rest.join('.');
  const make = (kind === 'banter' ? BANTER : MOMENT)[event];
  if (!make) return null;

  return [table(game, speaker), '', '## 지금', make(vars)].join('\n').trim();
}

/** 쇼다운에서 자기 손을 말할 때 쓸 이름. */
export const handName = (hand) => (hand ? describe(hand) : null);

export default { line, sometimes, memo, handName };
