/**
 * /요리 · /제작 — 재료로 무언가를 만든다
 *
 * 둘은 **점수를 매기는 칸만 다르고** 흐름이 같다(`casino/crafts.js` 의 MODES).
 * 요리는 먹을 수 있고, 제작(보석 가공·장신구·도구…)은 팔기만 한다.
 *
 *   1. 재료를 가졌는지, 만든 것 칸이 남았는지 본다
 *   2. 🎲 d20 을 굴린다 — **봇이** 굴린다
 *   3. 제미나이가 재료·결과물·과정·주사위를 보고 **항목별 점수와 지문**을 준다
 *   4. 점수에 주사위를 더해 등급을 낸다 — **공식이** 낸다(crafts.js 머리말)
 *   5. 재료를 빼고 결과물을 넣는다 — **한 번의 쓰기**
 *   6. 등급부터 보여 준다
 *
 * **판정이 실패하면 재료는 그대로다.** 쓰는 것은 판정이 끝난 뒤 한 번뿐이고, 그 쓰기가
 * 거절되면(그 사이 재료를 팔았다든가) 결과물도 안 들어간다.
 *
 * 결과는 **모두가 보는** 메시지로 낸다. 잘 만든 요리는 자랑하라고 있는 것이다.
 *
 * **먹으면 얼마나 차는지는 안 보여 준다.** 만들 때 굴려 두고(`crafts.effectOf`) `/사용` 이
 * 먹는 순간에만 꺼낸다. 독이 든 재료를 넣었으면 그것만 알려 준다 — 넣은 사람은 아니까.
 */
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getAccounts } from '../api.js';
import { apply } from '../casino/wallet.js';
import { ITEMS, ITEM_BY_KEY, findItem } from '../casino/items.js';
import {
  MODES, GRADE_BY_KEY, MAX_CRAFTS, POISON, POISON_CAP, partLabel, roll as rollDice, scoreOf, gradeOf,
  priceOf, effectOf, poisonOf, monstrous, newId,
} from '../casino/crafts.js';
import { earned, gained } from '../casino/titles.js';
import { awardCard } from '../casino/titleCard.js';
import { judge as askJudge } from '../ai/judge.js';
import { checkRate } from '../ai/client.js';
import { base, fail, trunc } from '../embeds.js';
import { displayOf } from '../casino/accounts.js';
import { forgetCrafts, itemsFor } from '../casino/bag.js';

const SLOTS = 5;

/** 한 사람이 다음 판정까지 기다려야 하는 시간. 제미나이 한도를 /캐입 과 같이 쓴다. */
const COOLDOWN = 10_000;
const lastAt = new Map();

const num = (n) => Number(n ?? 0).toLocaleString('ko-KR');

// ---------------------------------------------------------------- 명령 모양

function build(label, mode) {
  const b = new SlashCommandBuilder()
    .setName(label)
    .setDescription(mode.key === 'cook'
      ? '재료로 요리합니다. 제미나이가 채점하고 주사위가 솜씨를 정합니다.'
      : '재료로 물건을 만듭니다(보석 가공·장신구·도구…). 제미나이가 채점합니다.')
    .addStringOption((o) => o.setName('결과물').setDescription('무엇을 만들지')
      .setRequired(true).setMaxLength(40))
    .addStringOption((o) => o.setName('과정').setDescription('어떻게 만드는지 — 자세할수록 좋아요')
      .setRequired(true).setMaxLength(500));
  for (let i = 1; i <= SLOTS; i += 1) {
    b.addStringOption((o) => o.setName(`재료${i}`)
      .setDescription(i === 1 ? '쓸 재료 (같은 것을 여러 칸에 넣으면 그만큼 씁니다)' : '쓸 재료')
      .setRequired(i === 1).setAutocomplete(true));
  }
  return b;
}

/**
 * 재료 추천. **내가 가진 것만, 개수와 함께.** 요리면 재료를, 제작이면 잡화를 앞에 둔다.
 *
 * 처음엔 명부 전체에서 골랐는데, 재료가 아흔을 넘자 25칸에 앞쪽만 들어가 뒤에 들인
 * 것들이 아예 안 보였다. 가진 것만 보이면 그럴 일도 없고 고르기도 쉽다.
 *
 * **다른 칸에 이미 넣은 만큼은 뺀다.** 꿀이 하나뿐인데 재료1 에 꿀을 넣었으면 재료2 에는
 * 꿀이 안 뜬다. 계정은 짧게 캐시해서 읽고(`casino/bag.js`), 제때 못 읽으면 명부 전체로
 * 물러선다 — 그래도 칠 수는 있어야 한다. 가졌는지는 실행할 때 한 번 더 본다.
 */
const norm = (t) => String(t ?? '').replace(/\s+/g, '').toLowerCase();

