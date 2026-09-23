/**
 * farm/ui/view — 농장 화면과 공개 알림
 *
 * `/농장 보기` 의 임베드 · 버튼 한 줄, 그리고 채널에 공개로 보내는 알림(레벨업 · 대왕 작물).
 * 비명 뿌리가 익은 밭을 판에 앉은 채로 못 거두게 막는 판정도 화면 쪽 일이라 여기 둔다(3c).
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getFarm } from '../../api.js';
import { base } from '../../embeds.js';
import { seatedAt, seatedMessage } from '../../casino/tables.js';
import { FARM_COLOR, farmEmbed, cropName, plotNo } from '../render.js';
import { PREFIX, QUIET } from './shared.js';

export const channelName = (interaction, id) => interaction.guild?.channels.cache.get(id)?.name;

export function viewRow(ch) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:w:${ch}`).setLabel('물주기').setEmoji('💧').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:h:${ch}`).setLabel('수확').setEmoji('🧺').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:p:${ch}`).setLabel('심기').setEmoji('🌱').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:c:${ch}`).setLabel('개간').setEmoji('⛏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:v:${ch}`).setEmoji('🔄').setStyle(ButtonStyle.Secondary),
  );
}

export function viewPayload(interaction, farm, crops, content) {
  return {
    content: content ?? '',
    embeds: [farmEmbed(farm, crops, { name: channelName(interaction, farm.channelId) })],
    components: [viewRow(farm.channelId)],
    allowedMentions: QUIET,
  };
}

/** 아이템 이름. 작물이면 작물표, 아니면 명부. */

/**
 * 판에 앉아 있으면 **비명 뿌리가 익은 밭**은 못 거둔다 — 체력이 판의 장부에 있다(3c).
 * 다른 밭은 그대로 거둔다. 막아야 하면 사유 문장, 아니면 `null`.
 */
export async function screamBlocked(ch, me, plot = null) {
  const at = seatedAt(me);
  if (!at) return null;
  const { farm } = await getFarm(ch);
  const hit = farm?.plots.some((p, i) => (plot == null || plot === i) && p.crop === 'screamRoot' && p.ripe > 0);
  return hit ? `${seatedMessage('그쪽', at)} — 비명 뿌리는 체력이 드는 수확이라 판을 마친 뒤에 거둬 주세요.` : null;
}

/** 대왕 작물 알림(3b). 채널에 공개로 — 모두가 볼 일이다. */
export async function announceGiant(interaction, r, crops) {
  if (!r?.giants?.length) return;
  const names = r.giants.map((g) => `🏆 **대왕 ${cropName(crops, g.crop)}**(${plotNo(g.plot)}번 밭)`).join(' · ');
  await interaction.followUp({
    embeds: [base({
      title: '🏆 거대 작물이 자랐어요!',
      description: `<@${interaction.user.id}> 님의 밭에서 아홉 포기가 하나로 뭉쳤어요 — ${names}`,
      color: FARM_COLOR,
    })],
    allowedMentions: QUIET,
  });
}

/** 레벨업 알림. 채널에 공개로 보낸다. */
export async function announceLevel(interaction, levelUp, crops) {
  if (!levelUp) return;
  const fresh = (crops ?? []).filter((c) => levelUp.crops.includes(c.key)).map((c) => `${c.emoji} ${c.name}`);
  const lines = [`🎉 농장이 **Lv.${levelUp.to}** 이 됐어요!`];
  if (levelUp.opened.length) {
    lines.push(`🔓 **${levelUp.opened.map(plotNo).join('·')}번 밭**이 열렸어요 — 돌과 바위를 치워야 심을 수 있어요. \`/농장 개간\``);
  }
  if (fresh.length) lines.push(`🌱 새 작물: ${fresh.join(', ')}`);
  await interaction.followUp({
    embeds: [base({ title: '🛖 농장이 자랐어요', description: lines.join('\n'), color: FARM_COLOR })],
    allowedMentions: QUIET,
  });
}
