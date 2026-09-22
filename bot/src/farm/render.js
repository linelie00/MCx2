/**
 * farm/render — 농장 화면
 *
 * 그림을 안 쓰기로 했으니(embeds.js 머리말) 이모지 9×9 격자로 그린다. 밭 3×3 이 각각
 * 칸 3×3 이고, 번호는 둘 다 **키패드 배치**다(1 2 3 / 4 5 6 / 7 8 9).
 *
 * 셈은 서버가 끝내서 준다(`view` — 칸마다 `soil · rock · boulder · crack · weed · seed · grow ·
 * ripe · over · dry · dead · locked`).
 * 여기는 그 이름을 이모지와 문장으로 바꾸기만 한다. 규칙을 다시 갖지 않는다.
 */
import { base, gauge } from '../embeds.js';
import { ITEM_BY_KEY } from '../casino/items.js';

/** 농장 화면의 색. 흙빛 — 테마색(양피지)보다 조금 짙다. */
export const FARM_COLOR = 0x7a5c3a;

/** 칸 상태 → 이모지. 익은 칸만 작물마다 다르다. */
const CELL = {
  soil: '🟫', rock: '🪨', boulder: '⛰️', crack: '⛰️', weed: '🌼',
  seed: '🌱', grow: '🌿', dry: '🍂', dead: '💀', locked: '🔒',
};

/** 토질 ★ 다섯 칸. */
export const stars = (n) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));

/** 밭 번호(키패드 1~9). 서버는 0~8 을 쓴다. */
export const plotNo = (i) => i + 1;

export const cropName = (crops, key) => crops?.find((c) => c.key === key)?.name ?? ITEM_BY_KEY[key]?.name ?? key;
export const cropEmoji = (crops, key) => crops?.find((c) => c.key === key)?.emoji ?? '🥬';

/** 칸 하나. */
export function cellEmoji(state, crops, crop) {
  if (state === 'ripe' || state === 'over') return cropEmoji(crops, crop);
  return CELL[state] ?? '▫️';
}

/**
 * 9×9 격자. 밭 사이는 세로줄, 밭의 줄 사이는 빈 줄.
 *
 * 이모지는 글꼴마다 폭이 달라 가로 구분선(━╋━)은 모바일에서 어긋난다. 빈 줄이 제일 덜 깨진다.
 */
export function grid(farm, crops) {
  const lines = [];
  for (let R = 0; R < 3; R += 1) {
    for (let r = 0; r < 3; r += 1) {
      lines.push([0, 1, 2].map((C) => {
        const p = farm.plots[R * 3 + C];
        return p.cells.slice(r * 3, r * 3 + 3).map((s) => cellEmoji(s, crops, p.crop)).join('');
      }).join(' │ '));
    }
    if (R < 2) lines.push('');
  }
  return lines.join('\n');
}

/**
 * 궁합 한 토막(3a). 성장 배율이 1 이면 빈 문자열.
 * `🤝 +20%` · `⚔️ −15% 연작` · `🤝 +10% 윤작` — 서버가 준 `rate`·`rotation` 만 읽는다.
 */
export function modsBadge(mods) {
  if (!mods) return '';
  const pct = Math.round((mods.rate - 1) * 100);
  const rot = mods.rotation === 'same' ? ' 연작' : mods.rotation === 'varied' ? ' 윤작' : '';
  if (!pct && !rot) return '';
  if (!pct) return mods.rotation === 'same' ? `⚔️${rot}` : `🤝${rot}`;
  return pct > 0 ? `🤝 +${pct}%${rot}` : `⚔️ −${-pct}%${rot}`;
}

/** 열린 밭마다 한 줄. 토질 · 작물 · 궁합 · 익은 것 · 남은 물주기 · 오늘 물 · 돌. */
export function plotLines(farm, crops) {
  return farm.plots.map((p, i) => {
    if (!p.open) return null;
    const count = (st) => p.cells.filter((s) => s === st).length;
    const head = `**${plotNo(i)}번 밭** ${stars(p.star)}`;
    const bits = [];
    if (p.crop) bits.push(`${cropEmoji(crops, p.crop)} ${cropName(crops, p.crop)}${modsBadge(p.mods) ? ` ${modsBadge(p.mods)}` : ''}`);
    if (p.ripe) bits.push(`🧺 수확 ${p.ripe}`);
    if (p.growing) bits.push(`자라는 중 ${p.growing}${p.left != null ? ` (물 ${p.left}번 더)` : ''}`);
    if (p.need) bits.push(`💧 오늘 ${p.need}`);
    if (p.thirsty) bits.push(`⚠️ 목마름 ${p.thirsty}`);
    if (count('dry')) bits.push(`🍂 ${count('dry')}`);
    if (p.dead) bits.push(`💀 ${p.dead}`);
    const stones = count('rock') + count('boulder') + count('crack');
    if (stones) bits.push(`⛏️ 돌 ${stones}`);
    if (count('weed')) bits.push(`🌼 ${count('weed')}`);
    if (!p.crop && !stones) bits.push('_비어 있어요 — `/농장 심기`_');
    return `${head} ${bits.join(' · ')}`;
  }).filter(Boolean).join('\n');
}

/** 레벨 한 줄. `Lv.3 ▰▰▰▱▱▱▱▱ 38% · 180 / 300` */
export function levelLine(farm) {
  if (farm.xpNext == null) return `**Lv.${farm.level}** · 최고 레벨`;
  const done = farm.xp - farm.xpFloor;
  const span = farm.xpNext - farm.xpFloor;
  return `**Lv.${farm.level}** ${gauge(done, span)} · ${farm.xp} / ${farm.xpNext}`;
}

/** 다음 레벨에 열리는 것. */
export function nextLine(farm, crops) {
  if (farm.nextPlot == null) return null;
  const fresh = (crops ?? []).filter((c) => c.lv === farm.level + 1);
  return `🔓 _다음 Lv.${farm.level + 1} — ${plotNo(farm.nextPlot)}번 밭${fresh.length ? ` · 새 작물 ${fresh.map((c) => c.name).join(', ')}` : ''}_`;
}

/** 오늘 물 상태 한 줄. */
export function waterLine(farm) {
  const who = farm.waterBy?.length ? ` — ${farm.waterBy.map((id) => `<@${id}>`).join(' ')}` : '';
  if (farm.need) return `💧 오늘 물이 필요한 포기 **${farm.need}**${who}`;
  return farm.waterBy?.length ? `💧 오늘 물을 다 줬어요${who}` : '💧 _물을 줄 작물이 없어요._';
}

/** `/농장 보기` 의 임베드. */
export function farmEmbed(farm, crops, { name } = {}) {
  return base({
    // 제목에서는 <#채널> 멘션이 안 풀린다. 이름을 받아 쓰고, 멘션은 본문 첫 줄에 둔다.
    title: `${farm.sign} ${name ? `#${name} ` : ''}농장`,
    description: [
      `<#${farm.channelId}> · 주인 <@${farm.owner}>`,
      levelLine(farm),
      waterLine(farm),
      '',
      grid(farm, crops),
      '',
      plotLines(farm, crops),
      nextLine(farm, crops),
    ].filter((l) => l != null).join('\n'),
    color: FARM_COLOR,
    footer: '물은 한 포기에 체력 1 · 이틀 굶으면 시들고 나흘이면 죽어요 · 돌은 /농장 개간',
  });
}

export default {
  FARM_COLOR, plotNo, stars, cropName, cropEmoji, cellEmoji, grid, modsBadge, plotLines, levelLine, nextLine, waterLine, farmEmbed,
};
