/**
 * /프로필 — 카지노 계정 카드
 *
 * 계정을 사람이 볼 수 있는 유일한 창이다. 대상을 안 주면 자기 것.
 *
 * **탭이 넷이다** — 카드 · 전적 · 칭호 · 아이템. 한 화면에 다 넣으면 임베드가 스크롤이
 * 되고, 무엇보다 칭호와 아이템은 늘어나는 목록이라 언젠가 혼자 화면을 다 먹는다.
 *
 * **칭호는 저장돼 있지 않다.** 전적에서 계산해 낸다(casino/titles.js) — 저장하는 것은
 * 지금 달고 있는 것 하나뿐이고, 그것도 이름이 아니라 키다. 꾸밈(별·등급 색)은
 * casino/titleCard.js 가 판의 획득 알림과 함께 쓴다.
 *
 * 대상을 옵션 둘로 받는다 — 사람은 유저 옵션, 미겔·마티암은 선택지. 하나로 못 합친다:
 * 길드 멤버를 자동완성으로 뒤지려면 GuildMembers 인텐트가 필요한데 봇은 Guilds 만 켠다.
 *
 * 응답은 **공개**다. 서로 골드를 견주는 재미가 이 명령의 절반이다. 그래서 탭 버튼도
 * 아무나 누를 수 있게 뒀다 — 판을 여는 버튼과 달리 **아무것도 안 바꾸는 조회**라,
 * 남이 눌렀다고 거절 메시지를 띄울 이유가 없다.
 *
 * customId 에 대상과 탭이 다 들어 있어서 **봇을 재시작해도 옛 버튼이 그대로 동작한다.**
 * 게임 판과 달리 이 카드는 들고 있는 상태가 없다.
 *
 * **임베드가 아니라 새 메시지 형식(Components V2)이다** — 버튼을 카드 안에 넣으려고
 * (cardFor 머리말). 탭마다 `{ text, below, pages, page, held }` 를 내고, 카드가 그걸 쌓는다.
 */
import {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  AttachmentBuilder, StringSelectMenuBuilder, ContainerBuilder, SectionBuilder,
  TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize,
} from 'discord.js';
import { getAccounts, setTitle } from '../api.js';
import { fail, gauge, THEME_COLOR } from '../embeds.js';
import { NPC_CHOICES, resolveTarget, displayOf } from '../casino/accounts.js';
import { seatedAt } from '../casino/tables.js';
import { CATEGORIES, CATEGORY_LABEL } from '../casino/poker.js';
import {
  TITLES, GROUPS, earned as earnedTitles, TITLE_BY_KEY, TOTAL as TITLE_TOTAL,
} from '../casino/titles.js';
import { stamp, stampMd } from '../casino/titleCard.js';
import { ITEM_BY_KEY, MAX_HP } from '../casino/items.js';
import { GRADE_BY_KEY } from '../casino/crafts.js';
import { craftLabel } from '../casino/bag.js';
import { width, padEndW, padStartW, clipW } from '../text.js';

export const PREFIX = 'prof';

const data = new SlashCommandBuilder()
  .setName('프로필')
  .setDescription('칭호와 골드·MT·체력, 전적, 아이템을 봅니다.')
  .addUserOption((o) => o.setName('사람').setDescription('기본값은 본인'))
  .addStringOption((o) => o.setName('캐릭터').setDescription('미겔·마티암의 지갑')
    .addChoices(...NPC_CHOICES));

// ---------------------------------------------------------------- 조각

const TABS = [
  { key: 'card', label: '카드' },
  { key: 'record', label: '전적' },
  { key: 'titles', label: '칭호' },
  { key: 'items', label: '아이템' },
];

/**
 * 셀렉트 한 벌에 넣을 수 있는 칭호 수.
 *
 * 디스코드가 선택지를 25개로 막는데, 한 칸은 '벗기' 가 쓴다. 칭호가 그보다
 * 많아지면 쪽을 넘겨 고른다.
 */
const TITLES_PER_PAGE = 24;

