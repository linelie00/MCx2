/**
 * /사용 — 아이템을 먹는다
 *
 * 창고에 있는 것을 꺼내 먹고 체력이 오르내린다. 상점에서 산 회복약이 쓸모를 갖는
 * 유일한 자리이자, **쓰러진 사람이 일어나는 유일한 길**이다.
 *
 * **남에게도 먹일 수 있다.** 미겔·마티암도 계정이 있어서 죽을 수 있는데, 그때 아무도
 * 못 살리면 그 인물이 영영 누워 있게 된다. 다만 **회복되는 것만** 넘길 수 있다 —
 * 정체 모를 화석(−100) 같은 것을 남에게 먹이는 길은 아예 두지 않는다. 자기한테는
 * 음수도 그대로 먹는다(원석을 씹으면 아파야 한다).
 *
 * **쓰러져 있어도 쓸 수 있는 명령이다**(`allowDead`). 대신 그때는 부활의 영약만,
 * 그것도 자기한테만 쓸 수 있다.
 *
 * **`/요리` 로 만든 것도 먹는다.** 명부에 없는 물건이라 자동완성 값이 `craft:<id>` 이고,
 * 한 번에 하나를 통째로 먹는다. 얼마나 차는지는 만들 때 굴려 뒀고(`crafts.effectOf`)
 * **먹는 순간에 처음 드러난다.** 탈이 날 수도 있다 — 탔거나, 독이 남았거나, 식중독.
 *
 * 만든 요리는 **남에게도 먹일 수 있다.** 명부의 물건은 회복되는 것만 넘기지만, 요리는
 * 먹기 전엔 아무도 모르므로 "이건 못 넘긴다" 고 거절하는 순간 비밀이 샌다. 누구에게
 * 먹이든 운이다. 같은 까닭으로 체력이 가득해도 막지 않는다.
 *
 * **판에 앉아 있으면 못 쓴다.** 판이 도는 동안 체력은 인메모리 장부에만 있고 서버는
 * 판 시작 시점 값을 든다 — 그 사이에 서버를 고치면 정산 증감이 얹혀 체력이 생기거나
 * 사라진다(`casino/tables.js`). 던전 중에 회복약을 못 먹는 것은 그래서다. 도망쳐서
 * 고치고 다시 들어오는 것이 던전의 선택지다.
 */
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getAccounts } from '../api.js';
import { apply } from '../casino/wallet.js';
import { base, fail, gauge, trunc, THEME_COLOR } from '../embeds.js';
import { NPC_CHOICES, resolveTarget } from '../casino/accounts.js';
import { seatedAt, seatedMessage } from '../casino/tables.js';
import { ITEMS, ITEM_BY_KEY, MAX_HP, healOf } from '../casino/items.js';
import { isDead, forget, deadEmbed } from '../casino/alive.js';
import { craftsFor, forgetCrafts, craftLabel, CRAFT_VALUE } from '../casino/bag.js';
import { GRADE_BY_KEY } from '../casino/crafts.js';
import { earned, gained } from '../casino/titles.js';
import { awardCard } from '../casino/titleCard.js';
import { displayOf } from '../casino/accounts.js';

/** 한 번에 먹을 수 있는 개수. 열 개면 회복약도 넉넉하고, 실수로 창고를 비울 일도 없다. */
const MOST = 10;

/** 먹어서 뜻이 있는 것. 회복이 0 이면 씹어 봐야 아무 일도 안 난다. */
const usable = (item) => item && [item.heal].flat().some((n) => n !== 0);

/**
 * 남에게 넘길 수 있는 것. **깎일 여지가 조금도 없어야 한다.**
 * 범위로 적힌 것은 제일 나쁜 쪽이 0 이상이어야 한다.
 */
const tonic = (item) => {
  const range = [item.heal].flat();
  return Math.min(...range) >= 0 && Math.max(...range) > 0;
};

const num = (n) => Number(n ?? 0).toLocaleString('ko-KR');
const sign = (n) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

