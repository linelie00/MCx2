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
import {
  rollDice, reroll, totals, commit, scoreFor, categoryOf, MAX_ROLLS, ROUNDS,
} from '../yacht/rules.js';
import { chooseHold, chooseCategory, turnEvents } from '../yacht/ai.js';
import { line as npcLine, turnLines as npcTurnLines } from '../ai/gameTalk.js';
import { NAME } from '../ai/persona.js';
import { sayAs } from '../discord/webhook.js';
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

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** 나 말고 가장 높은 점수. 역전을 판단하는 데 쓴다. */
const bestOther = (game, me) => Math.max(
  0,
  ...game.seats.filter((s) => s !== me).map((s) => totals(s.sheet).total),
);

/**
 * 캐릭터로 한 줄 내보낸다.
 *
 * 웹훅이 막히면(봇에게 "웹훅 관리" 권한이 없는 채널 등) 일반 메시지로라도 보낸다.
 * /캐입 은 처음부터 이 대비책이 있었는데 요트에는 없어서, 권한이 없는 채널에서는
 * 대사가 통째로 사라져 기능이 죽은 것처럼 보였다.
 */
async function say(game, character, text) {
  try {
    await sayAs(game.message.channel, character, text);
  } catch (err) {
    console.warn('[요트] 웹훅 실패, 일반 메시지로 대체:', err.message);
    await game.message.channel
      .send({ content: `**${NAME[character]}** ${text}` })
      .catch((e) => console.warn('[요트] 대사 전송 실패:', e.message));
  }
}

/**
 * 판이 시작되면 NPC 가 한 마디씩.
 *
 * 말할 만한 순간은 판당 네 번쯤인데 대부분 중후반에 몰린다. 초반 몇 라운드가 통째로
 * 조용하면 기능이 안 도는 것처럼 보여서, 첫인사만은 문턱 없이 시킨다.
 */
async function openingLines(game) {
  const others = game.seats.map((s) => s.name);
  for (const seat of game.seats) {
    if (seat.kind !== 'npc') continue;
    const text = await npcLine({
      character: seat.character,
      situation: [
        '[요트 다이스 · 판이 막 시작됐다]',
        `${others.filter((n) => n !== seat.name).join(', ')} 와(과) 함께 한다.`,
        '아직 아무도 주사위를 굴리지 않았다.',
      ].join('\n'),
      said: game.said[seat.character],
    });
    if (!text) continue;
    game.said[seat.character].push(text);
    await say(game, seat.character, text);
    await sleep(700);
  }
}

/**
 * NPC 턴 한 개.
 *
 * 굴림은 전부 먼저 계산해 두고, 화면은 두 번만 고친다(굴린 직후 / 적은 직후).
 * 대사도 그 두 자리에 하나씩 붙는다 — 굴리면서 한 마디, 적으면서 한 마디.
 *
 * 턴을 통째로 계산한 뒤에 대사를 **한 번에** 받는 이유는 두 줄이 이어지게 하기
 * 위해서다. "5를 노려보지" 하고 굴린 다음 "결국 안 나왔군" 하고 적을 수 있다.
 * 덤으로 호출 수도 반이 된다.
 */
async function playNpcTurn(game, seat) {
  const sheetBefore = seat.sheet;
  const round = game.round;

  game.dice = rollDice();
  game.rollsLeft = MAX_ROLLS - 1;
  game.trail = [`1번째 — \`${game.dice.join(' ')}\``];
  const story = [`첫 굴림: ${game.dice.join(' ')}`];
  state.touch(game);
  await draw(game);                       // 편집 ①

  // 나머지 굴림은 화면을 안 고치고 진행한다. 과정은 trail 에 쌓아 한 번에 보여준다.
  while (game.rollsLeft > 0) {
    const held = chooseHold(seat.character, game.dice, seat.sheet, game.rollsLeft);
    if (held.every(Boolean)) { story.push('더 굴리지 않고 이대로 가기로 했다.'); break; }
    const kept = game.dice.filter((_, i) => held[i]);
    game.dice = reroll(game.dice, held);
    game.rollsLeft -= 1;
    game.trail.push(
      kept.length ? `　↳ \`${kept.join(' ')}\` 쥐고 다시` : '　↳ 전부 다시',
      `${MAX_ROLLS - game.rollsLeft}번째 — \`${game.dice.join(' ')}\``,
    );
    story.push(
      kept.length ? `${kept.join(' ')} 만 쥐고 나머지를 다시 굴렸다.` : '전부 다시 굴렸다.',
      `그래서 ${game.dice.join(' ')} 이 됐다.`,
    );
  }

  const dice = [...game.dice];
  const key = chooseCategory(seat.character, game.dice, seat.sheet);
  const wouldGain = scoreFor(key, dice);
  const sheetAfter = commit(sheetBefore, key, dice).sheet;

  // 대사를 먼저 받아 둔다. 그래야 굴린 직후에 첫 줄을 붙일 수 있다.
  const lines = await npcTurnLines({
    character: seat.character,
    situation: [
      `[요트 다이스 · ${round}/${ROUNDS}라운드] 내 차례다.`,
      ...story,
      `그리고 ${categoryOf(key).label} 칸에 ${wouldGain}점을 적기로 했다.`,
      turnEvents({
        gained: wouldGain, key, sheetBefore, sheetAfter, round,
        myTotal: totals(sheetAfter).total, bestOtherTotal: bestOther(game, seat),
      })[0]?.detail ?? '',
      `점수는 나 ${totals(sheetAfter).total}점, 앞선 사람이 ${bestOther(game, seat)}점.`,
    ].filter(Boolean).join('\n'),
    said: game.said[seat.character],
  });

  if (lines?.rolling) await say(game, seat.character, lines.rolling);

  // 사람이 읽을 시간을 준다. 겸사겸사 메시지 편집이 레이트리밋 큐에 밀리는 것도 피한다 —
  // discord.js 는 걸려도 오류를 안 내고 늦게 보내서, 많이 고치면 그냥 버벅이는 것처럼 보인다.
  await sleep(1200);
  if (game.phase !== 'playing') return;   // 그 사이 /요트 그만 이 올 수 있다

  game.held = [true, true, true, true, true];
  state.commitTo(game, key);
  await draw(game);                       // 편집 ②

  if (lines?.writing) await say(game, seat.character, lines.writing);
  if (lines) game.said[seat.character].push(...[lines.rolling, lines.writing].filter(Boolean));
}

