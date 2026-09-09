/**
 * render — 판을 임베드와 버튼 줄로 그린다
 *
 * 버튼 줄은 매번 새로 만든다(지워진 voice/controls.js 가 쓰던 방식). 상태에 따라 라벨과
 * 활성 여부가 달라지므로 재사용하면 반드시 어긋난다.
 *
 * customId 는 `yacht:<판번호>:<rev>:<동작>[:<값>]` 이다. rev 를 넣는 이유는 디스코드가
 * 누른 버튼을 비활성화해 주지 않기 때문이다 — 굴리기를 빠르게 두 번 누르면 두 번 굴러간다.
 * 지나간 rev 의 클릭은 조용히 무시하고 다시 그리기만 한다.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import {
  CATEGORIES, UPPER_KEYS, BONUS_NEED, BONUS_SCORE, ROUNDS, MAX_ROLLS,
  scoreAll, openCategories, totals, bonusLost,
} from './rules.js';
import { MAX_SEATS, current, ranking, filledCount } from './state.js';
import { base, THEME_COLOR } from '../embeds.js';
import { width, clipW, padEndW, padStartW } from '../text.js';

export const PREFIX = 'yacht';

const cid = (game, action, arg) =>
  [PREFIX, game.serial, game.rev, action, arg].filter((x) => x !== undefined).join(':');

// ---------------------------------------------------------------- 점수표

const LABEL_W = 9;
const COL_W = 7;

/**
 * 오른쪽 배점 안내.
 *
 * 규칙을 매번 물어보지 않아도 되게 표 안에 넣어 둔다. 화살표(→)나 ↑ 같은 기호는
 * 클라이언트마다 폭이 갈려 표를 어긋나게 하므로 안 쓴다.
 */
const HINTS = {
  // 위칸을 전부 "눈의 합" 이라고만 적어 두니 어느 눈을 세는 건지가 안 보였다.
  // 라벨이 1~6 이라 더 헷갈린다. 세는 눈을 그대로 적는다.
  aces: '1의 합',
  deuces: '2의 합',
  threes: '3의 합',
  fours: '4의 합',
  fives: '5의 합',
  sixes: '6의 합',
  choice: '눈의 합',
  fourKind: '눈의 합',
  fullHouse: '눈의 합',
  sStraight: '15',
  lStraight: '30',
  yacht: '50',
};

const BONUS_HINT = `소계 ${BONUS_NEED} 이상`;
const HINT_W = Math.max(...Object.values(HINTS).map(width), width(BONUS_HINT), width('배점'));

/**
 * 코드블록 점수표. 칸이 행, 사람이 열이다.
 * 라벨을 짧게(1~6, 초이스, 포카드…) 쓰는 이유는 4명이어도 한 줄이 안 넘치게 하기 위해서다.
 */
export function scoreTable(game) {
  const seats = game.seats;
  const cell = (v) => (v === null ? '·' : String(v));

  /** 사람 열들 뒤에 배점 안내를 붙인다. 없는 줄(소계·합계)은 빈칸으로 둔다. */
  const row = (label, cells, hint = '') =>
    padEndW(label, LABEL_W) + cells.join('') + (hint ? `   ${hint}` : '');

  const head = row('', seats.map((s) => padStartW(clipW(s.name, COL_W - 1), COL_W)), '배점');
  // ─(U+2500) 은 클라이언트마다 폭이 갈려서 표가 어긋난다. ASCII 로 정확히 맞춘다.
  const rule = '-'.repeat(LABEL_W + COL_W * seats.length + 3 + HINT_W);

  const rowFor = (cat) => row(
    cat.short,
    seats.map((s) => padStartW(cell(s.sheet[cat.key]), COL_W)),
    HINTS[cat.key],
  );

  const upper = CATEGORIES.filter((c) => UPPER_KEYS.includes(c.key)).map(rowFor);
  const lower = CATEGORIES.filter((c) => !UPPER_KEYS.includes(c.key)).map(rowFor);

  const sub = row('소계', seats.map((s) => padStartW(String(totals(s.sheet).upper), COL_W)));

  // 보너스는 받았으면 +35, 물 건너갔으면 ×, 아직이면 몇 점 남았는지. 마티암의 신중함이
  // 여기서 눈에 보인다.
  const bonus = row('보너스', seats.map((s) => {
    const t = totals(s.sheet);
    if (t.bonus) return padStartW(`+${BONUS_SCORE}`, COL_W);
    if (bonusLost(s.sheet)) return padStartW('×', COL_W);
    return padStartW(`-${t.bonusNeed}`, COL_W);
  }), BONUS_HINT);

  const total = row('합계', seats.map((s) => padStartW(String(totals(s.sheet).total), COL_W)));

  return ['```', head, ...upper, sub, bonus, rule, ...lower, rule, total, '```'].join('\n');
}

