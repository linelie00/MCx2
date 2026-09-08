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
  CATEGORIES, UPPER_KEYS, BONUS_NEED, BONUS_SCORE, ROUNDS,
  scoreAll, openCategories, totals, bonusLost,
} from './rules.js';
import { MAX_SEATS, current, ranking, filledCount } from './state.js';
import { base, THEME_COLOR } from '../embeds.js';

export const PREFIX = 'yacht';

const cid = (game, action, arg) =>
  [PREFIX, game.serial, game.rev, action, arg].filter((x) => x !== undefined).join(':');

// ---------------------------------------------------------------- 폭 맞추기
//
// 한글은 고정폭 글꼴에서 라틴 문자의 두 배를 차지한다. 그냥 padEnd 를 쓰면 이름이 한글인
// 열에서 표가 어긋난다. 게임 전용이라 공용 embeds.js 를 불리지 않고 여기 둔다.

const isWide = (cp) =>
  (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf)
  || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff)
  || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60)
  || (cp >= 0xffe0 && cp <= 0xffe6);

export function width(text) {
  let w = 0;
  for (const ch of String(text)) w += isWide(ch.codePointAt(0)) ? 2 : 1;
  return w;
}

/** 보이는 폭 기준으로 자른다. */
function clipW(text, n) {
  let out = '';
  let w = 0;
  for (const ch of String(text)) {
    const cw = isWide(ch.codePointAt(0)) ? 2 : 1;
    if (w + cw > n) break;
    out += ch;
    w += cw;
  }
  return out;
}

const padEndW = (text, n) => `${text}${' '.repeat(Math.max(0, n - width(text)))}`;
const padStartW = (text, n) => `${' '.repeat(Math.max(0, n - width(text)))}${text}`;

// ---------------------------------------------------------------- 점수표

const LABEL_W = 9;
const COL_W = 7;

/**
 * 코드블록 점수표. 칸이 행, 사람이 열이다.
 * 라벨을 짧게(1~6, 초이스, 포카드…) 쓰는 이유는 4명이어도 한 줄이 안 넘치게 하기 위해서다.
 */
export function scoreTable(game) {
  const seats = game.seats;
  const cell = (v) => (v === null ? '·' : String(v));

  const head = padEndW('', LABEL_W)
    + seats.map((s) => padStartW(clipW(s.name, COL_W - 1), COL_W)).join('');
  // ─(U+2500) 은 클라이언트마다 폭이 갈려서 표가 어긋난다. ASCII 로 정확히 맞춘다.
  const rule = '-'.repeat(LABEL_W + COL_W * seats.length);

  const rowFor = (cat) => padEndW(cat.short, LABEL_W)
    + seats.map((s) => padStartW(cell(s.sheet[cat.key]), COL_W)).join('');

  const upper = CATEGORIES.filter((c) => UPPER_KEYS.includes(c.key)).map(rowFor);
  const lower = CATEGORIES.filter((c) => !UPPER_KEYS.includes(c.key)).map(rowFor);

  const sub = padEndW('소계', LABEL_W)
    + seats.map((s) => padStartW(String(totals(s.sheet).upper), COL_W)).join('');

  // 보너스는 받았으면 +35, 물 건너갔으면 ×, 아직이면 몇 점 남았는지. 마티암의 신중함이
  // 여기서 눈에 보인다.
  const bonus = padEndW('보너스', LABEL_W) + seats.map((s) => {
    const t = totals(s.sheet);
    if (t.bonus) return padStartW(`+${BONUS_SCORE}`, COL_W);
    if (bonusLost(s.sheet)) return padStartW('×', COL_W);
    return padStartW(`-${t.bonusNeed}`, COL_W);
  }).join('');

  const total = padEndW('합계', LABEL_W)
    + seats.map((s) => padStartW(String(totals(s.sheet).total), COL_W)).join('');

  return ['```', head, ...upper, sub, bonus, rule, ...lower, rule, total, '```'].join('\n');
}

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
 * 처음엔 유니코드 주사위 문자(U+2680~2685)를 썼는데 디스코드에서 두부(▯)로 깨졌다.
 * 글꼴에 그 글자가 없으면 그냥 네모가 된다. 키캡 숫자 이모지는 디스코드가 자체 이미지로
 * 그려 주므로 어느 기기에서나 똑같이 보인다.
 */
const KEYCAPS = ['', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];

let FACES = [...KEYCAPS];

/**
 * 서버에 진짜 주사위 그림을 올려 뒀으면 그걸 쓴다.
 *
 * 커스텀 이모지는 `<:이름:id>` 형태라 코드에 박아 둘 수가 없다(서버마다 id 가 다르다).
 * 그래서 부팅할 때 이름으로 찾아 갈아 끼운다 — 없으면 키캡 그대로다.
 */
export function useCustomFaces(found) {
  FACES = FACES.map((v, i) => found[i] || KEYCAPS[i]);
}

export const faceOf = (d) => FACES[d];

/** 눈 다섯 개를 나란히. 채팅에 굴림 결과를 알릴 때도 쓴다. */
export const faces = (dice) => dice.map((d) => FACES[d]).join(' ');

/** 고정한 것은 [] 로 감싼다. 색만으로는 색각 이상이 있으면 구분이 안 된다. */
const diceLine = (game) =>
  game.dice.map((d, i) => (game.held[i] ? `[${FACES[d]}]` : ` ${FACES[d]} `)).join(' ');

export function boardEmbed(game) {
  const seat = current(game);
  const lines = [];

  // NPC 는 순식간에 두고 지나가므로, 직전에 무엇을 했는지 판에 남겨 둔다.
  if (game.lastMove) {
    const m = game.lastMove;
    lines.push(`직전 · **${m.name}** ${faces(m.dice)} → ${m.label} **${m.gained}점**`, '');
  }

  if (game.dice) {
    lines.push(`\`${diceLine(game)}\`  ${game.held.some(Boolean) ? '— `[ ]` 는 고정' : ''}`.trim());
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
    footer: `포카드·풀하우스는 주사위 5개의 합 · 상단 ${BONUS_NEED}점이면 +${BONUS_SCORE}`,
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
      new ButtonBuilder().setCustomId(cid(game, 'hold', i)).setLabel(FACES[d])
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
  PREFIX, faceOf, faces, useCustomFaces, width, scoreTable,
  lobbyEmbed, lobbyRows, boardEmbed, boardRows, resultEmbed,
};
