/**
 * render — 판을 임베드와 버튼 줄로 그린다
 *
 * 요트의 render.js 와 뼈대가 같다. 버튼 줄은 매번 새로 만들고, customId 는
 * `bj:<판번호>:<rev>:<동작>[:<값>]` 이다.
 *
 * 요트와 다른 점이 하나 있다. **베팅·인슈어런스 단계에서는 버튼을 비활성화하지 않는다.**
 * 여럿이 동시에 누르는 단계라 "너는 이미 답했다" 를 setDisabled 로 표현할 수가 없다
 * (버튼 상태는 모두에게 같은데 조건은 사람마다 다르다). 그래서 그 두 단계는 일단 다
 * 켜 두고 명령 쪽에서 사람마다 거절한다. 한 사람만 누르는 playing 단계에서만 끈다.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { handValue, handText, isBlackjack } from '../casino/cards.js';
import { BET_UNITS, OUTCOME_LABEL, insuranceCost } from './rules.js';
import {
  MAX_SEATS, active, currentHand, currentSeat, seatOfHand, actionsFor,
  dealerUp, standings, allIn,
} from './state.js';
import { base, THEME_COLOR } from '../embeds.js';
import { padEndW, padStartW, clipW } from '../text.js';

export const PREFIX = 'bj';

const cid = (game, action, arg) =>
  [PREFIX, game.serial, game.rev, action, arg].filter((x) => x !== undefined).join(':');

const btn = (game, action, label, style = ButtonStyle.Secondary, arg) =>
  new ButtonBuilder().setCustomId(cid(game, action, arg)).setLabel(label).setStyle(style);

// ---------------------------------------------------------------- 칩 표

const NAME_W = 10;
const COL_W = 9;

/**
 * 칩과 베팅을 코드블록 표로. **카드는 여기 안 넣는다** — 코드블록 안에서는 이모지가
 * 글자 크기로 쪼그라든다(요트에서 겪은 그 문제다).
 */
function chipTable(game) {
  const rows = game.seats.map((s) => {
    const bet = s.out ? '—'
      : (s.bet ? String(s.bet) : (s.staged ? `${s.staged}…` : '·'));
    const ins = s.insurance ? `+${s.insurance}` : '';
    return padEndW(clipW(s.name, NAME_W - 1), NAME_W)
      + padStartW(String(s.chips), COL_W)
      + padStartW(bet, COL_W)
      + (ins ? `  ${ins}` : '');
  });

  const head = padEndW('', NAME_W) + padStartW('칩', COL_W) + padStartW('베팅', COL_W);
  return ['```', head, '-'.repeat(NAME_W + COL_W * 2), ...rows, '```'].join('\n');
}

/**
 * 한 손을 한 줄로. 카드와 합계, 그리고 지금 두는 손이면 표시.
 *
 * 손 번호는 **그 사람 안에서** 센다. 전체 hands 의 인덱스를 쓰면 앞사람 손 수만큼
 * 밀려서 "마티암 #2, 마티암 #3" 이 되고, 마티암이 셋 있는 것처럼 보인다.
 */
function handLine(game, hand) {
  const seat = seatOfHand(game, hand);
  const { total, bust } = handValue(hand.cards);
  const mark = game.phase === 'playing' && game.hands[game.turn] === hand ? '▸ ' : '　';
  const tags = [
    bust ? 'Bust' : null,
    !hand.fromSplit && isBlackjack(hand.cards) ? 'Blackjack' : null,
    hand.surrendered ? 'Surrender' : null,
    hand.doubled ? 'Double' : null,
  ].filter(Boolean);

  const mine = game.hands.filter((h) => h.seatIndex === hand.seatIndex);
  const who = mine.length > 1 ? `${seat.name} #${mine.indexOf(hand) + 1}` : seat.name;

  return `${mark}**${who}** · ${hand.bet}칩\n　${handText(hand.cards)}　**${total}**`
    + (tags.length ? `　_${tags.join(' · ')}_` : '');
}

// ---------------------------------------------------------------- 대기실

