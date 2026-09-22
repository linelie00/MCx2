/**
 * /농장 — 채널마다 하나씩, 물을 주며 키우는 농장 (docs/FARM.md)
 *
 * 채널 하나가 땅 하나. 먼저 `/농장 등록` 한 사람이 주인이고, **한 사람에 농장 하나.**
 * 물은 칸마다 하루 한 번, **누구나** 줄 수 있다 — 한 포기에 **체력 1**. 심기·수확·개간·폐농은 주인만.
 *
 * **규칙은 전부 서버에 있다**(`server/src/farm/rules.js`). 성장·시듦·씨앗값·결 자리를 봇이 다시
 * 셈하지 않는다 — 두 곳에서 셈하면 언젠가 어긋난다. 봇은 서버가 준 칸 상태를 그리고, 못 한 사유
 * (`reason`)를 문장으로 바꾼다.
 *
 * 화면은 넷이다.
 *   - **농장 화면** — 공개. 버튼(물 · 수확 · 심기 · 개간 · 새로고침)은 누구나 누를 수 있고, 주인만
 *     되는 일은 서버가 거절한다. customId 에 **채널 id** 를 싣는다 — `/농장 보기 채널:` 로
 *     남의 채널 농장을 띄워도 버튼이 그 농장을 가리키게.
 *   - **심기 창** — 에페메랄. 작물 셀렉트 + 칸 3×3 토글 + 조작 한 줄(5줄, 디스코드 한도).
 *   - **개간 창** — 에페메랄. 칸 3×3(돌·잡초는 누르면 치우고, 바위는 바위 창으로) + 조작 한 줄.
 *   - **바위 창** — 에페메랄. 결 자리 `[1]`~`[5]` + 힌트. 결 자리는 서버만 안다.
 *   상태가 없는 핸들러라 창의 상태(밭·칸·작물·고른 칸)와 **주인 id(맨 뒤)** 를 customId 에 싣는다.
 *
 * **판에 앉아 있으면 못 심고 물도 못 준다.** 씨앗값은 골드를, 물은 체력을 쓰는데 판이 도는 동안
 * 둘 다 판의 장부에 있다(`casino/tables.js`) — 상점·출첵과 같은 까닭이다.
 *
 * 레벨이 오르면 **채널에 공개로** 알린다(밭이 열린 것은 모두가 볼 일이다).
 * 못 한 것은 **본인에게만** 보인다. 공개로 잡아 둔 응답은 지우고 에페메랄로 다시 말한다.
 */
import {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelType, MessageFlags,
} from 'discord.js';
import {
  getFarm, getFarmOf, getFarmCrops, registerFarm, abandonFarm, waterFarm, plantFarm, harvestFarm, clearFarm,
} from '../api.js';
import { base, fail, trunc } from '../embeds.js';
import { forget } from '../casino/alive.js';
import { forgetBag } from '../casino/bag.js';
import { seatedAt, seatedMessage } from '../casino/tables.js';
import { ITEM_BY_KEY } from '../casino/items.js';
import {
  FARM_COLOR, farmEmbed, cropName, cellEmoji, plotNo, stars,
} from '../farm/render.js';

export const PREFIX = 'farm';
const EPH = MessageFlags.Ephemeral;
/** 멘션을 적어도 아무도 안 불린다. 물 한 번에 알림이 가면 성가시다. */
const QUIET = { parse: [] };

/** 폐농 확인 버튼이 살아 있는 시간. 지나면 다시 `/농장 폐농`. */
const ABANDON_MS = 30_000;
/** 처음 열린 밭(키패드 5). 창들이 먼저 고르는 밭이다. */
const START_PLOT = 4;
/** 바위 한 개에 휘두를 수 있는 횟수(서버 `land.MAX_SWINGS` 와 같다 — 화면에 적는 용도). */
const MAX_SWINGS = 3;
/** 결 자리 수(서버 `land.GRAIN_SPOTS`). */
const GRAIN_SPOTS = 5;

const num = (n) => Number(n ?? 0).toLocaleString('ko-KR');

// ---------------------------------------------------------------- 사유

