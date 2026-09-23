/**
 * farm/ui/plant — 심기 창 (2a · 3a 궁합 미리보기 · 3c 주머니 씨앗 · 4c 과수)
 */
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} from 'discord.js';
import { getFarm, getFarmCrops, getPreview, plantFarm } from '../../api.js';
import { base, fail, trunc } from '../../embeds.js';
import { forget } from '../../casino/alive.js';
import { seatedAt, seatedMessage } from '../../casino/tables.js';
import {
  FARM_COLOR, cropName, plantName, cellEmoji, plotNo, stars, modsBadge, seasonsText,
} from '../render.js';
import {
  PREFIX, EPH, QUIET, CELL_COUNT, TREE_CELL, TREE_FRUITS, PLANT_PAGE, PAGE_VALUE,
  num, why, refuse, cellsOf, maskOf, soilCells, openPlots, pickPlot, nextOpen, unlocked,
} from './shared.js';

/** 심기 창이 보여 줄 밭. `plot` 이 열린 밭이 아니면 빈 흙이 있는 밭을 고른다. */
export const plantPlot = (farm, plot) => (plot != null && farm.plots[plot]?.open ? plot : pickPlot(farm, (p) => soilCells(p).length));

/**
 * 궁합 미리보기(3a)를 받는다. 셀렉트 줄마다 붙일 요약(`all`)과, 고른 작물의 보정 전부(`mods`).
 * 밭에 이미 작물이 있으면 그 밭의 보정은 농장 보기(`plot.mods`)에 이미 있다 — 요약만 받는다.
 * 미리보기가 안 와도 창은 연다(궁합 표시만 빠진다).
 */
async function previewFor(ch, farm, at, crop) {
  const fixed = farm.plots[at]?.crop;
  try {
    const [{ all }, one] = await Promise.all([
      getPreview(ch, at),
      crop && !fixed ? getPreview(ch, at, crop) : Promise.resolve(null),
    ]);
    return { all, mods: fixed ? farm.plots[at].mods : one?.mods ?? null };
  } catch {
    return { all: null, mods: fixed ? farm.plots[at].mods : null };
  }
}

/** 궁합 문구 줄(심기 창). 서버가 준 `notes` 그대로 — 좋은 것 🤝, 나쁜 것 ⚔️. */
export const modsLines = (mods) => (mods?.notes ?? []).slice(0, 5).map((n) => `${n.good ? '🤝' : '⚔️'} ${n.text}`);

/**
 * 심기 창. `plot` 이 열린 밭이 아니면 알아서 고른다. 밭에 이미 작물이 있으면 그 작물로 묶는다.
 * `mask` 는 빈 흙인 칸만 남긴다 — 그사이 바뀌었을 수 있다.
 * `preview` 는 `previewFor` 가 받아 온 궁합 — 셀렉트 줄마다 🤝/⚔️, 고른 작물의 문구.
 */
