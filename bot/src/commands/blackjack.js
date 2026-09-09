/**
 * /블랙잭 — 카지노 bard
 *
 * 요트와 같은 배관을 쓴다. 판은 스레드에서 돌고, 항상 message.edit() 로 고치며,
 * customId 의 rev 로 지나간 클릭을 거른다. 상태 변경은 await 앞에서 동기로 끝낸다.
 *
 * 블랙잭에서 새로 지켜야 할 것 셋.
 *
 *   1. **정산은 드라이버에서만 한다.** component() 는 turn 을 넘기고 phase 를 바꿀 뿐,
 *      딜러 카드를 뽑거나 칩을 만지지 않는다. 딜러가 항상 마지막에 두므로 이건 규칙이
 *      아니라 구조다 — 정산에는 async 저장과 여러 줄의 알림이 붙어 3초 시한을 넘긴다.
 *   2. **베팅·인슈어런스 단계에서는 버튼을 끄지 않는다.** 여럿이 동시에 누르는 단계라
 *      "너는 이미 답했다" 를 버튼 상태로 표현할 수 없다. 사람마다 deny() 로 거절한다.
 *   3. **카드가 바뀌면 카드만 든 메시지를 따로 보낸다.** 디스코드는 메시지 전체가
 *      이모지일 때만 크게 그리고, 임베드 안에서는 아예 안 그린다. 그 뒤에 판을 다시
 *      띄워 버튼이 늘 맨 아래 있게 한다.
 */
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import * as state from '../blackjack/state.js';
import { chooseAction, chooseInsurance, chooseBet } from '../blackjack/ai.js';
import { load, commit } from '../casino/wallet.js';
import { MIN_BET } from '../blackjack/rules.js';
import {
  PREFIX, lobbyEmbed, lobbyRows, boardEmbed, boardRows, resultEmbed, cardsOnly,
} from '../blackjack/render.js';
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
    .catch((err) => console.warn('[블랙잭] 판 갱신 실패:', err.message));
}

/** 판을 맨 아래에 새로 띄운다. 새 것을 먼저 보내고 옛 것의 버튼을 걷는다. */
async function repost(game) {
  const old = game.message;
  const channel = old?.channel;
  if (!channel) return;

  const fresh = await channel.send(payloadFor(game)).catch((err) => {
    console.warn('[블랙잭] 판 새로 띄우기 실패:', err.message);
    return null;
  });
  if (!fresh) { await draw(game); return; }

  game.message = fresh;
  await old.edit({ components: [] }).catch(() => {});
}

/**
 * 카드를 크게 보여주고 판을 다시 띄운다.
 * 이모지만 든 메시지여야 크게 나오므로 이름 같은 걸 붙이지 않는다.
 */
async function showCards(game, cards) {
  const text = cardsOnly(cards);
  await game.message.channel.send({ content: text })
    .catch((err) => console.warn('[블랙잭] 카드 알림 실패:', err.message));
  await repost(game);
}

// ---------------------------------------------------------------- 드라이버
//
// NPC 차례와 딜러 진행, 정산이 전부 여기서 돈다. 인터랙션 응답 경로 밖이라
// 느린 일(칩 저장, 여러 줄 알림, 일부러 두는 간격)을 마음껏 할 수 있다.

async function playNpcHand(game) {
  const seat = state.currentSeat(game);
  for (;;) {
    if (game.phase !== 'playing') return;
    const hand = state.currentHand(game);
    if (!hand || state.seatOfHand(game, hand) !== seat) return;

    const legal = state.actionsFor(game);
    if (!legal.size) { state.advanceHand(game); await draw(game); return; }

    const action = chooseAction(seat.character, {
      cards: hand.cards, dealerUp: state.dealerUp(game), legal,
    });

    const before = hand.cards.length;
    const res = state.act(game, action);
    await sleep(900);
    if (game.phase === 'done') return;

    // 카드가 늘었으면 크게 보여준다. 스플릿은 손이 둘이 되므로 판만 다시 그린다.
    if (hand.cards.length > before) await showCards(game, hand.cards);
    else await draw(game);

    if (res.moved) return;
  }
}

