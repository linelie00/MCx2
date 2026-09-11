/**
 * /mt상점 — 플래티넘·다이아몬드를 MT 로 바꾼다
 *
 * MT 는 얻는 길이 좁은 재화다(요트 1위 · 토너먼트 우승 · 던전 드물게). `/요리`·`/제작`
 * 에서 아주아주 잘 만든 것 — 💠 플래티넘 **5 MT**, 💎 다이아몬드 **10 MT** — 이 여기서
 * MT 가 된다(`casino/crafts.js` 의 GRADES). 같은 물건을 `/상점` 에 팔면 골드를 받는다.
 * **둘 중 한쪽만**이다 — 파는 순간 물건이 빠진다.
 *
 * 이번에는 **팔기만** 있다. MT 로 무엇을 살지는 나중에 정한다.
 *
 * `/상점` 과 같은 규약이다 — 에페메랄, customId 에 주인 id 를 **맨 뒤에** 넣고 검사한다
 * (에페메랄 메시지도 봇이 재시작하면 남아 있고, NPC id 에 콜론이 있다).
 */
import {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import { getAccounts } from '../api.js';
import { apply } from '../casino/wallet.js';
import { base, fail, trunc, THEME_COLOR } from '../embeds.js';
import { GRADE_BY_KEY } from '../casino/crafts.js';
import { forgetCrafts, craftLabel } from '../casino/bag.js';

export const PREFIX = 'mts';

const MT_COLOR = 0x7fd1d9;
const num = (n) => Number(n ?? 0).toLocaleString('ko-KR');

/** `mts:<무엇>:<만든 것 id>:<주인>` — 주인 id 는 콜론 때문에 맨 뒤. */
const cid = (what, id, owner) => [PREFIX, what, id, owner].join(':');

/** MT 로 바꿀 수 있는 것. 비싼 것부터. */
const worthy = (account) => (account?.crafts ?? [])
  .filter((c) => c.mt > 0)
  .sort((a, b) => b.mt - a.mt || b.price - a.price);

function listPayload(owner, account) {
  const list = worthy(account);
  const embed = base({
    title: '🪙 MT 상점',
    description: list.length
      ? list.map((c) => `${craftLabel(c)} — **${c.mt} MT** _(또는 ${num(c.price)}골드)_`).join('\n')
      : '_바꿀 수 있는 게 없어요._\n`/요리` · `/제작` 에서 💠 플래티넘(5 MT) · 💎 다이아몬드(10 MT) 를 만들면 여기서 MT 로 바꿉니다.',
    color: MT_COLOR,
    footer: 'MT 로 사는 물건은 곧 들어옵니다',
  }).addFields({ name: '가진 MT', value: `**${num(account?.mt)}**`, inline: true });

  const rows = [];
  if (list.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(cid('pick', '-', owner))
        .setPlaceholder('MT 로 바꿀 것 고르기')
        .addOptions(list.map((c) => ({
          label: trunc(c.name, 100),
          value: c.id,
          emoji: GRADE_BY_KEY[c.grade]?.emoji,
          description: trunc(`${c.mt} MT · ${c.kind}`, 100),
        }))),
    ));
  }
  return { embeds: [embed], components: rows, flags: MessageFlags.Ephemeral };
}

function card(id, owner, account) {
  const c = worthy(account).find((x) => x.id === id);
  if (!c) return listPayload(owner, account);
  const g = GRADE_BY_KEY[c.grade];
  return {
    embeds: [base({
      title: `${g.emoji} ${c.name}`,
      description: [
        c.desc ? `_${c.desc}_` : '',
        '',
        `${g.label} ${c.kind} · **${c.mt} MT** 로 바꿉니다.`,
        `_\`/상점\` 에 팔면 ${num(c.price)}골드 — 둘 중 한쪽만 받아요._`,
      ].join('\n'),
      color: g.color,
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cid('do', c.id, owner))
        .setLabel(`${c.mt} MT 로 바꾸기`).setEmoji('🪙').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(cid('list', '-', owner))
        .setLabel('목록으로').setStyle(ButtonStyle.Secondary),
    )],
    flags: MessageFlags.Ephemeral,
  };
}

/** 바꾼다. 빼기와 MT 가 한 번의 쓰기다. */
async function exchange(id, owner, account) {
  const c = worthy(account).find((x) => x.id === id);
  if (!c) return { embeds: [fail('이미 없어요. 팔았거나 먹었을 수 있어요.')], components: [], flags: MessageFlags.Ephemeral };

  const saved = await apply({
    mt: { [owner]: c.mt },
    crafts: { [owner]: { remove: [c.id] } },
  });
  if (!saved.ok) return { embeds: [fail('저장하지 못했어요. 잠시 뒤에 다시 해 주세요.')], components: [], flags: MessageFlags.Ephemeral };
  forgetCrafts(owner);

  return {
    embeds: [base({
      title: '🪙 바꿨어요',
      description: `${craftLabel(c)} → **+${c.mt} MT**`,
      color: MT_COLOR,
      footer: `가진 MT ${num(saved.accounts[owner]?.mt)}`,
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cid('list', '-', owner))
        .setLabel('목록으로').setStyle(ButtonStyle.Secondary),
    )],
    flags: MessageFlags.Ephemeral,
  };
}

const data = new SlashCommandBuilder()
  .setName('mt상점')
  .setDescription('플래티넘·다이아몬드 요리·제작품을 MT 로 바꿉니다.');

async function read(id) {
  const { accounts } = await getAccounts([id]);
  return accounts[id];
}

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await interaction.editReply(listPayload(interaction.user.id, await read(interaction.user.id)));
  } catch (err) {
    await interaction.editReply({ embeds: [fail(`계정을 읽지 못했어요. ${err.message}`)] });
  }
}

async function component(interaction) {
  const [, what, id, ...rest] = interaction.customId.split(':');
  const owner = rest.join(':');
  if (interaction.user.id !== owner) {
    await interaction.reply({ embeds: [fail('자기 MT 상점 창에서만 누를 수 있어요.')], flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();

  let account;
  try {
    account = await read(owner);
  } catch (err) {
    await interaction.editReply({ embeds: [fail(`계정을 읽지 못했어요. ${err.message}`)], components: [] });
    return;
  }
  if (what === 'pick') { await interaction.editReply(card(interaction.values?.[0], owner, account)); return; }
  if (what === 'do') { await interaction.editReply(await exchange(id, owner, account)); return; }
  await interaction.editReply(listPayload(owner, account));
}

export default {
  data,
  execute,
  componentPrefix: PREFIX,
  component,
  // 상점이다. 쓰러져 있어도 들어와서 바꿀 수 있다 — `/상점` 과 같다.
  allowDead: true,
};
