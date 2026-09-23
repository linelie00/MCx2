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
 *   - **바위 창** — 에페메랄. 결 자리 `[1]`~`[5]` + 힌트. 결 자리는 서버만 안다(미스릴 곡괭이면
 *     후보 두 자리를 주인에게만 준다).
 *   - **거름 창 · 곡괭이 창** — 에페메랄(2b). 비료·퇴비를 밭에 넣고, 곡괭이를 올린다.
 *   - **설비 창** — 에페메랄(4b). 빗물통·배수로·스프링클러는 버튼, 덮개·지지대는 밭 셀렉트.
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
  fertilizeFarm, compostCrops, upgradePickaxe, getTools, getAccounts, getPreview, getBook, getWeather, getEquips, buyEquip, getBoard, deliverOrder, postAccountDeltas,
} from '../api.js';
import { base, fail, trunc, gauge } from '../embeds.js';
import { forget } from '../casino/alive.js';
import { forgetBag } from '../casino/bag.js';
import { seatedAt, seatedMessage } from '../casino/tables.js';
import { ITEM_BY_KEY } from '../casino/items.js';
import { voiceOf, thanksOf } from '../farm/requesters.js';
import {
  FARM_COLOR, farmEmbed, cropName, plantName, cropEmoji, cellEmoji, plotNo, stars, modsBadge, seasonsText, SEASON_NAME, skyLine,
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
/** 한 밭의 칸 수 · 나무가 서는 칸(서버 `rules.CELLS` · `rules.TREE_CELL`, 4c). */
const CELL_COUNT = 9;
const TREE_CELL = 4;
/** 나무 한 번의 열매 수(서버 `TREE_YIELD` 의 ★1 최소 ~ ★5 최대 — 화면에 적는 용도). */
const TREE_FRUITS = '18~48개';
/** 개간 창에서 누르면 뽑기로 가는 칸 상태(4c). */
const UPROOTABLE = ['seed', 'grow', 'dry', 'ripe', 'over', 'dead', 'dormant', 'canopy'];

/** 거름 — 밭마다 하루 한도와 토질 경험(서버 `land.FERTS` 와 같다 — 화면에 적는 용도). */
const FERTS = {
  fertilizer: { name: '비료', emoji: '🧪', soil: 15, perDay: 1 },
  compost: { name: '퇴비', emoji: '🟤', soil: 5, perDay: 3 },
};
/** 퇴비 한 개에 드는 작물 수(서버 `land.COMPOST_CROPS`). */
const COMPOST_CROPS = 5;

/** 곡괭이 효과 한 줄. 값·재료·해금 레벨은 서버가 준다(`/farms/tools`). */
const PICKAXE_NOTE = {
  wood: '기본 곡괭이. 빗나가면 방향만 알려 줘요.',
  iron: '빗나가면 결까지 **몇 칸**인지 알려 줘요.',
  mithril: '휘두르기 전에 결 후보를 **두 자리**로 좁혀 줘요 — 완벽 확률 20% → 50%.',
};

const num = (n) => Number(n ?? 0).toLocaleString('ko-KR');

// ---------------------------------------------------------------- 사유

/** 서버가 준 `reason` → 사람에게 할 말. */
function why(r, crops) {
  switch (r.reason) {
    case 'none': return '이 채널엔 농장이 없어요. `/농장 등록` 으로 열 수 있어요.';
    case 'notOwner': return `농사일은 주인 <@${r.owner}> 님만 할 수 있어요. 물은 누구나 줄 수 있어요!`;
    case 'already': return `오늘 물이 필요한 작물엔 이미 다 줬어요${r.by?.length ? ` — ${r.by.map((id) => `<@${id}>`).join(' ')}` : ''}. 내일 또 부탁해요.`;
    case 'noPlants': return '물을 줄 작물이 없어요. 다 자란 작물은 물이 필요 없어요 — 수확하세요!';
    case 'rain': return '오늘은 비가 와서 물을 이미 줬어요 ☔ — 체력을 아끼세요.';
    case 'tired': return r.stamina
      ? `오늘 개간 기력을 다 썼어요(${r.stamina.max}). 내일 다시 채워져요.`
      : `체력이 모자라 물을 못 줘요(체력 **${num(r.hp)}**). 물 한 포기에 체력 ${r.cost ?? 1}${r.cost > 1 ? '(🥵 폭염)' : ''}, 1은 남겨 둬요. \`/출첵\` 이나 먹을 것으로 채우세요.`;
    case 'locked': return '아직 잠긴 밭이에요.';
    case 'level': return `**${cropName(crops, r.crop)}** 은(는) 농장 **Lv.${r.need}** 부터 심을 수 있어요.`;
    case 'otherCrop': return `그 밭엔 이미 **${cropName(crops, r.crop)}** 이(가) 자라고 있어요. 한 밭엔 한 작물만 심어요.`;
    case 'occupied': return '고른 칸 가운데 이미 무언가 있는 칸이 있어요. 창을 새로 열어 주세요.';
    case 'gold': return `골드가 모자라요. 씨앗값 **${num(r.need)}골드** · 가진 골드 **${num(r.gold)}**`;
    case 'nothing': return '거둘 게 없어요. 칸에 작물 그림이 보이면(다 자람) 수확할 수 있어요.';
    case 'noRocks': return '이 밭엔 치울 돌이 없어요. 바위는 하나씩 눌러 깨세요.';
    case 'fertCap': return `오늘 이 밭엔 **${FERTS[r.item]?.name ?? r.item}** 을(를) 더 못 넣어요 — 밭마다 하루 ${r.perDay}개.`;
    case 'soilMax': return '이 밭은 이미 토질 ★5 예요. 더 넣어도 소용없어요.';
    case 'noCrop': return '✨ 황금 비료는 **자라는 작물이 있는 밭**에 뿌려요.';
    case 'goldFertCap': return '이 밭엔 이미 ✨ 황금 비료를 뿌렸어요 — 밭 하나에 하나예요.';
    case 'noSeed': return `주머니에 **${cropName(crops, r.crop)}** 씨앗이 모자라요 — 가진 것 ${num(r.have)} / 필요 ${num(r.need)}. 희귀 씨앗은 개간하다 가끔 나와요.`;
    case 'noItem': return `**${r.item === 'ore' ? '원석' : itemName(crops, r.item)}${r.minStar ? ` ${STARS[r.minStar]} 이상` : ''}** 이(가) 모자라요 — 가진 것 ${num(r.have)}${r.need ? ` / 필요 ${num(r.need)}` : ''}.`;
    case 'noFarm': return '곡괭이는 농장이 있어야 올릴 수 있어요. `/농장 등록`';
    case 'maxTool': return '이미 가장 좋은 곡괭이예요.';
    case 'toolLevel': return `그 곡괭이는 농장 **Lv.${r.need}** 부터 만들 수 있어요.`;
    case 'owned': return `이미 놓은 설비예요${r.name ? ` — ${r.name}` : ''}.`;
    case 'equipLevel': return `${r.name ?? '그 설비'} 은(는) 농장 **Lv.${r.need}** 부터 놓을 수 있어요.`;
    case 'noPlot': return '열린 밭에만 놓을 수 있어요.';
    case 'needClear': return `나무는 밭 하나를 통째로 써요 — **아홉 칸이 다 빈 흙**이어야 심을 수 있어요. 돌·잡초는 \`/농장 개간\`, 작물은 개간 창에서 뽑을 수 있어요.`;
    case 'notPlant': return '거긴 뽑을 작물이 없어요.';
    case 'orderTaken': return r.by ? `한발 늦었어요 — <@${r.by}> 님이 먼저 채웠어요.` : '한발 늦었어요 — 다른 농장이 먼저 채웠어요.';
    case 'orderExpired': return '기한이 지났거나 이미 끝난 주문이에요.';
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

const STARS = ['', '★', '★★', '★★★'];
/**
 * 수확물 한 줄(3b) — ★ 변형은 원래 작물로 묶는다. `당근 ×5 (★×2 · ★★×1) · 🏆 대왕 무`
 * 대왕 작물은 따로 앞에, 품질 분포는 **개수**로 적는다(칸이 아니라 나온 것).
 */
function harvestLine(items, crops) {
  const groups = new Map();
  const giants = [];
  const others = [];
  for (const [k, n] of Object.entries(items ?? {})) {
    const it = ITEM_BY_KEY[k];
    if (it?.giantOf) { giants.push(`🏆 **${it.name}**${n > 1 ? ` ×${n}` : ''}`); continue; }
    const base = it?.variantOf ?? k;
    if (!it?.variantOf && !crops?.some((c) => c.key === k)) { others.push(`${itemName(crops, k)} ×${n}`); continue; }
    const g = groups.get(base) ?? [0, 0, 0, 0];
    g[it?.star ?? 0] += n;
    groups.set(base, g);
  }
  const lines = [...groups.entries()].map(([base, g]) => {
    const total = g.reduce((a, n) => a + n, 0);
    const stars = g.map((n, s) => (s && n ? `${STARS[s]}×${n}` : null)).filter(Boolean);
    return `${cropName(crops, base)} ×${total}${stars.length ? ` (${stars.join(' · ')})` : ''}`;
  });
  return [...giants, ...lines, ...others].join(' · ');
}

function waterNote(who, r) {
  const cost = r.cost ?? 1;
  const barrel = cost === 1 && r.farm?.sky?.today?.weather?.key === 'heat' ? ' 🛢️ 빗물통' : '';
  const bits = [`<@${who}> 님이 **${r.watered}포기**에 물을 줬어요 · 체력 −${r.watered * cost}${cost > 1 ? ' 🥵 폭염' : barrel} (남은 체력 ${num(r.hp)})`];
  if (r.revived) bits.push(`🍂 ${r.revived}포기가 살아났어요`);
  if (r.ripened) bits.push(`🧺 ${r.ripened}포기가 다 자랐어요`);
  if (r.left) bits.push(`_체력이 모자라 **${r.left}포기**는 못 줬어요 — 다른 분이 이어서 줄 수 있어요_`);
  return `💧 ${bits.join(' · ')}`;
}

function harvestNote(who, r, crops) {
  const bits = [];
  if (r.harvested || r.weeds) bits.push(harvestLine(r.items, crops));
  if (r.cleared) bits.push(`💀 ${r.cleared}칸을 치웠어요`);
  if (r.spread) bits.push(`🍀 박하가 ${r.spread}포기 번졌어요`);
  const lines = [`🧺 <@${who}> 님의 수확 — ${bits.join(' · ')}`];
  if (r.screams) {
    lines.push(r.plugs >= r.screams
      ? `😱 **비명!** — 귀마개 ${r.plugs}개로 막았어요`
      : `😱 **비명!**${r.plugs ? ` 귀마개 ${r.plugs}개로 다 못 막아` : ''} 체력 −${r.hpLost} (남은 체력 ${num(r.hp)}) — 상점 🌾 농사 진열대에 귀마개가 있어요`);
  }
  return lines.join('\n');
}

/**
 * 판에 앉아 있으면 **비명 뿌리가 익은 밭**은 못 거둔다 — 체력이 판의 장부에 있다(3c).
 * 다른 밭은 그대로 거둔다. 막아야 하면 사유 문장, 아니면 `null`.
 */
async function screamBlocked(ch, me, plot = null) {
  const at = seatedAt(me);
  if (!at) return null;
  const { farm } = await getFarm(ch);
  const hit = farm?.plots.some((p, i) => (plot == null || plot === i) && p.crop === 'screamRoot' && p.ripe > 0);
  return hit ? `${seatedMessage('그쪽', at)} — 비명 뿌리는 체력이 드는 수확이라 판을 마친 뒤에 거둬 주세요.` : null;
}

/** 대왕 작물 알림(3b). 채널에 공개로 — 모두가 볼 일이다. */
async function announceGiant(interaction, r, crops) {
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

/**
 * 심을 수 있는 작물 — 레벨이 닿는 것 + 주머니에 씨앗이 있는 희귀 작물. 희귀를 맨 앞에,
 * 그다음 **최근에 풀린 것부터.** 셀렉트는 25칸이라 `PLANT_PAGE` 씩 끊어 쪽을 넘긴다.
 */
const unlocked = (crops, level, pouch = {}) => crops
  .filter((c) => (c.seedOnly ? (pouch[c.key] ?? 0) > 0 : c.lv <= level))
  .sort((a, b) => Number(Boolean(b.seedOnly)) - Number(Boolean(a.seedOnly)) || b.lv - a.lv);
/** 셀렉트 한 쪽의 작물 수. 한 칸은 "다른 작물" 로 남긴다. */
const PLANT_PAGE = 24;
/** 쪽 넘김 셀렉트 값. */
const PAGE_VALUE = '__page:';

// ---------------------------------------------------------------- 심기 창

/** 심기 창이 보여 줄 밭. `plot` 이 열린 밭이 아니면 빈 흙이 있는 밭을 고른다. */
const plantPlot = (farm, plot) => (plot != null && farm.plots[plot]?.open ? plot : pickPlot(farm, (p) => soilCells(p).length));

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
const modsLines = (mods) => (mods?.notes ?? []).slice(0, 5).map((n) => `${n.good ? '🤝' : '⚔️'} ${n.text}`);

/**
 * 심기 창. `plot` 이 열린 밭이 아니면 알아서 고른다. 밭에 이미 작물이 있으면 그 작물로 묶는다.
 * `mask` 는 빈 흙인 칸만 남긴다 — 그사이 바뀌었을 수 있다.
 * `preview` 는 `previewFor` 가 받아 온 궁합 — 셀렉트 줄마다 🤝/⚔️, 고른 작물의 문구.
 */
function plantPayload({
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
async function openPlant(interaction, ch, { plot = null, crop = null } = {}) {
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

// ---------------------------------------------------------------- 개간 창 · 바위 창

const staminaLine = (st) => `⛏️ 오늘 개간 기력 **${st?.left ?? 0}** / ${st?.max ?? 0}`;

/** 개간 창. 돌·잡초는 누르면 바로 치우고, 바위는 바위 창으로 간다. */
function clearPayload({
  ch, plot, owner, farm, stamina, crops, note, me,
}) {
  const at = plot != null && farm.plots[plot]?.open ? plot : pickPlot(farm, (p) => stoneCells(p).length);
  const p = farm.plots[at];
  const rocks = cellsIn(p, ['rock']);
  const tired = !stamina?.left;

  /** `farm:<동작>:<채널>:<밭>:<칸>:<인자>:<주인>` */
  const id = (act, cell = '-', arg = '-') => [PREFIX, act, ch, at, cell, arg, owner].join(':');

  const lines = [
    staminaLine(stamina) + (me?.pickaxe ? ` · ${pickaxeName(me.pickaxe)}` : ''),
    '🪨 돌은 기력 1로 치워요 · ⛰️ 바위는 결을 찾아 깨요(기회 3번, 첫 방에 맞히면 ✨ 완벽) · 🌼 잡초는 그냥 뽑아요',
  ];
  if (p.crop) lines.push(`🌱 작물 칸을 누르면 뽑을 수 있어요 — 씨앗값은 돌아오지 않아요${crops.find((x) => x.key === p.crop)?.tree ? ' · 🪓 나무는 밭 전체' : ''}`);
  if (!stoneCells(p).length && !p.crop) lines.push('', '_이 밭엔 치울 게 없어요._');
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
      // 작물 칸 · 나무 그늘 — 누르면 뽑기 확인(4c)
      const crop = UPROOTABLE.includes(state) && p.crop;
      return new ButtonBuilder().setCustomId(id(crop ? 'cu' : 'c-', i)).setEmoji(cellEmoji(state, crops, p.crop))
        .setStyle(ButtonStyle.Secondary).setDisabled(!crop);
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
  ch, plot, cell, owner, farm, stamina, crops, note, me,
}) {
  const p = farm.plots[plot];
  const state = p?.cells[cell];
  if (state !== 'boulder' && state !== 'crack') {
    return clearPayload({
      ch, plot, owner, farm, stamina, crops, note, me,
    });
  }
  // 미스릴이면 결 후보 두 자리(서버가 주인에게만 준다)
  const cand = me?.candidates?.[plot]?.[cell] ?? null;
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
    if (cand) lines.push(`💎 미스릴 곡괭이 — 결은 **${cand[0]}번** 또는 **${cand[1]}번**이에요.`);
    else if (me?.pickaxe === 'iron') lines.push('⛏️ 철 곡괭이 — 빗나가면 결까지 몇 칸인지 알려 줘요.');
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
        .setCustomId(id('cs', k + 1)).setLabel(String(k + 1))
        .setStyle(cand?.includes(k + 1) ? ButtonStyle.Success : ButtonStyle.Danger).setDisabled(tired))),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(id('cz')).setLabel('돌아가기').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(id('cx')).setLabel('닫기').setStyle(ButtonStyle.Secondary),
      ),
    ],
    allowedMentions: QUIET,
  };
}

/**
 * 뽑기 확인 창(4c). 작물 칸을 누르면 연다 — 씨앗값은 안 돌아온다. 나무는 한 그루가 밭 전체다.
 */
function uprootPayload({
  ch, plot, cell, owner, farm, crops,
}) {
  const p = farm.plots[plot];
  const c = crops.find((x) => x.key === p?.crop);
  const id = (act, arg = '-') => [PREFIX, act, ch, plot, cell, arg, owner].join(':');
  const n = p.cells.filter((s) => !['soil', 'rock', 'boulder', 'crack', 'weed', 'canopy', 'locked'].includes(s)).length;
  const tree = Boolean(c?.tree);
  const lines = tree
    ? [`${c.emoji} **${c.treeName}** 를 벨까요? 밭 전체가 빈 흙이 돼요.`, '_묘목값은 돌아오지 않아요. 다시 키우려면 첫 열매부터 기다려야 해요._']
    : [`${c?.emoji ?? '🌱'} **${cropName(crops, p?.crop)}** 을(를) 뽑을까요? 이 밭엔 **${n}포기**가 있어요.`, '_거두지 않고 없애요 — 씨앗값은 돌아오지 않아요._'];
  const buttons = tree
    ? [new ButtonBuilder().setCustomId(id('cU', 'plot')).setLabel('나무 베기').setEmoji('🪓').setStyle(ButtonStyle.Danger)]
    : [
      new ButtonBuilder().setCustomId(id('cU', 'cell')).setLabel(`${cell + 1}번 칸만 뽑기`).setEmoji('🌱').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(id('cU', 'plot')).setLabel(`밭 전체 비우기 · ${n}포기`).setEmoji('🧹').setStyle(ButtonStyle.Danger),
    ];
  return {
    embeds: [base({
      title: `${tree ? '🪓 나무 베기' : '🌱 작물 뽑기'} — ${plotNo(plot)}번 밭`, description: lines.join('\n'), color: FARM_COLOR, footer: '뽑기는 기력이 들지 않아요',
    })],
    components: [new ActionRowBuilder().addComponents(
      ...buttons,
      new ButtonBuilder().setCustomId(id('cz')).setLabel('돌아가기').setStyle(ButtonStyle.Secondary),
    )],
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
    ch, plot, owner: me, farm, stamina: mine?.stamina, crops, me: mine,
  }));
}

