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
 * 먹을 수 있는 것만 추천한다. **명부만 보고 계정은 안 본다** — 자동완성도 3초 시한을
 * 타는데 여기서 HTTP 를 치면 느려진다. 가진 게 없으면 실행할 때 거절한다.
 */
async function autocomplete(interaction) {
  const typed = String(interaction.options.getFocused() || '').replace(/\s+/g, '').toLowerCase();
  const hit = ITEMS.filter((i) => usable(i) && (!typed
    || i.name.replace(/\s+/g, '').toLowerCase().includes(typed)
    || i.key.toLowerCase().includes(typed)));
  await interaction.respond(hit.slice(0, 25).map((i) => ({
    name: trunc(`${i.name} (${[i.heal].flat().map(sign).join('~')})`, 100),
    value: i.key,
  })));
}

async function execute(interaction) {
  const who = resolveTarget(interaction);
  if (who.error) {
    await interaction.reply({ embeds: [fail(who.error)], flags: MessageFlags.Ephemeral });
    return;
  }

  const item = ITEM_BY_KEY[interaction.options.getString('이름')];
  if (!item) {
    await interaction.reply({
      embeds: [fail('그런 아이템이 없어요. `/아이템 정보` 로 찾아보세요.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
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
