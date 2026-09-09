/**
 * render — 판을 임베드와 버튼 줄로 그린다
 *
 * 요트·블랙잭의 render.js 와 뼈대가 같다. customId 는
 * `hold:<판번호>:<rev>:<동작>[:<값>]` 이고, 버튼 줄은 매번 새로 만든다.
 *
 * **여기서 지켜야 할 것이 하나 더 있다 — 홀 카드를 그리지 않는다.**
 * 판은 모두가 보는 메시지다. 남의 두 장이 여기 보이면 게임이 끝난다. 자리 줄에는
 * 칩·베팅·직전 행동만 적고, 카드는 쇼다운에서 끝까지 간 사람만 깐다.
 * 자기 카드는 `[내 패]` 버튼이 나만 보이는 메시지로 보여 준다(commands/holdem.js).
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { handText, isJumboable } from '../casino/cards.js';
import { describe } from '../casino/poker.js';
import { SMALL_BLIND, BIG_BLIND, MAX_SEATS } from './rules.js';
import {
  BUY_IN, currentSeat, actionsFor, raisesFor, toCallFor, pot, standings,
} from './state.js';
import { base, THEME_COLOR } from '../embeds.js';
import { padEndW, padStartW, clipW } from '../text.js';

export const PREFIX = 'hold';

const cid = (game, action, arg) =>
  [PREFIX, game.serial, game.rev, action, arg].filter((x) => x !== undefined).join(':');

const btn = (game, action, label, style = ButtonStyle.Secondary, arg) =>
  new ButtonBuilder().setCustomId(cid(game, action, arg)).setLabel(label).setStyle(style);

/** 카드가 나온 뒤에는 언제나 켜 둔다. 남의 차례에도 자기 패는 볼 수 있어야 한다. */
const holeBtn = (game) => btn(game, 'hole', '내 패', ButtonStyle.Primary)
  .setDisabled(!game.seats.some((s) => s.hole.length));

// ---------------------------------------------------------------- 자리 표

const NAME_W = 9;
const COL_W = 7;
const ACT_W = 12;

/**
 * 칩·베팅·**방금 한 행동**을 코드블록 표로.
 *
 * 방금 한 행동을 안 보여 주면 NPC 가 무엇을 했는지 알 길이 없다. 사람은 자기가 누른
 * 것을 알지만 남의 수는 판에만 남기 때문이다. 칩 변화로 유추하게 두면 폴드와 체크를
 * 구분할 수 없다.
 *
 * **카드는 여기 안 넣는다** — 코드블록 안에서는 이모지가 글자 크기로 쪼그라든다
 * (요트에서 겪은 그 문제다). 그리고 애초에 남의 홀 카드는 어디에도 안 그린다.
 */
function seatTable(game) {
  const rows = game.seats.map((s, i) => {
    const here = game.turn === i ? '▸' : ' ';
    const dealer = i === game.button ? 'D' : ' ';
    const act = s.out ? '자리 비움' : (s.lastAction ?? '');
    return `${here}${dealer} `
      + padEndW(clipW(s.name, NAME_W - 1), NAME_W)
      + padStartW(String(s.chips), COL_W)
      + padStartW(s.bet ? String(s.bet) : '·', COL_W)
      + `  ${padEndW(clipW(act, ACT_W), ACT_W)}`;
  });

  const head = '   ' + padEndW('', NAME_W) + padStartW('칩', COL_W) + padStartW('이번', COL_W)
    + '  방금';
  return ['```', head, '-'.repeat(NAME_W + COL_W * 2 + ACT_W + 5), ...rows, '```'].join('\n');
}

// ---------------------------------------------------------------- 안내

/**
 * 판을 열 때 한 번 띄우는 규칙 안내.
 *
 * 홀덤은 요트·블랙잭보다 규칙이 많고, 무엇보다 **내 카드를 어떻게 보는지**를 모르면
 * 아무것도 못 한다. 그 한 줄이 이 안내의 핵심이다.
 */
