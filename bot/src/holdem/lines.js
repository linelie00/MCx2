/**
 * lines — 홀덤 대사의 바닥, 그리고 Gemini 에게 넘길 상황 메모
 *
 * 블랙잭의 lines.js 와 같은 구조다. Gemini 로 먼저 지어 보고 안 되면 여기서 고른다.
 *
 * **다만 메모를 만드는 방식이 다르다.** 블랙잭의 `table()` 은 모든 자리의 카드를 그대로
 * 적어 모델에 넘긴다 — 판이 전부 공개라 그래도 됐다. 홀덤에서 그대로 하면 NPC 가
 * 남의 홀 카드를 말한다. 그래서 메모는 **화자별로** 만들고, 남의 두 장은 넣지 않는다.
 *
 * 자기 카드는 넣는다. 대신 두 겹으로 막는다 — 프롬프트로 금지하고(1차),
 * 지어 온 줄에 자기 카드가 나오면 그 줄을 버린다(2차, `spoilerVeto`).
 * 한동안 자기 카드마저 안 줘 봤는데 새지는 않아도 판이 밋밋해졌다.
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

/** 흐름에 줄줄이 붙일 때는 짧은 쪽이 읽힌다. */
const STREET_SHORT = {
  preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버',
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
  // "판을 접는다" 라고 썼다가 마티암이 그대로 "Fold." 했다. 포커에서 접는다는 곧 Fold다.
  close: (v) => `오늘 판이 다 끝났다. 자리에서 일어나며 인사한다.${
    v.delta > 0 ? ` 오늘 ${v.amount}을 벌었다.`
      : (v.delta < 0 ? ` 오늘 ${v.amount}을 잃었다.` : ' 오늘은 본전이다.')}`,
};

const BANTER = {
  // 옆자리를 구경하는 자리다. 이걸 못 박아 두지 않으면 자기가 수를 두는 것처럼 말한다.
  allin: (v) => `옆자리 ${v.name}이(가) All-in 했다. 지금 내 차례가 아니고 나는 아무 수도 두지 않는다.`,
  raise: (v) => `옆자리 ${v.name}이(가) ${v.amount}까지 올렸다. 지금 내 차례가 아니고 나는 아무 수도 두지 않는다.`,
  fold: (v) => `옆자리 ${v.name}이(가) 접었다. 지금 내 차례가 아니고 나는 아무 수도 두지 않는다.`,
};

/** 카드를 깐 뒤. 여기서부터는 무엇을 들고 있었는지 말해도 된다. */
const OPEN = new Set(['showdown', 'settled', 'done']);

/** 자기가 둔 수를 말하는 자리들. 여기서만 "무슨 마음으로 두는지" 를 붙인다. */
const OWN_MOVE = new Set(['fold', 'check', 'call', 'raise', 'allin']);

/**
 * 무슨 마음으로 두는지 — **사실이 아니라 연기 지시다.**
 *
 * 한동안 손이 얼마나 센지를 사실대로 적어 줬다. 그랬더니 블러프하는 미겔이
 * "영 별로지만 밀어 봅니다요" 하고 스스로 광고했다 — 포커에서 제일 재미있는 자리가
 * 대사에서 죽은 것이다. 사람은 무엇을 보여 줄지 고르는데 NPC 는 못 골랐다.
 *
 * `ai.js` 가 이미 지금 수가 허세인지 진심인지 알고 있으니(`bluff`), 그걸 받아
 * **밖으로 낼 얼굴**을 정해 준다.
 */
function stanceOf(seat, event) {
  const st = seat.stance;
  if (!st || st.action !== event) return null;
  const strong = st.strength >= 0.6;

  if (st.bluff) {
    return '지금 미는 것은 **허세다.** 손은 별로다. 그런데도 자신 있게 민다.'
      + ' 별로라는 티를 절대 내지 않는다. 태연하거나, 오히려 신난 얼굴로.';
  }
  if (event === 'fold') {
    return strong
      ? '접는다. 나쁘지 않은 손이었는데 값이 안 맞는다. 아깝다.'
      : '접는다. 미련 둘 손이 아니었다.';
  }
  if (event === 'raise' || event === 'allin') {
    return strong
      ? '진짜 센 손이다. 숨길 것 없이 밀 만해서 민다.'
      : '확신까지는 없지만 값을 붙여 볼 만하다. 반쯤은 떠보는 것이다.';
  }
  return strong
    ? '손은 좋다. 다만 굳이 티 낼 것 없이 조용히 따라간다.'
    : '확신은 없지만 값이 맞아 따라간다.';
}

