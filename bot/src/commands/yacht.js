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
import { sayAsOrPlain } from '../discord/webhook.js';
import * as state from '../yacht/state.js';
import {
  PREFIX, faces, howto, lobbyEmbed, lobbyRows, boardEmbed, boardRows, resultEmbed,
} from '../yacht/render.js';
import { base, fail, THEME_COLOR } from '../embeds.js';
import { apply } from '../casino/wallet.js';
import { NPC_ID } from '../casino/accounts.js';

const { filledCount } = state;

/** 자기만 보이는 거절. 판을 건드리지 않는다. */
const deny = (interaction, text) =>
  interaction.reply({ embeds: [fail(text)], flags: MessageFlags.Ephemeral });

/** 지금 상태를 메시지 내용으로. 그리기와 새로 띄우기가 같이 쓴다. */
function payloadFor(game) {
  // 시작도 안 한 판을 접었으면 점수표를 보여줄 게 없다.
  const neverPlayed = game.round === 1 && game.seats.every((s) => filledCount(s.sheet) === 0);
  if (game.phase === 'done') {
    return {
      embeds: [neverPlayed ? base({ description: '판을 접었어요.' }) : resultEmbed(game)],
      components: [],
    };
  }
  return game.phase === 'lobby'
    ? { embeds: [lobbyEmbed(game)], components: lobbyRows(game) }
    : { embeds: [boardEmbed(game)], components: boardRows(game) };
}

/** 있는 자리에서 고친다. 사람이 자기 턴을 두는 동안은 전부 이쪽이다(메시지가 안 늘어난다). */
async function draw(game) {
  if (!game.message) return;
  await game.message.edit(payloadFor(game)).catch((err) => {
    console.warn('[요트] 판 갱신 실패:', err.message);
  });
}

/**
 * 판을 맨 아래에 새로 띄운다.
 *
 * NPC 가 말을 하고 나면 판이 대사에 밀려 위로 올라가 버려서, 버튼을 누르려면 스크롤을
 * 올려야 한다. 그래서 NPC 차례가 끝나면 판을 새로 띄운다.
 * 새 메시지를 **먼저** 보내고 옛 것의 버튼을 걷는다 — 반대로 하면 잠깐 누를 판이 없어진다.
 */
async function repost(game) {
  const old = game.message;
  const channel = old?.channel;
  if (!channel) return;

  const fresh = await channel.send(payloadFor(game)).catch((err) => {
    console.warn('[요트] 판 새로 띄우기 실패:', err.message);
    return null;
  });
  if (!fresh) { await draw(game); return; }

  game.message = fresh;
  await old.edit({ components: [] }).catch(() => {});
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** 나 말고 가장 높은 점수. 역전을 판단하는 데 쓴다. */
const bestOther = (game, me) => Math.max(
  0,
  ...game.seats.filter((s) => s !== me).map((s) => totals(s.sheet).total),
);

/** 캐릭터로 한 줄 내보낸다. 웹훅이 막힌 채널에서는 일반 메시지로 물러선다. */
const say = (game, character, text) =>
  sayAsOrPlain(game.message.channel, character, text, '요트');

/**
 * 굴린 결과를 채팅에 한 줄 남긴다.
 *
 * 캐릭터 웹훅이 아니라 봇 이름으로 보낸다 — 대사와 섞이면 어디까지가 그 사람이 한 말인지
 * 알 수 없다.
 *
 * 남긴 주사위는 "(6 6 남기고)" 처럼 따로 적지 않고 결과 안에서 구분해 그린다.
 * 같은 눈을 두 번 쓰니 줄이 길어지고 어느 자리가 남은 것인지도 안 보였다.
 */
async function rolled(game, seat, nth, dice, held) {
  await game.message.channel
    .send({ content: `🎲 **${seat.name}** ${nth}번째 — ${faces(dice, held)}` })
    .catch((err) => console.warn('[요트] 굴림 알림 실패:', err.message));
}

/**
 * 판이 시작되면 NPC 가 한 마디씩.
 *
 * 말할 만한 순간은 판당 네 번쯤인데 대부분 중후반에 몰린다. 초반 몇 라운드가 통째로
 * 조용하면 기능이 안 도는 것처럼 보여서, 첫인사만은 문턱 없이 시킨다.
 */
async function openingLines(game) {
  const others = game.seats.map((s) => s.name);
  let spoke = false;
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
    spoke = true;
    await sleep(700);
  }
  return spoke;
}

