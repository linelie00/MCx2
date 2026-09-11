/**
 * /아이템 — 아이템 도감
 *
 * 명부(casino/items.js)를 사람이 볼 수 있는 창이다. 아흔아홉 개를 코드 안에만 두면
 * 무엇이 있는지 아무도 모른다.
 *
 * **서버를 안 부른다.** 명부는 코드 안에 있는 상수라 계정을 읽을 이유가 없다 —
 * 그래서 `deferReply` 없이 바로 답하고, 사이트가 죽어 있어도 열린다. "내가 몇 개
 * 가졌나" 는 `/프로필` 의 아이템 탭이 이미 보여 준다.
 *
 * **부속 명령으로 둔 이유.** 나중에 `/아이템 양도` 가 여기 붙는다. 슬래시 명령은
 * 최상위 옵션과 부속 명령을 섞을 수 없어서, 나중에 나누려면 `/아이템` 을 통째로
 * 다시 등록해야 한다. 처음부터 나눠 둔다.
 *
 * 응답은 **공개**고 버튼도 아무나 누를 수 있다. 아무것도 안 바꾸는 조회다.
 * customId 에 보던 자리가 다 들어 있어 봇을 재시작해도 옛 버튼이 그대로 동작한다.
 */
import {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { ITEMS, ITEM_BY_KEY, MAX_HP } from '../casino/items.js';
import { base, trunc, THEME_COLOR } from '../embeds.js';
import { width, padEndW, padStartW, clipW } from '../text.js';

export const PREFIX = 'item';

/** 한 쪽에 스무 줄. 셀렉트가 25칸까지라 그 아래로 잡아야 목록과 셀렉트가 같이 간다. */
const PER_PAGE = 20;

/** 이름 칸의 최대 폭(칸 수). 넘치면 잘린다 — 모바일에서 표가 옆으로 새면 못 읽는다. */
const NAME_W = 22;

/**
 * 갈래 거르개. customId 에 들어가므로 **아스키 키**를 쓴다 — 한글도 되지만 굳이
 * customId 를 길게 만들 이유가 없다.
 */
const KINDS = [
  { key: 'all', label: '전체', icon: '📚', of: () => true },
  { key: 'use', label: '소비', icon: '🍶', of: (i) => i.kind === '소비' },
  { key: 'misc', label: '잡화', icon: '🎒', of: (i) => i.kind === '잡화' },
  { key: 'food', label: '재료', icon: '🧺', of: (i) => i.kind === '재료' },
];
const kindOf = (key) => KINDS.find((k) => k.key === key) ?? KINDS[0];
const iconOf = (item) => KINDS.find((k) => k.key !== 'all' && k.of(item))?.icon ?? '🎒';

const num = (n) => Number(n ?? 0).toLocaleString('ko-KR');

/** 회복력 한 줄. `15 ~ 20` · `+5` · `−15` · `없음` */
function healText(heal) {
  if (Array.isArray(heal)) return `${heal[0]} ~ ${heal[1]}`;
  if (!heal) return '없음';
  return heal > 0 ? `+${heal}` : `−${Math.abs(heal)}`;
}

/** 목록 칸에 들어갈 짧은 회복력. 부호만 보여도 뜻이 통한다. */
const healShort = (heal) => (Array.isArray(heal) ? `${heal[0]}~${heal[1]}` : String(heal));

/**
 * 사고팔기 한 줄.
 *
 * 값 하나로 사고 판다. 다만 **값이 있어도 못 파는 것**이 있어서(회복약) 셋으로 갈린다.
 */
function tradeText(item) {
  if (!item.price) return '상점에 없어요';
  return item.sell
    ? `사기 **${num(item.price)}골드** · 팔기 **${num(item.price)}골드**`
    : `사기 **${num(item.price)}골드** · _팔 수는 없어요_`;
}

// ---------------------------------------------------------------- 화면

/**
 * 탭 버튼의 쪽 자리에 넣는 값.
 *
 * **0 을 넣으면 안 된다.** 2쪽에서 `◀` 가 가리키는 곳이 1쪽인데, 그게 곧 탭 버튼과
 * 같은 customId 가 되어 디스코드가 한 메시지를 통째로 거절한다(50035
 * COMPONENT_CUSTOM_ID_DUPLICATED). 눌렀을 때는 `Number('t') || 0` 이라 0쪽으로 간다.
 */
const TAB_PAGE = 't';

/** `item:<무엇>:<갈래>:<쪽>[:<키>]` — 라우터가 첫 토막으로 찾으므로 구분자는 콜론이다. */
const cid = (what, kind, page, key) =>
  [PREFIX, what, kind, page, ...(key ? [key] : [])].join(':');

function listPayload(kindKey, page) {
  const kind = kindOf(kindKey);
  const all = ITEMS.filter(kind.of);
  const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const at = Math.min(Math.max(0, page), pages - 1);
  const slice = all.slice(at * PER_PAGE, (at + 1) * PER_PAGE);

  // **이름 칸의 폭은 쪽마다 다르면 안 된다.** 그 쪽에 있는 것만 재면 넘길 때마다
  // 표가 들썩인다. 걸러 낸 목록 전체에서 재고, 폭은 칸 수로 잰다(한글은 두 칸).
  const w = Math.min(NAME_W, Math.max(...all.map((i) => width(i.name)), 1));
  const rows = slice.map((i) => padEndW(clipW(i.name, w), w + 2)
    + padStartW(i.price ? `${num(i.price)}골드` : '—', 10)
    + padStartW(healShort(i.heal), 8));

  const embed = base({
    title: `${kind.icon} 아이템 도감 — ${kind.label}`,
    description: ['```', ...rows, '```'].join('\n'),
    color: THEME_COLOR,
    footer: '이름을 고르면 설명이 나와요 · /아이템 정보 이름:… 으로 바로 찾을 수도 있어요',
  }).addFields(
    { name: '종류', value: `**${num(all.length)}**`, inline: true },
    { name: '쪽', value: `${at + 1} / ${pages}`, inline: true },
    { name: '값', value: '사고파는 값이에요', inline: true },
  );

  const tabs = new ActionRowBuilder().addComponents(...KINDS.map((k) => new ButtonBuilder()
    .setCustomId(cid('list', k.key, TAB_PAGE))
    .setLabel(k.label)
    .setEmoji(k.icon)
    .setStyle(k.key === kind.key ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(k.key === kind.key)));

  const rowsOut = [tabs];
  if (pages > 1) {
    rowsOut.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cid('list', kind.key, at - 1))
        .setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(at <= 0),
      new ButtonBuilder().setCustomId(cid('list', kind.key, at + 1))
        .setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(at >= pages - 1),
    ));
  }
  rowsOut.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid('pick', kind.key, at))
      .setPlaceholder('설명을 볼 아이템 고르기')
      .addOptions(slice.map((i) => ({
        label: trunc(i.name, 100),
        value: i.key,
        description: trunc(i.desc, 100),
        emoji: iconOf(i),
      }))),
  ));

  return { embeds: [embed], components: rowsOut };
}