/**
 * NPC 차례가 이어지는 동안 대신 둔다.
 *
 * 인터랙션 응답 경로 **밖에서** 돈다. Gemini 대사까지 붙으면 한 바퀴에 수십 초가 걸리는데,
 * 그걸 사람의 버튼 응답 안에 넣으면 3초 시한을 넘겨 10062 를 맞는다.
 * driving 플래그로 드라이버가 둘 도는 것을 막는다(지나간 버튼 클릭이 하나 더 띄울 수 있다).
 */
async function runNpcTurns(game) {
  if (game.driving) return;
  game.driving = true;
  try {
    if (!game.opened) { game.opened = true; await openingLines(game); }
    while (game.phase === 'playing' && state.current(game)?.kind === 'npc') {
      await playNpcTurn(game, state.current(game));
      await sleep(900);
    }
    if (game.phase === 'done' && game.endedReason === 'finished') await closingLines(game);
  } finally {
    game.driving = false;
  }
}

/** 판이 끝나면 NPC 가 한 마디씩. 한 판에서 대사가 가장 값진 자리라 문턱 없이 부른다. */
async function closingLines(game) {
  const rows = state.ranking(game);
  const board = rows.map((r) => `${r.rank}위 ${r.seat.name} ${r.total}점`).join(' / ');

  for (const r of rows) {
    if (r.seat.kind !== 'npc') continue;
    const text = await npcLine({
      character: r.seat.character,
      situation: [
        '[요트 다이스 · 판이 끝났다]',
        `결과: ${board}`,
        r.rank === 1 ? '내가 이겼다.' : `나는 ${r.rank}위로 끝났다.`,
      ].join('\n'),
      said: game.said[r.seat.character],
    });
    if (!text) continue;
    game.said[r.seat.character].push(text);
    await say(game, r.seat.character, text);
    await sleep(700);
  }
}

/**
 * NPC 드라이버를 띄운다. 기다리지 않는다 — 부르는 쪽은 이미 응답을 마쳤다.
 *
 * 사람 차례면 while 이 바로 빠지지만, 첫인사는 그 전에 나간다(사람이 먼저 두는 판에서도
 * 시작하자마자 NPC 가 말을 걸어야 한다).
 */
function kickNpc(game) {
  const npcSeated = game.seats.some((s) => s.kind === 'npc');
  if (game.phase !== 'playing' || !npcSeated) return;
  if (game.opened && state.current(game)?.kind !== 'npc') return;
  runNpcTurns(game).catch((err) => console.error('[요트] NPC 턴 오류:', err));
}

// 방치된 판을 접는다. 봇이 살아 있는 동안만 도는 타이머라 재시작하면 같이 사라지는데,
// 재시작하면 판 자체가 사라지므로 문제되지 않는다.
setInterval(() => {
  for (const game of state.expired()) draw(game);
}, 60_000).unref();

const data = new SlashCommandBuilder()
  .setName('요트')
  .setDescription('요트 다이스를 합니다.')
  .addSubcommand((s) => s.setName('시작').setDescription('새 판을 엽니다')
    .addStringOption((o) => o.setName('상대').setDescription('NPC 를 앉히고 바로 시작합니다')
      .addChoices(
        { name: '미겔', value: 'migel' },
        { name: '마티암', value: 'matiam' },
        { name: '미겔 + 마티암', value: 'both' },
      )))
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

    // 상대를 지정했으면 대기실을 건너뛰고 바로 시작한다. 둘이 쓰는 서버에서 혼자
    // NPC 랑 놀 때 버튼을 두 번 더 누르게 할 이유가 없다.
    const against = interaction.options.getString('상대');
    for (const c of against === 'both' ? ['migel', 'matiam'] : (against ? [against] : [])) {
      state.addSeat(game, state.npcSeat(c));
    }
    if (against) state.start(game);

    await interaction.reply(against
      ? { embeds: [boardEmbed(game)], components: boardRows(game) }
      : { embeds: [lobbyEmbed(game)], components: lobbyRows(game) });
    game.message = await interaction.fetchReply();
    kickNpc(game);
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
    const refusal = await handleLobby(interaction, game, action, arg);
    if (refusal) return;
  } else {
    const refusal = await handleTurn(interaction, game, action, arg);
    if (refusal) return;
  }

  await interaction.deferUpdate();
  await draw(game);
  kickNpc(game);
}

/** 대기실 버튼. 거절했으면 true 를 돌려준다(호출부가 더 진행하지 않게). */
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