/**
 * '벗기' 칸의 값. **빈 문자열을 못 쓴다** — 디스코드가 셀렉트 값을 한 글자 이상으로
 * 막아서, `value: ''` 로 두면 카드를 만드는 자리에서 통째로 터진다.
 */
const NO_TITLE = '-';

/**
 * 한 쪽에 보여 줄 아이템 수. 임베드 한 칸에 넉넉히 들어가는 양.
 * 12 였는데 열다섯 가지만 모여도 쪽을 넘겨야 했다 — 조금 늘렸다.
 */
const PER_PAGE = 16;

const num = (n) => Number(n ?? 0).toLocaleString('ko-KR');

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

/**
 * 한 줄 요약. 예전 임베드의 "칸(field)" 셋을 한 줄로 늘어놓은 것이다 — 새 형식에는 칸이 없다.
 * `💰 골드 **1,250**　🪙 MT **3**`
 */
const facts = (pairs) => pairs.filter(Boolean).map(([k, v]) => `${k} ${v}`).join('　');


function cardTab(account, seated) {
  const s = account.stats ?? {};

  // 재화 둘과 최고를 한 줄에, 전적은 그 아래. 예전 임베드의 칸 넷을 두 줄로 옮겼다.
  const lines = [
    facts([['💰 골드', `**${num(account.gold)}**`], ['🪙 MT', `**${num(account.mt)}**`], ['📈 최고', `**${num(s.peak ?? account.gold)}**`]]),
    facts([['🎲 전적', s.hands ? `**${num(s.won)}** / ${num(s.hands)}핸드` : '_아직 없어요_']]),
    '',
  ];
  // 체력은 칸이 아니라 막대다. 숫자만으로는 얼마나 남았는지가 안 읽힌다.
  const hp = Number(account.hp ?? MAX_HP);
  lines.push(hp > 0
    ? `**체력** ${gauge(hp, MAX_HP, { percent: false })} **${hp}** / ${MAX_HP}`
    : '💀 **쓰러졌어요.** 부활의 영약을 마시면 일어납니다.');

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

  return { text: lines.join('\n') };
}

function recordTab(account) {
  const s = account.stats ?? {};
  if (!s.hands) {
    return { text: '_아직 한 판도 안 했어요._' };
  }

  const rows = [];
  const game = (label, hands, won) => {
    if (!hands) return;
    rows.push([label, `${num(won ?? 0)} / ${num(hands)}`]);
  };
  game('홀덤', s.holdemHands, s.holdemWon);
  game('블랙잭', s.blackjackHands, s.blackjackWon);
  rows.push(['전체', `${num(s.won)} / ${num(s.hands)}`]);

  const lines = [
    facts([
      ['홀덤', s.holdemHands ? `**${num(s.holdemHands)}**핸드` : '_없음_'],
      ['블랙잭', s.blackjackHands ? `**${num(s.blackjackHands)}**핸드` : '_없음_'],
      ['승률', `**${Math.round((s.won / s.hands) * 100)}%**`],
    ]),
    table(rows),
  ];

  const marks = [];
  if (s.bestPot) marks.push(`🏆 **최대 팟** ${num(s.bestPot)}`);
  if (bestHandLabel(s.bestHand)) marks.push(`🃏 **최고 족보** ${bestHandLabel(s.bestHand)}`);
  if (s.bestBet) marks.push(`🎯 **최대 베팅** ${num(s.bestBet)}`);
  if (s.blackjacks) marks.push(`✨ **블랙잭** ${num(s.blackjacks)}번`);
  if (marks.length) lines.push(...marks);

  return { text: lines.join('\n') };
}

/**
 * 칭호 도감. **가진 것과 못 가진 것을 함께** 보여 준다.
 *
 * 가진 것만 늘어놓으면 "뭘 더 모아야 하나" 를 알 길이 없다. 그렇다고 못 가진 것의
 * 이름과 조건을 다 까 두면 모으는 맛이 없어서, 잠긴 자리는 `???` 로만 둔다 —
 * 몇 개가 남았는지는 보이고 무엇인지는 안 보인다.
 *
 * 잠긴 것은 한 줄에 몰아 찍는다. `🔒 ??? ??? ???` — 줄마다 물음표를 늘어놓으면
 * 아직 아무것도 없는 사람의 화면이 물음표 서른 줄이 된다.
 */