/** 서버가 준 `reason` → 사람에게 할 말. */
function why(r, crops) {
  switch (r.reason) {
    case 'none': return '이 채널엔 농장이 없어요. `/농장 등록` 으로 열 수 있어요.';
    case 'notOwner': return `농사일은 주인 <@${r.owner}> 님만 할 수 있어요. 물은 누구나 줄 수 있어요!`;
    case 'already': return `오늘 물이 필요한 작물엔 이미 다 줬어요${r.by?.length ? ` — ${r.by.map((id) => `<@${id}>`).join(' ')}` : ''}. 내일 또 부탁해요.`;
    case 'noPlants': return '물을 줄 작물이 없어요. 다 자란 작물은 물이 필요 없어요 — 수확하세요!';
    case 'tired': return r.stamina
      ? `오늘 개간 기력을 다 썼어요(${r.stamina.max}). 내일 다시 채워져요.`
      : `체력이 모자라 물을 못 줘요(체력 **${num(r.hp)}**). 물 한 포기에 체력 1, 1은 남겨 둬요. \`/출첵\` 이나 먹을 것으로 채우세요.`;
    case 'locked': return '아직 잠긴 밭이에요.';
    case 'level': return `**${cropName(crops, r.crop)}** 은(는) 농장 **Lv.${r.need}** 부터 심을 수 있어요.`;
    case 'otherCrop': return `그 밭엔 이미 **${cropName(crops, r.crop)}** 이(가) 자라고 있어요. 한 밭엔 한 작물만 심어요.`;
    case 'occupied': return '고른 칸 가운데 이미 무언가 있는 칸이 있어요. 창을 새로 열어 주세요.';
    case 'gold': return `골드가 모자라요. 씨앗값 **${num(r.need)}골드** · 가진 골드 **${num(r.gold)}**`;
    case 'nothing': return '거둘 게 없어요. 칸에 작물 그림이 보이면(다 자람) 수확할 수 있어요.';
    case 'noRocks': return '이 밭엔 치울 돌이 없어요. 바위는 하나씩 눌러 깨세요.';
    case 'notStone': return '거기엔 캘 게 없어요.';
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
    new ButtonBuilder().setCustomId(`${PREFIX}:c:${ch}`).setLabel('개간').setEmoji('⛏️').setStyle(ButtonStyle.Secondary),
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

/** 아이템 이름. 작물이면 작물표, 아니면 명부. */
const itemName = (crops, key) => crops?.find((c) => c.key === key)?.name ?? ITEM_BY_KEY[key]?.name ?? key;
/** 받은 것 한 줄. `당근 ×4 · 민들레 ×1` */
const itemsLine = (items, crops) => Object.entries(items ?? {})
  .map(([k, n]) => `${itemName(crops, k)} ×${n}`).join(' · ');

function waterNote(who, r) {
  const bits = [`<@${who}> 님이 **${r.watered}포기**에 물을 줬어요 · 체력 −${r.watered} (남은 체력 ${num(r.hp)})`];
  if (r.revived) bits.push(`🍂 ${r.revived}포기가 살아났어요`);
  if (r.ripened) bits.push(`🧺 ${r.ripened}포기가 다 자랐어요`);
  if (r.left) bits.push(`_체력이 모자라 **${r.left}포기**는 못 줬어요 — 다른 분이 이어서 줄 수 있어요_`);
  return `💧 ${bits.join(' · ')}`;
}

function harvestNote(who, r, crops) {
  const bits = [];
  if (r.harvested || r.weeds) bits.push(itemsLine(r.items, crops));
  if (r.cleared) bits.push(`💀 ${r.cleared}칸을 치웠어요`);
  return `🧺 <@${who}> 님의 수확 — ${bits.join(' · ')}`;
}

/** 레벨업 알림. 채널에 공개로 보낸다. */
async function announceLevel(interaction, levelUp, crops) {
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

// ---------------------------------------------------------------- 공용

/** 9비트 ↔ 칸 index. */
const cellsOf = (mask) => [...Array(9).keys()].filter((i) => mask & (1 << i));
const maskOf = (cells) => cells.reduce((m, i) => m | (1 << i), 0);

const cellsIn = (plot, states) => plot.cells.map((s, i) => (states.includes(s) ? i : -1)).filter((i) => i >= 0);
const soilCells = (plot) => cellsIn(plot, ['soil']);
const stoneCells = (plot) => cellsIn(plot, ['rock', 'boulder', 'crack', 'weed']);
const openPlots = (farm) => farm.plots.map((p, i) => (p.open ? i : -1)).filter((i) => i >= 0);

/** 먼저 보여 줄 밭. 가운데(5)를 먼저, 그다음 `has` 가 참인 열린 밭. */
function pickPlot(farm, has) {
  const open = openPlots(farm);
  const good = open.filter((i) => has(farm.plots[i]));
  if (good.includes(START_PLOT)) return START_PLOT;
  return good[0] ?? open[0] ?? START_PLOT;
}
const nextOpen = (farm, plot) => {
  const open = openPlots(farm);
  return open[(open.indexOf(plot) + 1) % open.length];
};

/** 심을 수 있는 작물 — 레벨이 닿는 것, **최근에 풀린 것부터** 25개(셀렉트 한도). */
const unlocked = (crops, level) => crops
  .filter((c) => c.lv <= level)
  .sort((a, b) => b.lv - a.lv)
  .slice(0, 25);

// ---------------------------------------------------------------- 심기 창

/**
 * 심기 창. `plot` 이 열린 밭이 아니면 알아서 고른다. 밭에 이미 작물이 있으면 그 작물로 묶는다.
 * `mask` 는 빈 흙인 칸만 남긴다 — 그사이 바뀌었을 수 있다.
 */
function plantPayload({
  ch, plot, crop, mask, owner, farm, crops, note,
}) {
  const at = plot != null && farm.plots[plot]?.open ? plot : pickPlot(farm, (p) => soilCells(p).length);
  const p = farm.plots[at];
  const fixed = p.crop;
  const key = fixed ?? crop ?? null;
  const c = crops.find((x) => x.key === key && x.lv <= farm.level) ?? null;
  const soil = soilCells(p);
  const all = maskOf(soil);
  const m = mask & all;
  const picked = cellsOf(m);
  const cost = c ? c.seed * picked.length : 0;

  /** `farm:<동작>:<채널>:<밭>:<작물>:<칸>:<인자>:<주인>` — 주인은 맨 뒤. */
  const id = (act, { mm = m, arg = '-', cr = c?.key ?? '-' } = {}) => [PREFIX, act, ch, at, cr, mm, arg, owner].join(':');

  const lines = [`토질 ${stars(p.star)}`];
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
    : '_이 밭엔 빈 흙이 없어요. 돌·잡초는 `/농장 개간` 으로 치워요._');
  if (note) lines.push('', note);

  const rows = [];
  if (!fixed) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(id('pc'))
        .setPlaceholder('무엇을 심을까요?')
        .addOptions(unlocked(crops, farm.level).map((x) => ({
          label: trunc(`${x.name} — 씨앗 ${x.seed}골드`, 100),
          value: x.key,
          emoji: x.emoji,
          description: trunc(`${x.days}일 · 거두면 칸당 +${x.profit}골드 이상${x.regrow ? ` · ${x.regrow}일마다 또 열림` : ''}`, 100),
          default: x.key === c?.key,
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
  const want = crops.find((c) => c.key === crop);
  const note = want && want.lv > farm.level ? `⚠️ ${why({ reason: 'level', crop: want.key, need: want.lv }, crops)}` : undefined;
  return interaction.editReply(plantPayload({
    ch, plot, crop: want?.key ?? null, mask: 0, owner: me, farm, crops, note,
  }));
}

// ---------------------------------------------------------------- 개간 창 · 바위 창

const staminaLine = (st) => `⛏️ 오늘 개간 기력 **${st?.left ?? 0}** / ${st?.max ?? 0}`;

/** 개간 창. 돌·잡초는 누르면 바로 치우고, 바위는 바위 창으로 간다. */
function clearPayload({
  ch, plot, owner, farm, stamina, crops, note,
}) {
  const at = plot != null && farm.plots[plot]?.open ? plot : pickPlot(farm, (p) => stoneCells(p).length);
  const p = farm.plots[at];
  const rocks = cellsIn(p, ['rock']);
  const tired = !stamina?.left;

  /** `farm:<동작>:<채널>:<밭>:<칸>:<인자>:<주인>` */
  const id = (act, cell = '-', arg = '-') => [PREFIX, act, ch, at, cell, arg, owner].join(':');

  const lines = [
    staminaLine(stamina),
    '🪨 돌은 기력 1로 치워요 · ⛰️ 바위는 결을 찾아 깨요(기회 3번, 첫 방에 맞히면 ✨ 완벽) · 🌼 잡초는 그냥 뽑아요',
  ];
  if (!stoneCells(p).length) lines.push('', '_이 밭엔 치울 게 없어요._');
  if (note) lines.push('', note);

  const rows = [];
  for (let r = 0; r < 3; r += 1) {
    rows.push(new ActionRowBuilder().addComponents([0, 1, 2].map((k) => {
      const i = r * 3 + k;
      const state = p.cells[i];
      if (state === 'rock') {
        return new ButtonBuilder().setCustomId(id('cr', i)).setEmoji('🪨').setStyle(ButtonStyle.Primary).setDisabled(tired);
      }
      if (state === 'weed') {
        return new ButtonBuilder().setCustomId(id('cr', i)).setEmoji('🌼').setStyle(ButtonStyle.Success);
      }
      if (state === 'boulder' || state === 'crack') {
        return new ButtonBuilder().setCustomId(id('cb', i)).setEmoji('⛰️').setStyle(ButtonStyle.Danger)
          .setDisabled(tired);
      }
      return new ButtonBuilder().setCustomId(id('c-', i)).setEmoji(cellEmoji(state, crops, p.crop))
        .setStyle(ButtonStyle.Secondary).setDisabled(true);
    })));
  }
  const controls = [
    new ButtonBuilder().setCustomId(id('ca')).setLabel(`돌 모두 치우기 · 기력 ${Math.min(rocks.length, stamina?.left ?? 0)}`)
      .setEmoji('🪨').setStyle(ButtonStyle.Primary).setDisabled(tired || !rocks.length),
  ];
  if (openPlots(farm).length > 1) {
    controls.push(new ButtonBuilder().setCustomId(id('cn')).setLabel('다른 밭').setStyle(ButtonStyle.Secondary));
  }
  controls.push(new ButtonBuilder().setCustomId(id('cx')).setLabel('닫기').setStyle(ButtonStyle.Secondary));
  rows.push(new ActionRowBuilder().addComponents(controls));

  return {
    embeds: [base({
      title: `⛏️ 개간 — ${plotNo(at)}번 밭`,
      description: lines.join('\n'),
      color: FARM_COLOR,
      footer: '치운 칸은 빈 흙이 돼요 · 기력은 하루마다 다시 채워져요',
    })],
    components: rows,
    allowedMentions: QUIET,
  };
}

/** 바위 창. 결 자리는 서버만 안다 — 여기서는 휘두른 횟수와 힌트만 적는다. */
function boulderPayload({
  ch, plot, cell, owner, farm, stamina, crops, note,
}) {
  const p = farm.plots[plot];
  const state = p?.cells[cell];
  if (state !== 'boulder' && state !== 'crack') {
    return clearPayload({
      ch, plot, owner, farm, stamina, crops, note,
    });
  }
  const swings = p.swings?.[cell] ?? 0;
  const id = (act, arg = '-') => [PREFIX, act, ch, plot, cell, arg, owner].join(':');
  const tired = !stamina?.left;

  const lines = [staminaLine(stamina), ''];
  if (state === 'crack') {
    lines.push('💥 금이 간 바위예요 — **어디를 쳐도** 깨져요.');
  } else {
    lines.push(`결은 **1~${GRAIN_SPOTS}** 가운데 한 자리에 숨어 있어요. 남은 기회 **${MAX_SWINGS - swings}**`
      + (swings === 0 ? ' · _첫 방에 맞히면 ✨ 완벽 — 전리품 두 번!_' : ''));
    lines.push('_다 빗나가면 금이 가서, 다음엔 어디를 쳐도 깨져요._');
  }
  if (note) lines.push('', note);

  return {
    embeds: [base({
      title: `⛰️ 바위 — ${plotNo(plot)}번 밭 ${cell + 1}번 칸`,
      description: lines.join('\n'),
      color: FARM_COLOR,
      footer: '한 번 휘두를 때마다 기력 1',
    })],
    components: [
      new ActionRowBuilder().addComponents(Array.from({ length: GRAIN_SPOTS }, (_, k) => new ButtonBuilder()
        .setCustomId(id('cs', k + 1)).setLabel(String(k + 1)).setStyle(ButtonStyle.Danger).setDisabled(tired))),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(id('cz')).setLabel('돌아가기').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(id('cx')).setLabel('닫기').setStyle(ButtonStyle.Secondary),
      ),
    ],
    allowedMentions: QUIET,
  };
}

/** 개간 창을 연다(명령·농장 화면의 버튼 둘 다). 이미 응답을 잡아 둔 상태에서 부른다. */
async function openClear(interaction, ch, { plot = null } = {}) {
  const me = interaction.user.id;
  const [{ farm, me: mine }, crops] = await Promise.all([getFarm(ch, me), getFarmCrops()]);
  if (!farm) return refuse(interaction, why({ reason: 'none' }));
  if (farm.owner !== me) return refuse(interaction, why({ reason: 'notOwner', owner: farm.owner }));
  return interaction.editReply(clearPayload({
    ch, plot, owner: me, farm, stamina: mine?.stamina, crops,
  }));
}

/** 전리품 한 줄. */
const lootNote = (loot, crops) => (Object.keys(loot ?? {}).length ? ` · 🎁 ${itemsLine(loot, crops)}` : '');

/** 휘두른 결과 한 줄. */
function swingNote(r, crops) {
  if (r.kind === 'weed') return `🌼 잡초를 뽑았어요${lootNote(r.loot, crops)}`;
  if (r.kind === 'rock') return `🪨 돌을 치웠어요${lootNote(r.loot, crops)}`;
  if (r.kind === 'rocks') {
    return `🪨 돌 **${r.cleared}개**를 치웠어요${r.left ? ` (기력이 모자라 ${r.left}개는 남겼어요)` : ''}${lootNote(r.loot, crops)}`;
  }
  if (r.broke) {
    return `${r.perfect ? '✨ **완벽하게** 쪼갰어요!' : '⛰️ 바위를 깼어요!'}${lootNote(r.loot, crops)}`;
  }
  const where = r.hint.dir === 'left' ? '왼쪽' : '오른쪽';
  return `💨 빗나갔어요 — 결이 **${where}**으로 느껴져요${r.hint.near ? ' · **바로 옆**이에요!' : ''}`
    + (r.cracked ? '\n💥 세 번 다 빗나가 바위에 **금이 갔어요** — 다음엔 어디를 쳐도 깨져요.' : '');
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
  .addSubcommand((s) => s.setName('물주기').setDescription('이 채널 농장에 물을 줍니다 — 누구나, 한 포기에 체력 1')
    .addIntegerOption((o) => plotOption(o, '이 밭에만 (안 적으면 급한 칸부터 전부)')))
  .addSubcommand((s) => s.setName('심기').setDescription('씨앗을 사서 심습니다')
    .addStringOption((o) => o.setName('작물').setDescription('심을 작물').setAutocomplete(true))
    .addIntegerOption((o) => plotOption(o, '밭 번호 — 키패드 배치, 가운데가 5')))
  .addSubcommand((s) => s.setName('수확').setDescription('다 자란 것을 거두고 죽은 칸·잡초를 치웁니다')
    .addIntegerOption((o) => plotOption(o, '밭 번호 (안 적으면 전부)')))
  .addSubcommand((s) => s.setName('개간').setDescription('돌을 치우고 바위를 깹니다 — 하루 기력만큼')
    .addIntegerOption((o) => plotOption(o, '밭 번호 (안 적으면 알아서)')))
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
      description: [
        '가운데 **5번 밭**부터 시작해요. 아직 돌투성이예요 — `/농장 개간` 으로 치우고, `/농장 심기` 로 씨앗을 심으세요.',
        '물은 한 포기에 **체력 1** 이 들어요. 이웃이 대신 줄 수도 있어요.',
        '_잘못 열었다면 24시간 안에 `/농장 폐농` 으로 무를 수 있어요._',
      ].join('\n'),
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

/** 물주기(명령·버튼). 판에 앉아 있으면 체력이 판의 장부에 있어 막는다. */
async function doWater(interaction, ch, plot) {
  const me = interaction.user.id;
  const at = seatedAt(me);
  if (at) return { refused: seatedMessage('그쪽', at) };
  const [r, crops] = await Promise.all([waterFarm({ channelId: ch, userId: me, plot }), getFarmCrops()]);
  if (r.ok) forget(me);                  // 체력이 줄었다 — 사망 검사가 서버를 다시 보게
  return { r, crops };
}

async function waterCmd(interaction) {
  const n = interaction.options.getInteger('밭');
  await interaction.deferReply();
  const { refused, r, crops } = await doWater(interaction, interaction.channelId, n ? n - 1 : null);
  if (refused) return refuse(interaction, refused);
  if (!r.ok) return refuse(interaction, why(r, crops));
  await interaction.editReply(viewPayload(interaction, r.farm, crops, waterNote(interaction.user.id, r)));
  return announceLevel(interaction, r.levelUp, crops);
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
  await interaction.editReply(viewPayload(interaction, r.farm, crops, harvestNote(interaction.user.id, r, crops)));
  return announceLevel(interaction, r.levelUp, crops);
}

async function clearCmd(interaction) {
  await interaction.deferReply({ flags: EPH });
  const n = interaction.options.getInteger('밭');
  return openClear(interaction, interaction.channelId, { plot: n ? n - 1 : null });
}

async function abandonCmd(interaction) {
  await interaction.deferReply({ flags: EPH });
  const me = interaction.user.id;
  const { farm } = await getFarmOf(me);
  if (!farm) return refuse(interaction, '없앨 농장이 없어요.');

  const free = Date.parse(farm.graceUntil) > Date.now();
  const planted = farm.plots.reduce((a, p) => a + p.cells.filter((s) => ['seed', 'grow', 'ripe', 'over', 'dry'].includes(s)).length, 0);
  return interaction.editReply({
    embeds: [base({
      title: '⚠️ 정말 폐농할까요?',
      description: [
        `<#${farm.channelId}> 의 농장(**Lv.${farm.level}**)이 **통째로 사라져요.** 심긴 작물 **${planted}포기**도 함께요.`,
        free
          ? '_등록한 지 24시간이 안 돼서 **무르기**예요 — 바로 다시 열 수 있어요._'
          : '_무르기 기한(24시간)이 지났어요. 폐농하면 **7일 동안** 다시 못 열어요._',
        '_오늘 쓴 개간 기력은 돌아오지 않아요._',
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
  등록: register,
  보기: show,
  내농장: mine,
  물주기: waterCmd,
  심기: plantCmd,
  수확: harvestCmd,
  개간: clearCmd,
  폐농: abandonCmd,
};

async function execute(interaction) {
  const run = RUN[interaction.options.getSubcommand()];
  try {
    await run(interaction);
  } catch (err) {
    await refuse(interaction, `농장 서버에 닿지 못했어요. ${err.message}`);
  }
}

/** 작물 자동완성. 농장 레벨은 몰라서(시한 3초) 전부 보이고, 레벨을 적어 둔다. */
async function autocomplete(interaction) {
  const typed = String(interaction.options.getFocused() || '').replace(/\s+/g, '');
  let crops = [];
  try { crops = await getFarmCrops(); } catch { /* 빈 목록으로 답한다 — 시한이 3초다 */ }
  await interaction.respond(crops
    .filter((c) => !typed || c.name.replace(/\s+/g, '').includes(typed) || c.key.includes(typed))
    .slice(0, 25)
    .map((c) => ({ name: trunc(`${c.emoji} ${c.name} — 씨앗 ${c.seed}골드 · ${c.days}일 · Lv.${c.lv}`, 100), value: c.key })));
}

// ---------------------------------------------------------------- 버튼

/** 농장 화면의 버튼. 누구나 누른다 — 주인만 되는 일은 서버가 거절한다. */
async function viewButton(interaction, act, ch) {
  if (act === 'p' || act === 'c') {
    await interaction.deferReply({ flags: EPH });
    return act === 'p' ? openPlant(interaction, ch) : openClear(interaction, ch);
  }

  await interaction.deferUpdate();
  const me = interaction.user.id;

  if (act === 'v') {
    const [{ farm }, crops] = await Promise.all([getFarm(ch), getFarmCrops()]);
    if (!farm) return interaction.editReply({ content: '_이 농장은 사라졌어요._', embeds: [], components: [] });
    return interaction.editReply(viewPayload(interaction, farm, crops));
  }

  let r; let crops;
  if (act === 'w') {
    const out = await doWater(interaction, ch, null);
    if (out.refused) return interaction.followUp({ embeds: [fail(out.refused)], flags: EPH });
    ({ r, crops } = out);
  } else {
    [r, crops] = await Promise.all([harvestFarm({ channelId: ch, userId: me }), getFarmCrops()]);
  }
  if (r.farm) await interaction.editReply(viewPayload(interaction, r.farm, crops));
  if (!r.ok) return interaction.followUp({ embeds: [fail(why(r, crops))], flags: EPH, allowedMentions: QUIET });

  if (act === 'h') forgetBag(me);
  await interaction.followUp({
    content: act === 'w' ? waterNote(me, r) : harvestNote(me, r, crops),
    allowedMentions: QUIET,
  });
  return announceLevel(interaction, r.levelUp, crops);
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
    plot = nextOpen(farm, plot);
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
  return interaction.editReply({
    embeds: [base({
      title: `🌱 ${cropName(crops, r.crop)} ${r.count}칸을 심었어요`,
      description: [
        `씨앗값 **−${num(r.cost)}골드** · 가진 골드 **${num(r.account?.gold)}**`,
        '_물을 줘야 자라기 시작해요 — `/농장 물주기` (한 포기에 체력 1)_',
      ].join('\n'),
      color: FARM_COLOR,
    })],
    components: [],
  });
}

/** 개간 창 · 바위 창의 조작. 주인만 누른다(customId 맨 뒤). */
async function clearButton(interaction, act, [ch, plotS, cellS, arg, owner]) {
  if (interaction.user.id !== owner) {
    return interaction.reply({ embeds: [fail('자기 개간 창에서만 누를 수 있어요.')], flags: EPH });
  }
  await interaction.deferUpdate();
  if (act === 'cx') return interaction.editReply({ embeds: [base({ title: '⛏️ 개간 창을 닫았어요', color: FARM_COLOR })], components: [] });

  let plot = Number(plotS);
  const cell = cellS === '-' ? null : Number(cellS);
  const [{ farm, me }, crops] = await Promise.all([getFarm(ch, owner), getFarmCrops()]);
  if (!farm) return interaction.editReply({ embeds: [fail(why({ reason: 'none' }))], components: [] });
  const base0 = {
    ch, owner, farm, stamina: me?.stamina, crops,
  };

  if (act === 'cn') return interaction.editReply(clearPayload({ ...base0, plot: nextOpen(farm, plot) }));
  if (act === 'cz') return interaction.editReply(clearPayload({ ...base0, plot }));
  if (act === 'cb') return interaction.editReply(boulderPayload({ ...base0, plot, cell }));

  // 여기부터는 실제로 캔다 — 돌·잡초 하나(cr) · 돌 전부(ca) · 바위 휘두르기(cs)
  const r = await clearFarm({
    channelId: ch,
    userId: owner,
    plot,
    cell: act === 'ca' ? null : cell,
    pos: act === 'cs' ? Number(arg) : null,
    all: act === 'ca',
  });
  const next = {
    ...base0, farm: r.farm ?? farm, stamina: r.stamina ?? me?.stamina,
  };
  if (!r.ok) {
    const note = `⚠️ ${why(r, crops)}`;
    return interaction.editReply(act === 'cs' ? boulderPayload({ ...next, plot, cell, note }) : clearPayload({ ...next, plot, note }));
  }

  if (Object.keys(r.loot ?? {}).length) forgetBag(owner);
  plot = Number(plotS);
  const note = swingNote(r, crops);
  // 빗나간 바위는 바위 창에 그대로 남는다. 깼거나 돌·잡초면 개간 창으로.
  await interaction.editReply(act === 'cs' && !r.broke
    ? boulderPayload({ ...next, plot, cell, note })
    : clearPayload({ ...next, plot, note }));
  return announceLevel(interaction, r.levelUp, crops);
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
    if (['w', 'h', 'p', 'c', 'v'].includes(act)) return await viewButton(interaction, act, rest[0]);
    if (act === 'ab' || act === 'abx') return await abandonButton(interaction, act, rest);
    if (act.startsWith('c')) return await clearButton(interaction, act, rest);
    return await plantButton(interaction, act, rest);
  } catch (err) {
    const send = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
    return interaction[send]({ embeds: [fail(`농장 서버에 닿지 못했어요. ${err.message}`)], flags: EPH });
  }
}

/** 검사용(scripts/check-farm.mjs). 화면은 상태가 없어 그대로 불러 볼 수 있다. */
export {
  plantPayload, clearPayload, boulderPayload, swingNote, why, cellsOf, maskOf, unlocked,
};

export default {
  data,
  execute,
  autocomplete,
  componentPrefix: PREFIX,
  component,
};
