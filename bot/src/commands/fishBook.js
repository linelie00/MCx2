/**
 * /물고기 도감 — 낚아 본 것의 기록
 *
 * `/에너미 도감`(commands/bestiary.js)을 그대로 본떴다. 처음엔 전부 `???` 이고, 한 번
 * 낚으면 이름·설명·마릿수·최고 길이가 열린다. **잡동사니도 센다** — 나뭇가지 열 개를 건진
 * 것도 그날의 기록이다.
 *
 * 기록은 계정의 `fish` 칸이다(`{ 아이템키: { caught, best } }`). **아이템 키가 키**라서
 * 이름을 고쳐도 기록이 안 끊긴다(에너미 도감이 이름을 키로 쓰는 것과 다른 점).
 *
 * 응답은 **공개**고 버튼도 아무나 누를 수 있다 — 아무것도 안 바꾸는 조회다.
 */
import {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags,
} from 'discord.js';
import { getAccounts } from '../api.js';
import { fishFor } from '../casino/bag.js';
import { FISH, JUNK, LEGENDS, itemOf } from '../casino/fish.js';
import { base, fail, gauge, trunc, THEME_COLOR } from '../embeds.js';

export const PREFIX = 'fsh';

/** 한 쪽에 스무 줄. 셀렉트가 25칸까지라 그 아래로. */
const PER_PAGE = 20;

/** 탭 버튼의 쪽 자리. 0 을 넣으면 `◀` 와 customId 가 겹친다(50035) — bestiary.js 와 같은 이유. */
const TAB_PAGE = 't';

const WATER = 0x4a7a8c;
const LEGEND_COLOR = 0xc9a227;

const TABS = [
  { key: 'f', label: '물고기', icon: '🐟', list: FISH },
  { key: 'j', label: '잡동사니', icon: '🪵', list: JUNK },
  { key: 'l', label: '전설', icon: '✨', list: LEGENDS },
];
const tabOf = (key) => TABS.find((t) => t.key === key) ?? TABS[0];

/** 도감 전체. 표의 순서가 곧 도감의 순서다 — `???` 자리도 그대로 남는다. */
export const ENTRIES = TABS.flatMap((t) => t.list.map((f) => ({ ...f, tab: t.key })));
const BY_KEY = Object.fromEntries(ENTRIES.map((f) => [f.key, f]));

const num = (n) => Number(n ?? 0).toLocaleString('ko-KR');
const recOf = (book, key) => book?.[key] ?? null;
export const caughtOf = (r) => (r?.caught ?? 0) > 0;

/** `fsh:<무엇>:<탭>:<쪽>:<주인 id>` — id 는 콜론이 있을 수 있어 맨 뒤. */
const cid = (what, tab, page, id) => [PREFIX, what, tab, page, id].join(':');

function counts(book, list = ENTRIES) {
  const got = list.filter((f) => caughtOf(recOf(book, f.key)));
  return { got: got.length, total: list.length };
}

function line(f, r) {
  if (!caughtOf(r)) return '❔ ???';
  const item = itemOf(f.key);
  const best = r.best ? ` · 최대 **${r.best}cm**` : '';
  return `${f.tab === 'l' ? '✨' : f.tab === 'j' ? '🪵' : '🐟'} **${item.name}** · ${num(r.caught)}마리${best}`;
}

export function listPayload(id, book, tabKey, page) {
  const tab = tabOf(tabKey);
  const list = ENTRIES.filter((f) => f.tab === tab.key);
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const at = Math.min(Math.max(0, page), pages - 1);
  const slice = list.slice(at * PER_PAGE, (at + 1) * PER_PAGE);
  const all = counts(book);
  const here = counts(book, list);
  const fishOnly = counts(book, ENTRIES.filter((f) => f.tab === 'f'));

  const embed = base({
    title: `📖 물고기 도감 — ${tab.label}`,
    description: [`<@${id}> 의 기록`, '', ...slice.map((f) => line(f, recOf(book, f.key)))].join('\n'),
    color: tab.key === 'l' ? LEGEND_COLOR : WATER,
    footer: '`/요트 낚시` 로 낚으면 적혀요 · 이름을 고르면 기록이 나와요',
  }).addFields(
    { name: '모은 것', value: `${gauge(all.got, all.total, { percent: false })} ${all.got} / ${all.total}`, inline: true },
    { name: '물고기', value: `${gauge(fishOnly.got, fishOnly.total, { percent: false })} ${fishOnly.got} / ${fishOnly.total}`, inline: true },
    { name: `${tab.label} · ${at + 1} / ${pages}쪽`, value: `${here.got} / ${here.total}`, inline: true },
  );

  const rows = [new ActionRowBuilder().addComponents(...TABS.map((t) => new ButtonBuilder()
    .setCustomId(cid('list', t.key, TAB_PAGE, id))
    .setLabel(t.label)
    .setEmoji(t.icon)
    .setStyle(t.key === tab.key ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(t.key === tab.key)))];

  if (pages > 1) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cid('list', tab.key, at - 1, id))
        .setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(at <= 0),
      new ButtonBuilder().setCustomId(cid('list', tab.key, at + 1, id))
        .setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(at >= pages - 1),
    ));
  }

  // **잡은 것만** 고를 수 있다. 셀렉트에 이름이 뜨면 `???` 가 무슨 소용인가.
  const got = slice.filter((f) => caughtOf(recOf(book, f.key)));
  if (got.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(cid('pick', tab.key, at, id))
        .setPlaceholder('기록을 볼 것 고르기')
        .addOptions(got.map((f) => ({
          label: trunc(itemOf(f.key).name, 100),
          value: f.key,
          description: trunc(`${num(recOf(book, f.key).caught)}마리${recOf(book, f.key).best ? ` · 최대 ${recOf(book, f.key).best}cm` : ''}`, 100),
        }))),
    ));
  }
  return { embeds: [embed], components: rows };
}

