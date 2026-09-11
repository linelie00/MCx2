/**
 * /상점 — 회복약과 재료를 사고, 주운 것을 판다
 *
 * 던전에서 주운 것이 값으로 바뀌는 자리이자, 체력을 되찾는 길이다.
 * 파는 물건은 **회복약 넷과 `shop: true` 인 재료**뿐 — 명부의 `forSale()` 은 값이 붙은
 * 것 전부라 그대로 쓰면 루비까지 판다.
 *
 * **사기는 진열대로 나눈다.** 셀렉트 한 칸에 25개가 한도인데 파는 것이 서른을 넘는다.
 * 진열대를 먼저 고르고 그 안에서 물건을 고른다. **팔기는 쪽을 넘긴다** — 주운 것이
 * 스물다섯 가지를 넘으면 싼 것이 목록에서 밀려나 팔 수가 없었다.
 *
 * **만든 것(`/요리`·`/제작`)은 탭이 따로다.** 명부에 없는 물건이라 개수가 아니라 하나씩
 * 판다. 값은 만들 때 정해졌다(재료값 × 등급 배수). 스톤(0골드)은 "버리기" 가 된다 —
 * 칸이 25개라 비울 길이 있어야 한다.
 *
 * **응답이 에페메랄이다.** 남의 지갑을 들여다볼 일이 아니고, 무엇보다 사는 버튼은
 * 계정을 고치므로 남이 누르면 안 된다. 그런데 에페메랄 메시지도 봇이 재시작하면
 * 그대로 남아 있고 핸들러는 상태가 없으므로, **customId 에 주인 id 를 넣고 검사한다.**
 * NPC id 에 콜론이 있어서(`npc:migel`) id 는 **맨 뒤**에 둔다.
 *
 * **쓰러져 있어도 들어올 수 있다**(`allowDead`). 안 그러면 파산한 채로 죽은 사람이
 * 부활의 영약을 살 길이 없어 영영 못 일어난다. 대신 그때는 부활의 영약만 보인다.
 *
 * **판에 앉아 있으면 못 쓴다.** 판이 도는 동안 골드는 인메모리 장부에만 있고 서버는
 * 판 시작 시점 잔액을 든다(`casino/tables.js`).
 */
import {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags,
} from 'discord.js';
import { getAccounts } from '../api.js';
import { apply } from '../casino/wallet.js';
import { base, fail, trunc, THEME_COLOR } from '../embeds.js';
import { seatedAt, seatedMessage } from '../casino/tables.js';
import { ITEMS, ITEM_BY_KEY, CATS } from '../casino/items.js';
import { isDead, forget } from '../casino/alive.js';
import { GRADE_BY_KEY } from '../casino/crafts.js';
import { forgetCrafts, forgetBag, craftLabel } from '../casino/bag.js';
import { width, padEndW, padStartW, clipW } from '../text.js';

export const PREFIX = 'shop';

/**
 * 상점에 놓인 물건. **회복약 넷뿐이다.**
 *
 * 명부의 `sell` 은 "플레이어가 팔 수 있는가" 라서 사는 목록과 다르다 — 회복약은
 * 살 수는 있어도 못 판다. 그래서 재고를 따로 적는다.
 */
export const STOCK = ['potionSmall', 'potionMedium', 'potionLarge', 'potionRevive'];

/**
 * 진열대. 회복약 한 칸, 그리고 재료의 갈래(`CATS`)마다 한 칸.
 *
 * 재료는 명부의 `shop: true` 로 고른다 — 새 재료를 들이면 여기는 안 고쳐도 된다.
 */
export const SHELVES = [
  { key: 'potion', label: '회복약', icon: '🍶', keys: STOCK },
  ...CATS.map((c) => ({
    ...c,
    keys: ITEMS.filter((i) => i.kind === '재료' && i.cat === c.key && i.shop).map((i) => i.key),
  })),
];

/** 상점에서 살 수 있는 것 전부. 거래 직전에 한 번 더 본다. */
const BUYABLE = new Set(SHELVES.flatMap((sh) => sh.keys));