const data = new SlashCommandBuilder()
  .setName('사용')
  .setDescription('아이템을 먹습니다.')
  .addStringOption((o) => o.setName('이름').setDescription('무엇을 먹을지')
    .setRequired(true).setAutocomplete(true))
  .addIntegerOption((o) => o.setName('개수').setDescription('기본 1개')
    .setMinValue(1).setMaxValue(MOST))
  .addUserOption((o) => o.setName('사람').setDescription('남에게 먹입니다 (회복되는 것만)'))
  .addStringOption((o) => o.setName('캐릭터').setDescription('미겔·마티암에게 먹입니다')
    .addChoices(...NPC_CHOICES));

/**
 * 먹을 수 있는 것만 추천한다. **내가 만든 요리를 먼저**, 그다음 명부의 물건.
 *
 * 만든 것은 계정에만 있어서 읽어야 하는데, 자동완성도 3초 시한을 탄다. 그래서 짧게
 * 캐시하고 늦으면 명부만 보여 준다(`casino/bag.js`). 가진 게 없으면 실행할 때 거절한다.
 */
async function autocomplete(interaction) {
  const typed = String(interaction.options.getFocused() || '').replace(/\s+/g, '').toLowerCase();
  const match = (name, key = '') => !typed
    || name.replace(/\s+/g, '').toLowerCase().includes(typed)
    || key.toLowerCase().includes(typed);

  const made = (await craftsFor(interaction.user.id))
    .filter((c) => c.kind === '요리' && match(c.name))
    // 얼마나 차는지는 **안 보여 준다** — 먹을 때까지 비밀이다.
    .map((c) => ({ name: trunc(`${craftLabel(c)} · 만든 요리`, 100), value: `${CRAFT_VALUE}${c.id}` }));
  const hit = ITEMS.filter((i) => usable(i) && match(i.name, i.key))
    .map((i) => ({ name: trunc(`${i.name} (${[i.heal].flat().map(sign).join('~')})`, 100), value: i.key }));
  await interaction.respond([...made, ...hit].slice(0, 25));
}

/** 탈이 났을 때의 한 줄. 무엇 때문인지는 **먹고 나서야** 알려 준다. */
const HARM_TEXT = {
  burnt: '🔥 쓴 숯 맛이 난다. 탄 걸 먹은 대가다.',
  poison: '☠️ **독이 남아 있었다!** 온몸이 저려 온다.',
  sick: '🤢 **식중독이다.** 덜 익은 게 탈을 냈다.',
};

/**
 * 만든 요리를 먹는다. 쓰러져 있으면 못 먹고 판에 앉아 있으면 안 되는 것은 명부의
 * 물건과 같다. 다른 것은 **하나를 통째로** 먹고, 결과를 **먹고 나서야** 안다는 것.
 *
 * 이름을 쳐도 찾는다(자동완성을 안 골랐을 때). 같은 이름이 여럿이면 먼저 만든 것.
 */
