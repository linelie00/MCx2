/**
 * /요트 — 요트 다이스
 *
 * 봇의 첫 상태 있는 기능이다. 지켜야 할 게 두 가지 있다.
 *
 * 1) 판은 **항상 message.edit() 로 고친다.** interaction.editReply() 는 인터랙션 토큰이
 *    15분이면 죽는데, 12라운드짜리 판은 그걸 훌쩍 넘긴다. 게다가 방치 종료처럼
 *    인터랙션이 아예 없는 갱신도 있다. 경로를 하나로 두면 둘 다 같은 코드로 처리된다.
 *
 * 2) 상태 변경은 **await 앞에서 동기로** 끝낸다. 디스코드는 누른 버튼을 비활성화해 주지
 *    않아서 굴리기를 빠르게 두 번 누르면 인터랙션이 두 개 온다. 중간에 await 이 끼면
 *    둘이 서로 끼어든다. customId 의 rev 로 지나간 클릭을 걸러내는 것도 같은 이유다.
 */
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { rollDice, reroll, MAX_ROLLS } from '../yacht/rules.js';
import * as state from '../yacht/state.js';
import {
  PREFIX, lobbyEmbed, lobbyRows, boardEmbed, boardRows, resultEmbed,
} from '../yacht/render.js';
import { base, fail } from '../embeds.js';

const { filledCount } = state;

/** 자기만 보이는 거절. 판을 건드리지 않는다. */
const deny = (interaction, text) =>
  interaction.reply({ embeds: [fail(text)], flags: MessageFlags.Ephemeral });

/** 지금 상태로 판 메시지를 다시 그린다. 모든 갱신이 여기를 지난다. */
async function draw(game) {
  if (!game.message) return;
  // 시작도 안 한 판을 접었으면 점수표를 보여줄 게 없다.
  const neverPlayed = game.round === 1 && game.seats.every((s) => filledCount(s.sheet) === 0);
  const payload = game.phase === 'done'
    ? {
      embeds: [neverPlayed ? base({ description: '판을 접었어요.' }) : resultEmbed(game)],
      components: [],
    }
    : game.phase === 'lobby'
      ? { embeds: [lobbyEmbed(game)], components: lobbyRows(game) }
      : { embeds: [boardEmbed(game)], components: boardRows(game) };
  await game.message.edit(payload).catch((err) => {
    console.warn('[요트] 판 갱신 실패:', err.message);
  });
}

// 방치된 판을 접는다. 봇이 살아 있는 동안만 도는 타이머라 재시작하면 같이 사라지는데,
// 재시작하면 판 자체가 사라지므로 문제되지 않는다.
setInterval(() => {
  for (const game of state.expired()) draw(game);
}, 60_000).unref();

const data = new SlashCommandBuilder()
  .setName('요트')
  .setDescription('요트 다이스를 합니다.')
  .addSubcommand((s) => s.setName('시작').setDescription('새 판을 엽니다'))
  .addSubcommand((s) => s.setName('판').setDescription('판을 다시 띄웁니다'))
  .addSubcommand((s) => s.setName('그만').setDescription('진행 중인 판을 접습니다'));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const existing = state.get(interaction.channelId);
  const live = existing && existing.phase !== 'done' ? existing : null;

  if (sub === '시작') {
    if (live) {
      await deny(interaction, '이 채널에 이미 판이 있어요. `/요트 판` 으로 띄우거나 `/요트 그만` 으로 접어주세요.');
      return;
    }
    const game = state.create({
      channelId: interaction.channelId,
      guildId: interaction.guildId,
      starterId: interaction.user.id,
    });
    state.addSeat(game, state.humanSeat(interaction.user, interaction.member?.displayName));

    await interaction.reply({ embeds: [lobbyEmbed(game)], components: lobbyRows(game) });
    game.message = await interaction.fetchReply();
    return;
  }

  if (sub === '판') {
    if (!live) {
      await deny(interaction, '진행 중인 판이 없어요.');
      return;
    }
    // 옛 메시지의 버튼은 걷어낸다. rev 검사로 눌러도 막히긴 하지만, 살아 있어 보이면 헷갈린다.
    await live.message?.edit({ components: [] }).catch(() => {});
    await interaction.reply(live.phase === 'lobby'
      ? { embeds: [lobbyEmbed(live)], components: lobbyRows(live) }
      : { embeds: [boardEmbed(live)], components: boardRows(live) });
    live.message = await interaction.fetchReply();
    return;
  }

  // 그만
  if (!live) {
    await deny(interaction, '진행 중인 판이 없어요.');
    return;
  }
  if (!state.seatOf(live, interaction.user.id) && live.starterId !== interaction.user.id) {
    await deny(interaction, '이 판에 앉은 사람만 접을 수 있어요.');
    return;
  }
  state.end(live, 'cancelled');
  // 판 메시지 자체가 결과로 바뀌므로, 명령 응답은 본인에게만 짧게.
  await interaction.reply({
    embeds: [base({ description: '판을 접었어요.' })],
    flags: MessageFlags.Ephemeral,
  });
  await draw(live);
}