async function runDriver(game) {
  if (game.driving) return;
  game.driving = true;
  try {
    for (;;) {
      if (game.phase === 'done') return;

      // --- 베팅: NPC 는 알아서 건다
      if (game.phase === 'betting') {
        let bet = false;
        for (const seat of state.active(game)) {
          if (seat.kind !== 'npc' || seat.bet) continue;
          const amount = chooseBet(seat.character, {
            chips: seat.chips, lastBet: seat.bet, lastWon: seat.lastWon,
          });
          state.placeBet(game, seat, amount || MIN_BET);
          bet = true;
        }
        if (bet) await draw(game);
        if (!state.allBetsIn(game)) return;      // 사람을 기다린다

        state.deal(game);
        await draw(game);
        for (const hand of game.hands) {
          await sleep(700);
          await showCards(game, hand.cards);
        }

        if (state.needsInsurance(game)) {
          state.beginInsurance(game);
          for (const seat of state.active(game)) {
            if (seat.kind !== 'npc') continue;
            state.answerInsurance(game, seat, chooseInsurance(seat.character));
          }
          await draw(game);
          if (!state.allInsuranceIn(game)) return;   // 사람을 기다린다
        }

        if (state.peek(game)) { await settleAndShow(game); continue; }
        state.beginPlaying(game);
        await draw(game);
        continue;
      }

      // --- 인슈어런스: 사람이 다 답했으면 이어서
      if (game.phase === 'insurance') {
        if (!state.allInsuranceIn(game)) return;
        if (state.peek(game)) { await settleAndShow(game); continue; }
        state.beginPlaying(game);
        await draw(game);
        continue;
      }

      // --- 플레이: NPC 차례면 대신 두고, 사람 차례면 물러난다
      if (game.phase === 'playing') {
        const seat = state.currentSeat(game);
        if (!seat) { await draw(game); continue; }
        if (seat.kind !== 'npc') return;
        await playNpcHand(game);
        continue;
      }

      // --- 딜러
      if (game.phase === 'dealer') {
        await sleep(800);
        state.dealerDraw(game);                  // 홀카드를 깐다
        await showCards(game, game.dealer);

        if (state.anyoneAlive(game)) {
          while (state.dealerDraw(game)) {
            await sleep(900);
            if (game.phase === 'done') return;
            await showCards(game, game.dealer);
          }
        }
        await settleAndShow(game);
        continue;
      }

      return;      // settled — 사람이 [다음 핸드] 를 누를 때까지 기다린다
    }
  } finally {
    game.driving = false;
  }
}

/** 정산하고 결과를 보여준다. 칩 저장도 여기서 — 인터랙션 경로 밖이라 await 해도 된다. */
async function settleAndShow(game) {
  state.settle(game);
  await draw(game);
  await commit(game.guildId, game.chips.deltas());
}

/** 드라이버를 띄운다. 기다리지 않는다 — 부르는 쪽은 이미 응답을 마쳤다. */
function kick(game) {
  if (game.phase === 'done' || game.phase === 'lobby') return;
  runDriver(game).catch((err) => console.error('[블랙잭] 드라이버 오류:', err));
}

// 방치된 판을 접는다.
setInterval(() => {
  for (const game of state.expired()) draw(game);
}, 60_000).unref();

// ---------------------------------------------------------------- 명령

