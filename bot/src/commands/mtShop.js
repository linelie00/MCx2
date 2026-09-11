/**
 * /mt상점 — MT 로 칭호를 사고, 플래티넘·다이아몬드를 MT 로 바꾼다
 *
 * MT 는 얻는 길이 좁은 재화다(요트 1위 · 토너먼트 우승 · 던전 드물게). 탭이 둘이다.
 *
 *   🏷️ 칭호   MT 로 칭호를 산다. 무엇을 얼마에 파는지는 칭호 명부에 있다
 *              (`casino/titles.js` 의 SHOP_TITLES) — 명부에 한 줄 넣으면 여기 바로 뜬다.
 *   🪙 바꾸기  `/요리`·`/제작` 에서 아주아주 잘 만든 것 — 💠 플래티넘 **5 MT**, 💎 다이아몬드
 *              **10 MT** — 을 MT 로(`casino/crafts.js` 의 GRADES). 같은 물건을 `/상점` 에 팔면
 *              골드를 받는다. **둘 중 한쪽만**이다 — 파는 순간 물건이 빠진다.
 *
 * **칭호는 여전히 저장하지 않는다.** 산 것은 전적 카운터 하나(`own…`)로 남고, 칭호는 그걸
 * 보고 계산해 낸다 — 다른 칭호와 똑같다. MT 빼기와 카운터 올리기가 **한 번의 쓰기**라,
 * MT 가 모자라면 서버가 통째로 409 를 낸다(반쪽만 사지는 일이 없다).
 *
 * `/상점` 과 같은 규약이다 — 에페메랄, customId 에 주인 id 를 **맨 뒤에** 넣고 검사한다
 * (에페메랄 메시지도 봇이 재시작하면 남아 있고, NPC id 에 콜론이 있다).
 */
import {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import { getAccounts, setTitle } from '../api.js';
import { apply } from '../casino/wallet.js';
import { base, fail, trunc, THEME_COLOR } from '../embeds.js';
import { GRADE_BY_KEY } from '../casino/crafts.js';
import { forgetCrafts, craftLabel } from '../casino/bag.js';
import { SHOP_TITLES, TITLE_BY_KEY, tierOf } from '../casino/titles.js';
import { stamp, stampMd, plaque } from '../casino/titleCard.js';

export const PREFIX = 'mts';

const MT_COLOR = 0x7fd1d9;
const num = (n) => Number(n ?? 0).toLocaleString('ko-KR');
const ephemeral = (p) => ({ ...p, flags: MessageFlags.Ephemeral });

/** `mts:<무엇>:<대상>:<주인>` — 주인 id 는 콜론 때문에 맨 뒤. 대상이 없으면 `-`. */
const cid = (what, id, owner) => [PREFIX, what, id, owner].join(':');

const TABS = [
  { key: 'buy', label: '칭호', emoji: '🏷️' },
  { key: 'sell', label: 'MT 로 바꾸기', emoji: '🪙' },
];

function tabRow(owner, current) {
  return new ActionRowBuilder().addComponents(...TABS.map((t) => new ButtonBuilder()
    .setCustomId(cid('tab', t.key, owner))
    .setLabel(t.label)
    .setEmoji(t.emoji)
    .setStyle(t.key === current ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(t.key === current)));
}

const mtField = (account) => ({ name: '가진 MT', value: `**${num(account?.mt)}**`, inline: true });

// ---------------------------------------------------------------- 🏷️ 칭호 사기

/** 산 칭호인지. 칭호의 `when` 을 그대로 쓴다 — 산 기록을 읽는 길이 하나뿐이게. */
const owns = (account, t) => t.when(account?.stats ?? {}, account);

function buyPayload(owner, account) {
  const have = Number(account?.mt ?? 0);
  const lines = SHOP_TITLES.map((t) => (owns(account, t)
    ? `✅ ${stampMd(t)} — _가짐_`
    : `${stampMd(t)} — **${t.shop.mt} MT**${have < t.shop.mt ? ' 🔒' : ''}`));

  const embed = base({
    title: '🪙 MT 상점 — 칭호',
    description: `${lines.join('\n')}\n\n_산 칭호는 \`/프로필\` 칭호 탭에서 달 수 있어요._`,
    color: MT_COLOR,
    footer: 'MT 는 요트 1위 · 토너먼트 우승 · 던전에서 드물게 · 💠💎 요리·제작품에서',
  }).addFields(mtField(account));

  const rows = [tabRow(owner, 'buy')];
  const left = SHOP_TITLES.filter((t) => !owns(account, t));
  if (left.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(cid('tpick', '-', owner))
        .setPlaceholder('살 칭호 고르기')
        .addOptions(left.map((t) => ({
          label: trunc(stamp(t), 100),
          value: t.key,
          description: trunc(`${t.shop.mt} MT · ${t.desc}`, 100),
        }))),
    ));
  }
  return ephemeral({ embeds: [embed], components: rows });
}