/**
 * NPC 턴 한 개.
 *
 * 판 자체는 두 번만 고친다(굴린 직후 / 적은 직후). 대신 굴릴 때마다 채팅에 한 줄씩
 * 남겨서 과정이 보이게 한다 — 판만 고치면 뭘 쥐고 뭘 다시 굴렸는지가 순식간에 지나간다.
 * 대사는 굴리면서 한 마디, 적으면서 한 마디.
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
  game.trail = [`1번째 — ${faces(game.dice)}`];
  const story = [`첫 굴림: ${game.dice.join(' ')}`];
  state.touch(game);
  await draw(game);                       // 편집 ①
  await rolled(game, seat, 1, game.dice, null);

  // 굴릴 때마다 채팅으로 알린다. 판만 고치면 NPC 가 뭘 쥐고 뭘 다시 굴렸는지가
  // 순식간에 지나가 버려서, 결과만 덩그러니 남고 과정이 안 보인다.
  while (game.rollsLeft > 0) {
    const held = chooseHold(seat.character, game.dice, seat.sheet, game.rollsLeft);
    if (held.every(Boolean)) {
      story.push('더 굴리지 않고 이대로 가기로 했다.');
      break;
    }
    const kept = game.dice.filter((_, i) => held[i]);
    game.dice = reroll(game.dice, held);
    game.rollsLeft -= 1;
    game.trail.push(`${MAX_ROLLS - game.rollsLeft}번째 — ${faces(game.dice, held)}`);
    story.push(
      kept.length ? `${kept.join(' ')} 만 쥐고 나머지를 다시 굴렸다.` : '전부 다시 굴렸다.',
      `그래서 ${game.dice.join(' ')} 이 됐다.`,
    );
    await sleep(800);
    await rolled(game, seat, MAX_ROLLS - game.rollsLeft, game.dice, held);
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
      // 누구에게 말하는지 알려 준다. 이게 없으면 혼잣말처럼 굴어서 말투가 흐려진다.
      `같이 하는 사람: ${game.seats.filter((s) => s !== seat).map((s) => s.name).join(', ')}`,
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
  if (game.phase !== 'playing') return Boolean(lines?.rolling);   // 그 사이 /요트 그만 이 올 수 있다

  game.held = [true, true, true, true, true];
  state.commitTo(game, key);
  await draw(game);                       // 편집 ②

  if (lines?.writing) await say(game, seat.character, lines.writing);
  if (lines) game.said[seat.character].push(...[lines.rolling, lines.writing].filter(Boolean));
  return Boolean(lines?.rolling || lines?.writing);
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
  let spoke = false;
  try {
    if (!game.opened) { game.opened = true; spoke = await openingLines(game); }
    while (game.phase === 'playing' && state.current(game)?.kind === 'npc') {
      spoke = (await playNpcTurn(game, state.current(game))) || spoke;
      await sleep(900);
    }
    if (game.phase === 'done' && game.endedReason === 'finished') await closingLines(game);
    if (game.phase === 'done') await finish(game);
    // 대사에 밀려 올라간 판을 다시 맨 아래로. NPC 차례 묶음마다 한 번씩만 한다 —
    // 굴릴 때마다 새로 띄우면 스레드가 판으로 도배된다.
    if (spoke) await repost(game);
  } finally {
    game.driving = false;
  }
}

/**
 * 판이 끝났다. **1위에게 MT 한 개.**
 *
 * MT 는 얻는 길이 좁다 — 요트 1위와 홀덤 토너먼트 우승뿐이다. 그래서 조건을 좁게 잡는다.
 *
 *   - **동점이면 안 준다.** `ranking()` 은 동점을 같은 등수로 묶어서, 셋이 비기면 1위가
 *     셋이고 MT 가 세 개 생긴다.
 *   - **혼자 둔 판은 안 준다.** 아무도 안 이긴 1위다.
 *   - **끝까지 둔 판만.** 접거나 방치로 끝난 판은 아니다.
 *
 * **끝나는 길이 둘인데 한 곳으로 안 모인다.** NPC 가 마지막 칸을 채운 판은
 * `runNpcTurns` 로 오고, **사람이 채운 판은 거기 안 온다** — `kickNpc` 가
 * `phase !== 'playing'` 이라 바로 돌아오기 때문이다. 그래서 양쪽에서 부르고, 두 번
 * 부르는 것을 플래그로 막는다. 플래그는 **첫 await 앞에서 동기로** 세운다.
 */