function titlesTab(account, page, npc) {
  const held = earnedTitles(account, { npc });
  const has = new Set(held.map((t) => t.key));

  // 셀렉트만 쪽을 넘긴다. 목록은 서른넷이 다 들어가지만 셀렉트는 25칸이 한도다.
  const pages = Math.max(1, Math.ceil(held.length / TITLES_PER_PAGE));
  const at = Math.min(Math.max(0, page), pages - 1);
  const slice = held.slice(at * TITLES_PER_PAGE, (at + 1) * TITLES_PER_PAGE);

  const worn = account.title ? TITLE_BY_KEY[account.title] : null;
  const lines = [
    `**수집** ${gauge(held.length, TITLE_TOTAL, { percent: false })} **${held.length}** / ${TITLE_TOTAL}`,
    `**달고 있는 것** ${worn ? `**${stamp(worn)}**` : '없음'}`,
  ];

  let folded = false;
  for (const group of GROUPS) {
    const all = TITLES.filter((t) => t.group === group && (t.npc !== false || !npc));
    if (!all.length) continue;
    const mine = all.filter((t) => has.has(t.key));

    const head = `**■ ${group}**　\`${mine.length}/${all.length}\``;

    // 하나도 없는 갈래는 **제목 한 줄로 접는다.** 자물쇠를 줄줄이 놓아 봐야 알 것이
    // 없는데, 아직 아무것도 안 모은 사람은 그 줄이 여덟이라 화면을 통째로 먹는다.
    // **연달아 접힌 것끼리는 빈 줄 없이 붙인다** — 갈래가 요리·제작으로 늘며 빈 줄만
    // 여덟이 되어 한 화면을 넘겼다.
    if (!mine.length) { lines.push(...(folded ? [] : ['']), `${head}　🔒`); folded = true; continue; }
    folded = false;

    lines.push('', head);
    for (const t of mine) {
      // 달고 있는 것 표시. `▸` 는 너무 작아서 화면에서 안 보였다.
      const mark = t === worn ? '📌' : '　';
      lines.push(`${mark}${stampMd(t)} · _${t.desc}_`);
    }
    const locked = all.length - mine.length;
    if (locked) lines.push(`　🔒 ${'`???` '.repeat(locked).trim()}`);
  }

  // 쪽 버튼은 스물다섯 개를 넘게 가졌을 때만 나온다. 그때만 몇 쪽인지 적는다.
  return {
    text: lines.join('\n'),
    below: pages > 1 ? `-# 고르기 ${at + 1} / ${pages}쪽` : null,
    pages,
    page: at,
    held: slice,
  };
}

/**
 * 창고. 계정에는 **키와 개수만** 있고 이름·값·설명은 명부에서 읽는다(casino/items.js).
 *
 * 명부에 없는 키가 나올 수 있다 — 아이템을 지웠는데 누가 들고 있는 경우다.
 * 그때도 개수는 보여 준다. 사라진 것처럼 보이는 편보다 낫다.
 */
/**
 * 만든 것(`/요리`·`/제작`). 창고 맨 위에 둔다 — 개수가 아니라 하나하나라서 표와 섞으면
 * 읽기 나쁘다. 좋은 것부터 열 줄만, 나머지는 개수로.
 */
const MADE_SHOWN = 10;
function madeLines(account) {
  const crafts = [...(account.crafts ?? [])]
    .sort((a, b) => (GRADE_BY_KEY[b.grade]?.rank ?? 0) - (GRADE_BY_KEY[a.grade]?.rank ?? 0) || b.price - a.price);
  if (!crafts.length) return [];
  const lines = [`**■ 만든 것**　\`${crafts.length}/25\``];
  for (const c of crafts.slice(0, MADE_SHOWN)) lines.push(`${craftLabel(c)} · _${c.kind}_`);
  if (crafts.length > MADE_SHOWN) lines.push(`_…외 ${crafts.length - MADE_SHOWN}개 — \`/상점 만든것\` 에서 다 봐요._`);
  return [...lines, ''];
}

