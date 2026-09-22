/**
 * farm/render — 농장 화면
 *
 * 그림을 안 쓰기로 했으니(embeds.js 머리말) 이모지 9×9 격자로 그린다. 밭 3×3 이 각각
 * 칸 3×3 이고, 번호는 둘 다 **키패드 배치**다(1 2 3 / 4 5 6 / 7 8 9).
 *
 * 셈은 서버가 끝내서 준다(`view` — 칸마다 `soil · seed · grow · ripe · over · dry · dead · locked`).
 * 여기는 그 이름을 이모지와 문장으로 바꾸기만 한다. 규칙을 다시 갖지 않는다.
 */
import { base } from '../embeds.js';
import { ITEM_BY_KEY } from '../casino/items.js';

/** 농장 화면의 색. 흙빛 — 테마색(양피지)보다 조금 짙다. */
export const FARM_COLOR = 0x7a5c3a;

/** 칸 상태 → 이모지. 익은 칸만 작물마다 다르다. */
const CELL = {
  soil: '🟫', seed: '🌱', grow: '🌿', dry: '🍂', dead: '💀', locked: '🔒',
};

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

/** 열린 밭마다 한 줄. 작물 · 익은 것 · 남은 물주기 · 목마른 것. */
export function plotLines(farm, crops) {
  return farm.plots.map((p, i) => {
    if (!p.open) return null;
    const head = `**${plotNo(i)}번 밭**`;
    if (!p.crop) return `${head} — _비어 있어요. \`/농장 심기\`_`;
    const bits = [`${cropEmoji(crops, p.crop)} ${cropName(crops, p.crop)}`];
    if (p.ripe) bits.push(`🧺 수확 ${p.ripe}`);
    if (p.growing) bits.push(`자라는 중 ${p.growing}${p.left != null ? ` (물 ${p.left}번 더)` : ''}`);
    if (p.thirsty) bits.push(`💧 목마름 ${p.thirsty}`);
    if (p.dead) bits.push(`💀 ${p.dead}`);
    const dry = p.cells.filter((s) => s === 'dry').length;
    if (dry) bits.push(`🍂 시듦 ${dry}`);
    return `${head} ${bits.join(' · ')}`;
  }).filter(Boolean).join('\n');
}

/** 오늘 물 상태 한 줄. */
export function waterLine(farm) {
  return farm.watered
    ? `💧 오늘 물 줌 — <@${farm.waterBy}>`
    : '💧 _오늘은 아직 아무도 물을 안 줬어요._';
}

/** `/농장 보기` 의 임베드. */
export function farmEmbed(farm, crops, { name } = {}) {
  return base({
    // 제목에서는 <#채널> 멘션이 안 풀린다. 이름을 받아 쓰고, 멘션은 본문 첫 줄에 둔다.
    title: name ? `🛖 #${name} 농장` : '🛖 농장',
    description: [
      `<#${farm.channelId}> · 주인 <@${farm.owner}>`,
      waterLine(farm),
      '',
      grid(farm, crops),
      '',
      plotLines(farm, crops),
    ].join('\n'),
    color: FARM_COLOR,
    footer: '물은 하루 한 번, 누구나 줄 수 있어요 · 이틀 굶으면 시들고 나흘이면 죽어요',
  });
}

export default { FARM_COLOR, plotNo, cropName, cropEmoji, cellEmoji, grid, plotLines, waterLine, farmEmbed };