export function lobbyEmbed(game) {
  const seats = game.seats.length
    ? game.seats.map((s) => `· ${s.name}${s.kind === 'npc' ? ' (NPC)' : ''}`).join('\n')
    : '_아직 아무도 없어요._';

  // 미겔이 앉는 순간 딜러가 npc 로 바뀐다. 그게 보이면 재미있다.
  const dealer = game.seats.some((s) => s.character === 'migel') ? 'npc' : '미겔';

  return base({
    title: '블랙잭 — bard 에 자리 맡는 중',
    description: [seats, '', `${game.seats.length}/${MAX_SEATS}자리`].join('\n'),
    footer: `딜러: ${dealer}`,
  });
}

export function lobbyRows(game) {
  const full = game.seats.length >= MAX_SEATS;
  return [new ActionRowBuilder().addComponents(
    btn(game, 'join', '참가', ButtonStyle.Primary).setDisabled(full),
    btn(game, 'npc', '미겔 부르기', ButtonStyle.Secondary, 'migel').setDisabled(full),
    btn(game, 'npc', '마티암 부르기', ButtonStyle.Secondary, 'matiam').setDisabled(full),
    btn(game, 'start', '시작', ButtonStyle.Success).setDisabled(!game.seats.length),
    btn(game, 'cancel', '취소', ButtonStyle.Danger),
  )];
}

// ---------------------------------------------------------------- 진행 중

function dealerLine(game) {
  if (!game.dealer.length) return '';
  const shown = game.holeUp ? game.dealer : [game.dealer[0], game.dealer[1]];
  const text = handText(shown, { hole: !game.holeUp });
  if (!game.holeUp) return `**딜러**\n　${text}`;
  const { total, bust } = handValue(game.dealer);
  const tag = bust ? '　_Bust_' : (isBlackjack(game.dealer) ? '　_Blackjack_' : '');
  return `**딜러**\n　${text}　**${total}**${tag}`;
}

export function boardEmbed(game) {
  const lines = [];
  const dealerName = game.dealerCharacter === 'npc' ? 'npc' : '미겔';

  if (game.phase === 'betting') {
    lines.push('_베팅해 주세요._', '');
  } else if (game.dealer.length) {
    lines.push(dealerLine(game), '');
  }

  if (game.hands.length) {
    lines.push(...game.hands.map((h) => handLine(game, h)), '');
  }

  if (game.phase === 'insurance') {
    lines.push('**딜러의 업카드가 A 입니다.** Insurance 를 받으시겠어요?', '');
  }

  if (game.phase === 'settled') {
    // 스플릿하면 같은 이름이 여러 줄 나오므로 손 번호를 붙여 구분한다.
    const seen = {};
    const many = {};
    for (const r of game.results) many[r.seatIndex] = (many[r.seatIndex] || 0) + 1;
    lines.push(...game.results.map((r) => {
      seen[r.seatIndex] = (seen[r.seatIndex] || 0) + 1;
      const who = many[r.seatIndex] > 1 ? `${r.seat.name} #${seen[r.seatIndex]}` : r.seat.name;
      const sign = r.net > 0 ? `+${r.net}` : String(r.net);
      return `**${who}** — ${OUTCOME_LABEL[r.outcome]} \`${sign}\``;
    }), '');
  }

  lines.push(chipTable(game));

  const seat = game.phase === 'playing' ? currentSeat(game) : null;
  const title = {
    betting: `블랙잭 · ${game.handNo}번째 핸드 — 베팅`,
    insurance: `블랙잭 · ${game.handNo}번째 핸드 — Insurance`,
    playing: `블랙잭 · ${game.handNo}번째 핸드 — ${seat?.name ?? ''} 차례`,
    dealer: `블랙잭 · ${game.handNo}번째 핸드 — 딜러`,
    settled: `블랙잭 · ${game.handNo}번째 핸드 — 정산`,
  }[game.phase] ?? '블랙잭';

  return base({
    title,
    description: lines.join('\n'),
    color: seat?.color ?? THEME_COLOR,
    footer: `딜러: ${dealerName} · Blackjack 3:2 · Dealer stands on 17`,
  });
}