/** 전리품 한 줄. */
const lootNote = (loot, crops) => (Object.keys(loot ?? {}).length ? ` · 🎁 ${itemsLine(loot, crops)}` : '');

/** 휘두른 결과 한 줄. 희귀 씨앗을 주웠으면 한 줄 더. */
function swingNote(r, crops) {
  const line = swingLine(r, crops);
  const seeds = Object.entries(r.seeds ?? {});
  if (!seeds.length) return line;
  return `${line}\n🎒 **${seeds.map(([k, n]) => `${cropName(crops, k)} 씨앗${n > 1 ? ` ×${n}` : ''}`).join(' · ')}** 을(를) 주웠어요! 희귀 작물이에요 — \`/농장 심기\` 에서 주머니 씨앗으로 심어요.`;
}

function swingLine(r, crops) {
  if (r.kind === 'uproot') {
    return r.tree
      ? `🪓 **${plantName(crops, r.crop)}** 를 베었어요 — 밭이 비었어요`
      : `🌱 **${cropName(crops, r.crop)}** ${r.removed}포기를 뽑았어요${r.freed ? ' — 밭이 비었어요' : ''}`;
  }
  if (r.kind === 'weed') return `🌼 잡초를 뽑았어요${lootNote(r.loot, crops)}`;
  if (r.kind === 'rock') return `🪨 돌을 치웠어요${lootNote(r.loot, crops)}`;
  if (r.kind === 'rocks') {
    return `🪨 돌 **${r.cleared}개**를 치웠어요${r.left ? ` (기력이 모자라 ${r.left}개는 남겼어요)` : ''}${lootNote(r.loot, crops)}`;
  }
  if (r.broke) {
    return `${r.perfect ? '✨ **완벽하게** 쪼갰어요!' : '⛰️ 바위를 깼어요!'}${lootNote(r.loot, crops)}`;
  }
  const where = r.hint.dir === 'left' ? '왼쪽' : '오른쪽';
  const far = r.hint.dist ? ` · 결까지 **${r.hint.dist}칸**` : '';
  return `💨 빗나갔어요 — 결이 **${where}**으로 느껴져요${r.hint.near ? ' · **바로 옆**이에요!' : far}`
    + (r.cracked ? '\n💥 세 번 다 빗나가 바위에 **금이 갔어요** — 다음엔 어디를 쳐도 깨져요.' : '');
}