/**
 * 판을 열 때 한 번 띄우는 규칙 안내.
 *
 * 점수표 오른쪽 안내 열은 좁아서 "1의 합" 정도밖에 못 적는다. 처음 하는 사람이
 * 알아야 할 것 — 몇 번까지 굴리는지, 고른 칸을 왜 못 되돌리는지, 맞는 칸이 없을 때
 * 어떻게 하는지 — 은 거기 안 들어가서 따로 한 번만 띄운다.
 *
 * 룰이 갈리는 지점은 rules.js 머리말과 같은 것을 적는다. 한국식 12칸이라 포카드와
 * 풀하우스가 서양 Yahtzee 와 다른데, 그걸 모르면 점수가 잘못 나온 줄 안다.
 */
export const howto = () => base({
  title: '🎲 요트 다이스 — 처음이신가요?',
  description: [
    '주사위 다섯 개를 굴려 **12칸을 하나씩 채우는** 게임입니다.',
    '한 사람이 12번씩 두고, 다 채우면 **합계가 높은 사람이 이깁니다.**',
    '',
    '**■ 한 턴은 이렇게 흘러갑니다**',
    `1. 다섯 개를 굴립니다 — ${faces([3, 3, 5, 1, 6])}`,
    `2. 남길 것을 골라 나머지만 다시 굴립니다 — ${faces([3, 3, 5, 1, 6], [1, 1, 0, 0, 0])} 를 남기고 셋만`,
    `3. 2번을 **최대 ${MAX_ROLLS - 1}번 더** 할 수 있어요 (굴리기는 다 합쳐 ${MAX_ROLLS}번)`,
    '4. 마음에 드는 **칸 하나를 골라** 점수를 적습니다',
    '',
    '한 번 적은 칸은 다시 못 씁니다. 그래서 좋은 눈이 나와도 **어디에 적을지**가 고민이에요.',
    '맞는 칸이 하나도 없으면 **아무 칸에나 0점을 적어도 됩니다.** 버릴 칸을 고르는 것도 실력입니다.',
    '',
    '**■ 위칸 — 1부터 6까지**',
    `그 눈만 세서 더합니다. ${faces([3, 3, 3, 1, 5])} 를 **3의 눈** 칸에 적으면 3이 세 개라 **9점**.`,
    `위칸 여섯 칸의 합이 **${BONUS_NEED} 이상**이면 보너스 **+${BONUS_SCORE}점**을 더 받아요.`,
    '(각 칸에 그 눈이 세 개씩만 들어가면 딱 63입니다. 이게 판을 가르는 지점이에요.)',
    '',
    '**■ 아래칸 — 여섯 칸**',
    `**초이스** — 아무거나. 다섯 개 전부의 합. ${faces([6, 6, 4, 3, 2])} → 21점`,
    `**포카드** — 같은 눈 4개 이상. ${faces([5, 5, 5, 5, 2])} → **22점**`,
    '　(네 개만 더한 20이 아니라 **다섯 개 전부**를 더합니다. 서양 Yahtzee 와 다른 점이에요.)',
    `**풀하우스** — 3개 + 2개. ${faces([5, 5, 5, 2, 2])} → **19점**`,
    '　(25점 고정이 아니라 이것도 다섯 개 전부의 합입니다.)',
    `**S스트** — 연속 **4개**면 **15점** 고정. ${faces([2, 3, 4, 5, 1])}`,
    `**L스트** — 연속 **5개**면 **30점** 고정. ${faces([1, 2, 3, 4, 5])}`,
    `**요트** — 다섯 개가 전부 같으면 **50점**. ${faces([5, 5, 5, 5, 5])}`,
    '',
    '조건에 안 맞으면 그 칸은 **0점**입니다. 포카드 칸에 아무거나 적으면 0점이에요.',
  ].join('\n'),
  footer: '점수표 오른쪽에 각 칸의 배점이 적혀 있어요 · 10분 동안 아무도 안 누르면 판이 닫혀요.',
});

// ---------------------------------------------------------------- 대기실

