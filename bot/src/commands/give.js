/**
 * /양도 — 가진 것을 남에게 넘긴다
 *
 *   /양도 이름:도토리 개수:3 사람:@겨울
 *   /양도 이름:골드 개수:500 캐릭터:마티암
 *   /양도 이름:꿀 바른 멧돼지 구이 사람:@사백        ← 만든 것은 하나씩, 통째로
 *   /양도 이름:골드 개수:300 보내는쪽:미겔 캐릭터:마티암   ← 미겔 ↔ 마티암
 *
 * **넘길 수 있는 것은 셋이다** — 명부의 아이템, 골드, `/요리`·`/제작` 으로 만든 것. 셋 다
 * `이름` 한 칸에서 고른다(골드도 그 목록의 하나). 자동완성은 **보내는 쪽이 가진 것만** 보여 준다.
 *
 * **받는 쪽에는 미겔·마티암도 들어간다.** 계정이 있으니 받을 수 있다. 미겔 ↔ 마티암끼리도
 * 된다(`보내는쪽`). 다만 **미겔·마티암의 것은 서로에게만** 넘긴다 — 사람에게 넘기게 두면
 * `/급여` 로 넣은 일당이 그대로 사람 지갑으로 새어 나온다.
 *
 * 막는 것. **마지막 것이 놓치기 쉬운 함정이다.**
 *   - 받을 사람을 안 골랐거나 자기 자신 · 봇
 *   - 가진 것보다 많이(개수는 슬래시 옵션이 1 이상 정수로 막는다)
 *   - 받는 쪽의 만든 것이 가득(25) — 서버가 409 로도 막는다
 *   - **보내는 쪽이든 받는 쪽이든 판에 앉아 있을 때** — 판이 도는 동안 골드·체력은 인메모리
 *     장부에만 있고 서버는 판 시작 시점 값을 든다. 그 사이에 서버를 고치면 정산 증감이
 *     얹혀 없던 골드가 생기거나 사라진다(`casino/tables.js`)
 *
 * 빼기와 넣기가 **한 번의 쓰기**다(`wallet.apply`) — 반쪽만 넘어가는 일이 없다. 모자라면
 * 서버가 통째로 409 를 낸다.
 *
 * 쓰러져 있어도 쓸 수 있다(`allowDead`). 넘기는 데 몸이 필요하지는 않고, 쓰러진 친구에게
 * 부활의 영약을 쥐여 주는 것이 이 명령의 제일 중요한 쓸모다.
 *
 * 되묻는 단계는 없다. 자동완성으로 고르므로 틀릴 여지가 적고, 결과는 채널에 공개로 남는다
 * (선물이니까). 거절은 나만 보인다.
 */
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getAccounts } from '../api.js';
import { apply } from '../casino/wallet.js';
import { base, fail, trunc, THEME_COLOR } from '../embeds.js';
import { NPC_CHOICES, displayOf, isNpcId } from '../casino/accounts.js';
import { seatedAt, seatedMessage } from '../casino/tables.js';
import { ITEMS, ITEM_BY_KEY } from '../casino/items.js';
import { walletFor, forgetBag, craftLabel, CRAFT_VALUE } from '../casino/bag.js';

/** 자동완성과 실행이 같이 쓰는 골드의 값. 명부의 키와 안 겹친다(키는 소문자로 시작하는 낙타 모양). */
export const GOLD_VALUE = '$gold';

/** 받는 쪽의 만든 것 한도. 서버의 MAX_CRAFTS 와 같다. */
const MAX_CRAFTS = 25;

const num = (n) => Number(n ?? 0).toLocaleString('ko-KR');
const squash = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();

const data = new SlashCommandBuilder()
  .setName('양도')
  .setDescription('가진 아이템·골드·만든 것을 남에게 넘깁니다.')
  .addStringOption((o) => o.setName('이름').setDescription('무엇을 넘길지 — 골드도 여기서 골라요')
    .setRequired(true).setAutocomplete(true))
  .addIntegerOption((o) => o.setName('개수').setDescription('기본 1 · 골드면 금액')
    .setMinValue(1).setMaxValue(10_000_000))
  .addUserOption((o) => o.setName('사람').setDescription('받을 사람'))
  .addStringOption((o) => o.setName('캐릭터').setDescription('받을 캐릭터')
    .addChoices(...NPC_CHOICES))
  .addStringOption((o) => o.setName('보내는쪽').setDescription('미겔·마티암끼리 주고받게 할 때 — 비우면 나')
    .addChoices(...NPC_CHOICES));

