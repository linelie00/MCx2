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
 * **창마다 파일이 갈려 있다**(`farm/ui/*`) — 심기 · 개간(바위 · 뽑기) · 거름 · 퇴비 · 곡괭이 · 설비 ·
 * 주문 · 날씨 · 도감, 그리고 농장 화면과 공개 알림(`view.js`), 여러 창이 같이 쓰는 것(`shared.js`).
 * 이 파일에는 **명령 정의와 갈래(라우팅)** 만 남는다. 한 파일이 1,700줄을 넘어 갈랐다.
 *
 * 화면은 이렇다.
 *   - **농장 화면** — 공개. 버튼(물 · 수확 · 심기 · 개간 · 새로고침)은 누구나 누를 수 있고, 주인만
 *     되는 일은 서버가 거절한다. customId 에 **채널 id** 를 싣는다 — `/농장 보기 채널:` 로
 *     남의 채널 농장을 띄워도 버튼이 그 농장을 가리키게
 *   - **창들** — 전부 에페메랄. 심기 · 개간 · 바위 · 뽑기 · 거름 · 퇴비 · 곡괭이 · 설비 · 주문 · 도감
 *   상태가 없는 핸들러라 창의 상태(밭·칸·작물·고른 칸)와 **주인 id(맨 뒤)** 를 customId 에 싣는다.
 *
 * **판에 앉아 있으면 못 심고 물도 못 준다.** 씨앗값은 골드를, 물은 체력을 쓰는데 판이 도는 동안
 * 둘 다 판의 장부에 있다(`casino/tables.js`) — 상점·출첵과 같은 까닭이다.
 *
 * 레벨이 오르면 **채널에 공개로** 알린다(밭이 열린 것은 모두가 볼 일이다).
 * 못 한 것은 **본인에게만** 보인다. 공개로 잡아 둔 응답은 지우고 에페메랄로 다시 말한다.
 */
import {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType,
} from 'discord.js';
import {
  getFarm, getFarmOf, getFarmCrops, registerFarm, abandonFarm, waterFarm, harvestFarm, compostCrops, getAccounts, getBook,
} from '../api.js';
import { base, fail } from '../embeds.js';
import { forget } from '../casino/alive.js';
import { forgetBag } from '../casino/bag.js';
import { seatedAt, seatedMessage } from '../casino/tables.js';
import { FARM_COLOR } from '../farm/render.js';

import { PREFIX, EPH, QUIET, ABANDON_MS, COMPOST_CROPS, why, refuse } from '../farm/ui/shared.js';
import { waterNote, harvestNote, harvestLine, unlocked, num } from '../farm/ui/shared.js';
import {
  viewPayload, screamBlocked, announceGiant, announceLevel,
} from '../farm/ui/view.js';
import { plantPayload, openPlant, plantButton } from '../farm/ui/plant.js';
import {
  clearPayload, boulderPayload, uprootPayload, openClear, clearButton, swingNote,
} from '../farm/ui/clear.js';
import { fertPayload, openFert, fertButton } from '../farm/ui/fert.js';
import { toolsPayload, openTools, toolButton } from '../farm/ui/tools.js';
import { equipPayload, equipCmd, equipButton } from '../farm/ui/equip.js';
import { compostPayload, openCompost, compostButton } from '../farm/ui/compost.js';
import { ordersPayload, ordersCmd, orderButton } from '../farm/ui/orders.js';
import { weatherPayload, weatherCmd } from '../farm/ui/weather.js';
import { bookPayload, bookButton } from '../farm/ui/book.js';

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
    .addStringOption((o) => o.setName('작물').setDescription('안 적으면 가진 작물 가운데 고를 수 있어요').setAutocomplete(true))
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
  // 작물을 안 적으면 **가진 작물 가운데** 고르는 창을 연다 — 예순 가지에서 찾는 건 번거롭다
  if (!crop) return openCompost(interaction, { owner: me });
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
  // 퇴비는 **가진 작물** 만 — 없는 것을 골라 봐야 거절당한다
  if (interaction.options.getSubcommand(false) === '퇴비') {
    let items = {};
    try { items = (await getAccounts([interaction.user.id])).accounts[interaction.user.id]?.items ?? {}; } catch { /* 그냥 전부 보여 준다 */ }
    const mine = compostable(items, crops).filter((x) => !typed || x.crop.name.replace(/\s+/g, '').includes(typed));
    return interaction.respond(mine.map((x) => ({
      name: trunc(`${x.crop.emoji} ${x.crop.name} — ${x.have}개 → 퇴비 ${x.made}개`, 100),
      value: x.crop.key,
    })));
  }
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
    if (['mc', 'm1', 'mM', 'mx'].includes(act)) return await compostButton(interaction, act, rest);
    if (act === 'eb' || act === 'ep') return await equipButton(interaction, act, rest);
    if (act.startsWith('f')) return await fertButton(interaction, act, rest);
    if (act.startsWith('c')) return await clearButton(interaction, act, rest);
    return await plantButton(interaction, act, rest);
  } catch (err) {
    const send = interaction.deferred || interaction.replied ? 'followUp' : 'reply';
    return interaction[send]({ embeds: [fail(`농장 서버에 닿지 못했어요. ${err.message}`)], flags: EPH });
  }
}

/**
 * 검사용(scripts/check-farm.mjs). 창은 상태가 없어 그대로 불러 볼 수 있다.
 * 창마다 파일이 갈렸으니(`farm/ui/*`) 여기서는 다시 내보내기만 한다.
 */
export { why, waterNote, harvestNote, harvestLine, unlocked, cellsOf, maskOf, PLANT_PAGE } from '../farm/ui/shared.js';
export { plantPayload, modsLines } from '../farm/ui/plant.js';
export { clearPayload, boulderPayload, uprootPayload, swingNote } from '../farm/ui/clear.js';
export { fertPayload } from '../farm/ui/fert.js';
export { toolsPayload } from '../farm/ui/tools.js';
export { equipPayload } from '../farm/ui/equip.js';
export { compostPayload } from '../farm/ui/compost.js';
export { ordersPayload } from '../farm/ui/orders.js';
export { weatherPayload } from '../farm/ui/weather.js';
export { bookPayload } from '../farm/ui/book.js';

export default {
  data,
  execute,
  autocomplete,
  componentPrefix: PREFIX,
  component,
};