/**
 * 이번 핸드에 무슨 일이 있었는지. **전부 화면에 보였던 공개 정보다.**
 *
 * 표의 "방금" 칸은 마지막 하나만 보여 주니, 그것만 넘겨서는 "미겔이 플랍부터 계속
 * 올린다" 같은 말을 할 수가 없다 — 포커 잡담의 절반이 그런 말인데.
 */
function flow(game) {
  if (!game.hist?.length) return null;
  const rows = [];
  for (const h of game.hist) {
    const label = STREET_SHORT[h.street] ?? h.street;
    if (rows.at(-1)?.label !== label) rows.push({ label, moves: [] });
    rows.at(-1).moves.push(`${h.name} ${h.act}`);
  }
  return ['## 흐름', ...rows.map((r) => `${r.label}: ${r.moves.join(' · ')}`)].join('\n');
}

/**
 * 지금 판이 어떻게 생겼는지.
 *
 * **남의 두 장은 여기 절대 안 들어간다.** 화면에는 안 보이는데 모델에게만 새는 길이다.
 *
 * 자기 카드는 준다. 한동안 안 줘 봤다 — 미겔이 "쥔 10의 쌍을 톡톡 두드리며" 하고
 * 흘린 뒤라 모르면 못 흘린다는 쪽으로 갔었다. 그런데 그러면 드로도, 보드에 맞았는지도,
 * 무엇 하나 말할 수 없어 판이 밋밋해졌다. 대신 프롬프트로 금지하고 **지어 온 줄을
 * 검사해서 새면 버린다**(`spoilerVeto`). 프롬프트가 1차, 검사가 2차다.
 */
function table(game, speaker, event) {
  const open = OPEN.has(game.phase);
  const rows = [`판: ${STREET[game.phase] ?? game.phase} · 팟 ${game.seats.reduce((a, s) => a + s.committed, 0)}`];
  if (game.board.length) rows.push(`보드: ${plainHand(game.board)}`);

  let me = null;
  for (const s of game.seats) {
    if (s.out) continue;
    if (s.character === speaker) me = s;
    const tag = [
      s.folded ? '접음' : null,
      s.allIn ? '올인' : null,
      s.bet ? `이번 ${s.bet}` : null,
      s.lastAction ? `방금 ${s.lastAction}` : null,
    ].filter(Boolean).join(' · ');
    rows.push(`${s.name}: 칩 ${s.chips}${tag ? ` · ${tag}` : ''}`
      + (s.character === speaker ? ' ← 나' : ''));
  }

  const mine = [];
  if (me?.hole.length) {
    mine.push('## 내 패', `${plainHand(me.hole)}${game.board.length
      ? ` — 보드까지 합쳐 지금 ${describe(best5([...me.hole, ...game.board]))}` : ''}`);
    const stance = stanceOf(me, event);
    if (stance) mine.push(stance);
    mine.push(open
      ? '카드를 깐 뒤다. 이제는 무엇을 들고 있었는지 말해도 된다.'
      : '**아직 아무도 카드를 안 깠다.** 무슨 카드를 들고 있는지 말하지도, 암시하지도,'
        + ' 묘사하지도 않는다. 무늬도 숫자도 입에 올리지 않는다.'
        + ' 손에 쥔 것을 두드리거나 만지작거리는 묘사도 안 된다.');
  }

  return [
    ['## 판', ...rows].join('\n'),
    flow(game),
    mine.length ? mine.join('\n') : null,
  ].filter(Boolean).join('\n\n');
}

/**
 * 판을 접을 때의 메모 — **한 핸드가 아니라 하루치 결산이다.**
 *
 * 여기에 `table()` 을 그대로 쓰면 안 된다. 지난 핸드의 보드·흐름·"방금 Fold"·내 패가
 * 고스란히 남아 있어서, 모델이 그걸 지금 판으로 읽는다. 실제로 마티암이 작별 인사
 * 자리에서 "오늘은 여기서 그만 빼야겠군. Fold." 했고, 미겔은 아까 깐 손을 한 번 더
 * 자랑했다. 끝난 판의 카드는 말할 거리가 아니라 **군더더기**라 아예 안 넣는다.
 */