export const howto = () => base({
  title: '🃏 카지노 bard — 텍사스 홀덤',
  description: [
    '**각자 두 장**을 받고, 가운데 **다섯 장**을 함께 씁니다.',
    '일곱 장 중 **가장 좋은 다섯 장**으로 겨뤄 가장 센 사람이 팟을 가져갑니다.',
    '',
    '**`[내 패]` 를 누르면 내 두 장이 나에게만 보입니다.** 남에게는 안 보여요.',
    '',
    '**베팅은 네 번** — 카드를 받고(프리플랍), 석 장이 깔리고(플랍),',
    '한 장 더(턴), 마지막 한 장(리버).',
    '',
    '**Fold** 접기 · **Check** 그냥 넘기기 · **Call** 맞추기',
    '**Raise** 올리기 (금액은 버튼으로 고릅니다) · **All-in** 전부',
    '',
    `블라인드 **${SMALL_BLIND} / ${BIG_BLIND}**, 앉을 때 **${BUY_IN}칩**.`,
    '버튼(D)은 핸드마다 한 칸씩 돌고, 블라인드도 따라 돕니다.',
    '',
    '**손의 순서** — 스트레이트 플러시 > 포카드 > 풀하우스 > 플러시 >',
    '스트레이트 > 트리플 > 투페어 > 원페어 > 하이카드',
  ].join('\n'),
  footer: '10분 동안 아무도 안 누르면 판이 저절로 닫혀요.',
});

// ---------------------------------------------------------------- 대기실

export function lobbyEmbed(game) {
  const seats = game.seats.length
    ? game.seats.map((s) => `· ${s.name}${s.kind === 'npc' ? ' (NPC)' : ''}`).join('\n')
    : '_아직 아무도 없어요._';

  return base({
    title: '홀덤 — bard 에 자리 맡는 중',
    description: [
      seats, '',
      `${game.seats.length}/${MAX_SEATS}자리 · 두 자리부터 시작할 수 있어요.`,
    ].join('\n'),
    footer: `블라인드 ${SMALL_BLIND}/${BIG_BLIND} · 앉으면 ${BUY_IN}칩`,
  });
}

export function lobbyRows(game) {
  const full = game.seats.length >= MAX_SEATS;
  return [new ActionRowBuilder().addComponents(
    btn(game, 'join', '참가', ButtonStyle.Primary).setDisabled(full),
    btn(game, 'npc', '미겔 부르기', ButtonStyle.Secondary, 'migel').setDisabled(full),
    btn(game, 'npc', '마티암 부르기', ButtonStyle.Secondary, 'matiam').setDisabled(full),
    btn(game, 'start', '시작', ButtonStyle.Success).setDisabled(game.seats.length < 2),
    btn(game, 'cancel', '취소', ButtonStyle.Danger),
  )];
}

// ---------------------------------------------------------------- 진행 중

const STREET_LABEL = {
  preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버',
  showdown: '쇼다운', settled: '정산',
};

/** 쇼다운에서 깐 패. 끝까지 간 사람만 나온다. */
function showdownLines(game) {
  const shown = game.results?.shown ?? [];
  if (!shown.length) return [];
  return [
    '**쇼다운**',
    ...shown.map(({ seatIndex, hand }) => {
      const s = game.seats[seatIndex];
      return `　**${s.name}** ${handText(s.hole)}　_${describe(hand)}_`;
    }),
    '',
  ];
}

export function boardEmbed(game) {
  const lines = [];

  if (game.board.length) {
    lines.push('**보드**', `　${handText(game.board)}`, '');
  } else if (game.phase !== 'lobby') {
    lines.push('_보드는 아직 없습니다._', '');
  }

  lines.push(...showdownLines(game));

  if (game.phase === 'settled' && game.results) {
    lines.push(...game.results.rows
      .filter((r) => r.put > 0 || r.won > 0)
      .map((r) => {
        const sign = r.net > 0 ? `+${r.net}` : String(r.net);
        return `**${r.seat.name}** \`${sign}\``;
      }), '');
  }

  lines.push(seatTable(game));

  const seat = currentSeat(game);
  const title = game.phase === 'settled'
    ? `홀덤 · ${game.handNo}번째 핸드 — 정산`
    : `홀덤 · ${game.handNo}번째 핸드 — ${STREET_LABEL[game.phase] ?? ''}`
      + (seat ? ` · ${seat.name} 차례` : '');

  return base({
    title,
    description: lines.join('\n'),
    color: seat?.color ?? THEME_COLOR,
    footer: `팟 ${pot(game)} · 블라인드 ${SMALL_BLIND}/${BIG_BLIND}`
      + ` · 버튼 ${game.seats[game.button]?.name ?? '-'}`,
  });
}

