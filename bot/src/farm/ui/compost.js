/**
 * farm/ui/compost — 퇴비 창 (2b · 가진 작물 가운데 고르기)
 */
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} from 'discord.js';
import { getFarmCrops, getAccounts, compostCrops } from '../../api.js';
import { base, fail, trunc } from '../../embeds.js';
import { forgetBag } from '../../casino/bag.js';
import { FARM_COLOR } from '../render.js';
import { PREFIX, EPH, QUIET, FERTS, COMPOST_CROPS, num, why, itemName } from './shared.js';

/** 퇴비로 만들 수 있는 작물 — 가진 것이 `COMPOST_CROPS` 개 이상. 싼 것부터(비싼 건 파는 게 낫다). */
export const compostable = (items, crops) => (crops ?? [])
  .filter((c) => (items?.[c.key] ?? 0) >= COMPOST_CROPS)
  .map((c) => ({ crop: c, have: items[c.key], made: Math.floor(items[c.key] / COMPOST_CROPS) }))
  .sort((a, b) => a.crop.price - b.crop.price || b.have - a.have)
  .slice(0, 25);

/**
 * 퇴비 창 — **가진 작물 가운데 퇴비가 되는 것만** 고른다(작물표 예순 가지에서 찾는 건 번거롭다).
 * 고르면 하나 만들기 · 만들 수 있는 만큼 만들기.
 * customId `farm:mc:<작물>:<주인>`(고르기) · `farm:m1`·`farm:mM`(만들기).
 */
export function compostPayload({
  owner, items, crops, crop = null, note,
}) {
  const list = compostable(items, crops);
  const pick = list.find((x) => x.crop.key === crop) ?? null;
  const lines = [
    `거둔 작물 **${COMPOST_CROPS}개**로 퇴비 하나를 만들어요 · 가진 퇴비 **${num(items?.compost)}**`,
    '',
  ];
  if (!list.length) lines.push(`_${COMPOST_CROPS}개 넘게 가진 작물이 없어요. 더 거둬 오세요._`);
  else {
    lines.push(...list.map((x) => `${x.crop.emoji} **${x.crop.name}** ${num(x.have)}개 → 퇴비 ${x.made}개${x.crop.key === crop ? '　◀' : ''}`));
    lines.push('', '_싼 작물부터 보여 줘요 — 비싼 건 파는 편이 나아요._');
  }
  if (note) lines.push('', note);

  const id = (act, arg = '-') => [PREFIX, act, arg, owner].join(':');
  const rows = [];
  if (list.length) {
    rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(id('mc'))
      .setPlaceholder('무엇으로 만들까요?')
      .addOptions(list.map((x) => ({
        label: trunc(`${x.crop.name} — ${x.have}개`, 100),
        value: x.crop.key,
        emoji: x.crop.emoji,
        description: trunc(`퇴비 ${x.made}개 · 파는 값 ${x.crop.price}골드`, 100),
        default: x.crop.key === crop,
      })))));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(id('m1', crop ?? '-')).setLabel('퇴비 1개').setEmoji('🟤')
      .setStyle(ButtonStyle.Success).setDisabled(!pick),
    new ButtonBuilder().setCustomId(id('mM', crop ?? '-')).setLabel(pick ? `${pick.made}개 다 만들기` : '다 만들기').setEmoji('🟤')
      .setStyle(ButtonStyle.Primary).setDisabled(!pick || pick.made < 2),
    new ButtonBuilder().setCustomId(id('mx')).setLabel('닫기').setStyle(ButtonStyle.Secondary),
  ));
  return {
    embeds: [base({
      title: '🟤 퇴비 만들기', description: lines.join('\n'), color: FARM_COLOR, footer: `퇴비 하나에 토질 경험 +${FERTS.compost.soil} · 밭마다 하루 ${FERTS.compost.perDay}개까지`,
    })],
    components: rows,
    allowedMentions: QUIET,
  };
}

export async function openCompost(interaction, { owner = interaction.user.id, crop = null, note } = {}) {
  const [{ accounts }, crops] = await Promise.all([getAccounts([owner]), getFarmCrops()]);
  return interaction.editReply(compostPayload({
    owner, items: accounts[owner]?.items, crops, crop, note,
  }));
}

/** 퇴비 창의 조작. 창을 연 사람만(customId 맨 뒤). */
export async function compostButton(interaction, act, [arg, owner]) {
  if (interaction.user.id !== owner) {
    return interaction.reply({ embeds: [fail('자기 퇴비 창에서만 누를 수 있어요.')], flags: EPH });
  }
  await interaction.deferUpdate();
  if (act === 'mx') return interaction.editReply({ embeds: [base({ title: '🟤 퇴비 창을 닫았어요', color: FARM_COLOR })], components: [] });
  if (act === 'mc') return openCompost(interaction, { owner, crop: interaction.values?.[0] ?? null });

  const crop = arg === '-' ? null : arg;
  const { accounts } = await getAccounts([owner]);
  const have = accounts[owner]?.items?.[crop] ?? 0;
  const count = act === 'mM' ? Math.floor(have / COMPOST_CROPS) : 1;
  const [r, crops] = await Promise.all([compostCrops({ userId: owner, crop, count: Math.max(1, count) }), getFarmCrops()]);
  if (!r.ok) return openCompost(interaction, { owner, crop, note: `⚠️ ${why(r, crops)}` });
  forgetBag(owner);
  return openCompost(interaction, {
    owner,
    crop,
    note: `🟤 **${itemName(crops, r.crop)} ×${r.used}** → 퇴비 **${r.made}개** · 가진 퇴비 **${num(r.account?.items?.compost)}**`,
  });
}
