/**
 * farm/ui/clear — 개간 창 · 바위 창 · 뽑기 창 (2a H 미니게임 · 4c 뽑기)
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getFarm, getFarmCrops, clearFarm } from '../../api.js';
import { base, fail } from '../../embeds.js';
import { forgetBag } from '../../casino/bag.js';
import { FARM_COLOR, cropName, plantName, cellEmoji, plotNo } from '../render.js';
import { announceLevel } from './view.js';
import {
  PREFIX, EPH, QUIET, MAX_SWINGS, GRAIN_SPOTS, UPROOTABLE,
  why, refuse, itemsLine, pickaxeName, cellsIn, stoneCells, openPlots, pickPlot, nextOpen,
} from './shared.js';

const staminaLine = (st) => `⛏️ 오늘 개간 기력 **${st?.left ?? 0}** / ${st?.max ?? 0}`;

/** 개간 창. 돌·잡초는 누르면 바로 치우고, 바위는 바위 창으로 간다. */
export function clearPayload({
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
export function boulderPayload({
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
export function uprootPayload({
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
export async function openClear(interaction, ch, { plot = null } = {}) {
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
export function swingNote(r, crops) {
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

/** 개간 창 · 바위 창의 조작. 주인만 누른다(customId 맨 뒤). */
export async function clearButton(interaction, act, [ch, plotS, cellS, arg, owner]) {
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
