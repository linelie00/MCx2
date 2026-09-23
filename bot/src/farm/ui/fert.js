/**
 * farm/ui/fert — 거름 창 (2b 비료 · 퇴비, 5b 황금 비료)
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getFarm, getFarmCrops, getAccounts, fertilizeFarm } from '../../api.js';
import { base, fail } from '../../embeds.js';
import { forgetBag } from '../../casino/bag.js';
import { FARM_COLOR, cropName, plotNo, stars } from '../render.js';
import {
  PREFIX, EPH, QUIET, FERTS, COMPOST_CROPS, num, why, refuse, openPlots, pickPlot, nextOpen,
} from './shared.js';


/** 거름 창. 밭 하나의 토질과 오늘 넣은 것, 가진 거름을 보여 주고 넣는다. */
export function fertPayload({
  ch, plot, owner, farm, items, note,
}) {
  const at = plot != null && farm.plots[plot]?.open ? plot : pickPlot(farm, () => true);
  const p = farm.plots[at];
  const id = (act) => [PREFIX, act, ch, at, owner].join(':');
  const used = p.fert ?? {};

  const lines = [
    `토질 ${stars(p.star)} · 경험 **${num(p.soilXp)}**${p.soilNext != null ? ` / 다음 ★ ${num(p.soilNext)}` : ' · 최고'}`,
    `🟤 퇴비 조각 **${farm.compostBits ?? 0}** / 3 — 잡초·죽은 칸을 치우면 모이고, 셋이면 퇴비 하나`,
    '',
  ];
  for (const [key, f] of Object.entries(FERTS)) {
    lines.push(`${f.emoji} **${f.name}** +${f.soil} · 오늘 ${used[key] ?? 0} / ${f.perDay} · 가진 것 **${num(items?.[key])}**`);
  }
  lines.push(`✨ **황금 비료** 다음 수확 품질 +15 · 가진 것 **${num(items?.goldFertilizer)}**${p.goldBoost ? ' · _이 밭엔 이미 뿌렸어요_' : ''}`);
  lines.push('', `_비료는 상점 🌾 농사 진열대에서, 퇴비는 \`/농장 퇴비\` 로 작물 ${COMPOST_CROPS}개에 하나씩 만들어요._`);
  lines.push('_✨ 황금 비료는 마을 주문 보상으로만 얻어요 — **다음 수확 한 번**의 품질이 올라요._');
  if (note) lines.push('', note);

  const button = (key, all = false) => {
    const f = FERTS[key];
    const room = Math.max(0, f.perDay - (used[key] ?? 0));
    const n = all ? Math.min(room, items?.[key] ?? 0) : 1;
    return new ButtonBuilder()
      .setCustomId(id(all ? `${key === 'compost' ? 'fC' : 'fF'}` : `${key === 'compost' ? 'fc' : 'ff'}`))
      .setLabel(all ? `${f.name} ${n}개 넣기` : `${f.name} 넣기`).setEmoji(f.emoji)
      .setStyle(ButtonStyle.Success).setDisabled(!room || !(items?.[key] > 0));
  };
  // 줄마다 버튼 다섯까지 — 거름 넷과 조작을 따로 둔다(5b 에서 황금 비료가 늘며 여섯이 됐다)
  const row = [button('fertilizer'), button('compost'), button('compost', true),
    new ButtonBuilder().setCustomId(id('fg')).setLabel('황금 비료').setEmoji('✨').setStyle(ButtonStyle.Primary)
      .setDisabled(!(items?.goldFertilizer > 0) || !p.crop || p.goldBoost)];
  const tail = [];
  if (openPlots(farm).length > 1) tail.push(new ButtonBuilder().setCustomId(id('fn')).setLabel('다른 밭').setStyle(ButtonStyle.Secondary));
  tail.push(new ButtonBuilder().setCustomId(id('fx')).setLabel('닫기').setStyle(ButtonStyle.Secondary));

  return {
    embeds: [base({
      title: `🟤 거름 — ${plotNo(at)}번 밭`,
      description: lines.join('\n'),
      color: FARM_COLOR,
      footer: '토질이 오르면 물 한 번에 더 자라고, 한 칸에서 더 많이 나와요',
    })],
    components: [new ActionRowBuilder().addComponents(row), new ActionRowBuilder().addComponents(tail)],
    allowedMentions: QUIET,
  };
}

export async function openFert(interaction, ch, { plot = null } = {}) {
  const me = interaction.user.id;
  const [{ farm }, { accounts }] = await Promise.all([getFarm(ch), getAccounts([me])]);
  if (!farm) return refuse(interaction, why({ reason: 'none' }));
  if (farm.owner !== me) return refuse(interaction, why({ reason: 'notOwner', owner: farm.owner }));
  return interaction.editReply(fertPayload({
    ch, plot, owner: me, farm, items: accounts[me]?.items,
  }));
}

/** 거름 창의 조작. 주인만 누른다(customId 맨 뒤). */
export async function fertButton(interaction, act, [ch, plotS, owner]) {
  if (interaction.user.id !== owner) {
    return interaction.reply({ embeds: [fail('자기 거름 창에서만 누를 수 있어요.')], flags: EPH });
  }
  await interaction.deferUpdate();
  if (act === 'fx') return interaction.editReply({ embeds: [base({ title: '🟤 거름 창을 닫았어요', color: FARM_COLOR })], components: [] });

  let plot = Number(plotS);
  const [{ farm }, { accounts }, crops] = await Promise.all([getFarm(ch), getAccounts([owner]), getFarmCrops()]);
  if (!farm) return interaction.editReply({ embeds: [fail(why({ reason: 'none' }))], components: [] });
  if (act === 'fn') {
    plot = nextOpen(farm, plot);
    return interaction.editReply(fertPayload({ ch, plot, owner, farm, items: accounts[owner]?.items }));
  }

  const item = act === 'fg' ? 'goldFertilizer' : (act === 'ff' || act === 'fF' ? 'fertilizer' : 'compost');
  const count = act === 'fC' ? FERTS.compost.perDay : 1;
  const r = await fertilizeFarm({ channelId: ch, userId: owner, plot, item, count });
  if (!r.ok) {
    return interaction.editReply(fertPayload({
      ch, plot, owner, farm: r.farm ?? farm, items: accounts[owner]?.items, note: `⚠️ ${why(r, crops)}`,
    }));
  }
  forgetBag(owner);
  if (item === 'goldFertilizer') {
    return interaction.editReply(fertPayload({
      ch, plot, owner, farm: r.farm, items: r.account?.items, note: `✨ 황금 비료를 뿌렸어요 — 이 밭 **${cropName(crops, r.crop)}** 의 품질 **+${r.quality}** (다음 수확 한 번)`,
    }));
  }
  const f = FERTS[item];
  const up = r.to > r.from ? ` · 🎉 토질 **${stars(r.to)}**!` : '';
  return interaction.editReply(fertPayload({
    ch, plot, owner, farm: r.farm, items: r.account?.items, note: `${f.emoji} ${f.name} ${r.used}개를 넣었어요 — 토질 경험 +${r.soil}${up}`,
  }));
}