export function lobbyEmbed(game) {
  const seats = game.seats.length
    ? game.seats.map((s) => `· ${s.name}${s.kind === 'npc' ? ' (NPC)' : ''}`).join('\n')
    : '_아직 아무도 없어요._';

  return base({
    title: '요트 다이스 — 자리 맡는 중',
    description: [
      seats,
      '',
      `${game.seats.length}/${MAX_SEATS}자리 · 두 자리부터 시작할 수 있어요.`,
    ].join('\n'),
    footer: '참가하거나 NPC 를 불러 주세요.',
  });
}

export function lobbyRows(game) {
  const full = game.seats.length >= MAX_SEATS;
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(cid(game, 'join')).setLabel('참가')
      .setStyle(ButtonStyle.Primary).setDisabled(full),
    new ButtonBuilder().setCustomId(cid(game, 'npc', 'migel')).setLabel('미겔 부르기')
      .setStyle(ButtonStyle.Secondary).setDisabled(full),
    new ButtonBuilder().setCustomId(cid(game, 'npc', 'matiam')).setLabel('마티암 부르기')
      .setStyle(ButtonStyle.Secondary).setDisabled(full),
    new ButtonBuilder().setCustomId(cid(game, 'start')).setLabel('시작')
      .setStyle(ButtonStyle.Success).setDisabled(game.seats.length < 2),
    new ButtonBuilder().setCustomId(cid(game, 'cancel')).setLabel('취소')
      .setStyle(ButtonStyle.Danger),
  )];
}

// ---------------------------------------------------------------- 진행 중

/**
 * 주사위 눈.
 *
 * 처음엔 유니코드 주사위 문자(U+2680~2685)를 썼다. 렌더는 됐지만 **글자라서 너무 작다** —
 * 본문 글자 크기로 그려지는 데다 흑백이라 눈이 몇인지 알아보기 어려웠다.
 * 키캡 숫자 이모지는 디스코드가 이모지 크기의 컬러 이미지로 그려 줘서 확 눈에 띈다.
 */
const KEYCAPS = ['', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];

let FACES = [...KEYCAPS];
let KEPT = null;

/**
 * 서버에 진짜 주사위 그림을 올려 뒀으면 그걸 쓴다.
 *
 * 커스텀 이모지는 `<:이름:id>` 형태라 코드에 박아 둘 수가 없다(서버마다 id 가 다르다).
 * 그래서 부팅할 때 이름으로 찾아 갈아 끼운다 — 없으면 키캡 그대로다.
 *
 * kept 는 **남긴 주사위용 다른 색** 그림이다. 이것까지 있으면 남긴 것을 색으로 구분하고,
 * 없으면 [] 로 감싼다. 이모지에는 굵게·색 같은 마크다운이 안 먹어서, 표준 이모지만으로는
 * 색을 달리할 방법이 없다.
 */
export function useCustomFaces(found, kept) {
  FACES = FACES.map((v, i) => found[i] || KEYCAPS[i]);
  KEPT = kept?.some(Boolean) ? kept : null;
}

export const faceOf = (d) => FACES[d];

/** 남긴 눈 하나. 다른 색 그림이 있으면 그걸로, 없으면 [] 로 감싼다. */
const heldFace = (d) => KEPT?.[d] || `[${FACES[d]}]`;

const CUSTOM = /^<a?:(\w+):(\d+)>$/;

/**
 * 버튼에 붙일 이모지.
 *
 * 버튼 **라벨은 이모지 문법을 해석하지 않는다.** `<:dice2:123>` 을 라벨에 넣으면 그
 * 글자가 그대로 보인다(실제로 그렇게 나왔다). 커스텀 이모지는 setEmoji 로 넣어야 하고,
 * 그때는 `<:이름:id>` 가 아니라 { id, name } 을 줘야 한다.
 *
 * 버튼에서는 남긴 것을 [] 로 감싸지 않는다 — 초록 버튼 색이 이미 그 표시다.
 */
export function faceEmoji(d, held) {
  const s = (held && KEPT?.[d]) || FACES[d];
  const m = CUSTOM.exec(s);
  return m ? { id: m[2], name: m[1] } : s;
}

/**
 * 눈 다섯 개를 나란히. held 를 주면 남긴 것을 구분해 그린다.
 * 채팅의 굴림 알림과 판이 같은 표기를 쓴다 — 두 군데가 다르면 헷갈린다.
 */
export const faces = (dice, held) => dice
  .map((d, i) => (held?.[i] ? heldFace(d) : FACES[d]))
  .join(' ');

