/**
 * /홀덤 — 카지노 bard 의 텍사스 홀덤
 *
 * 요트·블랙잭과 같은 배관을 쓴다. 판은 스레드에서 돌고, 항상 message.edit() 로 고치며,
 * customId 의 rev 로 지나간 클릭을 거른다. 상태 변경은 await 앞에서 동기로 끝낸다.
 *
 * 홀덤에서 새로 지켜야 할 것 셋.
 *
 *   1. **홀 카드는 판에 안 그린다.** `[내 패]` 버튼이 나만 보이는 메시지로 보여 준다.
 *      봇이 한 사람에게만 보낼 수 있는 길은 **그 사람이 누른 인터랙션에 ephemeral 로
 *      답하는 것** 하나뿐이다(DM 은 막아 둔 사람이 못 받는다). 누르지 않은 사람에게
 *      먼저 보낼 방법은 없으므로 "누르면 보여 준다" 가 유일한 모양이다.
 *   2. **그래서 `[내 패]` 는 deferUpdate 경로를 타면 안 된다.** 한 인터랙션에
 *      deferUpdate 와 reply 를 둘 다 할 수 없다. deny() 와 같은 "거절" 경로로 빠진다.
 *   3. **판을 새로 띄우는 것은 라운드가 바뀔 때만.** 한 핸드에 베팅 라운드가 넷이라
 *      액션마다 새로 띄우면 메시지가 순식간에 쌓인다. 라운드 안에서는 제자리 수정만 한다.
 */
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import * as state from '../holdem/state.js';
import { chooseAction } from '../holdem/ai.js';
import { live } from '../holdem/rules.js';
import { load, commit } from '../casino/wallet.js';
import {
  PREFIX, howto, lobbyEmbed, lobbyRows, boardEmbed, boardRows, holeEmbed, resultEmbed,
} from '../holdem/render.js';
import { handText } from '../casino/cards.js';
import { base, fail } from '../embeds.js';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** 자기만 보이는 거절. 판을 건드리지 않는다. */
const deny = (interaction, text) =>
  interaction.reply({ embeds: [fail(text)], flags: MessageFlags.Ephemeral });

// ---------------------------------------------------------------- 그리기

function payloadFor(game) {
  if (game.phase === 'done') {
    const nothing = game.handNo === 0;
    return {
      embeds: [nothing ? base({ description: '판을 접었어요.' }) : resultEmbed(game)],
      components: [],
    };
  }
  return game.phase === 'lobby'
    ? { embeds: [lobbyEmbed(game)], components: lobbyRows(game) }
    : { embeds: [boardEmbed(game)], components: boardRows(game) };
}

async function draw(game) {
  if (!game.message) return;
  await game.message.edit(payloadFor(game))
    .catch((err) => console.warn('[홀덤] 판 갱신 실패:', err.message));
}

/** 판을 맨 아래에 새로 띄운다. 새 것을 먼저 보내고 옛 것의 버튼을 걷는다. */
async function repost(game) {
  const old = game.message;
  const channel = old?.channel;
  if (!channel) return;

  const fresh = await channel.send(payloadFor(game)).catch((err) => {
    console.warn('[홀덤] 판 새로 띄우기 실패:', err.message);
    return null;
  });
  if (!fresh) { await draw(game); return; }

  game.message = fresh;
  await old.edit({ components: [] }).catch(() => {});
}

/** 커뮤니티 카드가 깔렸을 때만 채팅에 남긴다. 액션마다 남기면 판이 묻힌다. */
async function showBoard(game, label) {
  if (!game.message?.channel) return;
  await game.message.channel
    .send({ content: `**${label}**\n${handText(game.board)}` })
    .catch((err) => console.warn('[홀덤] 보드 알림 실패:', err.message));
  await repost(game);
}

// ---------------------------------------------------------------- 드라이버

const STREET_NAME = { flop: '플랍', turn: '턴', river: '리버' };