/**
 * 버튼과 셀렉트.
 *
 * customId 는 `yacht:<판번호>:<rev>:<동작>[:<값>]`.
 */
async function component(interaction) {
  const [, serial, rev, action, arg] = interaction.customId.split(':');
  const game = state.get(interaction.channelId);

  // 봇이 재시작됐거나 다른 판의 버튼. 그냥 무시하면 디스코드가 빨간 "상호작용 실패"를
  // 띄워 버그처럼 보이므로, 이유를 알려주고 죽은 버튼을 걷어낸다.
  if (!game || game.serial !== serial || game.phase === 'done') {
    await interaction.reply({
      embeds: [fail('이 판은 이미 끝났어요. 봇이 재시작되면 진행 중이던 판이 사라져요.')],
      flags: MessageFlags.Ephemeral,
    });
    await interaction.message.edit({ components: [] }).catch(() => {});
    return;
  }

  // 지나간 클릭(대개 더블클릭). 오류가 아니라 현재 상태를 다시 보여주는 게 맞다.
  if (Number(rev) !== game.rev) {
    await interaction.deferUpdate();
    await draw(game);
    return;
  }

  if (game.phase === 'lobby') {
    const refusal = await handleLobby(interaction, game, action);
    if (refusal) return;
  } else {
    const refusal = await handleTurn(interaction, game, action, arg);
    if (refusal) return;
  }

  await interaction.deferUpdate();
  await draw(game);
}

/** 대기실 버튼. 거절했으면 true 를 돌려준다(호출부가 더 진행하지 않게). */
async function handleLobby(interaction, game, action) {
  if (action === 'join') {
    const err = state.addSeat(
      game,
      state.humanSeat(interaction.user, interaction.member?.displayName),
    );
    if (err) { await deny(interaction, err); return true; }
    return false;
  }

  if (action === 'start') {
    if (interaction.user.id !== game.starterId) {
      await deny(interaction, '판을 연 사람만 시작할 수 있어요.');
      return true;
    }
    const err = state.start(game);
    if (err) { await deny(interaction, err); return true; }
    return false;
  }

  if (action === 'cancel') {
    if (interaction.user.id !== game.starterId) {
      await deny(interaction, '판을 연 사람만 취소할 수 있어요.');
      return true;
    }
    state.end(game, 'cancelled');
    return false;
  }

  await deny(interaction, '지금은 누를 수 없는 버튼이에요.');
  return true;
}

/** 자기 차례에 하는 조작. 거절했으면 true. */
async function handleTurn(interaction, game, action, arg) {
  const seat = state.current(game);

  if (seat.kind !== 'human' || seat.userId !== interaction.user.id) {
    await deny(interaction, `지금은 ${seat.name} 차례예요.`);
    return true;
  }

  // --- 여기서부터 상태를 바꾼다. await 을 끼우지 않는다.
  if (action === 'roll') {
    if (game.rollsLeft <= 0) { await deny(interaction, '더 못 굴려요. 적을 칸을 고르세요.'); return true; }
    if (game.dice && game.held.every(Boolean)) {
      await deny(interaction, '다섯 개를 다 고정해 두면 굴려도 그대로예요.');
      return true;
    }
    game.dice = game.dice ? reroll(game.dice, game.held) : rollDice();
    game.rollsLeft -= 1;
    game.trail.push(`${MAX_ROLLS - game.rollsLeft}번째 — \`${game.dice.join(' ')}\``);
    state.touch(game);
    return false;
  }

  if (action === 'hold') {
    if (!game.dice) { await deny(interaction, '먼저 굴려 주세요.'); return true; }
    const i = Number(arg);
    game.held[i] = !game.held[i];
    state.touch(game);
    return false;
  }

  if (action === 'pick') {
    if (!game.dice) { await deny(interaction, '먼저 굴려 주세요.'); return true; }
    const key = interaction.values?.[0];
    if (!key || seat.sheet[key] !== null) { await deny(interaction, '거기엔 이미 적었어요.'); return true; }
    state.commitTo(game, key);
    return false;
  }

  await deny(interaction, '지금은 누를 수 없는 버튼이에요.');
  return true;
}

export default {
  data,
  execute,
  componentPrefix: PREFIX,
  component,
};