export function boardRows(game) {
  if (game.phase === 'betting') {
    // 여럿이 동시에 누르므로 아무것도 끄지 않는다. 거절은 명령 쪽에서 사람마다 한다.
    return [
      new ActionRowBuilder().addComponents(
        ...BET_UNITS.map((n) => btn(game, 'bet', String(n), ButtonStyle.Secondary, n)),
        btn(game, 'allin', 'All-in', ButtonStyle.Danger),
      ),
      new ActionRowBuilder().addComponents(
        btn(game, 'confirm', '베팅', ButtonStyle.Success),
        btn(game, 'clear', '지우기', ButtonStyle.Secondary),
      ),
    ];
  }

  if (game.phase === 'insurance') {
    return [new ActionRowBuilder().addComponents(
      btn(game, 'ins', 'Insurance', ButtonStyle.Primary, 'yes'),
      btn(game, 'ins', 'No Insurance', ButtonStyle.Secondary, 'no'),
    )];
  }

  if (game.phase === 'playing') {
    const seat = currentSeat(game);
    if (seat?.kind === 'npc') {
      return [new ActionRowBuilder().addComponents(
        btn(game, 'wait', `${seat.name}이(가) 두는 중…`).setDisabled(true),
      )];
    }
    // 한 사람만 누르는 단계라 여기서는 비활성화가 맞다.
    const can = actionsFor(game);
    return [new ActionRowBuilder().addComponents(
      btn(game, 'act', 'Hit', ButtonStyle.Primary, 'hit').setDisabled(!can.has('hit')),
      btn(game, 'act', 'Stand', ButtonStyle.Secondary, 'stand').setDisabled(!can.has('stand')),
      btn(game, 'act', 'Double', ButtonStyle.Success, 'double').setDisabled(!can.has('double')),
      btn(game, 'act', 'Split', ButtonStyle.Success, 'split').setDisabled(!can.has('split')),
      btn(game, 'act', 'Surrender', ButtonStyle.Danger, 'surrender').setDisabled(!can.has('surrender')),
    )];
  }

  if (game.phase === 'dealer') {
    return [new ActionRowBuilder().addComponents(
      btn(game, 'wait', '딜러가 카드를 받는 중…').setDisabled(true),
    )];
  }

  if (game.phase === 'settled') {
    return [new ActionRowBuilder().addComponents(
      btn(game, 'next', '다음 핸드', ButtonStyle.Success),
      btn(game, 'stop', '정산하고 끝내기', ButtonStyle.Danger),
    )];
  }

  return [];
}

// ---------------------------------------------------------------- 끝

const MEDAL = ['🥇', '🥈', '🥉'];

export function resultEmbed(game) {
  const rows = standings(game);
  const head = rows.map((r, i) => {
    const sign = r.delta > 0 ? `+${r.delta}` : String(r.delta);
    return `${MEDAL[i] ?? `${i + 1}위`} **${r.seat.name}** — ${r.chips}칩 (\`${sign}\`)`;
  }).join('\n');

  const note = {
    finished: null,
    broke: '_모두 최소 베팅을 못 걸어서 판을 접었어요._',
    idle: '_한참 아무도 두지 않아서 판을 접었어요._',
    cancelled: '_판을 접었어요._',
  }[game.endedReason];

  return base({
    title: '블랙잭 — bard 영업 종료',
    description: [head, note].filter(Boolean).join('\n\n'),
    color: rows[0]?.seat.color ?? THEME_COLOR,
    footer: `${game.handNo}핸드`,
  });
}

/**
 * 카드만 든 메시지.
 *
 * 디스코드는 **메시지 전체가 이모지일 때만** 이모지를 크게 그린다. 글자가 하나라도
 * 섞이면 전부 작아지고, 임베드 안에서는 아예 적용되지 않는다. 그래서 카드를 크게
 * 보여주려면 이렇게 따로 보내는 수밖에 없다.
 *
 * 누구 패인지는 바로 위 판이 말해 준다 — 이름을 붙이면 작아진다.
 */
export const cardsOnly = (cards) => handText(cards);

export const insuranceHint = (seat) => `Insurance 는 ${insuranceCost(seat.bet)}칩입니다.`;
export const allInAmount = allIn;
export const activeSeats = active;
export const handInPlay = currentHand;
export const upcard = dealerUp;

export default {
  PREFIX, lobbyEmbed, lobbyRows, boardEmbed, boardRows, resultEmbed, cardsOnly,
};
