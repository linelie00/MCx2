/**
 * /농장 — 채널마다 하나씩, 물을 주며 키우는 농장 (docs/FARM.md · 1단계 MVP)
 *
 * 채널 하나가 땅 하나. 먼저 `/농장 등록` 한 사람이 주인이고, **한 사람에 농장 하나.**
 * 물은 하루 한 번 농장 전체에 — **누구나** 줄 수 있다. 심기·수확·폐농은 주인만.
 *
 * **규칙은 전부 서버에 있다**(`server/src/farm/rules.js`). 성장·시듦·씨앗값을 봇이 다시 셈하지
 * 않는다 — 두 곳에서 셈하면 언젠가 어긋난다. 봇은 서버가 준 칸 상태를 그리고, 못 한 사유
 * (`reason`)를 문장으로 바꾼다.
 *
 * 화면은 둘이다.
 *   - **농장 화면** — 공개. 버튼(물 · 수확 · 심기 · 새로고침)은 누구나 누를 수 있고, 주인만
 *     되는 일은 서버가 거절한다. customId 에 **채널 id** 를 싣는다 — `/농장 보기 채널:` 로
 *     남의 채널 농장을 띄워도 버튼이 그 농장을 가리키게.
 *   - **심기 창** — 에페메랄. 작물 셀렉트 + 칸 3×3 토글 + 조작 한 줄(5줄, 디스코드 한도).
 *     상태가 없는 핸들러라 고른 작물·밭·칸(9비트)과 **주인 id(맨 뒤)** 를 customId 에 싣는다.
 *
 * **판에 앉아 있으면 못 심는다.** 씨앗값은 골드를 빼는데, 판이 도는 동안 골드는 판의 장부에
 * 있다(`casino/tables.js`) — 상점과 같은 까닭이다. 물주기·수확은 골드를 안 건드려 막지 않는다.
 *
 * 못 한 것은 **본인에게만** 보인다. 공개로 잡아 둔 응답은 지우고 에페메랄로 다시 말한다.
 */
import {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelType, MessageFlags,
} from 'discord.js';
import {
  getFarm, getFarmOf, getFarmCrops, registerFarm, abandonFarm, waterFarm, plantFarm, harvestFarm,
} from '../api.js';
import { base, fail, trunc } from '../embeds.js';
import { forget } from '../casino/alive.js';
import { forgetBag } from '../casino/bag.js';
import { seatedAt, seatedMessage } from '../casino/tables.js';
import {
  FARM_COLOR, farmEmbed, cropName, cellEmoji, plotNo,
} from '../farm/render.js';

export const PREFIX = 'farm';
const EPH = MessageFlags.Ephemeral;
/** 멘션을 적어도 아무도 안 불린다. 물 한 번에 알림이 가면 성가시다. */
const QUIET = { parse: [] };

/** 폐농 확인 버튼이 살아 있는 시간. 지나면 다시 `/농장 폐농`. */
const ABANDON_MS = 30_000;
/** 처음 열린 밭(키패드 5). 심기 창이 먼저 고르는 밭이다. */
const START_PLOT = 4;

const num = (n) => Number(n ?? 0).toLocaleString('ko-KR');

// ---------------------------------------------------------------- 사유

/** 서버가 준 `reason` → 사람에게 할 말. */
function why(r, crops) {
  switch (r.reason) {
    case 'none': return '이 채널엔 농장이 없어요. `/농장 등록` 으로 열 수 있어요.';
    case 'notOwner': return `농사일은 주인 <@${r.owner}> 님만 할 수 있어요. 물은 누구나 줄 수 있어요!`;
    case 'already': return `오늘은 이미 <@${r.by}> 님이 물을 줬어요. 내일 또 부탁해요.`;
    case 'locked': return '아직 잠긴 밭이에요.';
    case 'otherCrop': return `그 밭엔 이미 **${cropName(crops, r.crop)}** 이(가) 자라고 있어요. 한 밭엔 한 작물만 심어요.`;
    case 'occupied': return '고른 칸 가운데 이미 무언가 있는 칸이 있어요. 창을 새로 열어 주세요.';
    case 'gold': return `골드가 모자라요. 씨앗값 **${num(r.need)}골드** · 가진 골드 **${num(r.gold)}**`;
    case 'nothing': return '거둘 게 없어요. 칸에 작물 그림이 보이면(다 자람) 수확할 수 있어요.';
    case 'taken': return `이미 <@${r.owner}> 님의 땅이에요. 물은 누구나 줄 수 있어요 — \`/농장 물주기\``;
    case 'mine': return '이미 내 농장이에요. `/농장 보기`';
    case 'hasFarm': return `농장은 한 사람에 하나예요. 내 농장은 <#${r.channelId}> 에 있어요. 옮기려면 \`/농장 폐농\` 을 먼저 해 주세요.`;
    case 'cooldown': return `폐농한 지 얼마 안 됐어요. **${r.until}** 부터 다시 열 수 있어요.`;
    default: return `하지 못했어요. (${r.reason})`;
  }
}