export function boardEmbed(game) {
  const seat = current(game);
  const lines = [];

  // NPC 는 순식간에 두고 지나가므로, 직전에 무엇을 했는지 판에 남겨 둔다.
  if (game.lastMove) {
    const m = game.lastMove;
    lines.push(`직전 · **${m.name}** ${faces(m.dice)} → ${m.label} **${m.gained}점**`, '');
  }

  if (game.dice) {
    // 인라인 코드(`) 로 감싸면 안 된다 — 이모지가 글자 크기로 쪼그라든다.
    lines.push(`${faces(game.dice, game.held)}${game.held.some(Boolean) ? '　← 고정' : ''}`);
    lines.push(game.rollsLeft > 0 ? `굴릴 수 있는 횟수 **${game.rollsLeft}번**` : '**마지막 굴림이에요.** 적을 칸을 고르세요.');
  } else if (seat.kind === 'npc') {
    // 사람이 칸을 적은 직후 잠깐 이 상태가 보인다. NPC 에게 굴리라고 할 수는 없다.
    lines.push(`_${seat.name}이(가) 주사위를 집습니다…_`);
  } else {
    lines.push('_주사위를 굴려 주세요._');
  }

  if (game.trail.length) lines.push('', game.trail.join('\n'));
  lines.push('', scoreTable(game));

  return base({
    title: `요트 다이스 · ${game.round}/${ROUNDS}라운드 — ${seat.name} 차례`,
    description: lines.join('\n'),
    color: seat.color,
  });
}

export function boardRows(game) {
  const seat = current(game);
  // NPC 차례에는 사람이 누를 게 없다. 버튼을 비워 두면 판이 멈춘 것처럼 보이므로
  // 비활성 버튼 하나로 누구를 기다리는지 보여준다.
  if (seat.kind === 'npc') {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cid(game, 'wait')).setLabel(`${seat.name}이(가) 두는 중…`)
        .setStyle(ButtonStyle.Secondary).setDisabled(true),
    )];
  }

  if (!game.dice) {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cid(game, 'roll')).setLabel('굴리기')
        .setStyle(ButtonStyle.Primary),
    )];
  }

  const rows = [
    new ActionRowBuilder().addComponents(...game.dice.map((d, i) =>
      new ButtonBuilder().setCustomId(cid(game, 'hold', i))
        .setEmoji(faceEmoji(d, game.held[i]))
        .setStyle(game.held[i] ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(game.rollsLeft === 0))),
  ];

  const canRoll = game.rollsLeft > 0 && !game.held.every(Boolean);
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(cid(game, 'roll'))
      .setLabel(game.rollsLeft > 0 ? `다시 굴리기 (${game.rollsLeft}번 남음)` : '더 못 굴려요')
      .setStyle(ButtonStyle.Primary).setDisabled(!canRoll),
  ));

  // 셀렉트 선택이 곧 기록이다. 따로 "기록하기" 버튼을 두면 고른 값을 어딘가 들고 있다가
  // 주사위가 바뀔 때마다 무효화해야 해서, 이득 없이 버그 자리만 는다.
  const scores = scoreAll(game.dice);
  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(cid(game, 'pick'))
      .setPlaceholder('어느 칸에 적을까요?')
      .addOptions(openCategories(seat.sheet).map((key) => {
        const cat = CATEGORIES.find((c) => c.key === key);
        return { label: `${cat.label} — ${scores[key]}점`, value: key };
      })),
  ));

  return rows;
}

// ---------------------------------------------------------------- 끝

const MEDAL = ['🥇', '🥈', '🥉'];

export function resultEmbed(game) {
  const rows = ranking(game);
  const done = game.endedReason === 'finished';

  const head = rows.map((r) =>
    `${MEDAL[r.rank - 1] ?? `${r.rank}위`} **${r.seat.name}** — ${r.total}점`).join('\n');

  const note = {
    finished: null,
    idle: '_한참 아무도 두지 않아서 판을 접었어요._',
    cancelled: '_판을 접었어요._',
  }[game.endedReason];

  return base({
    title: done ? '요트 다이스 — 끝!' : '요트 다이스 — 중단',
    description: [head, note, '', scoreTable(game)].filter((x) => x !== null).join('\n'),
    color: rows[0]?.seat.color ?? THEME_COLOR,
    footer: done ? `${ROUNDS}라운드 완주` : `${filledCount(game.seats[0].sheet)}칸까지 진행`,
  });
}

export default {
  PREFIX, faceOf, faceEmoji, faces, useCustomFaces, scoreTable,
  lobbyEmbed, lobbyRows, boardEmbed, boardRows, resultEmbed,
};