function itemPayload(key, kindKey = 'all', page = 0) {
  const item = ITEM_BY_KEY[key];
  if (!item) return listPayload(kindKey, page);

  const embed = base({
    title: `${iconOf(item)} ${item.name}`,
    description: `_${item.desc}_\n\n${tradeText(item)}`,
    color: THEME_COLOR,
    footer: item.heal ? `먹었을 때 · 최대 체력은 ${MAX_HP}` : '먹어도 아무 일 없어요',
  }).addFields(
    { name: '갈래', value: item.kind, inline: true },
    { name: '값', value: item.price ? `${num(item.price)}골드` : '_없음_', inline: true },
    { name: '회복', value: healText(item.heal), inline: true },
  );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cid('list', kindKey, page))
        .setLabel('목록으로').setEmoji('📚').setStyle(ButtonStyle.Secondary),
    )],
  };
}

// ---------------------------------------------------------------- 명령

const data = new SlashCommandBuilder()
  .setName('아이템')
  .setDescription('아이템을 봅니다.')
  .addSubcommand((s) => s.setName('정보')
    .setDescription('아이템 하나를 보거나 전체 목록을 봅니다.')
    .addStringOption((o) => o.setName('이름')
      .setDescription('비우면 전체 목록이 나와요')
      .setAutocomplete(true)));

/**
 * 이름 자동완성. **키도 받는다** — 목록에서 고른 값이 키라서, 한 번 고른 뒤 다시
 * 치면 키가 들어온다.
 *
 * 아흔아홉 개뿐이라 매번 훑어도 된다. 공백은 무시한다("소형회복약"도 찾힌다).
 */
async function autocomplete(interaction) {
  const typed = String(interaction.options.getFocused() || '').replace(/\s+/g, '').toLowerCase();
  const hit = ITEMS.filter((i) => !typed
    || i.name.replace(/\s+/g, '').toLowerCase().includes(typed)
    || i.key.toLowerCase().includes(typed));
  await interaction.respond(hit.slice(0, 25).map((i) => ({
    name: trunc(`${i.name}${i.price ? ` (${num(i.price)}골드)` : ''}`, 100),
    value: i.key,
  })));
}

async function execute(interaction) {
  const picked = interaction.options.getString('이름');
  await interaction.reply(picked ? itemPayload(picked) : listPayload('all', 0));
}

async function component(interaction) {
  const [, what, kind, page, key] = interaction.customId.split(':');
  const at = Number(page) || 0;

  if (what === 'pick') {
    await interaction.update(itemPayload(interaction.values?.[0], kind, at));
    return;
  }
  await interaction.update(what === 'show' ? itemPayload(key, kind, at) : listPayload(kind, at));
}

export default {
  // 도감 조회. 쓰러졌을 때 쓸 수 있는 것을 찾아보는 창이다
  allowDead: true,
  data, execute, autocomplete, componentPrefix: PREFIX, component,
};