/** 공개로 잡아 둔 응답을 지우고, 본인에게만 말한다. */
async function refuse(interaction, message) {
  if (interaction.deferred && !interaction.ephemeral) {
    await interaction.deleteReply().catch(() => {});
    await interaction.followUp({ embeds: [fail(message)], flags: EPH, allowedMentions: QUIET });
    return;
  }
  // 수정(editReply)에는 에페메랄 플래그를 싣지 않는다 — 처음 응답을 잡을 때 이미 정해졌다.
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: '', embeds: [fail(message)], components: [], allowedMentions: QUIET });
    return;
  }
  await interaction.reply({ embeds: [fail(message)], flags: EPH, allowedMentions: QUIET });
}

// ---------------------------------------------------------------- 농장 화면

const channelName = (interaction, id) => interaction.guild?.channels.cache.get(id)?.name;

function viewRow(ch) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:w:${ch}`).setLabel('물주기').setEmoji('💧').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}:h:${ch}`).setLabel('수확').setEmoji('🧺').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:p:${ch}`).setLabel('심기').setEmoji('🌱').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:v:${ch}`).setEmoji('🔄').setStyle(ButtonStyle.Secondary),
  );
}

function viewPayload(interaction, farm, crops, content) {
  return {
    content: content ?? '',
    embeds: [farmEmbed(farm, crops, { name: channelName(interaction, farm.channelId) })],
    components: [viewRow(farm.channelId)],
    allowedMentions: QUIET,
  };
}

/** 수확한 것 한 줄. `당근 ×4 · 상추 ×2` */
const itemsLine = (items, crops) => Object.entries(items)
  .map(([k, n]) => `${cropName(crops, k)} ×${n}`).join(' · ');

function waterNote(r) {
  const bits = [`${r.grew}포기가 자랐어요`];
  if (r.revived) bits.push(`🍂 ${r.revived}포기가 살아났어요`);
  if (r.ripened) bits.push(`🧺 ${r.ripened}포기가 다 자랐어요`);
  return bits.join(' · ');
}

// ---------------------------------------------------------------- 심기 창

/** 9비트 ↔ 칸 index. */
const cellsOf = (mask) => [...Array(9).keys()].filter((i) => mask & (1 << i));
const maskOf = (cells) => cells.reduce((m, i) => m | (1 << i), 0);

const soilCells = (plot) => plot.cells.map((s, i) => (s === 'soil' ? i : -1)).filter((i) => i >= 0);
const openPlots = (farm) => farm.plots.map((p, i) => (p.open ? i : -1)).filter((i) => i >= 0);

/** 먼저 보여 줄 밭. 가운데(5)를 먼저, 그다음 빈 칸이 있는 열린 밭. */
function pickPlot(farm) {
  const open = openPlots(farm);
  const withSoil = open.filter((i) => soilCells(farm.plots[i]).length);
  if (withSoil.includes(START_PLOT)) return START_PLOT;
  return withSoil[0] ?? open[0] ?? START_PLOT;
}

/**
 * 심기 창. `plot` 이 열린 밭이 아니면 알아서 고른다. 밭에 이미 작물이 있으면 그 작물로 묶는다.
 * `mask` 는 빈 흙인 칸만 남긴다 — 그사이 남이 바꿨을 수 있다(물은 누구나 준다).
 */
