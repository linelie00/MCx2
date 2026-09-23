/**
 * farm/ui/book — 도감 창 (3b · 쪽 넘김)
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getFarmCrops, getBook } from '../../api.js';
import { base, fail } from '../../embeds.js';
import { FARM_COLOR } from '../render.js';
import { PREFIX, EPH, QUIET, STARS, num } from './shared.js';

/** 도감 한 쪽의 줄 수. */
const BOOK_PAGE = 25;

/**
 * 도감 — 작물마다 거둔 포기 수 · 최고 ★ · 대왕 작물. 안 키워 본 것은 ❔.
 * 레벨 순으로, 희귀는 맨 끝에. **한 쪽에 25줄**, ◀ ▶ 로 넘긴다 — 한 번에 다 찍으면 너무 길다.
 * customId `farm:bk:<쪽>:<도감 주인>` — 창을 연 사람만 넘긴다.
 */
export function bookPayload({
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

/** 도감 쪽 넘기기. 창을 연 사람만(customId 맨 뒤). */
export async function bookButton(interaction, [pageS, , owner]) {
  if (interaction.user.id !== owner) {
    return interaction.reply({ embeds: [fail('자기 도감 창에서만 넘길 수 있어요.')], flags: EPH });
  }
  await interaction.deferUpdate();
  const [{ book }, crops] = await Promise.all([getBook(owner), getFarmCrops()]);
  return interaction.editReply(bookPayload({
    who: owner, book, crops, page: Number(pageS) || 0,
  }));
}
