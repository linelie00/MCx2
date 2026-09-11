/**
 * /에너미 도감 — 던전에서 마주친 에너미의 기록
 *
 * 일흔다섯(일반 40 · 엘리트 35)이 **처음엔 전부 `???`** 다. 던전에서 만나면 이름과 한 줄
 * 설명이, 쓰러뜨리면 성향(얼마나 넓게 보는지 · 허세 · 올리는 크기)과 체력이 열린다.
 * 성향은 판에서 실제로 쓰는 값(holdem/mobs.js)을 말로 옮긴 것이라, 다음에 같은 놈을
 * 만나면 어떻게 싸울지 정하는 데 쓴다.
 *
 * 기록은 계정의 `enemies` 칸이다(`{ 이름: { met, won } }`). **이름이 키**라서 mobs.js 에서
 * 이름을 고치면 그 에너미의 기록이 끊긴다. 던전만 적는다 — 현금 판에 앉는 모브는 안 센다.
 *
 * 응답은 **공개**고 버튼도 아무나 누를 수 있다. `/프로필` 과 같다 — 아무것도 안 바꾸는
 * 조회다. 누구의 도감인지는 customId 맨 뒤에 둔다(NPC id 의 콜론 때문, 프로필과 같은 이유).
 */
import {
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, MessageFlags,
} from 'discord.js';
import { MOBS, NORMALS, ELITE_LOOSE_BONUS, hpOf, regenOf } from '../holdem/mobs.js';
import { getAccounts } from '../api.js';
import { enemiesFor } from '../casino/bag.js';
import { base, fail, gauge, trunc, THEME_COLOR } from '../embeds.js';

export const PREFIX = 'foe';

/** 한 쪽에 스무 줄. 셀렉트가 25칸까지라 그 아래로. */
const PER_PAGE = 20;

/** 탭 버튼의 쪽 자리. 0 을 넣으면 `◀` 와 customId 가 겹친다(50035) — items.js 참고. */
const TAB_PAGE = 't';

const TABS = [
  { key: 'n', label: '일반', icon: '🗡️', list: NORMALS, elite: false },
  { key: 'e', label: '엘리트', icon: '⚔️', list: MOBS, elite: true },
];
const tabOf = (key) => TABS.find((t) => t.key === key) ?? TABS[0];

/** 도감 전체. 표의 순서가 곧 도감의 순서다 — `???` 자리도 그대로 남는다. */
export const ENEMIES = TABS.flatMap((t) => t.list.map((m) => ({ ...m, elite: t.elite, tab: t.key })));
const BY_NAME = new Map(ENEMIES.map((m) => [m.name, m]));
export const TOTAL = ENEMIES.length;

const num = (n) => Number(n ?? 0).toLocaleString('ko-KR');

/** 기록 한 줄. 만났는지·이겼는지. 이긴 것은 만난 것이다. */
const recOf = (book, name) => book?.[name] ?? null;
export const metOf = (r) => (r?.met ?? 0) > 0 || (r?.won ?? 0) > 0;
export const wonOf = (r) => (r?.won ?? 0) > 0;

// ---------------------------------------------------------------- 성향을 말로

/** 던전에서 실제로 쓰는 값. 엘리트는 조금 무르다(mobs.js 의 ELITE_LOOSE_BONUS). */
const looseOf = (m) => m.loose + (m.elite ? ELITE_LOOSE_BONUS : 0);

/**
 * 값 → 말. 경계는 일흔다섯의 사분위쯤에서 잡았다(loose 0.14 · 0.19 · 0.24 /
 * bluff 0.08 · 0.14 · 0.20 / raise 0.40 · 0.50 · 0.62). 게이지 폭은 실제 최소·최대를 조금 넘긴다.
 */
const TRAITS = [
  {
    key: 'loose', label: '보는 패', lo: -0.02, hi: 0.36, of: looseOf,
    words: [[0.06, '좋은 패만 든다'], [0.14, '가려서 든다'], [0.22, '넓게 든다'], [0.28, '웬만하면 든다'], [Infinity, '아무 패나 든다']],
  },
  {
    key: 'bluff', label: '허세', lo: 0, hi: 0.32, of: (m) => m.bluff,
    words: [[0.06, '거의 안 부린다'], [0.13, '가끔 부린다'], [0.21, '자주 부린다'], [Infinity, '밥 먹듯 부린다']],
  },
  {
    key: 'raise', label: '올리는 크기', lo: 0.2, hi: 0.8, of: (m) => m.raise,
    words: [[0.35, '조금씩 올린다'], [0.5, '고르게 올린다'], [0.65, '크게 올린다'], [Infinity, '한 번에 크게 민다']],
  },
];
const wordOf = (t, v) => t.words.find(([cap]) => v < cap)[1];