export function plantPayload({
  ch, plot, crop, mask, owner, farm, crops, note, preview = null, pouch = {}, page = null,
}) {
  const at = plantPlot(farm, plot);
  const p = farm.plots[at];
  const fixed = p.crop;
  const key = fixed ?? crop ?? null;
  const list = unlocked(crops, farm.level, pouch);
  const c = (fixed ? crops.find((x) => x.key === key) : list.find((x) => x.key === key)) ?? null;
  // 쪽 — 따로 준 쪽, 없으면 고른 작물이 있는 쪽
  const pages = Math.max(1, Math.ceil(list.length / PLANT_PAGE));
  const onPage = page ?? Math.max(0, Math.floor(list.findIndex((x) => x.key === c?.key) / PLANT_PAGE));
  const pg = Math.min(pages - 1, Math.max(0, onPage));
  const soil = soilCells(p);
  const all = maskOf(soil);
  const m = mask & all;
  const picked = cellsOf(m);
  const tree = Boolean(c?.tree);                 // 나무(4c) — 밭 하나에 한 그루, 칸을 고르지 않는다
  const cost = c ? (tree ? c.seed : c.seed * picked.length) : 0;
  const ready = tree ? soil.length === CELL_COUNT && !fixed : picked.length > 0;

  /** `farm:<동작>:<채널>:<밭>:<작물>:<칸>:<인자>:<주인>` — 주인은 맨 뒤. */
  const id = (act, { mm = m, arg = '-', cr = c?.key ?? '-' } = {}) => [PREFIX, act, ch, at, cr, mm, arg, owner].join(':');

  const lines = [`토질 ${stars(p.star)}`];
  const bag = Object.entries(pouch).filter(([, n]) => n > 0);
  if (bag.length) lines.push(`🎒 주머니 ${bag.map(([k, n]) => `${cropName(crops, k)} ×${n}`).join(' · ')}`);
  if (c && tree) {
    lines.push(`${c.emoji} **${c.treeName}** · 묘목 **${num(c.seed)}골드** — 밭 하나에 한 그루 · 물을 **${c.days}번** 받으면 첫 열매, 그 뒤 제철엔 ${c.regrow}일마다 열려요`);
    if (c.note) lines.push(`📜 ${c.note}`);
    const now = farm.sky?.today.season;
    if (now && c.seasons) lines.push(`🗓️ 제철 ${seasonsText(c)} — 지금 ${now.name}${c.seasons.includes(now.key) ? ', 제철이에요' : '은 제철이 아니에요(첫 열매 전엔 느리게 자라요)'}`);
    lines.push(`_거둘 때마다 토질에 따라 열매 ${TREE_FRUITS} — 첫 수확만으로 묘목값을 넘어요._`);
  } else if (c) {
    lines.push(`${c.emoji} **${c.name}** · ${c.seedOnly ? `**🎒 주머니 씨앗** 칸당 하나(가진 것 ${num(pouch[c.key] ?? 0)})` : `씨앗 칸당 **${num(c.seed)}골드**`} · 물을 **${c.days}번** 받으면 다 자라요`
      + (c.regrow ? ` · 거둔 뒤 ${c.regrow}일마다 또 열려요` : ''));
    if (c.note) lines.push(`📜 ${c.note}`);
    const now = farm.sky?.today.season;
    if (now && c.seasons) {
      lines.push(c.seasons.includes(now.key)
        ? `🗓️ 제철 ${seasonsText(c)} — 지금 ${now.name}, 제철이에요`
        : `🥀 제철 ${seasonsText(c)} — 지금 ${now.name}은 제철이 아니라 **느리게 자라고 품질이 떨어져요**`);
    }
    if (!c.seedOnly) lines.push(`_거두면 칸마다 ${num(c.price)}골드어치(최소 1개) — 씨앗값을 빼도 칸당 **${num(c.profit)}골드** 이상 남아요._`);
  } else {
    lines.push('_먼저 심을 작물을 고르세요._');
  }
  if (fixed) lines.push('_이 밭엔 이미 이 작물이 자라고 있어요. 한 밭엔 한 작물만 심어요._');
  if (c) {
    const ml = modsLines(preview?.mods);
    if (ml.length) lines.push('', ...ml);
  }
  if (tree && !fixed) {
    lines.push('', soil.length === CELL_COUNT
      ? `밭 전체에 한 그루 · 묘목값 **${num(cost)}골드**`
      : `⚠️ 나무는 **아홉 칸이 다 빈 흙**이어야 심어요 — 지금 빈 흙 ${soil.length} / ${CELL_COUNT}. 돌·잡초는 \`/농장 개간\`, 작물은 개간 창에서 뽑아요.`);
  } else lines.push('', soil.length
    ? `고른 칸 **${picked.length}** / 빈 칸 ${soil.length}${c ? (c.seedOnly ? ` · 주머니 씨앗 **${picked.length}개**` : ` · 씨앗값 **${num(cost)}골드**`) : ''}`
    : '_이 밭엔 빈 흙이 없어요. 돌·잡초는 `/농장 개간` 으로 치워요._');
  if (note) lines.push('', note);

  const rows = [];
  if (!fixed) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(id('pc'))
        .setPlaceholder('무엇을 심을까요?')
        .addOptions([
          ...list.slice(pg * PLANT_PAGE, (pg + 1) * PLANT_PAGE).map((x) => ({
            label: trunc(x.seedOnly ? `${x.name} — 🎒 주머니 ${pouch[x.key]}` : x.tree ? `${x.treeName} — 묘목 ${x.seed}골드` : `${x.name} — 씨앗 ${x.seed}골드`, 100),
            value: x.key,
            emoji: x.emoji,
            description: trunc(`${farm.sky && x.seasons ? (x.seasons.includes(farm.sky.today.season.key) ? '🗓️제철 · ' : '🥀제철 아님 · ') : ''}${modsBadge(preview?.all?.[x.key]) ? `${modsBadge(preview.all[x.key])} · ` : ''}${x.days}일${x.tree ? ' · 🌳 밭 전체' : x.seedOnly ? ' · 희귀' : ` · 거두면 칸당 +${x.profit}골드 이상`}${x.regrow ? ` · ${x.regrow}일마다 또 열림` : ''}`, 100),
            default: x.key === c?.key,
          })),
          ...(pages > 1 ? [{
            label: `▶ 다른 작물 (${pg + 1}/${pages}쪽)`, value: `${PAGE_VALUE}${(pg + 1) % pages}`, description: '다음 쪽의 작물을 봐요',
          }] : []),
        ]),
    ));
  }
  for (let r = 0; r < 3; r += 1) {
    rows.push(new ActionRowBuilder().addComponents([0, 1, 2].map((k) => {
      const i = r * 3 + k;
      const state = p.cells[i];
      if (state !== 'soil') {
        // 막힌 칸도 customId 가 서로 달라야 한다(칸 번호를 인자에).
        return new ButtonBuilder().setCustomId(id('no', { arg: i })).setEmoji(cellEmoji(state, crops, p.crop))
          .setStyle(ButtonStyle.Secondary).setDisabled(true);
      }
      const on = Boolean(m & (1 << i));
      return new ButtonBuilder().setCustomId(id('pt', { arg: i }))
        .setEmoji(on ? (c?.emoji ?? '🌱') : '🟫')
        .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(!c || tree);
    })));
  }
  const controls = [
    new ButtonBuilder().setCustomId(id('pa')).setLabel(m === all && all ? '전체 해제' : '전체')
      .setStyle(ButtonStyle.Secondary).setDisabled(!c || tree || !soil.length),
    new ButtonBuilder().setCustomId(id('pg'))
      .setLabel(tree ? `나무 심기 · ${num(cost)}골드` : c?.seedOnly ? `심기 · 🎒 ${picked.length}개` : `심기 · ${num(cost)}골드`)
      .setEmoji(tree ? '🌳' : '🌱')
      .setStyle(ButtonStyle.Success).setDisabled(!c || !ready),
  ];
  if (openPlots(farm).length > 1) {
    controls.push(new ButtonBuilder().setCustomId(id('pn', { mm: 0, cr: '-' })).setLabel('다른 밭').setStyle(ButtonStyle.Secondary));
  }
  controls.push(new ButtonBuilder().setCustomId(id('px')).setLabel('닫기').setStyle(ButtonStyle.Secondary));
  rows.push(new ActionRowBuilder().addComponents(controls));

  return {
    embeds: [base({
      title: `🌱 심기 — ${plotNo(at)}번 밭`,
      description: lines.join('\n'),
      color: FARM_COLOR,
      footer: '🟫 빈 칸을 눌러 고르고 「심기」를 누르세요 · 물을 줘야 자라요',
    })],
    components: rows,
    allowedMentions: QUIET,
  };
}

