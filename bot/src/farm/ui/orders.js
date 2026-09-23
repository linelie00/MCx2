/**
 * farm/ui/orders — 주문 창 (5a 게시판 · 큰 의뢰, 5b 덤 보상)
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  getFarmOf, getFarmCrops, getAccounts, getBoard, deliverOrder, postAccountDeltas,
} from '../../api.js';
import { base, fail } from '../../embeds.js';
import { forgetBag } from '../../casino/bag.js';
import { FARM_COLOR, cropEmoji, SEASON_NAME } from '../render.js';
import { voiceOf, thanksOf } from '../requesters.js';
import { announceLevel } from './view.js';
import { PREFIX, EPH, QUIET, STARS, num, why, itemName } from './shared.js';

/** 주문 id → customId 조각. id 에 `:` 이 들어 있어 `~` 로 바꿔 싣는다. */
const orderToken = (id) => id.replaceAll(':', '~');
const orderOfToken = (t) => t.replaceAll('~', ':');

/** 며칠 남았나 — 오늘 마감이면 0. */
const daysLeft = (due, today) => Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

/** 그 작물을 요구 ★ 이상으로 가진 수. */
const haveOf = (crop, minStar, items) => [1, 2, 3].filter((s) => s >= minStar).reduce((a, s) => a + (items?.[`${crop}S${s}`] ?? 0), 0);
/** 주문을 다 채울 수 있나 — 작물마다. */
const canFill = (o, items) => o.parts.every((p) => haveOf(p.crop, o.minStar, items) >= p.qty);

/** 덤 보상(5b) 한 토막 — 주문 창에 미리 보여 준다. */
function bonusLine(bonus, crops) {
  if (!bonus) return null;
  const bits = [];
  for (const [k, n] of Object.entries(bonus.seeds ?? {})) bits.push(`🌱 ${itemName(crops, k)} 씨앗 ×${n}`);
  if (bonus.goldFert) bits.push(`✨ ${itemName(crops, 'goldFertilizer')}`);
  if (bonus.mt) bits.push('🪙 MT 1 _(주 1개까지)_');
  return bits.length ? `🎁 ${bits.join(' · ')}` : null;
}

/** 주문끼리 가르는 줄 — 필드 하나를 통째로 쓴다. 임베드엔 가로줄 문법이 없어 글자로 긋는다. */
const ORDER_RULE = { name: '─────────────────────────', value: '​', inline: false };

/**
 * 주문 하나 = 필드 넷 — 머리(번호 · 의뢰인 · 한마디)와 **★ 이상 · 기한 · 보상 세 칸**(inline).
 * `rule` 이면 앞에 구분선 필드를 하나 더 둔다. 직함은 안 적는다.
 * 예약 주문(`reserve`)은 **그 계절이 오기 전까지만** "오면 심으세요" 를 붙인다.
 */
function orderFields(o, n, {
  crops, items, today, season,
}, rule) {
  const { who, line } = voiceOf(o, (k) => itemName(crops, k));
  const left = daysLeft(o.due, today);
  const ready = canFill(o, items);
  const head = [`-# 「${line}」`];
  if (o.reserve && o.reserve !== season) head.push(`-# 🗓️ ${SEASON_NAME[o.reserve]} 작물 — ${SEASON_NAME[o.reserve]}이 오면 심으세요`);
  const need = o.parts.map((p) => {
    const have = haveOf(p.crop, o.minStar, items);
    return `${have >= p.qty ? '✅' : '▫️'} ${cropEmoji(crops, p.crop)} ${itemName(crops, p.crop)} **${num(Math.min(have, p.qty))} / ${p.qty}**`;
  });
  return [
    ...(rule ? [ORDER_RULE] : []),
    { name: `${ready ? '✅' : '📌'} ${n}. ${who.emoji} ${who.name}`, value: head.join('\n'), inline: false },
    { name: `${STARS[o.minStar]} 이상${o.parts.length > 1 ? ' (전부)' : ''}`, value: need.join('\n'), inline: true },
    { name: '기한', value: left ? `⏳ ${left}일 남음` : '⏳ **오늘까지**', inline: true },
    { name: '보상', value: [`🪙 ${num(o.gold)}`, `✨ +${o.xp}`, bonusLine(o.bonus, crops)].filter(Boolean).join('\n'), inline: true },
  ];
}

/**
 * 주문 창 — 임베드 **하나**에 📜 게시판 · ✉️ 내 의뢰. 주문마다 머리 한 줄 + 세 칸이고, 주문 사이는 줄로 가른다.
 * (한 덩어리 글도, 임베드를 주문마다 쪼갠 것도 읽기 나빴다.)
 * customId `farm:od:<주문>:<주인>` · 새로고침 `farm:or:-:<주인>`.
 */