function autocompleteFor(mode) {
  const first = mode.key === 'cook' ? '재료' : '잡화';
  const byKind = (a, b) => (a.kind === first ? 0 : 1) - (b.kind === first ? 0 : 1) || a.name.localeCompare(b.name, 'ko');
  return async (interaction) => {
    const focused = interaction.options.getFocused(true);
    const typed = norm(focused?.value);
    const match = (i) => !typed || norm(i.name).includes(typed) || i.key.toLowerCase().includes(typed);

    const owned = await itemsFor(interaction.user.id);
    if (!owned) {
      const hit = ITEMS.filter(match).sort(byKind);
      await interaction.respond(hit.slice(0, 25).map((i) => ({ name: trunc(`${i.name} · ${i.kind}`, 100), value: i.key })));
      return;
    }

    const used = {};
    for (let i = 1; i <= SLOTS; i += 1) {
      const slot = `재료${i}`;
      if (slot === focused?.name) continue;
      const item = findItem(interaction.options.getString(slot));
      if (item) used[item.key] = (used[item.key] ?? 0) + 1;
    }
    const left = Object.entries(owned)
      .map(([key, n]) => [ITEM_BY_KEY[key], n - (used[key] ?? 0)])
      .filter(([item, n]) => item && n > 0 && match(item))
      .sort(([a], [b]) => byKind(a, b));
    await interaction.respond(left.slice(0, 25).map(([i, n]) => ({
      name: trunc(`${i.name} ×${n} · ${i.kind}`, 100),
      value: i.key,
    })));
  };
}

// ---------------------------------------------------------------- 결과

/**
 * 결과 화면. **맨 위가 등급이다.**
 *
 * 점수가 어디서 왔는지 다 보여 준다 — 등급만 보여 주면 왜 브론즈인지 알 길이 없다.
 * 주사위가 막아서 한 등급 내려앉았으면 그것도 적는다.
 */
export function resultEmbed(mode, craft, { parts, total, capped, by, poison, who, names }) {
  const g = GRADE_BY_KEY[craft.grade];
  const score = Object.entries(parts)
    .map(([k, v]) => `${partLabel(mode, k)} ${v}/${mode.parts[k]}`).join(' · ');

  const lines = [
    `🎲 **${craft.dice}**${craft.dice === 1 ? ' — 대실패' : craft.dice === 20 ? ' — 대성공' : ''}`
      + `  ·  ${score}  →  **${total}점**`,
    '',
    `_${craft.desc}_`,
  ];
  if (craft.verdict) lines.push('', `> ${craft.verdict}`);
  if (capped && by === 'dice') {
    lines.push('', `_점수는 ${capped.emoji} ${capped.label}감이었지만 주사위가 모자랐어요`
      + ` (${capped.dice} 이상이어야 해요)._`);
  }
  if (capped && by === 'poison') {
    const cap = GRADE_BY_KEY[POISON_CAP];
    lines.push('', `_점수는 ${capped.emoji} ${capped.label}감이었지만 독이 든 요리는 ${cap.emoji} ${cap.label}까지예요._`);
  }
  if (poison) lines.push('', `☠️ **독이 든 재료가 들어갔어요**(${POISON[poison].label}). 먹어 봐야 알아요.`);

  const worth = [];
  // 얼마나 차는지는 **먹을 때까지 비밀이다.**
  if (mode.edible) worth.push('먹으면 **❔**');
  worth.push(craft.price ? `팔면 **${num(craft.price)}골드**` : '팔아도 **0골드**');
  if (craft.mt) worth.push(`\`/mt상점\` 에서 **${craft.mt} MT**`);

  return base({
    title: `${g.emoji} ${g.label} — ${craft.name}`,
    description: [...lines, '', worth.join(' · ')].join('\n'),
    color: g.color,
    footer: `${who} 의 ${mode.verb} · 재료 ${names.join(' · ')}`,
  });
}

// ---------------------------------------------------------------- 만들기

/** 칸에 적힌 재료를 키로. 자동완성을 안 고르고 이름을 쳐도 찾는다. */
function readSlots(interaction) {
  const keys = [];
  const unknown = [];
  for (let i = 1; i <= SLOTS; i += 1) {
    const raw = interaction.options.getString(`재료${i}`);
    if (!raw) continue;
    const item = findItem(raw);
    if (item) keys.push(item.key); else unknown.push(raw);
  }
  return { keys, unknown };
}

const tally = (keys) => keys.reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {});

const deny = (interaction, text) =>
  interaction.reply({ embeds: [fail(text)], flags: MessageFlags.Ephemeral });

/**
 * 만든다. `deps` 는 검사가 제미나이 대신 끼우는 자리다.
 */