// ---------------------------------------------------------------- 무엇을

/**
 * `이름` 값 → 넘길 것. `{ kind: 'gold' | 'item' | 'craft', … }` 또는 null.
 *
 * 자동완성을 골랐으면 값이 키지만, **안 고르고 쳐서 보낼 수도 있다** — 그때는 이름으로
 * 찾는다. 같은 이름의 만든 것이 여럿이면 먼저 만든 것.
 */
export function pickOf(raw, account) {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  if (v === GOLD_VALUE || ['골드', '돈', 'gold'].includes(squash(v))) return { kind: 'gold' };
  if (v.startsWith(CRAFT_VALUE)) {
    const c = (account?.crafts ?? []).find((x) => x.id === v.slice(CRAFT_VALUE.length));
    return c ? { kind: 'craft', craft: c } : { kind: 'craft', craft: null };
  }
  if (ITEM_BY_KEY[v]) return { kind: 'item', item: ITEM_BY_KEY[v] };
  const item = ITEMS.find((i) => squash(i.name) === squash(v));
  if (item) return { kind: 'item', item };
  const c = (account?.crafts ?? []).find((x) => squash(x.name) === squash(v));
  if (c) return { kind: 'craft', craft: c };
  return null;
}

/** 넘긴 것 한 줄. `도토리 ×3` · `500골드` · `🥇 꿀 바른 멧돼지 구이` */
const labelOf = (pick, n) => (pick.kind === 'gold' ? `**${num(n)}골드**`
  : pick.kind === 'craft' ? `**${craftLabel(pick.craft)}**`
    : `**${pick.item.name}**${n > 1 ? ` ×${n}` : ''}`);

// ---------------------------------------------------------------- 누가 누구에게

/** 이름표. 사람은 서버 별명, 미겔·마티암은 이름만(자리 밖에서는 `(NPC)` 꼬리표가 붙는다). */
function nameOf(id, interaction, picked) {
  if (isNpcId(id)) return displayOf(id).name.replace(/\s*\(NPC\)$/, '');
  if (id === interaction.user.id) return interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
  return interaction.options.getMember?.('사람')?.displayName || picked?.globalName || picked?.username || '누군가';
}

/**
 * 보내는 쪽과 받는 쪽. `{ from, to, error }`.
 * 순서가 뜻이 있다 — 싼 검사(옵션만 보는 것)를 먼저 해서, 계정을 읽기 전에 거절한다.
 */
export function partiesOf(interaction) {
  const me = interaction.user.id;
  const from = interaction.options.getString('보내는쪽') ?? me;
  const user = interaction.options.getUser('사람');
  const npc = interaction.options.getString('캐릭터');

  if (user && npc) return { error: '받을 쪽은 사람과 캐릭터 중 하나만 골라 주세요.' };
  if (!user && !npc) return { error: '받을 사람을 골라 주세요 — `사람:` 이나 `캐릭터:`.' };
  if (user?.bot) return { error: '봇은 계정이 없어요.' };
  const to = npc ?? user.id;
  if (to === from) return { error: '자기 자신에게는 넘길 수 없어요.' };
  if (isNpcId(from) && !isNpcId(to)) {
    return { error: '미겔·마티암의 것은 서로에게만 넘길 수 있어요.' };
  }
  return { from, to, user };
}

// ---------------------------------------------------------------- 명령

/**
 * 이름 자동완성. **보내는 쪽이 가진 것만** — 골드, 만든 것, 창고 순.
 *
 * 계정은 짧게 캐시하고 800ms 만 기다린다(`casino/bag.js`). 늦으면 골드 한 줄만 보여 준다 —
 * 가진 것을 모르는 채로 명부 전체를 띄우면 없는 것을 고르게 된다.
 */
async function autocomplete(interaction) {
  const typed = squash(interaction.options.getFocused());
  const from = interaction.options.getString('보내는쪽') ?? interaction.user.id;
  const account = await walletFor(from);
  const hit = (name) => !typed || squash(name).includes(typed);

  const out = [];
  if (hit('골드') && (!account || Number(account.gold ?? 0) > 0)) {
    out.push({ name: account ? `💰 골드 (가진 ${num(account.gold)})` : '💰 골드', value: GOLD_VALUE });
  }
  for (const c of account?.crafts ?? []) {
    if (hit(c.name)) out.push({ name: trunc(`${craftLabel(c)} · 만든 ${c.kind}`, 100), value: `${CRAFT_VALUE}${c.id}` });
  }
  for (const [key, n] of Object.entries(account?.items ?? {})) {
    const item = ITEM_BY_KEY[key];
    if (item && n > 0 && hit(item.name)) out.push({ name: trunc(`${item.name} ×${n}`, 100), value: key });
  }
  await interaction.respond(out.slice(0, 25)).catch(() => {});
}

