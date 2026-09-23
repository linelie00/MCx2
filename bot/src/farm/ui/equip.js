/**
 * farm/ui/equip — 설비 창 (4b)
 */
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} from 'discord.js';
import { getFarmOf, getFarmCrops, getAccounts, getEquips, buyEquip } from '../../api.js';
import { base, fail, trunc } from '../../embeds.js';
import { FARM_COLOR, cropName, cropEmoji, plotNo } from '../render.js';
import { PREFIX, EPH, QUIET, num, why } from './shared.js';

/**
 * 설비 창 — 내 농장의 설비. 농장 전체 설비는 버튼, 덮개·지지대는 밭을 여럿 고르는 셀렉트.
 * 고르는 순간 산다. 값·해금 레벨·효과는 서버 표(`/farms/equips`)를 그대로 적는다.
 */
export function equipPayload({ owner, farm, equips, gold, crops, note }) {
  const open = farm.plots.map((p, i) => (p.open ? i : -1)).filter((i) => i >= 0);
  const has = (e) => (e.per === 'farm' ? Boolean(farm.equip?.[e.key]) : false);
  const lines = [`<#${farm.channelId}> · **Lv.${farm.level}** · 가진 골드 **${num(gold)}**`, ''];
  for (const e of equips) {
    const lock = farm.level < e.lv ? ` · 🔒 Lv.${e.lv}` : '';
    if (e.per === 'farm') {
      let state = has(e) ? '✅ 있음' : `${num(e.gold)}골드`;
      if (e.key === 'sprinkler' && farm.equip?.sprinkler) {
        state += farm.equip.sprinkler.ready ? ' · 이번 주 아직 안 씀' : ' · 이번 주는 썼어요';
      }
      lines.push(`${e.emoji} **${e.name}** — ${e.note}`, `　└ ${state}${has(e) ? '' : lock}`);
    } else {
      const got = open.filter((i) => farm.plots[i][e.key]);
      lines.push(`${e.emoji} **${e.name}** — ${e.note}`,
        `　└ 밭당 ${num(e.gold)}골드 · 놓은 밭 ${got.length} / ${open.length}${got.length ? ` (${got.map(plotNo).join('·')}번)` : ''}${lock}`);
    }
  }
  if (note) lines.push('', note);

  const rows = [];
  const buttons = equips.filter((e) => e.per === 'farm' && !has(e)).map((e) => new ButtonBuilder()
    .setCustomId(`${PREFIX}:eb:${e.key}:${owner}`)
    .setLabel(`${e.name} · ${num(e.gold)}골드`)
    .setEmoji(e.emoji)
    .setStyle(ButtonStyle.Success)
    .setDisabled(farm.level < e.lv || gold < e.gold));
  if (buttons.length) rows.push(new ActionRowBuilder().addComponents(buttons));
  for (const e of equips.filter((x) => x.per === 'plot' && farm.level >= x.lv)) {
    const free = open.filter((i) => !farm.plots[i][e.key]);
    if (!free.length) continue;
    const afford = Math.floor(gold / e.gold);
    rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}:ep:${e.key}:${owner}`)
      .setPlaceholder(afford ? `${e.emoji} ${e.name} 놓을 밭 고르기 — 밭당 ${num(e.gold)}골드` : `${e.emoji} ${e.name} — 골드가 모자라요`)
      .setDisabled(!afford)
      .setMinValues(1)
      .setMaxValues(Math.max(1, Math.min(free.length, afford)))
      .addOptions(free.map((i) => ({
        label: `${plotNo(i)}번 밭`,
        value: String(i),
        description: trunc(farm.plots[i].crop ? `${cropEmoji(crops, farm.plots[i].crop)} ${cropName(crops, farm.plots[i].crop)}` : '비어 있음', 100),
      })))));
  }
  return {
    embeds: [base({ title: '🛠️ 설비', description: lines.join('\n'), color: FARM_COLOR, footer: '설비는 농장에 딸려요 — 폐농하면 같이 사라져요' })],
    components: rows,
    allowedMentions: QUIET,
  };
}

export async function openEquip(interaction, { owner = interaction.user.id, note } = {}) {
  const [{ farm }, { equips }, { accounts }, crops] = await Promise.all([getFarmOf(owner), getEquips(), getAccounts([owner]), getFarmCrops()]);
  if (!farm) return interaction.editReply({ embeds: [fail('설비는 내 농장에 놓아요. 먼저 `/농장 등록` 을 해 주세요.')], components: [] });
  return interaction.editReply(equipPayload({ owner, farm, equips, gold: accounts[owner]?.gold ?? 0, crops, note }));
}

export async function equipCmd(interaction) {
  await interaction.deferReply({ flags: EPH });
  return openEquip(interaction);
}

/** 설비 사기 — 버튼(`eb`, 농장 전체) · 셀렉트(`ep`, 밭마다). 주인만(customId 맨 뒤). */
export async function equipButton(interaction, act, [key, owner]) {
  if (interaction.user.id !== owner) {
    return interaction.reply({ embeds: [fail('자기 설비 창에서만 누를 수 있어요.')], flags: EPH });
  }
  await interaction.deferUpdate();
  const [{ farm }, { equips }] = await Promise.all([getFarmOf(owner), getEquips()]);
  if (!farm) return interaction.editReply({ embeds: [fail('농장이 없어요.')], components: [] });
  const e = equips.find((x) => x.key === key);
  const plots = act === 'ep' ? (interaction.values ?? []).map(Number) : null;
  const r = await buyEquip({ channelId: farm.channelId, userId: owner, key, plots });
  let note;
  if (r.ok) {
    note = `🎉 **${e.emoji} ${e.name}** 을(를) ${r.plots.length ? `${r.plots.map(plotNo).join('·')}번 밭에 ` : ''}놓았어요! (−${num(r.cost)}골드)`;
  } else if (r.reason === 'gold') {
    note = `⚠️ 골드가 모자라요. ${e?.name ?? '설비'} 값 **${num(r.need)}골드** · 가진 골드 **${num(r.gold)}**`;
  } else {
    note = `⚠️ ${why({ ...r, name: e?.name })}`;
  }
  return openEquip(interaction, { owner, note });
}