/** 아직 못 잡았으면 `null` — 부르는 쪽이 목록으로 돌아간다. */
export function cardPayload(id, book, key, tabKey, page) {
  const f = BY_KEY[key];
  const r = recOf(book, key);
  if (!f || !caughtOf(r)) return null;
  const item = itemOf(key);

  const facts = [
    `**${num(r.caught)}마리**`,
    r.best ? `최고 **${r.best}cm**` : null,
    f.cm ? `크기 ${f.cm[0]}~${f.cm[1]}cm` : null,
    item.sell && item.price ? `팔면 **${num(item.price)}골드**` : '팔 수 없어요',
  ].filter(Boolean).join('　·　');

  const embed = base({
    title: `${f.tab === 'l' ? '✨ 전설 · ' : f.tab === 'j' ? '🪵 ' : '🐟 '}${item.name}`,
    description: [`_${item.desc}_`, '', facts].join('\n'),
    color: f.tab === 'l' ? LEGEND_COLOR : WATER,
    footer: `${f.tab === 'l' ? '전설' : f.tab === 'j' ? '잡동사니' : '물고기'} · /물고기 도감`,
  });

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cid('list', tabKey ?? f.tab, page ?? 0, id))
        .setLabel('목록으로').setEmoji('📖').setStyle(ButtonStyle.Secondary),
    )],
  };
}

// ---------------------------------------------------------------- 명령

const data = new SlashCommandBuilder()
  .setName('물고기')
  .setDescription('낚은 것을 봅니다.')
  .addSubcommand((s) => s.setName('도감')
    .setDescription('낚아 본 것의 기록을 봅니다.')
    .addStringOption((o) => o.setName('이름')
      .setDescription('비우면 전체 목록 — 낚아 본 것만 찾을 수 있어요')
      .setAutocomplete(true)));

const NOT_CAUGHT = '도감에 없는 이름이에요. 낚으면 적혀요.';

async function bookOf(id) {
  const { accounts } = await getAccounts([id]);
  return accounts?.[id]?.fish ?? {};
}

/** **낚아 본 것만** 보여 준다 — 다 띄우면 도감을 채울 까닭이 없어진다. */
async function autocomplete(interaction) {
  const typed = String(interaction.options.getFocused() || '').replace(/\s+/g, '');
  const book = await fishFor(interaction.user.id);
  const hit = ENTRIES.filter((f) => caughtOf(recOf(book, f.key))
    && (!typed || itemOf(f.key).name.replace(/\s+/g, '').includes(typed)));
  await interaction.respond(hit.slice(0, 25).map((f) => ({
    name: `${f.tab === 'l' ? '✨ ' : ''}${itemOf(f.key).name} · ${num(recOf(book, f.key).caught)}마리`,
    value: f.key,
  }))).catch(() => {});
}

async function execute(interaction) {
  const id = interaction.user.id;
  const picked = interaction.options.getString('이름');
  // 아예 없는 이름은 계정을 읽을 것도 없다. **못 잡은 이름과 같은 말**로 답한다 —
  // 다르게 답하면 그런 물고기가 있는지가 드러난다.
  if (picked && !BY_KEY[picked]) {
    await interaction.reply({ embeds: [fail(NOT_CAUGHT)], flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();
  let book;
  try {
    book = await bookOf(id);
  } catch (err) {
    await interaction.editReply({ embeds: [fail(`계정을 읽지 못했어요. ${err.message}`)] });
    return;
  }
  if (picked) {
    const card = cardPayload(id, book, picked);
    await interaction.editReply(card ?? { embeds: [fail(NOT_CAUGHT)] });
    return;
  }
  await interaction.editReply(listPayload(id, book, 'f', 0));
}

async function component(interaction) {
  const [, what, tab, page, ...rest] = interaction.customId.split(':');
  const id = rest.join(':');
  const at = Number(page) || 0;

  await interaction.deferUpdate();
  try {
    const book = await bookOf(id);
    const card = what === 'pick' ? cardPayload(id, book, interaction.values?.[0], tab, at) : null;
    await interaction.editReply(card ?? listPayload(id, book, tab, at));
  } catch (err) {
    await interaction.followUp({
      embeds: [fail(`계정을 읽지 못했어요. ${err.message}`)], flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}

export default {
  // 조회만 한다. 쓰러져 있어도 자기 기록은 볼 수 있어야 한다
  allowDead: true,
  data, execute, autocomplete, componentPrefix: PREFIX, component,
};
