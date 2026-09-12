/**
 * fishRender — 낚시 판을 그린다
 *
 * 요트의 점수표는 **자리가 열**이라 혼자 하는 낚시에는 안 맞는다. 여기서는 열이 하나뿐이고,
 * 대신 **지금 적을 수 있는지**를 오른쪽에 적는다 — 낚시의 판단이 "어느 칸을 열 수 있나" 이기
 * 때문이다. 보너스도 한 줄로 그대로 보인다(전설이 숨는 자리라서 보여야 한다).
 *
 * 숨은 것은 **어떤 문자열에도 안 들어간다.** 들어가는 순간 게임이 끝난다.
 *
 * customId 는 요트와 같은 `yacht:` 를 쓴다 — 라우터는 판 번호 첫 글자(`f`)로 갈라낸다.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import {
  CATEGORIES, UPPER_KEYS, BONUS_NEED, BONUS_SCORE, MAX_ROLLS,
  scoreAll, totals, bonusLost, categoryOf,
} from './rules.js';
import { faces, faceEmoji, PREFIX } from './render.js';
import {
  writable, canWrite, TRIES, openingLine, legendNeed, legendBanner,
} from './fishing.js';
import { BONUS_ROW, itemOf, isLegend } from '../casino/fish.js';
import { base, THEME_COLOR } from '../embeds.js';
import { padEndW, padStartW, width } from '../text.js';

const LABEL_W = 9;
const VALUE_W = 7;

/** 물빛 · 잡동사니 · 전설. 카드 띠 색으로 무엇을 낚았는지가 먼저 읽힌다. */
export const WATER = 0x4a7a8c;
export const JUNK_COLOR = 0x6b6b6b;
export const LEGEND_COLOR = 0xc9a227;

export const cid = (round, action, arg) =>
  [PREFIX, round.serial, round.rev, action, arg].filter((x) => x !== undefined).join(':');

/**
 * 한 열짜리 점수표. 오른쪽은 **지금 적을 수 있는지**다.
 *
 *   ○  이번 눈으로 적을 수 있다
 *   ✗  못 적는다(조건이 안 맞거나 이미 적었다)
 *
 * 굴리기 전에는 오른쪽을 비운다 — 주사위가 없으면 판단할 것도 없다.
 */
export function fishTable(round) {
  const { sheet, dice } = round;
  const t = totals(sheet);
  const scores = dice ? scoreAll(dice) : null;

  const cell = (v) => padStartW(v === null || v === undefined ? '·' : String(v), VALUE_W);
  const mark = (key) => {
    if (!dice) return '';
    if (sheet[key] !== null) return '✗';
    return canWrite(sheet, key, dice) ? `○ ${scores[key]}점` : '✗';
  };
  const row = (label, value, right = '') =>
    padEndW(label, LABEL_W) + cell(value) + (right ? `   ${right}` : '');

  const rowFor = (cat) => row(cat.short, sheet[cat.key], mark(cat.key));
  const upper = CATEGORIES.filter((c) => UPPER_KEYS.includes(c.key)).map(rowFor);
  const lower = CATEGORIES.filter((c) => !UPPER_KEYS.includes(c.key)).map(rowFor);

  // 보너스는 적는 칸이 아니라 **이루는** 칸이다. 남은 점수를 그대로 보여 준다.
  const bonusCell = t.bonus ? `+${BONUS_SCORE}` : bonusLost(sheet) ? '×' : `-${t.bonusNeed}`;
  const bonus = row('보너스', bonusCell, t.bonus ? `○ 소계 ${BONUS_NEED}` : `소계 ${BONUS_NEED}`);

  const rule = '-'.repeat(LABEL_W + VALUE_W + 3 + 10);
  return ['```', ...upper, row('소계', t.upper), bonus, rule, ...lower, rule, row('합계', t.total), '```'].join('\n');
}

const RULE_LINES = [
  '**■ 적을 수 있는 칸**',
  '1~6 은 그 눈이 **세 개 이상**, 초이스는 **눈의 합 21 이상**,',
  '나머지는 **조건이 맞아 0점이 아닐 때**만 적을 수 있어요. 0점을 버려 떠볼 수는 없어요.',
];