const shelfOf = (key) => SHELVES.find((sh) => sh.key === key) ?? SHELVES[0];
/** 그 물건이 놓인 진열대. "목록으로" 가 제자리로 돌아가게 한다. */
const shelfFor = (itemKey) => (SHELVES.find((sh) => sh.keys.includes(itemKey)) ?? SHELVES[0]).key;

/** 쓰러져 있을 때 보이는 것. 이것만은 살 수 있어야 일어날 길이 생긴다. */
const REVIVE = 'potionRevive';

/** 한 번에 사고파는 개수 버튼. */
const STEPS = [1, 5, 10];

/** 팔기 한 쪽. 셀렉트 한 칸의 한도다. */
const PER_PAGE = 25;

const num = (n) => Number(n ?? 0).toLocaleString('ko-KR');
/** 먹으면 어떻게 되는지. `15~20` · `+5` · `−2` · `0` — 재료는 날로 먹으면 아픈 것도 있다. */
function healText(heal) {
  if (Array.isArray(heal)) return `${heal[0]}~${heal[1]}`;
  if (heal > 0) return `+${heal}`;
  if (heal < 0) return `−${-heal}`;
  return '0';
}

/** `shop:<사기팔기>:<무엇>:<키>:<개수>:<주인>` — 주인 id 는 콜론 때문에 맨 뒤. */
const cid = (side, what, key, n, owner) => [PREFIX, side, what, key, n, owner].join(':');

/** 팔 수 있는 것. 값이 붙어 있고 명부가 팔아도 된다고 한 것만. */
const sellable = (item) => item && item.sell && item.price > 0;

// ---------------------------------------------------------------- 화면

function table(rows) {
  const w = Math.max(...rows.map(([k]) => width(k)), 1) + 2;
  return ['```', ...rows.map(([k, v]) => padEndW(k, w) + padStartW(String(v), 12)), '```'].join('\n');
}

/** 그 진열대에서 살 수 있는 목록. 쓰러져 있으면 부활의 영약 하나뿐. */
const stockFor = (account, shelf) => (isDead(account) ? [REVIVE] : shelf.keys).map((k) => ITEM_BY_KEY[k]);

/** 팔 수 있는 목록 — 가진 것 중에서. 25칸이 셀렉트 한도라 비싼 것부터 자른다. */
const bagFor = (account) => Object.entries(account?.items ?? {})
  .map(([key, n]) => [ITEM_BY_KEY[key], n])
  .filter(([item, n]) => sellable(item) && n > 0)
  .sort(([a], [b]) => b.price - a.price || a.name.localeCompare(b.name, 'ko'));

