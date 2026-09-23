/**
 * farm/ui/shared — 농장 창들이 같이 쓰는 것
 *
 * 창마다 파일을 나누면서(심기·개간·거름·퇴비·곡괭이·설비·주문·날씨·도감), 여러 창이 같이 쓰는
 * 상수 · 사유 문장 · 칸 셈 · 수확 문구를 여기로 모았다. **규칙은 없다** — 서버가 준 것을 문장으로
 * 바꾸는 일만 한다(`commands/farm.js` 머리말).
 */
import { MessageFlags } from 'discord.js';
import { fail } from '../../embeds.js';
import { ITEM_BY_KEY } from '../../casino/items.js';
import { cropName } from '../render.js';

export const EPH = MessageFlags.Ephemeral;

export const PREFIX = 'farm';
/** 멘션을 적어도 아무도 안 불린다. 물 한 번에 알림이 가면 성가시다. */
export const QUIET = { parse: [] };

/** 폐농 확인 버튼이 살아 있는 시간. 지나면 다시 `/농장 폐농`. */
export const ABANDON_MS = 30_000;
/** 처음 열린 밭(키패드 5). 창들이 먼저 고르는 밭이다. */
export const START_PLOT = 4;
/** 바위 한 개에 휘두를 수 있는 횟수(서버 `land.MAX_SWINGS` 와 같다 — 화면에 적는 용도). */
export const MAX_SWINGS = 3;
/** 결 자리 수(서버 `land.GRAIN_SPOTS`). */
export const GRAIN_SPOTS = 5;
/** 한 밭의 칸 수 · 나무가 서는 칸(서버 `rules.CELLS` · `rules.TREE_CELL`, 4c). */
export const CELL_COUNT = 9;
export const TREE_CELL = 4;
/** 나무 한 번의 열매 수(서버 `TREE_YIELD` 의 ★1 최소 ~ ★5 최대 — 화면에 적는 용도). */
export const TREE_FRUITS = '18~48개';
/** 개간 창에서 누르면 뽑기로 가는 칸 상태(4c). */
export const UPROOTABLE = ['seed', 'grow', 'dry', 'ripe', 'over', 'dead', 'dormant', 'canopy'];

/** 거름 — 밭마다 하루 한도와 토질 경험(서버 `land.FERTS` 와 같다 — 화면에 적는 용도). */
export const FERTS = {
  fertilizer: { name: '비료', emoji: '🧪', soil: 15, perDay: 1 },
  compost: { name: '퇴비', emoji: '🟤', soil: 5, perDay: 3 },
};
/** 퇴비 한 개에 드는 작물 수(서버 `land.COMPOST_CROPS`). */
export const COMPOST_CROPS = 5;

/** 곡괭이 효과 한 줄. 값·재료·해금 레벨은 서버가 준다(`/farms/tools`). */
export const PICKAXE_NOTE = {
  wood: '기본 곡괭이. 빗나가면 방향만 알려 줘요.',
  iron: '빗나가면 결까지 **몇 칸**인지 알려 줘요.',
  mithril: '휘두르기 전에 결 후보를 **두 자리**로 좁혀 줘요 — 완벽 확률 20% → 50%.',
};

export const pickaxeName = (key, list) => {
  const t = list?.find((x) => x.key === key);
  if (t) return `${t.emoji} ${t.name}`;
  return { wood: '🪓 나무 곡괭이', iron: '⛏️ 철 곡괭이', mithril: '💎 미스릴 곡괭이' }[key] ?? key;
};

export const num = (n) => Number(n ?? 0).toLocaleString('ko-KR');

/** 서버가 준 `reason` → 사람에게 할 말. */
export function why(r, crops) {
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
export async function refuse(interaction, message) {
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

export const itemName = (crops, key) => crops?.find((c) => c.key === key)?.name ?? ITEM_BY_KEY[key]?.name ?? key;
/** 받은 것 한 줄. `당근 ×4 · 민들레 ×1` */
export const itemsLine = (items, crops) => Object.entries(items ?? {})
  .map(([k, n]) => `${itemName(crops, k)} ×${n}`).join(' · ');

export const STARS = ['', '★', '★★', '★★★'];
/**
 * 수확물 한 줄(3b) — ★ 변형은 원래 작물로 묶는다. `당근 ×5 (★×2 · ★★×1) · 🏆 대왕 무`
 * 대왕 작물은 따로 앞에, 품질 분포는 **개수**로 적는다(칸이 아니라 나온 것).
 */
export function harvestLine(items, crops) {
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

export function waterNote(who, r) {
  const cost = r.cost ?? 1;
  const barrel = cost === 1 && r.farm?.sky?.today?.weather?.key === 'heat' ? ' 🛢️ 빗물통' : '';
  const bits = [`<@${who}> 님이 **${r.watered}포기**에 물을 줬어요 · 체력 −${r.watered * cost}${cost > 1 ? ' 🥵 폭염' : barrel} (남은 체력 ${num(r.hp)})`];
  if (r.revived) bits.push(`🍂 ${r.revived}포기가 살아났어요`);
  if (r.ripened) bits.push(`🧺 ${r.ripened}포기가 다 자랐어요`);
  if (r.left) bits.push(`_체력이 모자라 **${r.left}포기**는 못 줬어요 — 다른 분이 이어서 줄 수 있어요_`);
  return `💧 ${bits.join(' · ')}`;
}

export function harvestNote(who, r, crops) {
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

/** 9비트 ↔ 칸 index. */
export const cellsOf = (mask) => [...Array(9).keys()].filter((i) => mask & (1 << i));
export const maskOf = (cells) => cells.reduce((m, i) => m | (1 << i), 0);

export const cellsIn = (plot, states) => plot.cells.map((s, i) => (states.includes(s) ? i : -1)).filter((i) => i >= 0);
export const soilCells = (plot) => cellsIn(plot, ['soil']);
export const stoneCells = (plot) => cellsIn(plot, ['rock', 'boulder', 'crack', 'weed']);
export const openPlots = (farm) => farm.plots.map((p, i) => (p.open ? i : -1)).filter((i) => i >= 0);

/** 먼저 보여 줄 밭. 가운데(5)를 먼저, 그다음 `has` 가 참인 열린 밭. */
export function pickPlot(farm, has) {
  const open = openPlots(farm);
  const good = open.filter((i) => has(farm.plots[i]));
  if (good.includes(START_PLOT)) return START_PLOT;
  return good[0] ?? open[0] ?? START_PLOT;
}
export const nextOpen = (farm, plot) => {
  const open = openPlots(farm);
  return open[(open.indexOf(plot) + 1) % open.length];
};

/**
 * 심을 수 있는 작물 — 레벨이 닿는 것 + 주머니에 씨앗이 있는 희귀 작물. 희귀를 맨 앞에,
 * 그다음 **최근에 풀린 것부터.** 셀렉트는 25칸이라 `PLANT_PAGE` 씩 끊어 쪽을 넘긴다.
 */
export const unlocked = (crops, level, pouch = {}) => crops
  .filter((c) => (c.seedOnly ? (pouch[c.key] ?? 0) > 0 : c.lv <= level))
  .sort((a, b) => Number(Boolean(b.seedOnly)) - Number(Boolean(a.seedOnly)) || b.lv - a.lv);
/** 셀렉트 한 쪽의 작물 수. 한 칸은 "다른 작물" 로 남긴다. */
export const PLANT_PAGE = 24;
/** 쪽 넘김 셀렉트 값. */
export const PAGE_VALUE = '__page:';