function itemsTab(account, page) {
  const made = madeLines(account);
  const owned = Object.entries(account.items ?? {})
    .filter(([, n]) => n > 0)
    .map(([key, n]) => [ITEM_BY_KEY[key] ?? { key, name: key, kind: '?', price: 0, sell: false }, n])
    .sort(([a], [b]) => a.kind.localeCompare(b.kind, 'ko') || a.name.localeCompare(b.name, 'ko'));

  if (!owned.length) {
    return {
      text: [...made, made.length
        ? '_창고는 비었어요._'
        : '_아직 아무것도 없어요._\n던전에서 줍거나 `/상점` 에서 사고, `/요리` · `/제작` 으로 만들어 보세요.'].join('\n'),
      pages: 1,
    };
  }

  const pages = Math.max(1, Math.ceil(owned.length / PER_PAGE));
  const at = Math.min(Math.max(0, page), pages - 1);
  const slice = owned.slice(at * PER_PAGE, (at + 1) * PER_PAGE);
  const total = owned.reduce((a, [, n]) => a + n, 0);
  // 팔 수 있는 것만 센다. 회복약처럼 값은 있어도 못 파는 물건이 있다.
  const worth = owned.reduce((a, [item, n]) => a + (item.sell ? item.price * n : 0), 0);

  // **쪽을 넘기면 아이템 표만 바뀐다.** 만든 것·합계는 쪽마다 그대로 둔다. 예전에는 만든 것을
  // 첫 쪽에만 둬서, 넘길 때마다 표가 위로 튀어 올라 카드가 통째로 바뀌는 것처럼 보였다.
  // 표 머리에 몇째 줄인지 적어 어디를 보고 있는지 알게 한다.
  const from = at * PER_PAGE + 1;
  const head = pages > 1
    ? `**■ 창고**　\`${from}–${from + slice.length - 1} / ${owned.length}\``
    : '**■ 창고**';
  const lines = [...made, head, table(slice.map(([item, n]) => [clipW(item.name, 24), `×${num(n)}`]))];

  // 합계는 ◀ ▶ **밑에** — 넘겨도 안 바뀌는 것이라 표와 떨어뜨려 둔다.
  return {
    text: lines.join('\n'),
    below: facts([
      ['종류', `**${num(owned.length)}**`],
      ['개수', `**${num(total)}**`],
      worth ? ['다 팔면', `**${num(worth)}골드**`] : null,
      pages > 1 ? ['쪽', `${at + 1} / ${pages}`] : null,
    ]),
    pages,
    page: at,
  };
}

// ---------------------------------------------------------------- 카드

const TAB_BODY = {
  record: (account) => recordTab(account),
  items: (account, page) => itemsTab(account, page),
  titles: (account, page, who) => titlesTab(account, page, who.npc),
};

/** 새 형식은 글자를 **메시지 전체에서 4000자**까지 받는다. 본문이 넘치면 여기서 자른다. */
const BODY_MAX = 3200;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * `prof:<탭>:<쪽>:<대상 id>`
 *
 * 라우터가 `customId.split(':')[0]` 로 찾으므로 구분자는 콜론이어야 한다(index.js).
 * 그런데 NPC id 자체에 콜론이 들어 있어서(`npc:migel`) **id 를 맨 뒤에** 두고
 * 읽을 때 나머지를 다시 이어 붙인다.
 */
const cid = (id, tab, page) => [PREFIX, tab, page, id].join(':');

/**
 * 탭 버튼의 쪽 자리에 넣는 값.
 *
 * **0 을 넣으면 안 된다.** 2쪽에서 `◀` 가 가리키는 곳이 1쪽인데, 그게 곧 탭 버튼과
 * 같은 customId 가 되어 디스코드가 한 메시지를 통째로 거절한다(50035
 * COMPONENT_CUSTOM_ID_DUPLICATED). 눌렀을 때는 `Number('t') || 0` 이라 0쪽으로 간다.
 */
const TAB_PAGE = 't';