function listPayload(side, owner, account, shelfKey = 'potion', page = 0) {
  const dead = isDead(account);
  const gold = Number(account?.gold ?? 0);

  if (side === 'made') return madePayload(owner, account);

  if (side === 'sell') {
    const bag = bagFor(account);
    const worth = bag.reduce((a, [item, n]) => a + item.price * n, 0);
    const pages = Math.max(1, Math.ceil(bag.length / PER_PAGE));
    const at = Math.min(Math.max(0, page), pages - 1);
    const shown = bag.slice(at * PER_PAGE, at * PER_PAGE + PER_PAGE);
    const embed = base({
      title: '💰 상점 — 팔기',
      description: bag.length
        ? table(shown.map(([item, n]) => [clipW(`${item.name} ×${n}`, 24), `${num(item.price)}골드`]))
          + `\n_다 팔면_ **${num(worth)}골드**`
        : '_팔 수 있는 게 없어요._\n던전에서 주운 잡화·재료를 여기서 값으로 바꿉니다.',
      color: THEME_COLOR,
      footer: `값은 명부에 적힌 그대로예요 — 흥정은 없습니다${pages > 1 ? ` · ${at + 1} / ${pages}쪽` : ''}`,
    }).addFields({ name: '가진 골드', value: `**${num(gold)}**`, inline: true });

    const rows = [];
    if (bag.length) {
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          // 쪽을 key 자리에 싣는다 — 쪽마다 셀렉트의 customId 가 달라진다.
          .setCustomId(cid('sell', 'pick', `p${at}`, 0, owner))
          .setPlaceholder('팔 것 고르기')
          .addOptions(shown.map(([item, n]) => ({
            label: trunc(item.name, 100),
            value: item.key,
            description: trunc(`${n}개 · 개당 ${num(item.price)}골드`, 100),
          }))),
      ));
    }
    if (pages > 1) {
      // 쪽 자리에 숫자를 쓴다. 탭 버튼은 `t` 라 안 부딪힌다(50035).
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(cid('sell', 'list', '-', at - 1, owner))
          .setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(at === 0),
        new ButtonBuilder().setCustomId(cid('sell', 'list', '-', at + 1, owner))
          .setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(at === pages - 1),
      ));
    }
    rows.push(sideRow('sell', owner));
    return { embeds: [embed], components: rows, flags: MessageFlags.Ephemeral };
  }

  // 쓰러져 있으면 진열대를 못 고른다 — 부활의 영약 칸에 묶어 둔다.
  const shelf = dead ? SHELVES[0] : shelfOf(shelfKey);
  const stock = stockFor(account, shelf);
  const embed = base({
    title: `${shelf.icon} 상점 — 사기 · ${shelf.label}`,
    description: table(stock.map((i) => [clipW(i.name, 24), `${num(i.price)}골드`]))
      + (dead
        ? '\n💀 _쓰러져 있어서 부활의 영약만 보여요._'
        : (shelf.key === 'potion' ? '\n_회복약만 효능이 적혀 있어요. 재료는 먹어 봐야 알아요._' : '')),
    color: THEME_COLOR,
    footer: '산 것은 /사용 으로 먹습니다',
  }).addFields({ name: '가진 골드', value: `**${num(gold)}**`, inline: true });

  const rows = [];
  if (!dead) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(cid('buy', 'shelf', '-', 0, owner))
        .setPlaceholder('진열대 고르기')
        .addOptions(SHELVES.map((sh) => ({
          label: sh.label,
          value: sh.key,
          emoji: sh.icon,
          description: `${sh.keys.length}가지`,
          default: sh.key === shelf.key,
        }))),
    ));
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        // 진열대를 customId 에 싣는다. 고른 물건의 카드에서 "목록으로" 가 여기로 돌아온다.
        .setCustomId(cid('buy', 'pick', shelf.key, 0, owner))
        .setPlaceholder('살 것 고르기')
        .addOptions(stock.map((i) => ({
          label: trunc(i.name, 100),
          value: i.key,
          // 회복약에만 효능을 적는다(`/사용` 과 같은 원칙). 재료는 먹어 봐야 안다.
          description: trunc(i.kind === '소비' ? `${num(i.price)}골드 · 먹으면 ${healText(i.heal)}` : `${num(i.price)}골드`, 100),
        }))),
    ),
    sideRow('buy', owner),
  );

  return { embeds: [embed], components: rows, flags: MessageFlags.Ephemeral };
}

/**
 * 사기/팔기 탭.
 *
 * **쪽 자리에 개수 0 이 아니라 `t` 를 쓴다** — 개수 버튼이 만드는 customId 와 부딪히면
 * 디스코드가 메시지를 통째로 거절한다(50035).
 */
