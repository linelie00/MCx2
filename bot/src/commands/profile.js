/**
 * /프로필 — 카지노 계정 카드
 *
 * 계정을 사람이 볼 수 있는 유일한 창이다. 대상을 안 주면 자기 것.
 *
 * **탭이 셋이다** — 카드 · 전적 · 아이템. 한 화면에 다 넣으면 임베드가 스크롤이 되고,
 * 무엇보다 아이템은 늘어나는 목록이라 언젠가 혼자 화면을 다 먹는다. 버튼으로 나눈다.
 *
 * 대상을 옵션 둘로 받는다 — 사람은 유저 옵션, 미겔·마티암은 선택지. 하나로 못 합친다:
 * 길드 멤버를 자동완성으로 뒤지려면 GuildMembers 인텐트가 필요한데 봇은 Guilds 만 켠다.
 *
 * 응답은 **공개**다. 서로 칩을 견주는 재미가 이 명령의 절반이다. 그래서 탭 버튼도
 * 아무나 누를 수 있게 뒀다 — 판을 여는 버튼과 달리 **아무것도 안 바꾸는 조회**라,
 * 남이 눌렀다고 거절 메시지를 띄울 이유가 없다.
 *
 * customId 에 대상과 탭이 다 들어 있어서 **봇을 재시작해도 옛 버튼이 그대로 동작한다.**
 * 게임 판과 달리 이 카드는 들고 있는 상태가 없다.
 */
import {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  AttachmentBuilder,
} from 'discord.js';
import { getAccounts } from '../api.js';
import { base, fail, THEME_COLOR } from '../embeds.js';
import { NPC_CHOICES, resolveTarget, displayOf } from '../casino/accounts.js';
import { seatedAt } from '../casino/tables.js';
import { CATEGORIES, CATEGORY_LABEL } from '../casino/poker.js';
import { width, padEndW, padStartW, clipW } from '../text.js';

export const PREFIX = 'prof';

const data = new SlashCommandBuilder()
  .setName('프로필')
  .setDescription('칭호와 칩, 전적, 아이템을 봅니다.')
  .addUserOption((o) => o.setName('사람').setDescription('기본값은 본인'))
  .addStringOption((o) => o.setName('캐릭터').setDescription('미겔·마티암의 지갑')
    .addChoices(...NPC_CHOICES));

// ---------------------------------------------------------------- 조각

const TABS = [
  { key: 'card', label: '카드' },
  { key: 'record', label: '전적' },
  { key: 'items', label: '아이템' },
];

/** 한 페이지에 보여 줄 아이템 수. 임베드 한 칸에 넉넉히 들어가는 양. */
const PER_PAGE = 12;

const num = (n) => Number(n ?? 0).toLocaleString('ko-KR');

/**
 * 텍스트 게이지. `▰▰▰▰▱▱▱ 57%`
 *
 * 이미지를 안 쓰기로 한 이상 "얼마나 찼는지" 를 보여줄 방법이 이것뿐이다. 숫자만
 * 적어 두면 카드가 표처럼 보이는데, 막대가 하나 있으면 그것만으로 게임 화면이 된다.
 */
function gauge(done, total, cells = 8) {
  if (!total) return `\`${'▱'.repeat(cells)}\` _아직_`;
  const filled = Math.max(0, Math.min(cells, Math.round((done / total) * cells)));
  return `\`${'▰'.repeat(filled)}${'▱'.repeat(cells - filled)}\` ${Math.round((done / total) * 100)}%`;
}

/** 최고 족보 숫자 → 이름. 서버는 큰 쪽만 남기려고 숫자로 들고 있다. */
function bestHandLabel(n) {
  if (!n) return null;
  return CATEGORY_LABEL[CATEGORIES[CATEGORIES.length - n]] ?? null;
}

/**
 * 이름과 값을 줄 맞춰 찍는다. 숫자가 오른쪽으로 붙어야 표처럼 읽힌다.
 *
 * 폭은 글자 수가 아니라 **칸 수**로 잰다. 한글은 두 칸이라 length 로 맞추면 어긋난다.
 */
function table(rows) {
  const w = Math.max(...rows.map(([k]) => width(k))) + 2;
  return ['```', ...rows.map(([k, v]) => padEndW(k, w) + padStartW(String(v), 12)), '```'].join('\n');
}