function titleCard(key, owner, account) {
  const t = TITLE_BY_KEY[key];
  if (!t?.shop) return buyPayload(owner, account);
  const have = Number(account?.mt ?? 0);
  const had = owns(account, t);

  const why = had ? '이미 가졌어요 — `/프로필` 칭호 탭에서 달 수 있어요.'
    : have < t.shop.mt ? `MT 가 **${t.shop.mt - have}** 모자라요.`
      : `**${t.shop.mt} MT** 로 삽니다. 한 번 사면 영영 가져요.`;
  return ephemeral({
    embeds: [base({
      title: stamp(t),
      description: `_${t.desc}_\n\n${why}`,
      color: tierOf(t).color,
    }).addFields({ name: '값', value: `**${t.shop.mt} MT**`, inline: true }, mtField(account))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cid('tbuy', t.key, owner))
        .setLabel(`${t.shop.mt} MT 로 사기`).setEmoji('🏷️').setStyle(ButtonStyle.Success)
        .setDisabled(had || have < t.shop.mt),
      new ButtonBuilder().setCustomId(cid('tab', 'buy', owner))
        .setLabel('목록으로').setStyle(ButtonStyle.Secondary),
    )],
  });
}

/** 산다. MT 빼기와 산 기록이 한 번의 쓰기다 — 모자라면 서버가 통째로 거절한다. */
async function buyTitle(key, owner, account) {
  const t = TITLE_BY_KEY[key];
  if (!t?.shop) return ephemeral({ embeds: [fail('파는 칭호가 아니에요.')], components: [] });
  if (owns(account, t)) return titleCard(key, owner, account);
  if (Number(account?.mt ?? 0) < t.shop.mt) return titleCard(key, owner, account);

  const saved = await apply({
    mt: { [owner]: -t.shop.mt },
    bump: { [owner]: { [t.shop.stat]: 1 } },
  });
  if (!saved.ok) {
    return ephemeral({ embeds: [fail('사지 못했어요. MT 가 그새 줄었거나 저장이 안 됐어요.')], components: [] });
  }
  return ephemeral({
    embeds: [base({
      title: '🏷️ 샀어요',
      description: `${plaque([t])}\n_${t.desc}_`,
      color: tierOf(t).color,
      footer: `남은 MT ${num(saved.accounts[owner]?.mt)}`,
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cid('wear', t.key, owner))
        .setLabel('지금 달기').setEmoji('🎖️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(cid('tab', 'buy', owner))
        .setLabel('목록으로').setStyle(ButtonStyle.Secondary),
    )],
  });
}

async function wear(key, owner, account) {
  const t = TITLE_BY_KEY[key];
  if (!t || !owns(account, t)) return ephemeral({ embeds: [fail('가진 칭호가 아니에요.')], components: [] });
  await setTitle(owner, t.key);
  return ephemeral({
    embeds: [base({ description: `**${stamp(t)}** 을(를) 달았어요.`, color: tierOf(t).color })],
    components: [tabRow(owner, null)],
  });
}

// ---------------------------------------------------------------- 🪙 MT 로 바꾸기

/** MT 로 바꿀 수 있는 것. 비싼 것부터. */
const worthy = (account) => (account?.crafts ?? [])
  .filter((c) => c.mt > 0)
  .sort((a, b) => b.mt - a.mt || b.price - a.price);

function sellPayload(owner, account) {
  const list = worthy(account);
  const embed = base({
    title: '🪙 MT 상점 — 바꾸기',
    description: list.length
      ? list.map((c) => `${craftLabel(c)} — **${c.mt} MT** _(또는 ${num(c.price)}골드)_`).join('\n')
      : '_바꿀 수 있는 게 없어요._\n`/요리` · `/제작` 에서 💠 플래티넘(5 MT) · 💎 다이아몬드(10 MT) 를 만들면 여기서 MT 로 바꿉니다.',
    color: MT_COLOR,
  }).addFields(mtField(account));

  const rows = [tabRow(owner, 'sell')];
  if (list.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(cid('pick', '-', owner))
        .setPlaceholder('MT 로 바꿀 것 고르기')
        .addOptions(list.map((c) => ({
          label: trunc(c.name, 100),
          value: c.id,
          emoji: GRADE_BY_KEY[c.grade]?.emoji,
          description: trunc(`${c.mt} MT · ${c.kind}`, 100),
        }))),
    ));
  }
  return ephemeral({ embeds: [embed], components: rows });
}