/**
 * 한 줄 요약과 공략. 포커의 네 갈래(좁게/넓게 × 얌전/세게)를 그대로 옮겼다.
 * "세게" 는 크게 올리거나 허세가 잦은 것 — 둘 다 이쪽에게 압박이 된다.
 */
export function styleOf(m) {
  const tight = looseOf(m) < 0.14;
  const hard = m.raise >= 0.55 || m.bluff >= 0.2;
  if (tight && hard) return { name: '기다렸다 한 방', tip: '올리면 진짜일 때가 많아요. 약한 패로 맞서지 마세요.' };
  if (tight) return { name: '조심스러운 짠물', tip: '자주 접어요. 작게 자주 밀어 보세요.' };
  if (hard) return { name: '판을 휘젓는 난동꾼', tip: '허세가 섞여 있어요. 괜찮은 패면 끝까지 따라가 보세요.' };
  return { name: '다 따라오는 구경꾼', tip: '잘 안 접어요. 허세는 안 먹혀요 — 좋은 패로 크게 받으세요.' };
}

// ---------------------------------------------------------------- 화면

/** `foe:<무엇>:<탭>:<쪽>:<도감 주인 id>` — id 는 콜론이 있을 수 있어 맨 뒤. */
const cid = (what, tab, page, id) => [PREFIX, what, tab, page, id].join(':');

function counts(book, list = ENEMIES) {
  const recs = list.map((m) => recOf(book, m.name));
  return { met: recs.filter(metOf).length, won: recs.filter(wonOf).length, total: list.length };
}

function line(m, r) {
  if (!metOf(r)) return '❔ ???';
  return wonOf(r)
    ? `✅ **${m.name}** · 처치 ${num(r.won)}`
    : `👁️ **${m.name}** · 만남 ${num(r.met)}`;
}

export function listPayload(id, book, tabKey, page) {
  const tab = tabOf(tabKey);
  const list = ENEMIES.filter((m) => m.tab === tab.key);
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const at = Math.min(Math.max(0, page), pages - 1);
  const slice = list.slice(at * PER_PAGE, (at + 1) * PER_PAGE);
  const all = counts(book);
  const here = counts(book, list);

  const embed = base({
    title: `📖 에너미 도감 — ${tab.label}`,
    description: [`<@${id}> 의 기록`, '', ...slice.map((m) => line(m, recOf(book, m.name)))].join('\n'),
    color: THEME_COLOR,
    footer: '던전에서 만나면 이름이, 쓰러뜨리면 성향이 적혀요 · 이름을 고르면 기록이 나와요',
  }).addFields(
    { name: '만난 에너미', value: `${gauge(all.met, all.total, { percent: false })} ${all.met} / ${all.total}`, inline: true },
    { name: '쓰러뜨린 에너미', value: `${gauge(all.won, all.total, { percent: false })} ${all.won} / ${all.total}`, inline: true },
    { name: `${tab.label} · ${at + 1} / ${pages}쪽`, value: `만남 ${here.met} · 처치 ${here.won} / ${here.total}`, inline: true },
  );

  const tabs = new ActionRowBuilder().addComponents(...TABS.map((t) => new ButtonBuilder()
    .setCustomId(cid('list', t.key, TAB_PAGE, id))
    .setLabel(t.label)
    .setEmoji(t.icon)
    .setStyle(t.key === tab.key ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(t.key === tab.key)));
  const rows = [tabs];
  if (pages > 1) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cid('list', tab.key, at - 1, id))
        .setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(at <= 0),
      new ButtonBuilder().setCustomId(cid('list', tab.key, at + 1, id))
        .setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(at >= pages - 1),
    ));
  }
  // **만난 것만** 고를 수 있다. 셀렉트에 이름이 뜨면 `???` 가 무슨 소용인가.
  const seen = slice.filter((m) => metOf(recOf(book, m.name)));
  if (seen.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(cid('pick', tab.key, at, id))
        .setPlaceholder('기록을 볼 에너미 고르기')
        .addOptions(seen.map((m) => ({
          label: trunc(m.name, 100),
          value: m.name,
          description: trunc(m.note, 100),
          emoji: wonOf(recOf(book, m.name)) ? '✅' : '👁️',
        }))),
    ));
  }
  return { embeds: [embed], components: rows };
}