function closing(game, speaker, vars) {
  const rows = (vars.table ?? []).map(({ name, chips, delta }) => {
    const sign = delta > 0 ? `+${delta}` : String(delta);
    return `${name}: ${chips}칩 (${sign})${name === vars.me ? ' ← 나' : ''}`;
  });
  return [
    '## 오늘의 결산',
    `${game.handNo}핸드를 했다. 판은 이걸로 끝이다.`,
    ...rows,
    '',
    '## 지금',
    MOMENT.close(vars),
    '※ 지금 카드를 받고 있는 것이 아니다. **수를 두지 않는다** —'
      + ' Fold·Call·Raise 같은 말은 나오면 안 된다. 무슨 패였는지도 이제 와 꺼내지 않는다.',
  ].join('\n');
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
  if (event === 'close') return closing(game, speaker, vars);

  const at = kind === 'banter' || !OWN_MOVE.has(event) ? null : event;
  return [table(game, speaker, at), '', '## 지금', make(vars)].join('\n').trim();
}

// ---------------------------------------------------------------- 스포 검사

/** 그 끗을 부르는 글자말. 숫자꼴(10, 7 …)은 아래에서 따로 — 칩 액수와 생김새가 같다. */
const RANK_WORDS = {
  a: ['A', '에이스'], k: ['K', '킹'], q: ['Q', '퀸'], j: ['J', '잭'], t: ['T', '텐'],
};
const SUIT_WORDS = {
  s: ['♠', '스페이드', '스페'], h: ['♥', '하트'],
  d: ['♦', '다이아몬드', '다이아'], c: ['♣', '클로버', '클럽'],
};
/** 숫자 뒤에 이런 말이 붙으면 카드가 아니라 세는 말이다. */
const COUNTER = '장|명|번|판|칩|개|배|초|분|점|원|씩|째|년|살|위|등|퍼';

/**
 * 그 낱말이 **낱말로서** 나오는지 보는 정규식.
 *
 * 경계를 안 두면 크게 헛짚는다 — A 를 그냥 찾으면 "C**a**ll", "**A**ll-in", "R**a**ise"
 * 가 전부 걸리고, K 는 "Chec**k**" 에 걸린다. NPC 가 매 줄 쓰는 낱말들이라 검사가
 * 사실상 전부를 버리게 된다(실제로 그랬다). 그래서 앞뒤가 글자면 카드가 아니라고 본다.
 *
 * 숫자는 한 겹 더 — "3**장**", "60**칩**" 처럼 세는 말이 붙으면 카드가 아니다.
 */
function token(word) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const letter = /^[A-Za-z]+$/.test(word);
  if (letter) return new RegExp(`(?<![A-Za-z가-힣])${esc}(?![A-Za-z가-힣])`, 'i');
  if (/^\d+$/.test(word)) return new RegExp(`(?<!\\d)${esc}(?!\\d)(?!\\s*(?:${COUNTER}))`);
  return new RegExp(esc);              // 한글 이름(에이스·다이아…)은 그대로
}

/**
 * 지어 온 줄이 **내 홀 카드를 흘리는지** 본다. 흘리면 버릴 이유를, 아니면 null.
 *
 * 보드에 이미 깔린 끗·무늬는 봐준다 — 모두가 보고 있는 카드다. 걸러 내는 것은
 * "내 손에만 있는 것" 뿐이다. 그래서 K♦ 를 들고 보드에 ♦ 가 없는데 "다이아몬드" 를
 * 말하면 걸리고, 보드에 ♦ 가 있으면 안 걸린다.
 *
 * 숫자 끗은 칩 액수와 생김새가 같아서(스몰블라인드가 10 이다) 오검출이 난다.
 * 그때 잃는 것은 **그 한 줄뿐**이고 캔드 대사가 대신 나가므로, 놓치는 쪽보다
 * 지나치게 잡는 쪽으로 기울여 둔다.
 */
export function spoilerVeto(game, speaker) {
  if (OPEN.has(game.phase)) return null;
  const me = game.seats.find((s) => s.character === speaker);
  if (!me?.hole.length) return null;

  const onBoard = game.board;
  const ranks = [...new Set(me.hole.map((c) => c.rank))]
    .filter((r) => !onBoard.some((b) => b.rank === r));
  const suits = [...new Set(me.hole.map((c) => c.suit))]
    .filter((s) => !onBoard.some((b) => b.suit === s));

  const tests = [];
  const add = (word) => tests.push([token(word), `내 ${word}`]);
  for (const r of ranks) {
    for (const w of RANK_WORDS[r] ?? []) add(w);
    add(RANK_TEXT[r] ?? r);            // 숫자꼴. 10 은 "텐" 이자 스몰블라인드 액수다
  }
  for (const s of suits) for (const w of SUIT_WORDS[s]) add(w);

  return (text) => tests.find(([re]) => re.test(text))?.[1] ?? null;
}

/** 쇼다운에서 자기 손을 말할 때 쓸 이름. */
export const handName = (hand) => (hand ? describe(hand) : null);

export default { line, sometimes, memo, handName, spoilerVeto };