/**
 * 전설 판을 여는 카드.
 *
 * 백 판에 다섯 번 오는 판이라 **평범한 판과 한눈에 달라야 한다** — 제목·띠 색·머리글이 전부
 * 바뀐다. 거리 기척은 이 판에서 뜻이 없으므로(칸을 이미 알려 줬다) 그 자리에 **닿는 길**을 쓴다.
 */
const legendOpenEmbed = (round) => base({
  title: '✦ 전 설 ✦',
  description: [
    '```',
    '          전 설 이 나 타 났 다',
    '```',
    openingLine(round.hidden),
    '',
    '**■ 닿으려면**',
    legendNeed(round.hidden),
    `기회는 **${TRIES}번**, 기회마다 주사위는 **${MAX_ROLLS}번**. 빗나가도 자리는 그대로예요.`,
    '',
    ...RULE_LINES,
    '',
    '_놓치면 오늘의 강은 다시 잠잠해진다._',
  ].join('\n'),
  color: LEGEND_COLOR,
  footer: `전설은 백 판에 다섯 번 와요 · 오늘 남은 낚시 ${round.left ?? '?'}번`,
});

/** 판을 열 때 한 번. 규칙과 첫 기척. */
export const openEmbed = (round) => (round.hidden.legend ? legendOpenEmbed(round) : base({
  title: '🎣 낚시',
  description: [
    openingLine(round.hidden),
    '',
    `점수표의 **열세 줄 가운데 하나**에 숨어 있어요. 그 칸을 **실제로 적어야** 낚입니다.`,
    `기회는 **${TRIES}번**, 기회마다 주사위는 **${MAX_ROLLS}번**까지 굴려요.`,
    '',
    ...RULE_LINES,
    '',
    '**■ 기척**',
    '빗나가면 얼마나 가까웠는지 한 줄이 옵니다. **위인지 아래인지는 안 알려 줘요.**',
    '보너스 칸은 **소계 63** 을 만들면, 요트 칸은 **같은 눈 다섯**을 적으면 닿습니다.',
  ].join('\n'),
  color: WATER,
  footer: `오늘 남은 낚시 ${round.left ?? '?'}번 · 10분 동안 아무것도 안 누르면 닫혀요`,
}));

export function boardEmbed(round) {
  const lines = [];
  if (round.hidden.legend) lines.push(legendBanner(round.hidden), '');

  if (round.dice) {
    lines.push(`${faces(round.dice, round.held)}${round.held.some(Boolean) ? '　← 고정' : ''}`);
    lines.push(round.rollsLeft > 0
      ? `굴릴 수 있는 횟수 **${round.rollsLeft}번**`
      : '**마지막 굴림이에요.** 적을 칸을 고르세요.');
  } else {
    lines.push('_주사위를 굴려 주세요._');
  }
  if (round.trail.length) lines.push('', round.trail.join('\n'));

  // 지나간 기척. 최근 셋만 — 판이 길어져도 표가 안 밀린다.
  const log = round.log.filter((l) => l.hint).slice(-3);
  if (log.length) lines.push('', ...log.map((l) => `🎣 ${l.label} — _${l.hint}_`));

  lines.push('', fishTable(round));

  return base({
    title: `${round.hidden.legend ? '✦' : '🎣'} 낚시 · 남은 기회 ${round.triesLeft}번`,
    description: lines.join('\n'),
    color: round.hidden.legend ? LEGEND_COLOR : (round.color ?? WATER),
    footer: `${round.name} · 오늘 남은 낚시 ${round.left ?? '?'}번`,
  });
}