async function execute(interaction) {
  const who = partiesOf(interaction);
  if (who.error) {
    await interaction.reply({ embeds: [fail(who.error)], flags: MessageFlags.Ephemeral });
    return;
  }
  const { from, to } = who;
  for (const id of [from, to]) {
    const at = seatedAt(id);
    if (at) {
      await interaction.reply({ embeds: [fail(seatedMessage(nameOf(id, interaction, who.user), at))], flags: MessageFlags.Ephemeral });
      return;
    }
  }

  // 거절은 나만 보이게, 넘긴 것은 채널에 공개로. 그래서 에페메랄로 잡아 두고 끝에 followUp.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const say = (msg) => interaction.editReply({ embeds: [fail(msg)] });

  let accounts;
  try {
    ({ accounts } = await getAccounts([from, to]));
  } catch (err) {
    await say(`계정을 읽지 못했어요. ${err.message}`);
    return;
  }
  const src = accounts[from];
  const dst = accounts[to];

  const pick = pickOf(interaction.options.getString('이름'), src);
  if (!pick || (pick.kind === 'craft' && !pick.craft)) {
    await say('그런 것을 가지고 있지 않아요. 자동완성에서 골라 주세요.');
    return;
  }
  const n = interaction.options.getInteger('개수') ?? 1;
  const fromName = nameOf(from, interaction, who.user);
  const toName = nameOf(to, interaction, who.user);

  let moves;
  if (pick.kind === 'gold') {
    const have = Number(src?.gold ?? 0);
    if (have < n) { await say(`골드가 모자라요 — ${fromName}에게는 **${num(have)}골드**가 있어요.`); return; }
    moves = { deltas: { [from]: -n, [to]: n } };
  } else if (pick.kind === 'item') {
    const have = Number(src?.items?.[pick.item.key] ?? 0);
    if (have < n) {
      await say(have ? `**${pick.item.name}** 은(는) **${have}개**뿐이에요.` : `**${pick.item.name}** 을(를) 가지고 있지 않아요.`);
      return;
    }
    moves = { items: { [from]: { [pick.item.key]: -n }, [to]: { [pick.item.key]: n } } };
  } else {
    // 만든 것은 명부에 없는 한 점짜리라 **하나를 통째로** 옮긴다. 개수는 안 본다.
    if ((dst?.crafts ?? []).length >= MAX_CRAFTS) {
      await say(`${toName}의 만든 것이 가득이에요(${MAX_CRAFTS}개). 팔거나 먹어서 자리를 비워야 받을 수 있어요.`);
      return;
    }
    moves = { crafts: { [from]: { remove: [pick.craft.id] }, [to]: { add: [pick.craft] } } };
  }

  const saved = await apply(moves);
  if (!saved.ok) {
    await say('넘기지 못했어요. 그새 가진 것이 바뀌었거나 저장이 안 됐어요.');
    return;
  }
  forgetBag(from);
  forgetBag(to);

  const left = pick.kind === 'gold' ? `${fromName} 남은 골드 ${num(saved.accounts[from]?.gold)}`
    : pick.kind === 'item' ? `${fromName} 남은 ${pick.item.name} ${num(saved.accounts[from]?.items?.[pick.item.key] ?? 0)}개`
      : `${toName}의 만든 것 ${saved.accounts[to]?.crafts?.length ?? '?'} / ${MAX_CRAFTS}`;
  await interaction.editReply({ embeds: [base({ description: '넘겼어요.', color: THEME_COLOR })] });
  await interaction.followUp({
    embeds: [base({
      title: '🎁 양도',
      description: `**${fromName}** → **${toName}**\n${labelOf(pick, n)}`,
      color: THEME_COLOR,
      footer: left,
    })],
  }).catch(() => {});
}

export default {
  // 쓰러진 친구에게 부활의 영약을 쥐여 주는 것이 이 명령의 제일 중요한 쓸모다 — 누구든 쓴다
  allowDead: true,
  data, execute, autocomplete,
};