export async function make(interaction, mode, { judge = askJudge, rand = Math.random, now = Date.now } = {}) {
  const me = interaction.user.id;
  const name = String(interaction.options.getString('결과물') ?? '').trim();
  const process = String(interaction.options.getString('과정') ?? '').trim();
  const { keys, unknown } = readSlots(interaction);

  if (!name || !process) { await deny(interaction, '무엇을 어떻게 만들지 적어 주세요.'); return; }
  if (unknown.length) {
    await deny(interaction, `이런 재료는 없어요: **${unknown.join(', ')}**. 목록에서 골라 주세요.`);
    return;
  }
  if (!keys.length) { await deny(interaction, '재료를 하나는 넣어 주세요.'); return; }

  // 한도 — 판정 한 번이 제미나이 한 번이다. /캐입 과 한도를 같이 쓴다.
  const since = now() - (lastAt.get(me) ?? 0);
  if (since < COOLDOWN) {
    await deny(interaction, `조금만 천천히요. ${Math.ceil((COOLDOWN - since) / 1000)}초 뒤에 다시 해 주세요.`);
    return;
  }
  const limited = checkRate();
  if (limited) { await deny(interaction, limited); return; }

  // 계정을 읽고 제미나이를 부른다 — 둘 다 3초를 넘길 수 있다.
  await interaction.deferReply();

  let account;
  try {
    ({ accounts: { [me]: account } } = await getAccounts([me]));
  } catch (err) {
    await interaction.editReply({ embeds: [fail(`계정을 읽지 못했어요. ${err.message}`)] });
    return;
  }

  const counts = tally(keys);
  const short = Object.entries(counts)
    .filter(([k, n]) => Number(account?.items?.[k] ?? 0) < n)
    .map(([k, n]) => `**${ITEM_BY_KEY[k].name}** ${n}개 (가진 것 ${Number(account?.items?.[k] ?? 0)})`);
  if (short.length) {
    await interaction.editReply({ embeds: [fail(`재료가 모자라요.\n${short.join('\n')}`)] });
    return;
  }
  if ((account?.crafts?.length ?? 0) >= MAX_CRAFTS) {
    await interaction.editReply({
      embeds: [fail(`만든 것이 가득이에요(${MAX_CRAFTS}개). \`/상점\` 에서 팔거나 \`/사용\` 으로 먹어 주세요.`)],
    });
    return;
  }

  lastAt.set(me, now());
  const dice = rollDice(rand);
  const answer = await judge(mode, { name, process, counts, dice });
  if (!answer.ok) {
    await interaction.editReply({
      embeds: [fail(`판정을 못 했어요 — **재료는 그대로예요.**\n${answer.error}`)],
    });
    return;
  }

  const { parts, total } = scoreOf(mode, answer.judged, dice);
  // 독은 요리에만 따진다. 제작에 독초를 넣는 것은 그냥 재료다(먹을 게 아니니까).
  const poison = mode.edible ? poisonOf(keys) : 0;
  const { grade, capped, by } = gradeOf(total, dice, { poisoned: poison > 0 });
  const { heal, harm } = effectOf(mode, grade, answer.judged, keys, rand);
  const craft = {
    id: newId(),
    kind: mode.verb,
    name,
    grade: grade.key,
    heal,
    harm,
    price: priceOf(keys, grade),
    mt: grade.mt,
    desc: answer.judged.desc,
    from: keys,
    dice,
    score: total,
  };

  // 전적. 칭호가 읽는다(casino/titles.js 의 요리·제작).
  const stone = grade.key === 'stone';
  const bump = mode.key === 'cook'
    ? {
      cooked: 1,
      bestCook: grade.rank,
      ...(stone ? { burnt: 1 } : {}),
      ...(monstrous(keys) && grade.rank >= GRADE_BY_KEY.gold.rank ? { monsterDish: 1 } : {}),
    }
    : { crafted: 1, bestCraft: grade.rank, ...(stone ? { craftBroke: 1 } : {}) };

  const saved = await apply({
    items: { [me]: Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, -n])) },
    crafts: { [me]: { add: [craft] } },
    bump: { [me]: bump },
  });
  if (!saved.ok) {
    await interaction.editReply({
      embeds: [fail('저장하지 못했어요 — **재료는 그대로예요.** 그 사이에 재료를 팔았거나 서버가 잠깐 쉬는 중일 수 있어요.')],
    });
    return;
  }

  forgetCrafts(me);          // /사용 자동완성이 새 요리를 보게

  const who = displayOf(me, { user: interaction.user, member: interaction.member }).name;
  await interaction.editReply({
    embeds: [resultEmbed(mode, { ...craft, verdict: answer.judged.verdict }, {
      parts, total, capped, by, poison, who, names: keys.map((k) => ITEM_BY_KEY[k].name),
    })],
  });

  // 새 칭호. 만들기 전 계정과 견준다 — 칭호는 저장하지 않고 전적에서 계산하므로.
  const held = earned(saved.accounts[me]);
  const fresh = gained(earned(account).map((t) => t.key), held);
  if (fresh.length) {
    await interaction.followUp(awardCard({
      name: who, avatar: interaction.user.displayAvatarURL?.({ size: 256 }) ?? null, avatarFile: null,
      fresh, held: held.length,
    })).catch((err) => console.warn('[요리] 칭호 알림 실패:', err.message));
  }
}

// ---------------------------------------------------------------- 내보내기

const commandFor = (label) => {
  const mode = MODES[label];
  return {
    data: build(label, mode),
    execute: (interaction) => make(interaction, mode),
    autocomplete: autocompleteFor(mode),
  };
};

export default [commandFor('요리'), commandFor('제작')];