/** 아직 못 만난 이름이면 `null` — 부르는 쪽이 목록으로 돌아간다. */
export function cardPayload(id, book, name, tabKey, page) {
  const m = BY_NAME.get(name);
  const r = recOf(book, name);
  if (!m || !metOf(r)) return null;

  const lines = [`_${m.note}_`, ''];
  if (wonOf(r)) {
    const style = styleOf(m);
    lines.push(`**성향 — ${style.name}**`);
    for (const t of TRAITS) {
      const v = t.of(m);
      lines.push(`${t.label} ${gauge(v - t.lo, t.hi - t.lo, { percent: false })} ${wordOf(t, v)}`);
    }
    lines.push('', `💡 ${style.tip}`);
  } else {
    lines.push('🔒 **성향** — 쓰러뜨리면 적혀요.');
  }

  const embed = base({
    title: `${m.elite ? '⚔️ 엘리트 · ' : '🗡️ '}${m.name}`,
    description: lines.join('\n'),
    color: m.elite ? 0xc9a227 : THEME_COLOR,
    footer: `${m.elite ? '엘리트' : '일반'} 에너미 · /에너미 도감`,
  }).addFields(
    { name: '만남', value: `${num(r.met)}번`, inline: true },
    { name: '처치', value: `${num(r.won ?? 0)}번`, inline: true },
    { name: '체력', value: wonOf(r) ? `**${hpOf(m)}** · 재생 +${regenOf(m)}` : '🔒', inline: true },
  );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cid('list', tabKey ?? m.tab, page ?? 0, id))
        .setLabel('목록으로').setEmoji('📖').setStyle(ButtonStyle.Secondary),
    )],
  };
}

// ---------------------------------------------------------------- 명령

const data = new SlashCommandBuilder()
  .setName('에너미')
  .setDescription('던전의 에너미를 봅니다.')
  .addSubcommand((s) => s.setName('도감')
    .setDescription('던전에서 만난 에너미의 기록을 봅니다.')
    .addStringOption((o) => o.setName('이름')
      .setDescription('비우면 전체 목록 — 만난 에너미만 찾을 수 있어요')
      .setAutocomplete(true)));

const NOT_MET = '도감에 없는 이름이에요. 던전에서 만나면 적혀요.';

/** 계정의 도감. 버튼·명령 둘 다 defer 한 뒤에 부른다(HTTP). */
async function bookOf(id) {
  const { accounts } = await getAccounts([id]);
  return accounts?.[id]?.enemies ?? {};
}

/**
 * 이름 자동완성. **만난 것만** 보여 준다 — 일흔다섯을 다 띄우면 도감을 채울 까닭이
 * 없어진다. 계정을 제때 못 읽으면 빈 목록(bag.js 가 800ms 에서 끊는다).
 */
async function autocomplete(interaction) {
  const typed = String(interaction.options.getFocused() || '').replace(/\s+/g, '');
  const book = await enemiesFor(interaction.user.id);
  const hit = ENEMIES.filter((m) => metOf(recOf(book, m.name))
    && (!typed || m.name.replace(/\s+/g, '').includes(typed)));
  await interaction.respond(hit.slice(0, 25).map((m) => ({
    name: `${m.elite ? '⚔️ ' : ''}${m.name}${wonOf(recOf(book, m.name)) ? ' ✅' : ''}`,
    value: m.name,
  }))).catch(() => {});
}

async function execute(interaction) {
  const id = interaction.user.id;
  const picked = interaction.options.getString('이름');
  // 아예 없는 이름은 계정을 읽을 것도 없다. 못 만난 이름과 **같은 말**로 답한다 —
  // 다르게 답하면 그 이름이 도감에 있는지가 드러난다.
  if (picked && !BY_NAME.has(picked)) {
    await interaction.reply({ embeds: [fail(NOT_MET)], flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply();
  let book;
  try {
    book = await bookOf(id);
  } catch (err) {
    await interaction.editReply({ embeds: [fail(`계정을 읽지 못했어요. ${err.message}`)] });
    return;
  }
  if (picked) {
    const card = cardPayload(id, book, picked);
    await interaction.editReply(card ?? { embeds: [fail(NOT_MET)] });
    return;
  }
  // 처음엔 일반 탭. 엘리트만 만났으면 엘리트부터 — 빈 쪽을 먼저 보여 줄 까닭이 없다.
  const firstTab = counts(book, NORMALS).met || !counts(book, MOBS).met ? 'n' : 'e';
  await interaction.editReply(listPayload(id, book, firstTab, 0));
}

async function component(interaction) {
  const [, what, tab, page, ...rest] = interaction.customId.split(':');
  const id = rest.join(':');
  const at = Number(page) || 0;

  await interaction.deferUpdate();
  try {
    const book = await bookOf(id);
    const card = what === 'pick' ? cardPayload(id, book, interaction.values?.[0], tab, at) : null;
    await interaction.editReply(card ?? listPayload(id, book, tab, at));
  } catch (err) {
    await interaction.followUp({
      embeds: [fail(`계정을 읽지 못했어요. ${err.message}`)], flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
}

export default {
  // 조회만 한다. 쓰러져 있어도 무엇에게 졌는지는 볼 수 있어야 한다
  allowDead: true,
  data, execute, autocomplete, componentPrefix: PREFIX, component,
};