function tabRow(who, tab) {
  return new ActionRowBuilder().addComponents(...TABS.map((t) => new ButtonBuilder()
    .setCustomId(cid(who.id, t.key, TAB_PAGE))
    .setLabel(t.label)
    .setStyle(t.key === tab ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(t.key === tab)));
}

function pagerRow(who, tab, page, pages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(cid(who.id, tab, page - 1))
      .setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(cid(who.id, tab, page + 1))
      .setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
  );
}

/** 칭호 탭에서만 붙는 고르는 줄. **가진 것만** 고를 수 있게 이 쪽의 목록으로 채운다. */
function wearRow(who, page, held) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid(who.id, 'wear', page))
      .setPlaceholder('달 칭호 고르기')
      .addOptions(
        { label: '칭호 벗기', value: NO_TITLE, description: '아무것도 안 답니다' },
        ...held.map((t) => ({ label: stamp(t), value: t.key, description: clipW(t.desc, 90) })),
      ),
  );
}

const text = (content) => new TextDisplayBuilder().setContent(content);
const line = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);

/**
 * 카드 한 장. **디스코드의 새 메시지 형식(Components V2)** 이다.
 *
 * 예전에는 임베드였는데, 임베드 안에는 버튼을 못 넣는다 — 쪽 넘김 ◀ ▶ 과 탭이 늘 카드
 * **밖** 맨 아래에 붙어서, 아이템 표를 보다가 한참 아래로 내려가 눌러야 했다. 새 형식은
 * 상자(Container) 안에 글·구분선·버튼 줄을 **원하는 순서로** 쌓을 수 있다. 그래서
 *
 *     〈 칭호 〉 / 이름              [초상화]
 *     ─────────
 *     본문 (탭마다)
 *     [ ◀ ] [ ▶ ]                ← 넘기는 것 바로 밑
 *     요약 한 줄
 *     ─────────
 *     -# 도움말
 *     [카드] [전적] [칭호] [아이템]
 *
 * 왼쪽 색 띠(accent)·오른쪽 위 초상화(섹션의 thumbnail)는 임베드와 같은 자리에 둔다.
 *
 * 새 형식 메시지에는 **본문(content)·임베드를 같이 못 쓴다.** 보낼 때 `IsComponentsV2`
 * 깃발을 달아야 한다(payloadFor).
 */
function cardFor(who, account, tab, page) {
  const body = TAB_BODY[tab]
    ? TAB_BODY[tab](account, page, who)
    : cardTab(account, seatedAt(who.id));

  // 달고 있는 칭호는 **키**로 저장돼 있다. 이름은 명부에서 찾아 쓴다 — 그래야 나중에
  // 칭호 이름을 고쳐도 달고 있던 게 안 날아간다.
  const worn = account.title ? TITLE_BY_KEY[account.title] : null;
  const pages = body.pages ?? 1;
  const at = body.page ?? 0;

  const box = new ContainerBuilder().setAccentColor(who.color ?? THEME_COLOR);

  // 머리 — 칭호 · 이름 · 초상화. 초상화는 섹션의 곁들이(accessory)라 오른쪽 위에 선다.
  const head = [text(`-# ${worn ? `〈 ${stamp(worn)} 〉` : '칭호 없음'}`), text(`## ${who.name}`)];
  if (who.avatar) {
    box.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(...head)
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(who.avatar)));
  } else {
    box.addTextDisplayComponents(...head);
  }
  box.addSeparatorComponents(line());

  box.addTextDisplayComponents(text(clip(body.text, BODY_MAX)));
  // **넘기는 것 바로 밑에 넘기는 버튼.** 칭호 탭은 고르는 줄도 여기.
  if (pages > 1) box.addActionRowComponents(pagerRow(who, tab, at, pages));
  if (tab === 'titles' && body.held?.length) box.addActionRowComponents(wearRow(who, at, body.held));
  if (body.below) box.addTextDisplayComponents(text(body.below));

  box.addSeparatorComponents(line());
  box.addTextDisplayComponents(text(who.npc
    ? '-# /급여 로 일당을 받습니다 (자동으로 늘지 않아요)'
    : '-# /출첵 으로 하루 한 번 받을 수 있어요'));
  box.addActionRowComponents(tabRow(who, tab));

  return { box, pages, page: at };
}