async function eatCraft(interaction, who, raw) {
  const me = interaction.user.id;
  const self = who.id === me;
  await interaction.deferReply();

  let accounts;
  try {
    ({ accounts } = await getAccounts([...new Set([me, who.id])]));
  } catch (err) {
    await interaction.editReply({ embeds: [fail(`계정을 읽지 못했어요. ${err.message}`)] });
    return;
  }
  const mine = accounts[me];
  const target = accounts[who.id];

  const crafts = mine?.crafts ?? [];
  const craft = raw.startsWith(CRAFT_VALUE)
    ? crafts.find((c) => c.id === raw.slice(CRAFT_VALUE.length))
    : crafts.find((c) => c.name.replace(/\s+/g, '') === raw.replace(/\s+/g, ''));
  if (!craft) {
    await interaction.editReply({
      embeds: [fail('그런 아이템이 없어요. `/아이템 정보` 로 찾거나, 만든 요리는 목록에서 골라 주세요.')],
    });
    return;
  }
  if (craft.kind !== '요리') {
    await interaction.editReply({ embeds: [fail(`**${craft.name}** 은(는) 먹어도 아무 일 없어요.`)] });
    return;
  }
  if (isDead(mine)) { await interaction.editReply({ embeds: [deadEmbed()] }); return; }
  for (const [id, name] of [[me, '그쪽'], [who.id, who.name]]) {
    const at = seatedAt(id);
    if (at) { await interaction.editReply({ embeds: [fail(seatedMessage(name, at))] }); return; }
  }
  const was = Number(target?.hp ?? MAX_HP);
  if (was <= 0) { await interaction.editReply({ embeds: [fail(`${who.name}은(는) 쓰러져 있어요. 부활의 영약만 들어가요.`)] }); return; }

  // 전적 — 먹은 사람과 먹인 사람이 다를 수 있다. 칭호가 읽는다(요리 갈래).
  const bad = craft.heal < 0;
  const dies = was + craft.heal <= 0;
  const bump = { [who.id]: { ateMade: 1, ...(bad ? { foodSick: 1 } : {}), ...(dies ? { diedEating: 1 } : {}) } };
  if (!self && bad) bump[me] = { ...(bump[me] ?? {}), fedBad: 1 };

  const saved = await apply({
    crafts: { [me]: { remove: [craft.id] } },
    hp: { [who.id]: craft.heal },
    bump,
  });
  if (!saved.ok) {
    await interaction.editReply({ embeds: [fail('저장하지 못했어요. 잠시 뒤에 다시 해 주세요.')] });
    return;
  }
  forget(me);
  forget(who.id);
  forgetCrafts(me);

  const now = Number(saved.accounts[who.id]?.hp ?? was);
  const g = GRADE_BY_KEY[craft.grade];
  const lines = [
    self ? `**${craft.name}** 을(를) 먹었어요.` : `${who.name}에게 **${craft.name}** 을(를) 먹였어요.`,
    craft.desc ? `_${craft.desc}_` : '',
    '',
  ];
  if (craft.harm) lines.push(HARM_TEXT[craft.harm] ?? '🤢 탈이 났다.', '');
  lines.push(`**체력** ${gauge(now, MAX_HP, { percent: false })} ${was} → **${now}** / ${MAX_HP}`);
  if (now <= 0) lines.push('', `💀 **${who.name}이(가) 쓰러졌어요.**`);
  await interaction.editReply({
    embeds: [base({
      title: `${g?.emoji ?? '🍽️'} ${craft.name}`,
      description: lines.join('\n'),
      color: craft.harm ? 0x6b5b5b : (g?.color ?? THEME_COLOR),
      footer: `${now === was ? '±0' : sign(now - was)} · ${g?.label ?? ''} 요리`,
    })],
  });

  // 새 칭호 — 먹은 사람(식중독·최후의 만찬)과 먹인 사람(독살 미수)이 따로 받는다.
  for (const id of Object.keys(bump)) {
    const before = accounts[id];
    const after = saved.accounts[id];
    if (!before || !after) continue;
    const npc = id.startsWith('npc:');
    const held = earned(after, { npc });
    const fresh = gained(earned(before, { npc }).map((t) => t.key), held);
    if (!fresh.length) continue;
    const face = id === me
      ? { name: displayOf(me, { user: interaction.user, member: interaction.member }).name,
        avatar: interaction.user.displayAvatarURL?.({ size: 256 }) ?? null, avatarFile: null }
      : { name: who.name, ...displayOf(id) };
    await interaction.followUp(awardCard({
      name: face.name, avatar: face.avatar ?? null, avatarFile: face.avatarFile ?? null, fresh, held: held.length,
    })).catch((err) => console.warn('[사용] 칭호 알림 실패:', err.message));
  }
}