export function boardRows(round) {
  if (!round.dice) {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cid(round, 'roll')).setLabel('굴리기').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(cid(round, 'quit')).setLabel('그만').setStyle(ButtonStyle.Danger),
    )];
  }

  const rows = [
    new ActionRowBuilder().addComponents(...round.dice.map((d, i) =>
      new ButtonBuilder().setCustomId(cid(round, 'hold', i))
        .setEmoji(faceEmoji(d, round.held[i]))
        .setStyle(round.held[i] ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(round.rollsLeft === 0))),
  ];

  const canRoll = round.rollsLeft > 0 && !round.held.every(Boolean);
  const open = writable(round.sheet, round.dice);
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(cid(round, 'roll'))
      .setLabel(round.rollsLeft > 0 ? `다시 굴리기 (${round.rollsLeft}번 남음)` : '더 못 굴려요')
      .setStyle(ButtonStyle.Primary).setDisabled(!canRoll),
    // 적을 칸이 하나도 없을 때의 유일한 출구. 누르면 그 기회가 날아간다.
    new ButtonBuilder().setCustomId(cid(round, 'skip'))
      .setLabel('이번 기회 넘기기').setStyle(ButtonStyle.Secondary).setDisabled(open.length > 0),
    new ButtonBuilder().setCustomId(cid(round, 'quit')).setLabel('그만').setStyle(ButtonStyle.Danger),
  ));

  if (open.length) {
    const scores = scoreAll(round.dice);
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(cid(round, 'pick'))
        .setPlaceholder('어느 칸에 던질까요?')
        .addOptions(open.map((key) => ({
          label: `${categoryOf(key).label} — ${scores[key]}점`,
          value: key,
        }))),
    ));
  }
  return rows;
}

/** 낚은 것 · 놓친 것. 판이 끝나면 이 카드 하나가 남는다. */
export function resultEmbed(round, { line, book = null } = {}) {
  const c = round.caught;
  if (!c) {
    return base({
      title: round.hidden.legend ? '✦ 그림자가 돌아갔다' : '🎣 오늘은 여기까지',
      description: [
        line ?? (round.hidden.legend
          ? '그림자가 천천히 물밑으로 돌아간다. 다음을 기약하자.'
          : '해가 기운다. 오늘은 여기까지다.'),
        '',
        round.hidden.legend
          ? '_그런 것은 아무 때나 오지 않는다._'
          : '_무엇이 있었는지는 물만 안다._',
      ].join('\n'),
      color: round.hidden.legend ? LEGEND_COLOR : WATER,
      footer: `${round.name} · 오늘 남은 낚시 ${round.left ?? '?'}번`,
    });
  }

  const item = itemOf(c.key);
  const legend = isLegend(c.key);
  const rec = book?.[c.key] ?? null;          // 쓰고 난 뒤의 도감 칸
  const best = rec?.best ?? c.cm;
  const nth = rec?.caught ?? 1;

  const facts = [
    c.cm ? `길이 **${c.cm}cm**` : null,
    c.cm && best > c.cm ? `내 최고 ${best}cm` : (c.cm ? '**최고 기록!**' : null),
    `**${nth}마리째**`,
    item.sell && item.price ? `팔면 **${item.price.toLocaleString('ko-KR')}골드**` : '팔 수 없어요',
  ].filter(Boolean).join('　·　');

  // 전설은 카드부터 다르다 — 제목에 띠를 두르고 머리글을 얹는다. 백 판에 다섯 번 있는 일이다.
  const crown = legend ? ['```', '           전 설 을 낚 았 다', '```'] : [];

  return base({
    title: legend
      ? `✦ ${item.name} ${c.cm}cm ✦`
      : `${c.cm ? '🎣' : '🪵'} ${item.name}${c.cm ? ` ${c.cm}cm` : ''}`,
    description: [...crown, line ?? '', '', `_${item.desc}_`, '', facts]
      .filter((x) => x !== null).join('\n'),
    color: legend ? LEGEND_COLOR : (c.cm ? WATER : JUNK_COLOR),
    footer: `${round.name} · 오늘 남은 낚시 ${round.left ?? '?'}번 · /물고기 도감 에 적혔어요`,
  });
}

export default { cid, fishTable, openEmbed, boardEmbed, boardRows, resultEmbed, WATER, LEGEND_COLOR };