const data = new SlashCommandBuilder()
  .setName('블랙잭')
  .setDescription('카지노 bard 에서 블랙잭을 합니다.')
  .addSubcommand((s) => s.setName('시작').setDescription('새 판을 엽니다'))
  .addSubcommand((s) => s.setName('판').setDescription('판을 다시 띄웁니다'))
  .addSubcommand((s) => s.setName('그만').setDescription('진행 중인 판을 접습니다'));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const existing = state.forChannel(interaction.channelId);
  const live = existing && existing.phase !== 'done' ? existing : null;

  if (sub === '시작') {
    if (live) {
      await deny(interaction, '이 채널에 이미 판이 있어요. `/블랙잭 판` 으로 띄우거나 `/블랙잭 그만` 으로 접어주세요.');
      return;
    }

    const starter = interaction.member?.displayName
      || interaction.user.globalName || interaction.user.username;

    await interaction.reply({ embeds: [base({ description: `bard 의 테이블을 엽니다 — ${starter}` })] });
    const anchor = await interaction.fetchReply();

    let room = interaction.channel;
    try {
      if (!interaction.channel.isThread()) {
        room = await anchor.startThread({
          name: `🃏 블랙잭 — ${starter}`,
          autoArchiveDuration: 1440,
        });
      }
    } catch (err) {
      console.warn('[블랙잭] 스레드를 못 만들어 채널에서 진행합니다:', err.message);
      room = interaction.channel;
    }

    const game = state.create({
      channelId: room.id,
      homeChannelId: interaction.channelId,
      guildId: interaction.guildId,
      starterId: interaction.user.id,
    });
    state.addSeat(game, state.humanSeat(interaction.user, interaction.member?.displayName));

    if (room.id === interaction.channelId) {
      await interaction.editReply(payloadFor(game));
      game.message = anchor;
    } else {
      game.message = await room.send(payloadFor(game));
    }
    return;
  }

  if (sub === '판') {
    if (!live) { await deny(interaction, '진행 중인 판이 없어요.'); return; }
    await repost(live);
    await interaction.reply({
      embeds: [base({ description: `판을 다시 띄웠어요. <#${live.channelId}>` })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 그만
  if (!live) { await deny(interaction, '진행 중인 판이 없어요.'); return; }
  if (!state.seatOf(live, interaction.user.id) && live.starterId !== interaction.user.id) {
    await deny(interaction, '이 판에 앉은 사람만 접을 수 있어요.');
    return;
  }
  state.end(live, 'cancelled');
  await interaction.reply({
    embeds: [base({ description: '판을 접었어요.' })],
    flags: MessageFlags.Ephemeral,
  });
  await draw(live);
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

  if (Number(rev) !== game.rev) {
    await interaction.deferUpdate();
    await draw(game);
    return;
  }

  const handlers = {
    lobby: handleLobby,
    betting: handleBetting,
    insurance: handleInsurance,
    playing: handlePlaying,
    settled: handleSettled,
  };
  const handler = handlers[game.phase];
  if (!handler) { await deny(interaction, '지금은 누를 수 없어요.'); return; }

  const refused = await handler(interaction, game, action, arg);
  if (refused) return;

  await interaction.deferUpdate();
  await draw(game);

  // 알림은 판을 그린 뒤에. 상태 변경 자리에서 보내면 응답이 그만큼 늦어진다.
  const queued = game.pendingChat.splice(0);
  for (const cards of queued) await showCards(game, cards);

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

/** 베팅 — 여럿이 동시에 누른다. 버튼을 끄는 대신 사람마다 거절한다. */
async function handleBetting(interaction, game, action, arg) {
  const seat = state.seatOf(game, interaction.user.id);
  if (!seat) { await deny(interaction, '이 판에 앉아 있지 않아요.'); return true; }
  if (seat.out) { await deny(interaction, '칩이 모자라 이번 판은 쉬어요.'); return true; }

  if (action === 'bet') {
    const err = state.stageBet(game, seat, Number(arg));
    if (err) { await deny(interaction, err); return true; }
    return false;
  }
  if (action === 'clear') {
    const err = state.clearBet(game, seat);
    if (err) { await deny(interaction, err); return true; }
    return false;
  }
  if (action === 'allin') {
    if (seat.bet) { await deny(interaction, '이미 베팅했어요.'); return true; }
    const err = state.placeBet(game, seat, state.allIn(seat));
    if (err) { await deny(interaction, err); return true; }
    return false;
  }
  if (action === 'confirm') {
    if (!seat.staged) { await deny(interaction, '먼저 칩을 올려 주세요.'); return true; }
    const err = state.placeBet(game, seat);
    if (err) { await deny(interaction, err); return true; }
    return false;
  }

  await deny(interaction, '지금은 누를 수 없는 버튼이에요.');
  return true;
}

/** 인슈어런스 — 여기도 여럿이 동시에 누른다. */
async function handleInsurance(interaction, game, action, arg) {
  const seat = state.seatOf(game, interaction.user.id);
  if (!seat || seat.out) { await deny(interaction, '이 판에 앉아 있지 않아요.'); return true; }
  if (action !== 'ins') { await deny(interaction, '지금은 누를 수 없는 버튼이에요.'); return true; }

  const err = state.answerInsurance(game, seat, arg === 'yes');
  if (err) { await deny(interaction, err); return true; }
  return false;
}

/** 플레이 — 한 사람만 누른다. 버튼 비활성화가 통하는 유일한 단계다. */
async function handlePlaying(interaction, game, action, arg) {
  const seat = state.currentSeat(game);
  if (!seat || seat.kind !== 'human' || seat.userId !== interaction.user.id) {
    await deny(interaction, `지금은 ${seat?.name ?? '다른 사람'} 차례예요.`);
    return true;
  }
  if (action !== 'act') { await deny(interaction, '지금은 누를 수 없는 버튼이에요.'); return true; }
  if (!state.actionsFor(game).has(arg)) { await deny(interaction, '지금은 못 하는 수예요.'); return true; }

  const hand = state.currentHand(game);
  const before = hand.cards.length;
  state.act(game, arg);
  // 카드가 늘었으면 판을 그린 뒤에 크게 보여준다.
  if (hand.cards.length > before) game.pendingChat.push([...hand.cards]);
  return false;
}

async function handleSettled(interaction, game, action) {
  const seat = state.seatOf(game, interaction.user.id);
  if (!seat && game.starterId !== interaction.user.id) {
    await deny(interaction, '이 판에 앉은 사람만 누를 수 있어요.');
    return true;
  }

  if (action === 'next') { state.nextHand(game); return false; }
  if (action === 'stop') { state.end(game, 'finished'); return false; }

  await deny(interaction, '지금은 누를 수 없는 버튼이에요.');
  return true;
}

export default {
  data,
  execute,
  componentPrefix: PREFIX,
  component,
};