function sideRow(side, owner) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(cid('buy', 'list', '-', 't', owner))
      .setLabel('사기').setEmoji('🍶')
      .setStyle(side === 'buy' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(side === 'buy'),
    new ButtonBuilder().setCustomId(cid('sell', 'list', '-', 't', owner))
      .setLabel('팔기').setEmoji('💰')
      .setStyle(side === 'sell' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(side === 'sell'),
    new ButtonBuilder().setCustomId(cid('made', 'list', '-', 't', owner))
      .setLabel('요리 · 제작').setEmoji('🍽️')
      .setStyle(side === 'made' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(side === 'made'),
  );
}

// ---------------------------------------------------------------- 만든 것

const byWorth = (a, b) => b.price - a.price || a.name.localeCompare(b.name, 'ko');

/** 만든 것 목록. 25개가 칸의 한도라 한 쪽에 다 들어간다(`MAX_CRAFTS`). */
function madePayload(owner, account) {
  const gold = Number(account?.gold ?? 0);
  const crafts = [...(account?.crafts ?? [])].sort(byWorth);
  const worth = crafts.reduce((a, c) => a + c.price, 0);

  const embed = base({
    title: '🍽️ 상점 — 요리 · 제작',
    description: crafts.length
      ? table(crafts.map((c) => [clipW(craftLabel(c), 26), `${num(c.price)}골드`]))
        + `\n_다 팔면_ **${num(worth)}골드**`
        + (crafts.some((c) => c.mt) ? '\n_💠 💎 는 `/mt상점` 에서 MT 로도 바꿀 수 있어요._' : '')
      : '_만든 게 없어요._\n`/요리` · `/제작` 으로 만든 것을 여기서 팝니다.',
    color: THEME_COLOR,
    footer: `${crafts.length} / 25칸 · 값은 만들 때 정해졌어요(재료값 × 등급)`,
  }).addFields({ name: '가진 골드', value: `**${num(gold)}**`, inline: true });

  const rows = [];
  if (crafts.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(cid('made', 'pick', '-', 0, owner))
        .setPlaceholder('팔 것 고르기')
        .addOptions(crafts.map((c) => ({
          label: trunc(c.name, 100),
          value: c.id,
          emoji: GRADE_BY_KEY[c.grade]?.emoji,
          description: trunc(`${GRADE_BY_KEY[c.grade]?.label ?? ''} · ${c.kind} · ${num(c.price)}골드`, 100),
        }))),
    ));
  }
  rows.push(sideRow('made', owner));
  return { embeds: [embed], components: rows, flags: MessageFlags.Ephemeral };
}

function madeCard(id, owner, account) {
  const c = (account?.crafts ?? []).find((x) => x.id === id);
  if (!c) return madePayload(owner, account);
  const g = GRADE_BY_KEY[c.grade];
  const lines = [c.desc ? `_${c.desc}_` : '', ''];
  lines.push(`${g?.emoji ?? ''} **${g?.label ?? c.grade}** ${c.kind}`
    // 먹으면 얼마나 차는지는 **먹을 때까지 비밀이다**(`/요리` 머리말).
    + (c.kind === '요리' ? ' · 먹으면 **❔**' : '')
    + ` · 팔면 **${num(c.price)}골드**`);
  if (c.mt) lines.push(`_\`/mt상점\` 에서 팔면 **${c.mt} MT** 예요 — 골드와 MT 중 한쪽만 받아요._`);

  return {
    embeds: [base({ title: `🍽️ ${c.name}`, description: lines.join('\n'), color: g?.color ?? THEME_COLOR })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cid('made', 'do', c.id, 1, owner))
        .setLabel(c.price ? `팔기 · ${num(c.price)}골드` : '버리기')
        .setStyle(c.price ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(cid('made', 'list', '-', 't', owner))
        .setLabel('목록으로').setStyle(ButtonStyle.Secondary),
    )],
    flags: MessageFlags.Ephemeral,
  };
}

/** 만든 것 하나를 판다. 빼기와 골드가 한 번의 쓰기다. */
async function sellCraft(id, owner, account) {
  const c = (account?.crafts ?? []).find((x) => x.id === id);
  if (!c) return { embeds: [fail('이미 없어요. 먹었거나 팔았을 수 있어요.')], components: [], flags: MessageFlags.Ephemeral };

  const saved = await apply({
    deltas: { [owner]: c.price },
    crafts: { [owner]: { remove: [c.id] } },
  });
  if (!saved.ok) return { embeds: [fail('저장하지 못했어요. 잠시 뒤에 다시 해 주세요.')], components: [], flags: MessageFlags.Ephemeral };
  forget(owner);
  forgetCrafts(owner);

  return {
    embeds: [base({
      title: c.price ? '💰 팔았어요' : '🗑️ 버렸어요',
      description: `${craftLabel(c)}${c.price ? ` · +**${num(c.price)}골드**` : ''}`,
      color: THEME_COLOR,
      footer: `가진 골드 ${num(saved.accounts[owner]?.gold)} · 만든 것 ${saved.accounts[owner]?.crafts?.length ?? 0} / 25`,
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cid('made', 'list', '-', 't', owner))
        .setLabel('목록으로').setEmoji('🍽️').setStyle(ButtonStyle.Secondary),
    )],
    flags: MessageFlags.Ephemeral,
  };
}