/**
 * 카드 한 장을 통째로. 명령과 버튼이 같은 것을 쓴다.
 *
 * 미겔·마티암 초상화는 로컬 파일이라 **매번 같이 올린다.** 탭을 넘길 때도 다시
 * 붙여야 한다 — `files` 를 빼고 보내면 디스코드가 첨부를 지우고 그림이 사라진다.
 *
 * `embeds: []` 를 같이 보낸다 — 새 형식 이전에 올라간 카드(임베드)의 버튼을 누르면 그
 * 메시지를 새 형식으로 바꿔 쓰는데, 임베드가 남아 있으면 디스코드가 거절한다.
 */
async function payloadFor(who, tab, page) {
  const { accounts } = await getAccounts([who.id]);
  const account = accounts[who.id];
  const card = cardFor(who, account, tab, page);
  return {
    content: null,
    embeds: [],
    components: [card.box],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
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
  let payload;
  try {
    payload = await payloadFor(who, 'card', 0);
  } catch (err) {
    await interaction.editReply({ embeds: [fail(`계정을 읽지 못했어요. ${err.message}`)] });
    return;
  }
  // 기다리는 자리(defer)를 새 형식으로 바꿔 쓴다. 디스코드가 그걸 거절하면 자리를 지우고
  // 새 메시지로 올린다 — 새로 보내는 것은 새 형식이 늘 된다.
  try {
    await interaction.editReply(payload);
  } catch (err) {
    console.warn('[프로필] 기다리는 자리를 바꿔 쓰지 못해 새로 올립니다:', err.message);
    await interaction.deleteReply().catch(() => {});
    await interaction.followUp(payload).catch((e) => console.warn('[프로필] 카드를 못 올렸어요:', e.message));
  }
}

/**
 * 탭 버튼. **누구든 누를 수 있다** — 아무것도 안 바꾸는 조회이기 때문이다.
 *
 * customId 에 대상 id 가 들어 있어서 봇이 재시작해도 그대로 동작한다. 대신 이름은
 * 다시 만들어야 하는데(id 만으로는 표시 이름을 모른다), 누른 사람이 그 대상이면
 * 그 인터랙션에서 이름을 가져올 수 있고 아니면 계정 id 로만 판단한다.
 *
 * **예전 카드(임베드)의 버튼을 눌러도 된다.** 그 메시지를 새 형식으로 바꿔 쓰고, 디스코드가
 * 바꿔 쓰기를 거절하면 새 카드를 아래에 하나 올린다.
 */
async function component(interaction) {
  const [, tab, page, ...rest] = interaction.customId.split(':');
  const id = rest.join(':');

  const self = interaction.user.id === id;
  const who = displayOf(id, self
    ? { user: interaction.user, member: interaction.member }
    : {});

  // **칭호를 바꾸는 것은 남이 못 한다.** 탭을 넘기는 것과 달리 이건 계정을 고친다.
  // 미겔·마티암은 함께 쓰는 인물이라 누구든 달아 줄 수 있게 뒀다.
  if (tab === 'wear' && !self && !who.npc) {
    await interaction.reply({
      embeds: [fail('자기 칭호만 바꿀 수 있어요.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();
  let payload;
  try {
    if (tab === 'wear') {
      const picked = interaction.values?.[0];
      await setTitle(id, !picked || picked === NO_TITLE ? null : picked);
    }
    payload = await payloadFor(who, tab === 'wear' ? 'titles' : tab, Number(page) || 0);
  } catch (err) {
    await interaction.followUp({
      embeds: [fail(`계정을 읽지 못했어요. ${err.message}`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  try {
    await interaction.editReply(payload);
  } catch (err) {
    console.warn('[프로필] 카드를 바꿔 쓰지 못해 새로 올립니다:', err.message);
    await interaction.followUp(payload).catch(() => {});
  }
}

export default {
  // 조회만 한다 — 쓰러져 있어도 자기 상태는 봐야 한다
  allowDead: true, data, execute, componentPrefix: PREFIX, component };