function craftCard(id, owner, account) {
  const c = worthy(account).find((x) => x.id === id);
  if (!c) return sellPayload(owner, account);
  const g = GRADE_BY_KEY[c.grade];
  return ephemeral({
    embeds: [base({
      title: `${g.emoji} ${c.name}`,
      description: [
        c.desc ? `_${c.desc}_` : '',
        '',
        `${g.label} ${c.kind} · **${c.mt} MT** 로 바꿉니다.`,
        `_\`/상점\` 에 팔면 ${num(c.price)}골드 — 둘 중 한쪽만 받아요._`,
      ].join('\n'),
      color: g.color,
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cid('do', c.id, owner))
        .setLabel(`${c.mt} MT 로 바꾸기`).setEmoji('🪙').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(cid('tab', 'sell', owner))
        .setLabel('목록으로').setStyle(ButtonStyle.Secondary),
    )],
  });
}

/** 바꾼다. 빼기와 MT 가 한 번의 쓰기다. */
async function exchange(id, owner, account) {
  const c = worthy(account).find((x) => x.id === id);
  if (!c) return ephemeral({ embeds: [fail('이미 없어요. 팔았거나 먹었을 수 있어요.')], components: [] });

  const saved = await apply({
    mt: { [owner]: c.mt },
    crafts: { [owner]: { remove: [c.id] } },
  });
  if (!saved.ok) return ephemeral({ embeds: [fail('저장하지 못했어요. 잠시 뒤에 다시 해 주세요.')], components: [] });
  forgetCrafts(owner);

  return ephemeral({
    embeds: [base({
      title: '🪙 바꿨어요',
      description: `${craftLabel(c)} → **+${c.mt} MT**`,
      color: MT_COLOR,
      footer: `가진 MT ${num(saved.accounts[owner]?.mt)}`,
    })],
    components: [tabRow(owner, null)],
  });
}

// ---------------------------------------------------------------- 명령

const data = new SlashCommandBuilder()
  .setName('mt상점')
  .setDescription('MT 로 칭호를 사고, 플래티넘·다이아몬드 요리·제작품을 MT 로 바꿉니다.');

async function read(id) {
  const { accounts } = await getAccounts([id]);
  return accounts[id];
}

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await interaction.editReply(buyPayload(interaction.user.id, await read(interaction.user.id)));
  } catch (err) {
    await interaction.editReply({ embeds: [fail(`계정을 읽지 못했어요. ${err.message}`)] });
  }
}

/** 누른 것 → 화면. `list` 는 탭이 생기기 전의 옛 버튼이다(바꾸기 목록). */
const SCREENS = {
  tab: (id, owner, account) => (id === 'sell' ? sellPayload : buyPayload)(owner, account),
  list: (id, owner, account) => sellPayload(owner, account),
  tpick: (id, owner, account, picked) => titleCard(picked, owner, account),
  tbuy: (id, owner, account) => buyTitle(id, owner, account),
  wear: (id, owner, account) => wear(id, owner, account),
  pick: (id, owner, account, picked) => craftCard(picked, owner, account),
  do: (id, owner, account) => exchange(id, owner, account),
};

async function component(interaction) {
  const [, what, id, ...rest] = interaction.customId.split(':');
  const owner = rest.join(':');
  if (interaction.user.id !== owner) {
    await interaction.reply({ embeds: [fail('자기 MT 상점 창에서만 누를 수 있어요.')], flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();

  let account;
  try {
    account = await read(owner);
  } catch (err) {
    await interaction.editReply({ embeds: [fail(`계정을 읽지 못했어요. ${err.message}`)], components: [] });
    return;
  }
  const screen = SCREENS[what] ?? SCREENS.tab;
  await interaction.editReply(await screen(id, owner, account, interaction.values?.[0]));
}

export default {
  data,
  execute,
  componentPrefix: PREFIX,
  component,
  // 상점이다. 쓰러져 있어도 들어와서 바꿀 수 있다 — `/상점` 과 같다.
  allowDead: true,
};