function cardPayload(side, key, owner, account) {
  const item = ITEM_BY_KEY[key];
  if (!item) return listPayload(side, owner, account);

  const gold = Number(account?.gold ?? 0);
  const have = Number(account?.items?.[key] ?? 0);
  const most = side === 'buy' ? Math.floor(gold / item.price) : have;

  const lines = [`_${item.desc}_`, ''];
  lines.push(side === 'buy'
    ? `개당 **${num(item.price)}골드**${item.kind === '소비' ? ` · 먹으면 **${healText(item.heal)}**` : ''}`
    : `개당 **${num(item.price)}골드** · 가진 것 **${num(have)}개**`);
  if (!most) {
    lines.push('', side === 'buy' ? '_골드가 모자라요._' : '_팔 게 없어요._');
  }

  const embed = base({
    title: `${side === 'buy' ? '🍶' : '💰'} ${item.name}`,
    description: lines.join('\n'),
    color: THEME_COLOR,
    footer: `가진 골드 ${num(gold)} · 최대 ${num(most)}개까지`,
  });

  const steps = new ActionRowBuilder().addComponents(
    ...STEPS.map((n) => new ButtonBuilder()
      .setCustomId(cid(side, 'do', key, n, owner))
      .setLabel(`${n}개`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(n > most)),
    new ButtonBuilder().setCustomId(cid(side, 'list', side === 'buy' ? shelfFor(key) : '-', 't', owner))
      .setLabel('목록으로').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [steps], flags: MessageFlags.Ephemeral };
}

// ---------------------------------------------------------------- 거래

/** 실제로 사고판다. `{ payload }` 를 돌려준다. */
async function trade(side, key, count, owner, account) {
  const item = ITEM_BY_KEY[key];
  if (!item) return { embeds: [fail('그런 물건이 없어요.')], flags: MessageFlags.Ephemeral };

  const dead = isDead(account);
  if (side === 'buy') {
    if (!BUYABLE.has(key)) return { embeds: [fail(`**${item.name}** 은(는) 상점에 없어요.`)], flags: MessageFlags.Ephemeral };
    if (dead && key !== REVIVE) {
      return {
        embeds: [fail('쓰러져 있어서 부활의 영약만 살 수 있어요.')],
        flags: MessageFlags.Ephemeral,
      };
    }
    if (Number(account.gold) < item.price * count) {
      return { embeds: [fail(`골드가 모자라요. **${num(item.price * count)}골드**가 필요해요.`)], flags: MessageFlags.Ephemeral };
    }
  } else {
    if (!sellable(item)) return { embeds: [fail(`**${item.name}** 은(는) 팔 수 없어요.`)], flags: MessageFlags.Ephemeral };
    if (Number(account.items?.[key] ?? 0) < count) {
      return { embeds: [fail(`**${item.name}** 이(가) 그만큼 없어요.`)], flags: MessageFlags.Ephemeral };
    }
  }

  const amount = item.price * count;
  // 골드와 아이템이 **한 번의 쓰기로** 같이 움직인다. 나누면 반쪽만 저장되는 상태가 생긴다.
  const saved = await apply({
    deltas: { [owner]: side === 'buy' ? -amount : amount },
    items: { [owner]: { [key]: side === 'buy' ? count : -count } },
  });
  if (!saved.ok) {
    return { embeds: [fail('저장하지 못했어요. 잠시 뒤에 다시 해 주세요.')], flags: MessageFlags.Ephemeral };
  }
  forget(owner);
  forgetBag(owner);          // /요리 재료 자동완성이 산 것을 바로 보게

  const after = saved.accounts[owner];
  const embed = base({
    title: `${side === 'buy' ? '🍶 샀어요' : '💰 팔았어요'}`,
    description: `**${item.name}** ×${count} · ${side === 'buy' ? '−' : '+'}**${num(amount)}골드**`
      + `\n_${item.desc}_`,
    color: THEME_COLOR,
    footer: `가진 골드 ${num(after?.gold)} · ${item.name} ${num(after?.items?.[key] ?? 0)}개`,
  });
  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cid(side, 'list', side === 'buy' ? shelfFor(key) : '-', 't', owner))
        .setLabel('목록으로').setEmoji(side === 'buy' ? '🍶' : '💰').setStyle(ButtonStyle.Secondary),
    )],
    flags: MessageFlags.Ephemeral,
  };
}