function plantPayload({
  ch, plot, crop, mask, owner, farm, crops, note,
}) {
  const at = plot != null && farm.plots[plot]?.open ? plot : pickPlot(farm);
  const p = farm.plots[at];
  const fixed = p.crop;
  const key = fixed ?? crop ?? null;
  const c = crops.find((x) => x.key === key) ?? null;
  const soil = soilCells(p);
  const all = maskOf(soil);
  const m = mask & all;
  const picked = cellsOf(m);
  const cost = c ? c.seed * picked.length : 0;

  /** `farm:<동작>:<채널>:<밭>:<작물>:<칸>:<인자>:<주인>` — 주인은 맨 뒤. */
  const id = (act, { mm = m, arg = '-', cr = key ?? '-' } = {}) => [PREFIX, act, ch, at, cr, mm, arg, owner].join(':');

  const lines = [];
  if (c) {
    lines.push(`${c.emoji} **${c.name}** · 씨앗 칸당 **${num(c.seed)}골드** · 물을 **${c.days}번** 받으면 다 자라요`
      + (c.regrow ? ` · 거둔 뒤 ${c.regrow}일마다 또 열려요` : ''));
    lines.push(`_거두면 칸마다 ${num(c.price)}골드어치(최소 1개) — 씨앗값을 빼도 칸당 **${num(c.profit)}골드** 이상 남아요._`);
  } else {
    lines.push('_먼저 심을 작물을 고르세요._');
  }
  if (fixed) lines.push('_이 밭엔 이미 이 작물이 자라고 있어요. 한 밭엔 한 작물만 심어요._');
  lines.push('', soil.length
    ? `고른 칸 **${picked.length}** / 빈 칸 ${soil.length}${c ? ` · 씨앗값 **${num(cost)}골드**` : ''}`
    : '_이 밭엔 빈 칸이 없어요._');
  if (note) lines.push('', note);

  const rows = [];
  if (!fixed) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(id('pc'))
        .setPlaceholder('무엇을 심을까요?')
        .addOptions(crops.slice(0, 25).map((x) => ({
          label: trunc(`${x.name} — 씨앗 ${x.seed}골드`, 100),
          value: x.key,
          emoji: x.emoji,
          description: trunc(`${x.days}일 · 거두면 칸당 +${x.profit}골드 이상${x.regrow ? ` · ${x.regrow}일마다 또 열림` : ''}`, 100),
          default: x.key === key,
        }))),
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
        .setDisabled(!c);
    })));
  }
  const controls = [
    new ButtonBuilder().setCustomId(id('pa')).setLabel(m === all && all ? '전체 해제' : '전체')
      .setStyle(ButtonStyle.Secondary).setDisabled(!c || !soil.length),
    new ButtonBuilder().setCustomId(id('pg')).setLabel(`심기 · ${num(cost)}골드`).setEmoji('🌱')
      .setStyle(ButtonStyle.Success).setDisabled(!c || !picked.length),
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
async function openPlant(interaction, ch, { plot = null, crop = null } = {}) {
  const me = interaction.user.id;
  const [{ farm }, crops] = await Promise.all([getFarm(ch), getFarmCrops()]);
  if (!farm) return refuse(interaction, why({ reason: 'none' }));
  if (farm.owner !== me) return refuse(interaction, why({ reason: 'notOwner', owner: farm.owner }));
  const at = seatedAt(me);
  if (at) return refuse(interaction, seatedMessage('그쪽', at));
  const known = crop && crops.some((c) => c.key === crop) ? crop : null;
  return interaction.editReply(plantPayload({
    ch, plot, crop: known, mask: 0, owner: me, farm, crops,
  }));
}

// ---------------------------------------------------------------- 명령

const plotOption = (o, text) => o.setName('밭').setDescription(text).setMinValue(1).setMaxValue(9);

const data = new SlashCommandBuilder()
  .setName('농장')
  .setDescription('채널마다 하나씩, 물을 주며 키우는 농장')
  .addSubcommand((s) => s.setName('등록').setDescription('이 채널을 내 농장으로 만듭니다 — 먼저 한 사람이 주인'))
  .addSubcommand((s) => s.setName('보기').setDescription('농장을 봅니다')
    .addChannelOption((o) => o.setName('채널').setDescription('볼 채널 (안 적으면 여기)').addChannelTypes(ChannelType.GuildText)))
  .addSubcommand((s) => s.setName('내농장').setDescription('어느 채널에서든 내 농장을 봅니다'))
  .addSubcommand((s) => s.setName('물주기').setDescription('이 채널 농장에 오늘의 물을 줍니다 — 누구나 줄 수 있어요'))
  .addSubcommand((s) => s.setName('심기').setDescription('씨앗을 사서 심습니다')
    .addStringOption((o) => o.setName('작물').setDescription('심을 작물').setAutocomplete(true))
    .addIntegerOption((o) => plotOption(o, '밭 번호 — 키패드 배치, 가운데가 5')))
  .addSubcommand((s) => s.setName('수확').setDescription('다 자란 것을 거두고 죽은 칸을 치웁니다')
    .addIntegerOption((o) => plotOption(o, '밭 번호 (안 적으면 전부)')))
  .addSubcommand((s) => s.setName('폐농').setDescription('내 농장을 없앱니다 — 등록 24시간 안이면 무르기'));

async function register(interaction) {
  // 채널 종류는 봇만 안다. 스레드·포럼·음성·공지 채널은 땅이 아니다.
  if (interaction.channel?.type !== ChannelType.GuildText) {
    return refuse(interaction, '농장은 **일반 텍스트 채널**에서만 열 수 있어요. 스레드·포럼·음성 채널은 안 돼요.');
  }
  await interaction.deferReply({ flags: EPH });
  const [r, crops] = await Promise.all([
    registerFarm({ channelId: interaction.channelId, guildId: interaction.guildId, userId: interaction.user.id }),
    getFarmCrops(),
  ]);
  if (!r.ok) return refuse(interaction, why(r, crops));

  await interaction.editReply({
    embeds: [base({
      title: '🛖 농장을 열었어요',
      description: '가운데 **5번 밭**부터 시작해요. `/농장 심기` 로 씨앗을 심고, 하루 한 번 물을 주세요.\n'
        + '_잘못 열었다면 24시간 안에 `/농장 폐농` 으로 무를 수 있어요._',
      color: FARM_COLOR,
    })],
  });
  return interaction.followUp(viewPayload(interaction, r.farm, crops, `🛖 <@${interaction.user.id}> 님이 이 채널에 농장을 열었어요!`));
}

async function show(interaction) {
  const ch = interaction.options.getChannel('채널')?.id ?? interaction.channelId;
  await interaction.deferReply();
  const [{ farm }, crops] = await Promise.all([getFarm(ch), getFarmCrops()]);
  if (!farm) {
    return refuse(interaction, ch === interaction.channelId
      ? why({ reason: 'none' })
      : `<#${ch}> 엔 농장이 없어요.`);
  }
  return interaction.editReply(viewPayload(interaction, farm, crops));
}

async function mine(interaction) {
  await interaction.deferReply({ flags: EPH });
  const [{ farm, cooldownUntil }, crops] = await Promise.all([getFarmOf(interaction.user.id), getFarmCrops()]);
  if (!farm) {
    return refuse(interaction, cooldownUntil
      ? why({ reason: 'cooldown', until: cooldownUntil })
      : '아직 농장이 없어요. 마음에 드는 채널에서 `/농장 등록` 을 해 보세요.');
  }
  const grace = Date.parse(farm.graceUntil) > Date.now()
    ? `_<t:${Math.floor(Date.parse(farm.graceUntil) / 1000)}:R> 까지는 \`/농장 폐농\` 으로 무를 수 있어요._`
    : undefined;
  return interaction.editReply(viewPayload(interaction, farm, crops, grace));
}

async function waterCmd(interaction) {
  await interaction.deferReply();
  const [r, crops] = await Promise.all([
    waterFarm({ channelId: interaction.channelId, userId: interaction.user.id }),
    getFarmCrops(),
  ]);
  if (!r.ok) return refuse(interaction, why(r, crops));
  return interaction.editReply(viewPayload(interaction, r.farm, crops, `💧 <@${interaction.user.id}> 님이 물을 줬어요 — ${waterNote(r)}`));
}

async function plantCmd(interaction) {
  await interaction.deferReply({ flags: EPH });
  const n = interaction.options.getInteger('밭');
  return openPlant(interaction, interaction.channelId, {
    plot: n ? n - 1 : null,
    crop: interaction.options.getString('작물'),
  });
}

async function harvestCmd(interaction) {
  const n = interaction.options.getInteger('밭');
  await interaction.deferReply();
  const [r, crops] = await Promise.all([
    harvestFarm({ channelId: interaction.channelId, userId: interaction.user.id, plot: n ? n - 1 : null }),
    getFarmCrops(),
  ]);
  if (!r.ok) return refuse(interaction, why(r, crops));
  forgetBag(interaction.user.id);           // /요리 재료 자동완성이 거둔 것을 바로 보게
  return interaction.editReply(viewPayload(interaction, r.farm, crops, harvestNote(interaction.user.id, r, crops)));
}

function harvestNote(who, r, crops) {
  const bits = [];
  if (r.harvested) bits.push(`${itemsLine(r.items, crops)}`);
  if (r.cleared) bits.push(`💀 ${r.cleared}칸을 치웠어요`);
  return `🧺 <@${who}> 님의 수확 — ${bits.join(' · ')}`;
}

async function abandonCmd(interaction) {
  await interaction.deferReply({ flags: EPH });
  const me = interaction.user.id;
  const { farm } = await getFarmOf(me);
  if (!farm) return refuse(interaction, '없앨 농장이 없어요.');

  const free = Date.parse(farm.graceUntil) > Date.now();
  const planted = farm.plots.reduce((a, p) => a + p.cells.filter((s) => !['soil', 'locked'].includes(s)).length, 0);
  return interaction.editReply({
    embeds: [base({
      title: '⚠️ 정말 폐농할까요?',
      description: [
        `<#${farm.channelId}> 의 농장이 **통째로 사라져요.** 심긴 작물 **${planted}포기**도 함께요.`,
        free
          ? '_등록한 지 24시간이 안 돼서 **무르기**예요 — 바로 다시 열 수 있어요._'
          : '_무르기 기한(24시간)이 지났어요. 폐농하면 **7일 동안** 다시 못 열어요._',
        '',
        '_30초 안에 눌러 주세요._',
      ].join('\n'),
      color: 0xa04a3a,
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:ab:${Date.now()}:${me}`).setLabel('정말 폐농').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${PREFIX}:abx:-:${me}`).setLabel('그만두기').setStyle(ButtonStyle.Secondary),
    )],
    allowedMentions: QUIET,
  });
}

const RUN = {
  등록: register, 보기: show, 내농장: mine, 물주기: waterCmd, 심기: plantCmd, 수확: harvestCmd, 폐농: abandonCmd,
};

async function execute(interaction) {
  const run = RUN[interaction.options.getSubcommand()];
  try {
    await run(interaction);
  } catch (err) {
    await refuse(interaction, `농장 서버에 닿지 못했어요. ${err.message}`);
  }
}

async function autocomplete(interaction) {
  const typed = String(interaction.options.getFocused() || '').replace(/\s+/g, '');
  let crops = [];
  try { crops = await getFarmCrops(); } catch { /* 빈 목록으로 답한다 — 시한이 3초다 */ }
  await interaction.respond(crops
    .filter((c) => !typed || c.name.includes(typed) || c.key.includes(typed))
    .slice(0, 25)
    .map((c) => ({ name: trunc(`${c.emoji} ${c.name} — 씨앗 ${c.seed}골드 · ${c.days}일`, 100), value: c.key })));
}

// ---------------------------------------------------------------- 버튼

/** 농장 화면의 버튼. 누구나 누른다 — 주인만 되는 일은 서버가 거절한다. */
async function viewButton(interaction, act, ch) {
  if (act === 'p') {
    await interaction.deferReply({ flags: EPH });
    return openPlant(interaction, ch);
  }

  await interaction.deferUpdate();
  const me = interaction.user.id;
  const crops = await getFarmCrops();

  if (act === 'v') {
    const { farm } = await getFarm(ch);
    if (!farm) return interaction.editReply({ content: '_이 농장은 사라졌어요._', embeds: [], components: [] });
    return interaction.editReply(viewPayload(interaction, farm, crops));
  }

  const r = act === 'w'
    ? await waterFarm({ channelId: ch, userId: me })
    : await harvestFarm({ channelId: ch, userId: me });
  if (r.farm) await interaction.editReply(viewPayload(interaction, r.farm, crops));
  if (!r.ok) return interaction.followUp({ embeds: [fail(why(r, crops))], flags: EPH, allowedMentions: QUIET });

  if (act === 'h') forgetBag(me);
  return interaction.followUp({
    content: act === 'w' ? `💧 <@${me}> 님이 물을 줬어요 — ${waterNote(r)}` : harvestNote(me, r, crops),
    allowedMentions: QUIET,
  });
}

/** 심기 창의 조작. 주인만 누른다(customId 맨 뒤). */
async function plantButton(interaction, act, [ch, plotS, cropS, maskS, arg, owner]) {
  if (interaction.user.id !== owner) {
    return interaction.reply({ embeds: [fail('자기 심기 창에서만 누를 수 있어요.')], flags: EPH });
  }
  await interaction.deferUpdate();
  if (act === 'px') return interaction.editReply({ embeds: [base({ title: '🌱 심기 창을 닫았어요', color: FARM_COLOR })], components: [] });

  let plot = Number(plotS);
  let crop = cropS === '-' ? null : cropS;
  let mask = Number(maskS) || 0;
  const [{ farm }, crops] = await Promise.all([getFarm(ch), getFarmCrops()]);
  if (!farm) return interaction.editReply({ embeds: [fail(why({ reason: 'none' }))], components: [] });
  const payload = (note) => plantPayload({
    ch, plot, crop, mask, owner, farm, crops, note,
  });

  if (act === 'pc') crop = interaction.values?.[0] ?? crop;
  if (act === 'pt') mask ^= 1 << Number(arg);
  if (act === 'pa') {
    const all = maskOf(soilCells(farm.plots[plot] ?? { cells: [] }));
    mask = (mask & all) === all ? 0 : all;
  }
  if (act === 'pn') {
    const open = openPlots(farm);
    plot = open[(open.indexOf(plot) + 1) % open.length];
    mask = 0;
  }
  if (act !== 'pg') return interaction.editReply(payload());

  // 심기. 판에 앉았는지 **누르는 순간** 다시 본다 — 창을 연 뒤에 앉았을 수 있다.
  const at = seatedAt(owner);
  if (at) return interaction.editReply(payload(`⚠️ ${seatedMessage('그쪽', at)}`));
  const r = await plantFarm({
    channelId: ch, userId: owner, plot, cells: cellsOf(mask), crop,
  });
  if (!r.ok) return interaction.editReply(payload(`⚠️ ${why(r, crops)}`));

  forget(owner);
  const watered = r.farm.watered;
  return interaction.editReply({
    embeds: [base({
      title: `🌱 ${cropName(crops, r.crop)} ${r.count}칸을 심었어요`,
      description: [
        `씨앗값 **−${num(r.cost)}골드** · 가진 골드 **${num(r.account?.gold)}**`,
        watered
          ? '_오늘 물은 이미 받아서 하루치 자랐어요._'
          : '_오늘 물을 주면 바로 자라기 시작해요 — `/농장 물주기`_',
      ].join('\n'),
      color: FARM_COLOR,
    })],
    components: [],
  });
}

/** 폐농 확인. */
async function abandonButton(interaction, act, [ts, owner]) {
  if (interaction.user.id !== owner) {
    return interaction.reply({ embeds: [fail('자기 농장만 폐농할 수 있어요.')], flags: EPH });
  }
  await interaction.deferUpdate();
  if (act === 'abx') return interaction.editReply({ embeds: [base({ title: '🛖 폐농을 그만뒀어요', color: FARM_COLOR })], components: [] });
  if (Date.now() - Number(ts) > ABANDON_MS) {
    return interaction.editReply({ embeds: [fail('확인 시간이 지났어요. 다시 `/농장 폐농` 해 주세요.')], components: [] });
  }

  const r = await abandonFarm(owner);
  if (!r.ok) return interaction.editReply({ embeds: [fail('없앨 농장이 없어요.')], components: [] });
  return interaction.editReply({
    embeds: [base({
      title: '🍂 폐농했어요',
      description: r.free
        ? `<#${r.channelId}> 의 농장을 물렀어요. 바로 다른 채널에서 다시 열 수 있어요.`
        : `<#${r.channelId}> 의 농장을 닫았어요. **${r.until}** 부터 다시 열 수 있어요.`,
      color: FARM_COLOR,
    })],
    components: [],
  });
}

async function component(interaction) {
  const [, act, ...rest] = interaction.customId.split(':');
  try {
    if (['w', 'h', 'p', 'v'].includes(act)) return await viewButton(interaction, act, rest[0]);
    if (act === 'ab' || act === 'abx') return await abandonButton(interaction, act, rest);
    return await plantButton(interaction, act, rest);
  } catch (err) {
    const send = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
    return interaction[send]({ embeds: [fail(`농장 서버에 닿지 못했어요. ${err.message}`)], flags: EPH });
  }
}

/** 검사용(scripts/check-farm.mjs). 화면은 상태가 없어 그대로 불러 볼 수 있다. */
export { plantPayload, why, cellsOf, maskOf };

export default {
  data,
  execute,
  autocomplete,
  componentPrefix: PREFIX,
  component,
};