// ---------------------------------------------------------------- 탭

function cardTab(account, seated) {
  const s = account.stats ?? {};

  const fields = [
    { name: '💰 칩', value: `**${num(account.chips)}**`, inline: true },
    { name: '📈 최고', value: `**${num(s.peak ?? account.chips)}**`, inline: true },
    {
      name: '🎲 전적',
      value: s.hands ? `**${num(s.won)}** / ${num(s.hands)}핸드` : '_아직 없어요_',
      inline: true,
    },
  ];

  const lines = [];
  if (s.hands) {
    lines.push(`**승률** ${gauge(s.won ?? 0, s.hands)}`, '');
    const net = (s.earned ?? 0) - (s.lost ?? 0);
    lines.push(`딴 것 **+${num(s.earned)}** · 잃은 것 **−${num(s.lost)}** · 합쳐 **${net >= 0 ? '+' : '−'}${num(Math.abs(net))}**`);
  } else {
    lines.push('_아직 한 판도 안 했어요._ `/블랙잭` 이나 `/홀덤` 으로 시작해 보세요.');
  }

  if (seated) {
    lines.push('', `_지금 <#${seated.channelId}> 의 ${seated.game} 판에 앉아 있어요 —_`
      + ' _판이 끝나야 이 숫자에 반영돼요._');
  }

  return { fields, description: lines.join('\n') };
}

function recordTab(account) {
  const s = account.stats ?? {};
  if (!s.hands) {
    return { fields: [], description: '_아직 한 판도 안 했어요._' };
  }

  const rows = [];
  const game = (label, hands, won) => {
    if (!hands) return;
    rows.push([label, `${num(won ?? 0)} / ${num(hands)}`]);
  };
  game('홀덤', s.holdemHands, s.holdemWon);
  game('블랙잭', s.blackjackHands, s.blackjackWon);
  rows.push(['전체', `${num(s.won)} / ${num(s.hands)}`]);

  const lines = [table(rows), ''];

  const marks = [];
  if (s.bestPot) marks.push(`🏆 **최대 팟** ${num(s.bestPot)}`);
  if (bestHandLabel(s.bestHand)) marks.push(`🃏 **최고 족보** ${bestHandLabel(s.bestHand)}`);
  if (s.bestBet) marks.push(`🎯 **최대 베팅** ${num(s.bestBet)}`);
  if (s.blackjacks) marks.push(`✨ **블랙잭** ${num(s.blackjacks)}번`);
  if (marks.length) lines.push(...marks);

  return {
    fields: [
      { name: '홀덤', value: s.holdemHands ? `${num(s.holdemHands)}핸드` : '_없음_', inline: true },
      { name: '블랙잭', value: s.blackjackHands ? `${num(s.blackjackHands)}핸드` : '_없음_', inline: true },
      { name: '승률', value: `${Math.round((s.won / s.hands) * 100)}%`, inline: true },
    ],
    description: lines.join('\n'),
  };
}

function itemsTab(account, page) {
  const owned = Object.entries(account.items ?? {}).filter(([, n]) => n > 0).sort();
  if (!owned.length) {
    return {
      fields: [],
      description: '_아직 아무것도 없어요._\n`/상점` 과 `/요리` 가 생기면 여기가 채워집니다.',
      pages: 1,
    };
  }

  const pages = Math.max(1, Math.ceil(owned.length / PER_PAGE));
  const at = Math.min(Math.max(0, page), pages - 1);
  const slice = owned.slice(at * PER_PAGE, (at + 1) * PER_PAGE);
  const total = owned.reduce((a, [, n]) => a + n, 0);

  return {
    fields: [
      { name: '종류', value: `**${num(owned.length)}**`, inline: true },
      { name: '개수', value: `**${num(total)}**`, inline: true },
      { name: '쪽', value: `${at + 1} / ${pages}`, inline: true },
    ],
    description: table(slice.map(([id, n]) => [clipW(id, 20), `×${num(n)}`])),
    pages,
    page: at,
  };
}

// ---------------------------------------------------------------- 카드