async function runDriver(game) {
  if (game.driving) return;
  game.driving = true;
  try {
    let street = game.phase;

    for (;;) {
      if (game.phase === 'done') return;

      // 스트리트가 바뀌었으면 보드를 알리고 판을 다시 띄운다.
      if (game.phase !== street) {
        street = game.phase;
        if (STREET_NAME[street]) await showBoard(game, STREET_NAME[street]);
        else await draw(game);
      }

      if (game.phase === 'showdown') { await settleAndShow(game); continue; }
      if (game.phase === 'settled') return;      // 사람이 [다음 핸드] 를 누를 때까지

      const seat = state.currentSeat(game);
      if (!seat) { await draw(game); return; }
      if (seat.kind !== 'npc') { await draw(game); return; }   // 사람 차례 — 물러난다

      await sleep(900);
      if (game.phase === 'done') return;

      const move = chooseAction(seat.character, {
        hole: seat.hole,
        board: game.board,
        opponents: Math.max(1, live(game.seats).length - 1),
        toCall: state.toCallFor(game, seat),
        pot: state.pot(game),
        legal: state.actionsFor(game),
        raises: state.raisesFor(game),
      });
      state.act(game, move.action, move.to);
      await draw(game);
    }
  } finally {
    game.driving = false;
    // 도는 동안 들어온 클릭이 있었으면 지금 처리한다(블랙잭에서 겪은 그 구멍).
    if (game.rekick) { game.rekick = false; kick(game); }
  }
}

/** 팟을 나누고 결과를 보여준다. 칩 저장도 여기서 — 인터랙션 경로 밖이라 await 해도 된다. */
async function settleAndShow(game) {
  state.settle(game);
  await repost(game);
  await commit(game.guildId, game.chips.deltas());
}

function kick(game) {
  if (game.phase === 'lobby' || game.phase === 'done') return;
  if (game.driving) { game.rekick = true; return; }
  runDriver(game).catch((err) => console.error('[홀덤] 드라이버 오류:', err));
}

// 방치된 판을 접는다.
setInterval(() => {
  for (const game of state.expired()) draw(game);
}, 60_000).unref();

// ---------------------------------------------------------------- 명령

