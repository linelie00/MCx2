/**
 * farm/ui/tools — 곡괭이 창 (2b)
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getFarmCrops, getAccounts, getTools, upgradePickaxe } from '../../api.js';
import { base, fail } from '../../embeds.js';
import { forget } from '../../casino/alive.js';
import { forgetBag } from '../../casino/bag.js';
import { FARM_COLOR } from '../render.js';
import { PREFIX, EPH, QUIET, PICKAXE_NOTE, num, why, itemName, pickaxeName } from './shared.js';

/** 곡괭이 창. 지금 것 · 다음 것의 값과 재료 · 해금 레벨. */
export function toolsPayload({ owner, tools, account, note }) {
  const list = tools.pickaxes;
  const now = list.find((t) => t.key === tools.tool) ?? list[0];
  const next = list[list.indexOf(now) + 1] ?? null;
  const cost = (t) => [`${num(t.gold)}골드`, ...Object.entries(t.items).map(([k, n]) => `${k === 'ore' ? '원석(아무거나)' : itemName(null, k)} ${n}`)].join(' · ');
  const oreHave = ['oreBlue', 'oreRed', 'oreGold', 'oreGreen', 'oreBlack', 'oreWhite'].reduce((a, k) => a + (account?.items?.[k] ?? 0), 0);
  const haveOf = (k) => (k === 'ore' ? oreHave : account?.items?.[k] ?? 0);

  const lines = [`지금 **${now.emoji} ${now.name}** — ${PICKAXE_NOTE[now.key]}`, ''];
  let ready = false;
  if (next) {
    const lvOk = (tools.level ?? 0) >= next.lv;
    const goldOk = (account?.gold ?? 0) >= next.gold;
    const itemsOk = Object.entries(next.items).every(([k, n]) => haveOf(k) >= n);
    ready = lvOk && goldOk && itemsOk;
    lines.push(`다음 **${next.emoji} ${next.name}** — ${PICKAXE_NOTE[next.key]}`);
    lines.push(`값: ${cost(next)}`);
    lines.push(`${lvOk ? '✅' : '🔒'} 농장 Lv.${next.lv}${tools.level ? ` (지금 Lv.${tools.level})` : ''} · ${goldOk ? '✅' : '❌'} 골드 ${num(account?.gold)}`
      + Object.entries(next.items).map(([k, n]) => ` · ${haveOf(k) >= n ? '✅' : '❌'} ${k === 'ore' ? '원석' : itemName(null, k)} ${haveOf(k)}/${n}`).join(''));
  } else {
    lines.push('_가장 좋은 곡괭이예요._');
  }
  if (note) lines.push('', note);

  return {
    embeds: [base({ title: '⛏️ 곡괭이', description: lines.join('\n'), color: FARM_COLOR, footer: '곡괭이는 폐농해도 남아요 · 재료는 개간 전리품에서 나와요' })],
    components: next ? [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:k:${owner}`).setLabel(`${next.name}로 바꾸기`).setEmoji(next.emoji)
        .setStyle(ButtonStyle.Success).setDisabled(!ready),
    )] : [],
    allowedMentions: QUIET,
  };
}

export async function openTools(interaction) {
  const me = interaction.user.id;
  const [tools, { accounts }] = await Promise.all([getTools(me), getAccounts([me])]);
  return interaction.editReply(toolsPayload({ owner: me, tools, account: accounts[me] }));
}

/** 곡괭이 바꾸기. */
export async function toolButton(interaction, [owner]) {
  if (interaction.user.id !== owner) {
    return interaction.reply({ embeds: [fail('자기 곡괭이 창에서만 누를 수 있어요.')], flags: EPH });
  }
  await interaction.deferUpdate();
  const [r, crops] = await Promise.all([upgradePickaxe(owner), getFarmCrops()]);
  const [tools, { accounts }] = await Promise.all([getTools(owner), getAccounts([owner])]);
  forget(owner);
  forgetBag(owner);
  const note = r.ok ? `🎉 **${pickaxeName(r.tool, tools.pickaxes)}** 을(를) 손에 넣었어요! (−${num(r.paid.gold)}골드)` : `⚠️ ${why(r, crops)}`;
  return interaction.editReply(toolsPayload({ owner, tools, account: accounts[owner], note }));
}