export function boardRows(game) {
  if (game.phase === 'settled' || game.phase === 'showdown') {
    return [new ActionRowBuilder().addComponents(
      btn(game, 'next', '다음 핸드', ButtonStyle.Success),
      btn(game, 'stop', '정산하고 끝내기', ButtonStyle.Danger),
      holeBtn(game),
    )];
  }

  const seat = currentSeat(game);
  if (!seat) {
    return [new ActionRowBuilder().addComponents(
      btn(game, 'wait', '진행 중…').setDisabled(true),
      holeBtn(game),
    )];
  }

  // NPC 차례에는 누를 것이 없다. 그래도 [내 패] 는 켜 둔다 — 남이 두는 동안에도
  // 자기 카드는 볼 수 있어야 한다.
  if (seat.kind === 'npc') {
    return [new ActionRowBuilder().addComponents(
      btn(game, 'wait', `${seat.name}이(가) 두는 중…`).setDisabled(true),
      holeBtn(game),
    )];
  }

  // 레이즈 금액을 고르는 중 — 그 사람에게만 의미가 있지만 버튼은 모두에게 보인다.
  // 명령 쪽에서 차례가 아닌 사람을 거절한다.
  if (game.raising) {
    const opts = raisesFor(game);
    return [new ActionRowBuilder().addComponents(
      ...opts.slice(0, 4).map((o) => btn(game, 'to', o.label, ButtonStyle.Primary, o.to)),
      btn(game, 'back', '취소', ButtonStyle.Secondary),
    )];
  }

  const legal = actionsFor(game);
  const need = toCallFor(game, seat);
  const row = new ActionRowBuilder().addComponents(
    btn(game, 'act', 'Fold', ButtonStyle.Danger, 'fold').setDisabled(!legal.has('fold')),
    legal.has('check')
      ? btn(game, 'act', 'Check', ButtonStyle.Success, 'check')
      : btn(game, 'act', `Call ${need}`, ButtonStyle.Success, 'call')
        .setDisabled(!legal.has('call')),
    btn(game, 'raise', 'Raise', ButtonStyle.Primary).setDisabled(!legal.has('raise')),
    btn(game, 'act', 'All-in', ButtonStyle.Secondary, 'allin').setDisabled(!legal.has('allin')),
    holeBtn(game),
  );
  return [row];
}

/**
 * `[내 패]` 로 그 사람에게만 보내는 것.
 *
 * **이모지만 있는 메시지여야 디스코드가 카드를 크게 그린다.** 글자가 하나라도 섞이거나
 * 임베드 안에 들어가면 무조건 글자 크기로 쪼그라든다. 그래서 이모지가 올라가 있으면
 * 임베드를 버리고 카드만 보낸다 — 칩·팟은 어차피 판에 있고, 본인이 누른 것이라
 * 무슨 메시지인지 설명할 필요도 없다.
 *
 * 이모지가 없을 때(부팅 때 못 찾았을 때)는 어차피 글자라 커질 수가 없으므로 임베드로 간다.
 */
export function holeMessage(game, seat) {
  const cards = handText(seat.hole);
  if (isJumboable(cards)) return { content: cards };

  const lines = [`　${cards}`];
  if (game.board.length) lines.push('', '**보드**', `　${handText(game.board)}`);
  return {
    embeds: [base({
      title: `${seat.name}의 패`,
      description: lines.join('\n'),
      color: seat.color,
      footer: `칩 ${seat.chips} · 이번 라운드 ${seat.bet} · 팟 ${pot(game)}`,
    })],
  };
}

// ---------------------------------------------------------------- 끝

export function resultEmbed(game) {
  const rows = standings(game).map((r, i) => {
    const sign = r.delta > 0 ? `+${r.delta}` : String(r.delta);
    return `${['🥇', '🥈', '🥉'][i] ?? '　'} **${r.seat.name}** ${r.chips}칩 \`${sign}\``;
  });
  return base({
    title: '홀덤 — 판이 끝났어요',
    description: rows.join('\n'),
    footer: `${game.handNo}핸드`,
  });
}

/**
 * 차례인 사람을 부르는 한 줄. 판 메시지의 content 로 같이 나간다.
 *
 * 따로 메시지를 보내면 판이 또 밀리므로 **판에 얹는다.** 새 메시지로 나갈 때만 알림이
 * 울리므로(제자리 수정은 안 울린다), 부르는 효과는 repost 하는 자리에서만 생긴다.
 */
export function turnCall(game) {
  if (!['preflop', 'flop', 'turn', 'river'].includes(game.phase)) return null;
  const seat = currentSeat(game);
  if (!seat || seat.kind !== 'human' || !seat.userId) return null;
  const need = toCallFor(game, seat);
  return `<@${seat.userId}> 차례예요 — ${need > 0 ? `${need} 맞추거나 접거나` : '체크할 수 있어요'}`;
}

export default {
  PREFIX, howto, lobbyEmbed, lobbyRows, boardEmbed, boardRows, holeMessage, turnCall, resultEmbed,
};