async function finish(game) {
  if (game.rewarded) return;
  game.rewarded = true;
  if (game.endedReason !== 'finished' || game.seats.length < 2) return;

  const rows = state.ranking(game);
  const first = rows.filter((r) => r.rank === 1);
  if (first.length !== 1) return;

  const seat = first[0].seat;
  const id = seat.kind === 'human' ? seat.userId : NPC_ID[seat.character];
  if (!id) return;

  // 요트는 여태 서버를 한 번도 안 불렀다. 여기서 처음 부르는 만큼, 실패해도 판이
  // 깨지지 않게 통째로 감싼다.
  try {
    const res = await apply({ mt: { [id]: 1 } });
    if (!res.ok) return;
    await game.message?.channel?.send({
      embeds: [base({
        title: '🪙 MT +1',
        description: `**${seat.name}** 이(가) 1위로 MT 를 얻었어요.`
          + ` 지금 **${res.accounts[id]?.mt ?? '?'}개**.`,
        color: THEME_COLOR,
      })],
    });
  } catch (err) {
    console.warn('[요트] MT 지급 실패:', err.message);
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
  const existing = state.forChannel(interaction.channelId);
  const live = existing && existing.phase !== 'done' ? existing : null;

  if (sub === '시작') {
    if (live) {
      await deny(interaction, '이 채널에 이미 판이 있어요. `/요트 판` 으로 띄우거나 `/요트 그만` 으로 접어주세요.');
      return;
    }
    const starter = interaction.member?.displayName
      || interaction.user.globalName || interaction.user.username;

    // 판을 스레드에서 돌린다. 주사위와 대사가 오가는 통에 원래 채널이 묻히지 않는다.
    // 스레드를 못 만드는 채널(권한이 없거나 이미 스레드 안이거나)이면 그냥 여기서 한다.
    await interaction.reply({ embeds: [base({ description: `요트 판을 엽니다 — ${starter}` })] });
    const anchor = await interaction.fetchReply();

    let room = interaction.channel;
    try {
      if (!interaction.channel.isThread()) {
        room = await anchor.startThread({
          name: `🎲 요트 다이스 — ${starter}`,
          autoArchiveDuration: 1440,
        });
      }
    } catch (err) {
      console.warn('[요트] 스레드를 못 만들어 채널에서 진행합니다:', err.message);
      room = interaction.channel;
    }

    const game = state.create({
      channelId: room.id,
      homeChannelId: interaction.channelId,
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

    // 규칙 안내를 판보다 먼저 한 번. 스레드를 못 만들었을 때도 순서가 맞게, 판은
    // 항상 새 메시지로 보낸다(예전엔 안내 메시지를 판으로 덮어써서 하나 아꼈는데,
    // 그러면 규칙이 판 아래로 가서 버튼이 위에 오게 된다).
    await room.send({ embeds: [howto()] })
      .catch((err) => console.warn('[요트] 규칙 안내 실패:', err.message));
    game.message = await room.send(payloadFor(game));
    kickNpc(game);
    return;
  }

  if (sub === '판') {
    if (!live) {
      await deny(interaction, '진행 중인 판이 없어요.');
      return;
    }
    // 판이 도는 곳(대개 스레드)에 새로 띄운다. 명령을 바깥 채널에서 쳤다고 판을 그쪽으로
    // 옮기면 안 된다 — 판이 두 군데로 갈라진다.
    await repost(live);
    await interaction.reply({
      embeds: [base({ description: `판을 다시 띄웠어요. <#${live.channelId}>` })],
      flags: MessageFlags.Ephemeral,
    });
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
  const game = state.forChannel(interaction.channelId);

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

  // **사람이 마지막 칸을 채운 판은 kickNpc 가 바로 돌아가서 드라이버에 안 닿는다.**
  // 보상을 드라이버에만 걸면 그런 판이 통째로 빠진다.
  if (game.phase === 'done') await finish(game);

  // 사람이 굴린 것도 채팅에 남긴다. 판을 새로 띄우고 나면 앞 굴림이 판에서 사라지는데,
  // 채팅에 남아 있으면 이번 턴에 무엇을 어떻게 굴렸는지 되짚을 수 있다.
  if (game.pendingRoll) {
    const p = game.pendingRoll;
    game.pendingRoll = null;
    await rolled(game, p.seat, p.nth, p.dice, p.held);
  }

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
    // 첫 굴림에는 남긴 것이 없다. 다시 굴릴 때만 어느 자리를 쥐고 있었는지 표시한다.
    const held = game.dice ? [...game.held] : null;
    game.dice = game.dice ? reroll(game.dice, game.held) : rollDice();
    game.rollsLeft -= 1;
    game.trail.push(`${MAX_ROLLS - game.rollsLeft}번째 — ${faces(game.dice, held)}`);
    // 채팅 알림은 판을 다 그린 뒤에 보낸다. 여기서 보내면 인터랙션 응답이 그만큼 늦어진다.
    game.pendingRoll = { seat, nth: MAX_ROLLS - game.rollsLeft, dice: [...game.dice], held };
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