async function execute(interaction) {
  const who = resolveTarget(interaction);
  if (who.error) {
    await interaction.reply({ embeds: [fail(who.error)], flags: MessageFlags.Ephemeral });
    return;
  }

  const raw = String(interaction.options.getString('이름') ?? '');
  const item = ITEM_BY_KEY[raw];
  // 명부에 없으면 만든 요리일 수 있다 — 계정을 읽어야 알 수 있다.
  if (!item) { await eatCraft(interaction, who, raw); return; }
  if (!usable(item)) {
    await interaction.reply({
      embeds: [fail(`**${item.name}** 은(는) 먹어도 아무 일 없어요.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const count = interaction.options.getInteger('개수') ?? 1;
  const me = interaction.user.id;
  const self = who.id === me;

  // 남에게 넘기는 것은 회복되는 것만. 음수를 남에게 먹이는 길은 아예 두지 않는다.
  if (!self && !tonic(item)) {
    await interaction.reply({
      embeds: [fail(`**${item.name}** 은(는) 남에게 먹일 수 없어요. 회복되는 것만 넘길 수 있어요.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 계정을 읽는다 — HTTP 라 먼저 응답을 잡는다.
  await interaction.deferReply();

  let accounts;
  try {
    ({ accounts } = await getAccounts([...new Set([me, who.id])]));
  } catch (err) {
    await interaction.editReply({ embeds: [fail(`계정을 읽지 못했어요. ${err.message}`)] });
    return;
  }
  const mine = accounts[me];
  const target = accounts[who.id];

  // 쓰러진 사람은 부활의 영약만, 그것도 자기한테만. `/사용` 은 사망 게이트를 지나오므로
  // 여기서 직접 본다 — 게이트는 편의지 불변식이 아니다.
  if (isDead(mine) && !(self && item.key === 'potionRevive')) {
    await interaction.editReply({ embeds: [deadEmbed()] });
    return;
  }

  const have = Number(mine?.items?.[item.key] ?? 0);
  if (have < count) {
    await interaction.editReply({
      embeds: [fail(have
        ? `**${item.name}** 이(가) ${have}개뿐이에요.`
        : `**${item.name}** 을(를) 안 갖고 있어요.`)],
    });
    return;
  }

  // 판이 도는 동안은 체력이 인메모리 장부에만 있다. 주는 쪽도 받는 쪽도 앉아 있으면 안 된다.
  for (const [id, name] of [[me, '그쪽'], [who.id, who.name]]) {
    const at = seatedAt(id);
    if (at) {
      await interaction.editReply({ embeds: [fail(seatedMessage(name, at))] });
      return;
    }
  }

  const was = Number(target?.hp ?? MAX_HP);
  if (was >= MAX_HP && tonic(item)) {
    await interaction.editReply({
      embeds: [fail(`${who.name}의 체력이 이미 가득이에요. 아껴 두세요.`)],
    });
    return;
  }

  // 범위로 적힌 것은 개수만큼 따로 굴린다 — 세 개를 한 번에 먹어도 운은 세 번이다.
  let heal = 0;
  for (let i = 0; i < count; i += 1) heal += healOf(item);

  const saved = await apply({
    items: { [me]: { [item.key]: -count } },
    hp: { [who.id]: heal },
  });
  if (!saved.ok) {
    await interaction.editReply({ embeds: [fail('저장하지 못했어요. 잠시 뒤에 다시 해 주세요.')] });
    return;
  }
  forget(me);
  forget(who.id);

  // **결과는 응답에서 읽는다.** 서버가 0~최대치로 자르므로 봇의 산수는 틀린다.
  const now = Number(saved.accounts[who.id]?.hp ?? was);
  const left = Number(saved.accounts[me]?.items?.[item.key] ?? 0);

  const lines = [
    self
      ? `**${item.name}**${count > 1 ? ` ×${count}` : ''} 을(를) 먹었어요.`
      : `${who.name}에게 **${item.name}**${count > 1 ? ` ×${count}` : ''} 을(를) 먹였어요.`,
    `_${item.desc}_`,
    '',
    `**체력** ${gauge(now, MAX_HP, { percent: false })} ${was} → **${now}** / ${MAX_HP}`,
  ];
  if (was <= 0 && now > 0) lines.push('', `✨ **${who.name}이(가) 일어났어요.**`);
  if (now <= 0) lines.push('', `💀 **${who.name}이(가) 쓰러졌어요.**`);

  await interaction.editReply({
    embeds: [base({
      title: `${was <= 0 && now > 0 ? '✨' : '🍶'} ${item.name}`,
      description: lines.join('\n'),
      color: who.color ?? THEME_COLOR,
      footer: `${sign(now - was)} · 남은 ${item.name} ${num(left)}개`,
    })],
  });
}

export default {
  data,
  execute,
  autocomplete,
  // 쓰러져 있어도 쓸 수 있어야 한다 — 부활의 영약이 여기로만 들어간다.
  allowDead: true,
};