/** 심기 창을 연다(명령·농장 화면의 버튼 둘 다). 이미 응답을 잡아 둔 상태에서 부른다. */
export async function openPlant(interaction, ch, { plot = null, crop = null } = {}) {
  const me = interaction.user.id;
  const [{ farm, me: mine }, crops] = await Promise.all([getFarm(ch, me), getFarmCrops()]);
  const pouch = mine?.pouch ?? {};
  if (!farm) return refuse(interaction, why({ reason: 'none' }));
  if (farm.owner !== me) return refuse(interaction, why({ reason: 'notOwner', owner: farm.owner }));
  const at = seatedAt(me);
  if (at) return refuse(interaction, seatedMessage('그쪽', at));
  const want = crops.find((c) => c.key === crop);
  const usable = want && unlocked(crops, farm.level, pouch).some((x) => x.key === want.key);
  let note;
  if (want && !usable) {
    note = want.seedOnly
      ? `⚠️ ${why({ reason: 'noSeed', crop: want.key, have: 0, need: 1 }, crops)}`
      : `⚠️ ${why({ reason: 'level', crop: want.key, need: want.lv }, crops)}`;
  }
  const where = plantPlot(farm, plot);
  const preview = await previewFor(ch, farm, where, usable ? want.key : null);
  return interaction.editReply(plantPayload({
    ch, plot: where, crop: usable ? want.key : null, mask: 0, owner: me, farm, crops, note, preview, pouch,
  }));
}