// ---------------------------------------------------------------- 명령

const data = new SlashCommandBuilder()
  .setName('상점')
  .setDescription('회복약과 재료를 사고, 주운 것을 팝니다.')
  .addSubcommand((s) => s.setName('사기').setDescription('회복약과 재료를 삽니다'))
  .addSubcommand((s) => s.setName('팔기').setDescription('가진 잡화·재료를 팝니다'))
  .addSubcommand((s) => s.setName('만든것').setDescription('요리·제작으로 만든 것을 팝니다'));

/** 계정을 읽고 앉아 있는지 본다. 막혔으면 `null`. */
async function open(interaction, id) {
  const at = seatedAt(id);
  if (at) {
    await interaction.editReply({ embeds: [fail(seatedMessage('그쪽', at))] });
    return null;
  }
  try {
    const { accounts } = await getAccounts([id]);
    return accounts[id];
  } catch (err) {
    await interaction.editReply({ embeds: [fail(`계정을 읽지 못했어요. ${err.message}`)] });
    return null;
  }
}

async function execute(interaction) {
  const side = { 팔기: 'sell', 만든것: 'made' }[interaction.options.getSubcommand()] ?? 'buy';
  const id = interaction.user.id;

  // 계정을 읽는다 — HTTP 라 먼저 응답을 잡는다. 남이 볼 것이 아니라 에페메랄로.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const account = await open(interaction, id);
  if (!account) return;

  await interaction.editReply(listPayload(side, id, account));
}

async function component(interaction) {
  const [, side, what, key, n, ...rest] = interaction.customId.split(':');
  const owner = rest.join(':');

  // **주인만 누른다.** 조회 화면이 아니라 계정을 고치는 자리다. 에페메랄이라 남이 볼
  // 일이 잘 없지만, 봇이 재시작해도 옛 버튼이 살아 있으므로 검사는 있어야 한다.
  if (interaction.user.id !== owner) {
    await interaction.reply({
      embeds: [fail('자기 상점 창에서만 누를 수 있어요.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();
  const at = seatedAt(owner);
  if (at) {
    await interaction.editReply({ embeds: [fail(seatedMessage('그쪽', at))], components: [] });
    return;
  }

  let account;
  try {
    ({ accounts: { [owner]: account } } = await getAccounts([owner]));
  } catch (err) {
    await interaction.editReply({ embeds: [fail(`계정을 읽지 못했어요. ${err.message}`)], components: [] });
    return;
  }

  if (side === 'made') {
    if (what === 'pick') { await interaction.editReply(madeCard(interaction.values?.[0], owner, account)); return; }
    if (what === 'do') { await interaction.editReply(await sellCraft(key, owner, account)); return; }
    await interaction.editReply(madePayload(owner, account));
    return;
  }
  if (what === 'shelf') {
    await interaction.editReply(listPayload('buy', owner, account, interaction.values?.[0]));
    return;
  }
  if (what === 'pick') {
    await interaction.editReply(cardPayload(side, interaction.values?.[0], owner, account));
    return;
  }
  if (what === 'do') {
    await interaction.editReply(await trade(side, key, Number(n) || 1, owner, account));
    return;
  }
  // 목록 버튼은 진열대를 key 자리에, 팔기의 쪽을 n 자리에 싣고 온다(`t` 면 첫 쪽).
  await interaction.editReply(listPayload(side, owner, account, key === '-' ? undefined : key, Number(n) || 0));
}

export default {
  data,
  execute,
  componentPrefix: PREFIX,
  component,
  // 파산한 채로 죽으면 부활의 영약을 살 길이 없어 영영 못 일어난다. 열어 둔다.
  allowDead: true,
};