function cardFor(who, account, tab, page) {
  const seated = seatedAt(who.id);
  const body = tab === 'record' ? recordTab(account)
    : (tab === 'items' ? itemsTab(account, page) : cardTab(account, seated));

  const embed = base({
    title: who.name,
    description: body.description,
    color: who.color ?? THEME_COLOR,
    footer: who.npc
      ? '/급여 로 일당을 받습니다 (자동으로 늘지 않아요)'
      : '/출첵 으로 하루 한 번 받을 수 있어요',
  })
    .setAuthor({ name: account.title ? `〈 ${account.title} 〉` : '칭호 없음' })
    .addFields(body.fields);

  // **초상화는 오른쪽 위다.** 임베드에서 thumbnail 은 자리를 못 옮긴다 — 왼쪽에
  // 걸 수 있는 곳은 author 아이콘뿐인데 그건 24px 라 얼굴이 안 보인다. 크기를 골랐다.
  if (who.avatar) embed.setThumbnail(who.avatar);

  return { embed, pages: body.pages ?? 1, page: body.page ?? 0 };
}

/**
 * `prof:<탭>:<쪽>:<대상 id>`
 *
 * 라우터가 `customId.split(':')[0]` 로 찾으므로 구분자는 콜론이어야 한다(index.js).
 * 그런데 NPC id 자체에 콜론이 들어 있어서(`npc:migel`) **id 를 맨 뒤에** 두고
 * 읽을 때 나머지를 다시 이어 붙인다.
 */
const cid = (id, tab, page) => [PREFIX, tab, page, id].join(':');

function rows(who, tab, page, pages) {
  const tabs = new ActionRowBuilder().addComponents(...TABS.map((t) => new ButtonBuilder()
    .setCustomId(cid(who.id, t.key, 0))
    .setLabel(t.label)
    .setStyle(t.key === tab ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(t.key === tab)));

  if (tab !== 'items' || pages <= 1) return [tabs];

  return [tabs, new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(cid(who.id, 'items', page - 1))
      .setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(cid(who.id, 'items', page + 1))
      .setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
  )];
}

/**
 * 카드 한 장을 통째로. 명령과 버튼이 같은 것을 쓴다.
 *
 * 미겔·마티암 초상화는 로컬 파일이라 **매번 같이 올린다.** 탭을 넘길 때도 다시
 * 붙여야 한다 — `files` 를 빼고 보내면 디스코드가 첨부를 지우고 그림이 사라진다.
 */
async function payloadFor(who, tab, page) {
  const { accounts } = await getAccounts([who.id]);
  const account = accounts[who.id];
  const card = cardFor(who, account, tab, page);
  return {
    embeds: [card.embed],
    components: rows(who, tab, card.page, card.pages),
    files: who.avatarFile
      ? [new AttachmentBuilder(who.avatarFile.file, { name: who.avatarFile.name })]
      : [],
  };
}

// ---------------------------------------------------------------- 명령

async function execute(interaction) {
  const who = resolveTarget(interaction);
  if (who.error) {
    await interaction.reply({ embeds: [fail(who.error)], flags: MessageFlags.Ephemeral });
    return;
  }

  // 계정 조회는 HTTP 다. 3초 시한을 먼저 잡아 둔다.
  await interaction.deferReply();
  try {
    await interaction.editReply(await payloadFor(who, 'card', 0));
  } catch (err) {
    await interaction.editReply({ embeds: [fail(`계정을 읽지 못했어요. ${err.message}`)] });
  }
}

/**
 * 탭 버튼. **누구든 누를 수 있다** — 아무것도 안 바꾸는 조회이기 때문이다.
 *
 * customId 에 대상 id 가 들어 있어서 봇이 재시작해도 그대로 동작한다. 대신 이름은
 * 다시 만들어야 하는데(id 만으로는 표시 이름을 모른다), 누른 사람이 그 대상이면
 * 그 인터랙션에서 이름을 가져올 수 있고 아니면 계정 id 로만 판단한다.
 */
async function component(interaction) {
  const [, tab, page, ...rest] = interaction.customId.split(':');
  const id = rest.join(':');

  const self = interaction.user.id === id;
  const who = displayOf(id, self
    ? { user: interaction.user, member: interaction.member }
    : {});

  await interaction.deferUpdate();
  try {
    await interaction.editReply(await payloadFor(who, tab, Number(page) || 0));
  } catch (err) {
    await interaction.followUp({
      embeds: [fail(`계정을 읽지 못했어요. ${err.message}`)],
      flags: MessageFlags.Ephemeral,
    });
  }
}

export default { data, execute, componentPrefix: PREFIX, component };