export function ordersPayload({
  owner, board, mine, crops, items, today, note, season = null,
}) {
  const all = [...board, ...mine];
  const ctx = {
    crops, items, today, season,
  };
  const fields = [
    { name: `📜 마을 게시판 · ${board.length}건`, value: board.length ? '-# 급마다 한 칸 · 빈 칸은 월·목에 채워져요 · 먼저 채운 농장이 가져가요' : '-# _지금은 붙은 주문이 없어요._', inline: false },
    ...board.flatMap((o, i) => orderFields(o, i + 1, ctx, i > 0)),
    { name: `✉️ 내 의뢰 · ${mine.length}건`, value: mine.length ? '-# 우리 농장에만 온 큰 의뢰 · 월요일마다 한 건' : '-# _와 있는 의뢰가 없어요._', inline: false },
    ...mine.flatMap((o, i) => orderFields(o, board.length + i + 1, ctx, i > 0)),
  ];

  const buttons = all.map((o, i) => new ButtonBuilder()
    .setCustomId(`${PREFIX}:od:${orderToken(o.id)}:${owner}`)
    .setLabel(`${i + 1}번 납품`)
    .setEmoji(o.kind === 'board' ? '📜' : '✉️')
    .setStyle(ButtonStyle.Success)
    .setDisabled(!canFill(o, items)));
  const rows = [];
  for (let k = 0; k < buttons.length && rows.length < 4; k += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(k, k + 5)));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:or:-:${owner}`).setLabel('새로고침').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
  ));
  return {
    embeds: [base({
      title: '📜 주문',
      description: note ?? undefined,
      color: FARM_COLOR,
      footer: '★ 이상 작물만 받아요 · 낮은 ★ 부터 내요 · ✅ 는 지금 낼 수 있는 주문',
    }).addFields(fields.slice(0, 25))],
    components: rows,
    allowedMentions: QUIET,
  };
}

export async function openOrders(interaction, { owner = interaction.user.id, note } = {}) {
  const { farm } = await getFarmOf(owner);
  if (!farm) return interaction.editReply({ embeds: [fail('주문은 내 농장으로 받아요. 먼저 `/농장 등록` 을 해 주세요.')], components: [] });
  const [{ board, mine, today }, { accounts }, crops] = await Promise.all([getBoard(farm.channelId), getAccounts([owner]), getFarmCrops()]);
  return interaction.editReply(ordersPayload({
    owner, board, mine: mine ?? [], crops, items: accounts[owner]?.items, today, note, season: farm.sky?.today?.season?.key ?? null,
  }));
}

export async function ordersCmd(interaction) {
  await interaction.deferReply({ flags: EPH });
  return openOrders(interaction);
}

/** 납품(`od`) · 새로고침(`or`). 주인만(customId 맨 뒤). */
export async function orderButton(interaction, act, [token, owner]) {
  if (interaction.user.id !== owner) {
    return interaction.reply({ embeds: [fail('자기 주문 창에서만 누를 수 있어요.')], flags: EPH });
  }
  await interaction.deferUpdate();
  if (act === 'or') return openOrders(interaction, { owner });
  const { farm } = await getFarmOf(owner);
  if (!farm) return interaction.editReply({ embeds: [fail('농장이 없어요.')], components: [] });
  const [r, crops] = await Promise.all([deliverOrder({ channelId: farm.channelId, userId: owner, orderId: orderOfToken(token) }), getFarmCrops()]);
  if (!r.ok) return openOrders(interaction, { owner, note: `⚠️ ${why(r, crops)}` });

  forgetBag(owner);
  const { who } = voiceOf(r.order, (k) => itemName(crops, k));
  const what = r.order.parts.map((p) => `${itemName(crops, p.crop)} ${p.qty}개`).join(' · ');
  // 받은 덤(5b) — 씨앗은 주머니로, 황금 비료는 창고로, MT 는 주 1개까지
  const got = r.got ?? {};
  const prize = [];
  for (const [k, n] of Object.entries(got.seeds ?? {})) prize.push(`🌱 **${itemName(crops, k)} 씨앗 ×${n}** (주머니)`);
  if (got.goldFert) prize.push(`✨ **${itemName(crops, 'goldFertilizer')}**`);
  if (got.mt) prize.push('🪙 **MT 1**');
  if (got.mtCapped) prize.push('🪙 _이번 주 MT 는 이미 받아서 골드로 대신 받았어요_');

  // 헨젤의 주문은 따로 센다 — 의뢰인은 봇만 안다(칭호 「마녀의 하수인」)
  if (who.key === 'hansel') await postAccountDeltas({ bump: { [owner]: { farmHansel: 1 } } }).catch(() => {});

  await openOrders(interaction, {
    owner,
    note: [`🧺 ${who.name}의 주문을 채웠어요 — 🪙 **+${num(r.order.gold)}** · ✨ +${r.xp} · 가진 골드 **${num(r.account?.gold)}**`, ...prize].join('\n'),
  });
  // 채널에 공개로 — 게시판 주문은 다른 농장도 노리던 것이다
  await interaction.followUp({
    content: [
      `🧺 <@${owner}> 님이 ${who.emoji} **${who.name}**의 ${r.order.kind === 'board' ? '게시판 주문' : '의뢰'}(${what})을 채웠어요 · 🪙 ${num(r.order.gold)}${prize.length ? ` · ${prize.map((x) => x.replace(/\*\*/g, '')).join(' · ')}` : ''}`,
      `${who.emoji} **${who.name}** — 「${thanksOf(r.order, who)}」`,
    ].join('\n'),
    allowedMentions: QUIET,
  });
  return announceLevel(interaction, r.levelUp, crops);
}