// ---------------------------------------------------------------- 거름 창 · 곡괭이 창 (2b)

const pickaxeName = (key, list) => {
  const t = list?.find((x) => x.key === key);
  if (t) return `${t.emoji} ${t.name}`;
  return { wood: '🪓 나무 곡괭이', iron: '⛏️ 철 곡괭이', mithril: '💎 미스릴 곡괭이' }[key] ?? key;
};

/** 거름 창. 밭 하나의 토질과 오늘 넣은 것, 가진 거름을 보여 주고 넣는다. */
function fertPayload({
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
  lines.push(`✨ **황금 비료** 품질 +15 · 가진 것 **${num(items?.goldFertilizer)}**${p.goldBoost ? ' · _이 밭엔 이미 뿌렸어요_' : ''}`);
  lines.push('', `_비료는 상점 🌾 농사 진열대에서, 퇴비는 \`/농장 퇴비\` 로 작물 ${COMPOST_CROPS}개에 하나씩 만들어요._`);
  lines.push('_✨ 황금 비료는 마을 주문 보상으로만 얻어요 — 그 밭 작물이 다 끝날 때까지 품질이 올라요._');
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

async function openFert(interaction, ch, { plot = null } = {}) {
  const me = interaction.user.id;
  const [{ farm }, { accounts }] = await Promise.all([getFarm(ch), getAccounts([me])]);
  if (!farm) return refuse(interaction, why({ reason: 'none' }));
  if (farm.owner !== me) return refuse(interaction, why({ reason: 'notOwner', owner: farm.owner }));
  return interaction.editReply(fertPayload({
    ch, plot, owner: me, farm, items: accounts[me]?.items,
  }));
}

/** 곡괭이 창. 지금 것 · 다음 것의 값과 재료 · 해금 레벨. */
function toolsPayload({ owner, tools, account, note }) {
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

async function openTools(interaction) {
  const me = interaction.user.id;
  const [tools, { accounts }] = await Promise.all([getTools(me), getAccounts([me])]);
  return interaction.editReply(toolsPayload({ owner: me, tools, account: accounts[me] }));
}

// ---------------------------------------------------------------- 설비 (4b)

/**
 * 설비 창 — 내 농장의 설비. 농장 전체 설비는 버튼, 덮개·지지대는 밭을 여럿 고르는 셀렉트.
 * 고르는 순간 산다. 값·해금 레벨·효과는 서버 표(`/farms/equips`)를 그대로 적는다.
 */
function equipPayload({ owner, farm, equips, gold, crops, note }) {
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

async function openEquip(interaction, { owner = interaction.user.id, note } = {}) {
  const [{ farm }, { equips }, { accounts }, crops] = await Promise.all([getFarmOf(owner), getEquips(), getAccounts([owner]), getFarmCrops()]);
  if (!farm) return interaction.editReply({ embeds: [fail('설비는 내 농장에 놓아요. 먼저 `/농장 등록` 을 해 주세요.')], components: [] });
  return interaction.editReply(equipPayload({ owner, farm, equips, gold: accounts[owner]?.gold ?? 0, crops, note }));
}

async function equipCmd(interaction) {
  await interaction.deferReply({ flags: EPH });
  return openEquip(interaction);
}

/** 설비 사기 — 버튼(`eb`, 농장 전체) · 셀렉트(`ep`, 밭마다). 주인만(customId 맨 뒤). */
async function equipButton(interaction, act, [key, owner]) {
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

// ---------------------------------------------------------------- 주문 (5a)

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
function ordersPayload({
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

async function openOrders(interaction, { owner = interaction.user.id, note } = {}) {
  const { farm } = await getFarmOf(owner);
  if (!farm) return interaction.editReply({ embeds: [fail('주문은 내 농장으로 받아요. 먼저 `/농장 등록` 을 해 주세요.')], components: [] });
  const [{ board, mine, today }, { accounts }, crops] = await Promise.all([getBoard(farm.channelId), getAccounts([owner]), getFarmCrops()]);
  return interaction.editReply(ordersPayload({
    owner, board, mine: mine ?? [], crops, items: accounts[owner]?.items, today, note, season: farm.sky?.today?.season?.key ?? null,
  }));
}

async function ordersCmd(interaction) {
  await interaction.deferReply({ flags: EPH });
  return openOrders(interaction);
}

/** 납품(`od`) · 새로고침(`or`). 주인만(customId 맨 뒤). */
async function orderButton(interaction, act, [token, owner]) {
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

// ---------------------------------------------------------------- 날씨 (4a)

/** 날씨 효과 한 줄(설명). */
const SKY_NOTE = {
  clear: '보통 날', cloudy: '성장 ×0.9', rain: '비가 물을 줘요(체력 안 듦)', downpour: '비가 물을 줘요 · 뿌리 작물 품질 −10',
  heat: '물 한 포기에 체력 2 · 용의 고추 ×2', frost: '제철이 아닌 작물이 상해요', storm: '키 큰 작물(옥수수·해바라기)이 쓰러져요',
  rainbow: '오늘 거두면 품질 +10',
};

/** `/농장 날씨` — 오늘·내일, 앞으로 이레, 오늘 제철인 작물. */
function weatherPayload({ wf, crops }) {
  const t = wf.today; const n = wf.tomorrow;
  const week = (wf.ahead ?? []).map((a) => `${a.weather.emoji}`).join(' ');
  const inSeason = crops.filter((c) => wf.inSeason.includes(c.key) && !c.seedOnly);
  const lines = [
    `**오늘** ${t.weather.emoji} ${t.weather.name} — ${SKY_NOTE[t.weather.key]}`,
    `**내일** ${n.weather.emoji} ${n.weather.name} — ${SKY_NOTE[n.weather.key]}`,
    '',
    `${t.season.emoji} **${t.season.name}** ${t.season.day}일째 / 14 — 계절은 2주마다 바뀌어요`,
    week ? `앞으로 이레 ${week}` : null,
    '',
    `🗓️ **지금 제철** (${inSeason.length}종) — ${inSeason.map((c) => `${c.emoji}${c.name}`).join(' ')}`,
    '_제철이 아니면 성장 ×0.7 · 품질이 떨어져요_',
  ].filter((l) => l != null);
  return {
    embeds: [base({ title: `${t.weather.emoji} 오늘의 날씨`, description: lines.join('\n'), color: FARM_COLOR, footer: '모든 농장이 같은 날씨예요 · 날씨는 미리 정해져 있어요' })],
    allowedMentions: QUIET,
  };
}

async function weatherCmd(interaction) {
  await interaction.deferReply({ flags: EPH });
  const [wf, crops] = await Promise.all([getWeather(7), getFarmCrops()]);
  return interaction.editReply(weatherPayload({ wf, crops }));
}

// ---------------------------------------------------------------- 도감 (3b)

/** 도감 한 쪽의 줄 수. */
const BOOK_PAGE = 25;

/**
 * 도감 — 작물마다 거둔 포기 수 · 최고 ★ · 대왕 작물. 안 키워 본 것은 ❔.
 * 레벨 순으로, 희귀는 맨 끝에. **한 쪽에 25줄**, ◀ ▶ 로 넘긴다 — 한 번에 다 찍으면 너무 길다.
 * customId `farm:bk:<쪽>:<도감 주인>` — 창을 연 사람만 넘긴다.
 */
function bookPayload({
  who, book, crops, page = 0,
}) {
  const known = crops.filter((c) => book[c.key]?.n);
  const pct = Math.round((known.length / crops.length) * 100);
  const line = (c) => {
    const b = book[c.key];
    if (!b?.n) return `❔ ${c.seedOnly ? '_희귀 ???_' : `_??? (Lv.${c.lv})_`}`;
    return `${c.emoji} **${c.name}** · ${num(b.n)}포기${b.best ? ` · 최고 ${STARS[b.best]}` : ''}${b.giant ? ` · 🏆×${b.giant}` : ''}`;
  };
  const ordered = [...crops].sort((a, b) => Number(Boolean(a.seedOnly)) - Number(Boolean(b.seedOnly)) || a.lv - b.lv);
  const pages = Math.max(1, Math.ceil(ordered.length / BOOK_PAGE));
  const at = Math.min(pages - 1, Math.max(0, page));
  const slice = ordered.slice(at * BOOK_PAGE, (at + 1) * BOOK_PAGE);
  const nav = (to, label, off) => new ButtonBuilder().setCustomId(`${PREFIX}:bk:${to}:${label}:${who}`)
    .setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(off);
  return {
    embeds: [base({
      title: `📖 농장 도감 — ${known.length} / ${crops.length} (${pct}%)`,
      description: [`<@${who}> 님이 키워 본 작물`, '', ...slice.map(line)].join('\n'),
      color: FARM_COLOR,
      footer: `${at + 1} / ${pages}쪽 · 거둘 때마다 적혀요 · 최고 품질은 ★ · ★★ · ★★★ · 🏆 는 대왕 작물`,
    })],
    components: pages > 1 ? [new ActionRowBuilder().addComponents(
      nav(Math.max(0, at - 1), '◀', at === 0),
      nav(Math.min(pages - 1, at + 1), '▶', at === pages - 1),
    )] : [],
    allowedMentions: QUIET,
  };
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
  .addSubcommand((s) => s.setName('거름').setDescription('비료·퇴비를 밭에 넣어 토질을 올립니다')
    .addIntegerOption((o) => plotOption(o, '밭 번호 (안 적으면 알아서)')))
  .addSubcommand((s) => s.setName('퇴비').setDescription(`거둔 작물 ${COMPOST_CROPS}개로 퇴비 하나를 만듭니다`)
    .addStringOption((o) => o.setName('작물').setDescription('퇴비로 만들 작물').setAutocomplete(true).setRequired(true))
    .addIntegerOption((o) => o.setName('개수').setDescription('만들 퇴비 수 (기본 1)').setMinValue(1).setMaxValue(100)))
  .addSubcommand((s) => s.setName('곡괭이').setDescription('곡괭이를 봅니다 · 더 좋은 것으로 바꿉니다'))
  .addSubcommand((s) => s.setName('설비').setDescription('빗물통 · 덮개 · 배수로 · 지지대 · 스프링클러를 봅니다 · 놓습니다'))
  .addSubcommand((s) => s.setName('주문').setDescription('마을 게시판과 내 농장에 온 의뢰를 보고 납품합니다'))
  .addSubcommand((s) => s.setName('도감').setDescription('키워 본 작물 · 최고 품질 · 대왕 작물을 봅니다'))
  .addSubcommand((s) => s.setName('날씨').setDescription('오늘 · 내일 날씨와 계절, 지금 제철인 작물'))
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
  const blocked = await screamBlocked(interaction.channelId, interaction.user.id, n ? n - 1 : null);
  if (blocked) return refuse(interaction, blocked);
  const [r, crops] = await Promise.all([
    harvestFarm({ channelId: interaction.channelId, userId: interaction.user.id, plot: n ? n - 1 : null }),
    getFarmCrops(),
  ]);
  if (!r.ok) return refuse(interaction, why(r, crops));
  forgetBag(interaction.user.id);           // /요리 재료 자동완성이 거둔 것을 바로 보게
  if (r.hpLost) forget(interaction.user.id); // 비명으로 체력이 줄었다
  await interaction.editReply(viewPayload(interaction, r.farm, crops, harvestNote(interaction.user.id, r, crops)));
  await announceGiant(interaction, r, crops);
  return announceLevel(interaction, r.levelUp, crops);
}

async function clearCmd(interaction) {
  await interaction.deferReply({ flags: EPH });
  const n = interaction.options.getInteger('밭');
  return openClear(interaction, interaction.channelId, { plot: n ? n - 1 : null });
}

async function fertCmd(interaction) {
  await interaction.deferReply({ flags: EPH });
  const n = interaction.options.getInteger('밭');
  return openFert(interaction, interaction.channelId, { plot: n ? n - 1 : null });
}

async function compostCmd(interaction) {
  await interaction.deferReply({ flags: EPH });
  const me = interaction.user.id;
  const crop = interaction.options.getString('작물');
  const count = interaction.options.getInteger('개수') ?? 1;
  const [r, crops] = await Promise.all([compostCrops({ userId: me, crop, count }), getFarmCrops()]);
  if (!r.ok) return refuse(interaction, why(r, crops));
  forgetBag(me);
  return interaction.editReply({
    embeds: [base({
      title: `🟤 퇴비 ${r.made}개를 만들었어요`,
      description: `${itemName(crops, r.crop)} ×${r.used} → 퇴비 ×${r.made} · 가진 퇴비 **${num(r.account?.items?.compost)}**
_\`/농장 거름\` 으로 밭에 넣으세요 — 하나에 토질 경험 +${FERTS.compost.soil}._`,
      color: FARM_COLOR,
    })],
  });
}

async function bookCmd(interaction) {
  await interaction.deferReply({ flags: EPH });
  const me = interaction.user.id;
  const [{ book }, crops] = await Promise.all([getBook(me), getFarmCrops()]);
  return interaction.editReply(bookPayload({ who: me, book, crops }));
}

async function toolsCmd(interaction) {
  await interaction.deferReply({ flags: EPH });
  return openTools(interaction);
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
        `<#${farm.channelId}> 의 농장(**Lv.${farm.level}**)이 **통째로 사라져요.** 심긴 작물 **${planted}포기**${farm.equipCount ? ` · 설비 **${farm.equipCount}개**` : ''}도 함께요.`,
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
  거름: fertCmd,
  퇴비: compostCmd,
  곡괭이: toolsCmd,
  설비: equipCmd,
  주문: ordersCmd,
  도감: bookCmd,
  날씨: weatherCmd,
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
    .map((c) => ({
      name: trunc(`${c.emoji} ${c.name} — ${c.seedOnly ? '🎒 희귀(주머니 씨앗)' : `씨앗 ${c.seed}골드 · Lv.${c.lv}`} · ${c.days}일`, 100),
      value: c.key,
    })));
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
    const blocked = await screamBlocked(ch, me);
    if (blocked) return interaction.followUp({ embeds: [fail(blocked)], flags: EPH });
    [r, crops] = await Promise.all([harvestFarm({ channelId: ch, userId: me }), getFarmCrops()]);
    if (r.hpLost) forget(me);
  }
  if (r.farm) await interaction.editReply(viewPayload(interaction, r.farm, crops));
  if (!r.ok) return interaction.followUp({ embeds: [fail(why(r, crops))], flags: EPH, allowedMentions: QUIET });

  if (act === 'h') forgetBag(me);
  await interaction.followUp({
    content: act === 'w' ? waterNote(me, r) : harvestNote(me, r, crops),
    allowedMentions: QUIET,
  });
  if (act === 'h') await announceGiant(interaction, r, crops);
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
    ch, owner, farm, stamina: me?.stamina, crops, me,
  };

  if (act === 'cn') return interaction.editReply(clearPayload({ ...base0, plot: nextOpen(farm, plot) }));
  if (act === 'cz') return interaction.editReply(clearPayload({ ...base0, plot }));
  if (act === 'cb') return interaction.editReply(boulderPayload({ ...base0, plot, cell }));
  if (act === 'cu') return interaction.editReply(uprootPayload({ ...base0, plot, cell }));

  // 여기부터는 실제로 캔다 — 돌·잡초 하나(cr) · 돌 전부(ca) · 바위 휘두르기(cs)
  const r = await clearFarm({
    channelId: ch,
    userId: owner,
    plot,
    cell: act === 'ca' ? null : cell,
    pos: act === 'cs' ? Number(arg) : null,
    all: act === 'ca',
    uproot: act === 'cU' ? arg : null,
  });
  const next = {
    ...base0, farm: r.farm ?? farm, stamina: r.stamina ?? me?.stamina, me: r.me ?? me,
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

/** 거름 창의 조작. 주인만 누른다(customId 맨 뒤). */
async function fertButton(interaction, act, [ch, plotS, owner]) {
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
      ch, plot, owner, farm: r.farm, items: r.account?.items, note: `✨ 황금 비료를 뿌렸어요 — 이 밭 **${cropName(crops, r.crop)}** 의 품질 **+${r.gold}** (밭이 빌 때까지)`,
    }));
  }
  const f = FERTS[item];
  const up = r.to > r.from ? ` · 🎉 토질 **${stars(r.to)}**!` : '';
  return interaction.editReply(fertPayload({
    ch, plot, owner, farm: r.farm, items: r.account?.items, note: `${f.emoji} ${f.name} ${r.used}개를 넣었어요 — 토질 경험 +${r.soil}${up}`,
  }));
}

/** 곡괭이 바꾸기. */
async function toolButton(interaction, [owner]) {
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

/** 도감 쪽 넘기기. 창을 연 사람만(customId 맨 뒤). */
async function bookButton(interaction, [pageS, , owner]) {
  if (interaction.user.id !== owner) {
    return interaction.reply({ embeds: [fail('자기 도감 창에서만 넘길 수 있어요.')], flags: EPH });
  }
  await interaction.deferUpdate();
  const [{ book }, crops] = await Promise.all([getBook(owner), getFarmCrops()]);
  return interaction.editReply(bookPayload({
    who: owner, book, crops, page: Number(pageS) || 0,
  }));
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
    if (act === 'k') return await toolButton(interaction, rest);
    if (act === 'bk') return await bookButton(interaction, rest);
    if (act === 'od' || act === 'or') return await orderButton(interaction, act, rest);
    if (act === 'eb' || act === 'ep') return await equipButton(interaction, act, rest);
    if (act.startsWith('f')) return await fertButton(interaction, act, rest);
    if (act.startsWith('c')) return await clearButton(interaction, act, rest);
    return await plantButton(interaction, act, rest);
  } catch (err) {
    const send = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
    return interaction[send]({ embeds: [fail(`농장 서버에 닿지 못했어요. ${err.message}`)], flags: EPH });
  }
}

/** 검사용(scripts/check-farm.mjs). 화면은 상태가 없어 그대로 불러 볼 수 있다. */
export {
  plantPayload, clearPayload, boulderPayload, uprootPayload, fertPayload, toolsPayload, bookPayload, weatherPayload, equipPayload, ordersPayload, waterNote, swingNote, harvestNote, harvestLine, why,
  cellsOf, maskOf, unlocked, modsLines, PLANT_PAGE,
};

export default {
  data,
  execute,
  autocomplete,
  componentPrefix: PREFIX,
  component,
};