const data = new SlashCommandBuilder()
  .setName('홀덤')
  .setDescription('카지노 bard 에서 텍사스 홀덤을 합니다.')
  .addSubcommand((s) => s.setName('시작').setDescription('새 판을 엽니다'))
  .addSubcommand((s) => s.setName('판').setDescription('판을 다시 띄웁니다'))
  .addSubcommand((s) => s.setName('그만').setDescription('진행 중인 판을 접습니다'));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const existing = state.forChannel(interaction.channelId);
  const liveGame = existing && existing.phase !== 'done' ? existing : null;

  if (sub === '시작') {
    if (liveGame) {
      await deny(interaction, '이 채널에 이미 판이 있어요. `/홀덤 판` 으로 띄우거나 `/홀덤 그만` 으로 접어주세요.');
      return;
    }

    const starter = interaction.member?.displayName
      || interaction.user.globalName || interaction.user.username;

    await interaction.reply({ embeds: [base({ description: `bard 의 홀덤 테이블을 엽니다 — ${starter}` })] });
    const anchor = await interaction.fetchReply();

    let room = interaction.channel;
    try {
      if (!interaction.channel.isThread()) {
        room = await anchor.startThread({
          name: `🃏 홀덤 — ${starter}`,
          autoArchiveDuration: 1440,
        });
      }
    } catch (err) {
      console.warn('[홀덤] 스레드를 못 만들어 채널에서 진행합니다:', err.message);
      room = interaction.channel;
    }

    const game = state.create({
      channelId: room.id,
      homeChannelId: interaction.channelId,
      guildId: interaction.guildId,
      starterId: interaction.user.id,
    });
    state.addSeat(game, state.humanSeat(interaction.user, interaction.member?.displayName));

    await room.send({ embeds: [howto()] })
      .catch((err) => console.warn('[홀덤] 규칙 안내 실패:', err.message));
    game.message = await room.send(payloadFor(game));
    return;
  }

  if (sub === '판') {
    if (!liveGame) { await deny(interaction, '진행 중인 판이 없어요.'); return; }
    await repost(liveGame);
    await interaction.reply({
      embeds: [base({ description: `판을 다시 띄웠어요. <#${liveGame.channelId}>` })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 그만
  if (!liveGame) { await deny(interaction, '진행 중인 판이 없어요.'); return; }
  if (!state.seatOf(liveGame, interaction.user.id) && liveGame.starterId !== interaction.user.id) {
    await deny(interaction, '이 판에 앉은 사람만 접을 수 있어요.');
    return;
  }
  state.end(liveGame, 'cancelled');
  await interaction.reply({
    embeds: [base({ description: '판을 접었어요.' })],
    flags: MessageFlags.Ephemeral,
  });
  await draw(liveGame);
}

// ---------------------------------------------------------------- 버튼

async function component(interaction) {
  const [, serial, rev, action, arg] = interaction.customId.split(':');
  const game = state.forChannel(interaction.channelId);

  if (!game || game.serial !== serial || game.phase === 'done') {
    await interaction.reply({
      embeds: [fail('이 판은 이미 끝났어요. 봇이 재시작되면 진행 중이던 판이 사라져요.')],
      flags: MessageFlags.Ephemeral,
    });
    await interaction.message.edit({ components: [] }).catch(() => {});
    return;
  }

  // `[내 패]` 는 **rev 검사보다 먼저** 본다. 카드는 rev 로 바뀌는 값이 아니라서
  // 지나간 판에서 눌러도 맞는 답을 줄 수 있고, 무엇보다 여기서 deferUpdate 를 타면
  // 그 뒤에 reply 를 못 한다.
  if (action === 'hole') {
    const seat = state.seatOf(game, interaction.user.id);
    if (!seat) { await deny(interaction, '이 판에 앉아 있지 않아요.'); return; }
    if (!seat.hole.length) { await deny(interaction, '아직 카드를 안 받았어요.'); return; }
    await interaction.reply({
      embeds: [holeEmbed(game, seat)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (Number(rev) !== game.rev) {
    await interaction.deferUpdate();
    await draw(game);
    return;
  }

  const handlers = { lobby: handleLobby };
  const handler = handlers[game.phase] ?? handlePlay;
  const refused = await handler(interaction, game, action, arg);
  if (refused) return;

  await interaction.deferUpdate();
  await draw(game);
  kick(game);
}

async function handleLobby(interaction, game, action, arg) {
  if (action === 'join') {
    const err = state.addSeat(
      game,
      state.humanSeat(interaction.user, interaction.member?.displayName),
    );
    if (err) { await deny(interaction, err); return true; }
    return false;
  }

  if (action === 'npc') {
    const err = state.addSeat(game, state.npcSeat(arg));
    if (err) { await deny(interaction, err); return true; }
    return false;
  }

  if (action === 'start') {
    if (interaction.user.id !== game.starterId) {
      await deny(interaction, '판을 연 사람만 시작할 수 있어요.');
      return true;
    }
    // 잔액 불러오기는 async 다. 상태를 바꾸기 전에 끝내 둔다.
    const balances = await load(game.guildId, game.seats.map((s) => s.id));
    const err = state.start(game, balances);
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

/** 베팅·정산 단계. 한 사람만 누르므로 버튼 비활성화가 통한다. */
async function handlePlay(interaction, game, action, arg) {
  if (action === 'next' || action === 'stop') {
    const seat = state.seatOf(game, interaction.user.id);
    if (!seat && game.starterId !== interaction.user.id) {
      await deny(interaction, '이 판에 앉은 사람만 누를 수 있어요.');
      return true;
    }
    if (game.phase !== 'settled') { await deny(interaction, '아직 핸드가 안 끝났어요.'); return true; }
    if (action === 'stop') { state.end(game, 'finished'); return false; }
    if (!state.nextHand(game)) return false;      // 둘이 안 남으면 판이 끝난다
    return false;
  }

  const seat = state.currentSeat(game);
  if (!seat || seat.kind !== 'human' || seat.userId !== interaction.user.id) {
    await deny(interaction, `지금은 ${seat?.name ?? '다른 사람'} 차례예요.`);
    return true;
  }

  if (action === 'raise') { game.raising = true; state.touch(game); return false; }
  if (action === 'back') { game.raising = false; state.touch(game); return false; }

  if (action === 'to') {
    game.raising = false;
    const err = state.act(game, 'raise', Number(arg));
    if (err) { game.raising = true; await deny(interaction, err); return true; }
    return false;
  }

  if (action === 'act') {
    game.raising = false;
    const err = state.act(game, arg);
    if (err) { await deny(interaction, err); return true; }
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