/** 심기 창의 조작. 주인만 누른다(customId 맨 뒤). */
export async function plantButton(interaction, act, [ch, plotS, cropS, maskS, arg, owner]) {
  if (interaction.user.id !== owner) {
    return interaction.reply({ embeds: [fail('자기 심기 창에서만 누를 수 있어요.')], flags: EPH });
  }
  await interaction.deferUpdate();
  if (act === 'px') return interaction.editReply({ embeds: [base({ title: '🌱 심기 창을 닫았어요', color: FARM_COLOR })], components: [] });

  let plot = Number(plotS);
  let crop = cropS === '-' ? null : cropS;
  let mask = Number(maskS) || 0;
  let page = null;
  const [{ farm, me }, crops] = await Promise.all([getFarm(ch, owner), getFarmCrops()]);
  if (!farm) return interaction.editReply({ embeds: [fail(why({ reason: 'none' }))], components: [] });
  const pouch = me?.pouch ?? {};
  let preview = null;
  const payload = (note) => plantPayload({
    ch, plot, crop, mask, owner, farm, crops, note, preview, pouch, page,
  });

  if (act === 'pc') {
    const v = interaction.values?.[0] ?? '';
    if (v.startsWith(PAGE_VALUE)) page = Number(v.slice(PAGE_VALUE.length)) || 0;   // 쪽 넘김 — 작물은 그대로
    else crop = v || crop;
  }
  if (act === 'pt') mask ^= 1 << Number(arg);
  if (act === 'pa') {
    const all = maskOf(soilCells(farm.plots[plot] ?? { cells: [] }));
    mask = (mask & all) === all ? 0 : all;
  }
  if (act === 'pn') {
    plot = nextOpen(farm, plot);
    mask = 0;
  }
  // 칸만 누른 것(pt·pa)은 궁합이 안 바뀐다 — 그래도 창을 다시 그리므로 한 번 받아 둔다.
  if (act !== 'pg') {
    plot = plantPlot(farm, plot);
    preview = await previewFor(ch, farm, plot, crop);
    return interaction.editReply(payload());
  }

  // 심기. 판에 앉았는지 **누르는 순간** 다시 본다 — 창을 연 뒤에 앉았을 수 있다.
  const at = seatedAt(owner);
  if (at) return interaction.editReply(payload(`⚠️ ${seatedMessage('그쪽', at)}`));
  const r = await plantFarm({
    channelId: ch, userId: owner, plot, cells: crops.find((x) => x.key === crop)?.tree ? [TREE_CELL] : cellsOf(mask), crop,
  });
  if (!r.ok) return interaction.editReply(payload(`⚠️ ${why(r, crops)}`));

  forget(owner);
  return interaction.editReply({
    embeds: [base({
      title: r.tree ? `🌳 ${plantName(crops, r.crop)}를 심었어요` : `🌱 ${cropName(crops, r.crop)} ${r.count}칸을 심었어요`,
      description: [
        r.seeds
          ? `🎒 주머니 씨앗 **−${r.seeds}** · 남은 것 **${num(r.me?.pouch?.[r.crop] ?? 0)}**`
          : `${r.tree ? '묘목값' : '씨앗값'} **−${num(r.cost)}골드** · 가진 골드 **${num(r.account?.gold)}**`,
        '_물을 줘야 자라기 시작해요 — `/농장 물주기` (한 포기에 체력 1)_',
      ].join('\n'),
      color: FARM_COLOR,
    })],
    components: [],
  });
}
