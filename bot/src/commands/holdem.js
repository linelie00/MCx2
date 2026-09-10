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
import { chooseAction, readRange } from '../holdem/ai.js';
import { live } from '../holdem/rules.js';
import { loadAccounts, commit, buyIn } from '../casino/wallet.js';
import { seatedAt, seatedMessage } from '../casino/tables.js';
import { STAKES_CHOICES, tooPoor } from '../casino/stakes.js';
import { drawMobs } from '../holdem/mobs.js';
import {
  PREFIX, howto, ranking, lobbyEmbed, lobbyRows, boardEmbed, boardRows,
  holeMessage, turnCall, resultEmbed,
} from '../holdem/render.js';
import { handText, isJumboable } from '../casino/cards.js';
import { CATEGORIES } from '../casino/poker.js';
import {
  earned as earnedTitles, gained as gainedTitles, counterForHand, isHighCard,
} from '../casino/titles.js';
import {
  line, sometimes, memo, handName, spoilerVeto,
} from '../holdem/lines.js';
import * as casinoTalk from '../ai/casinoTalk.js';
import { sayAsOrPlain } from '../discord/webhook.js';
import { base, fail } from '../embeds.js';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * NPC·모브가 수를 두기 전에 쉬는 시간.
 *
 * 생각하는 것처럼 보이라고 두는 뜸인데, **자리 수만큼 그대로 곱해진다.** 여덟
 * 자리에서 0.9초씩 쉬면 한 스트리트에만 7초가 그냥 흐른다. 자리가 많을수록 줄인다.
 */
const thinkPause = (game) => Math.max(320, 950 - game.seats.length * 80);

/**
 * 모브가 체크·콜에도 한마디 할 확률.
 *
 * 큰 수와 폴드는 늘 말한다. 문제는 자잘한 수인데, 여덟 자리에서 다 말하면 한
 * 핸드에 서른 줄이 넘는다. 자리가 늘면 그만큼 조용해진다.
 */
const chatterOdds = (game) => Math.min(0.34, 1.2 / game.seats.length);

/** 자기만 보이는 거절. 판을 건드리지 않는다. */
const deny = (interaction, text) =>
  interaction.reply({ embeds: [fail(text)], flags: MessageFlags.Ephemeral });

/**
 * ack 를 이미 보낸 뒤의 거절. `deny` 는 reply 라서 그 자리에서는 못 쓴다 —
 * 한 인터랙션에 응답은 한 번뿐이다.
 */
const denyLate = (interaction, text) =>
  interaction.followUp({ embeds: [fail(text)], flags: MessageFlags.Ephemeral });

// ---------------------------------------------------------------- 그리기

function payloadFor(game) {
  if (game.phase === 'done') {
    const nothing = game.handNo === 0;
    return {
      embeds: [nothing ? base({ description: '판을 접었어요.' }) : resultEmbed(game)],
      components: [],
    };
  }
  if (game.phase === 'lobby') {
    return { embeds: [lobbyEmbed(game)], components: lobbyRows(game) };
  }
  // 차례인 사람을 판 위에 같이 부른다. 따로 보내면 판이 또 밀린다.
  const call = turnCall(game);
  return {
    ...(call ? { content: call } : { content: '' }),
    embeds: [boardEmbed(game)],
    components: boardRows(game),
  };
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
  game.boardBottom = true;
  await old.edit({ components: [] }).catch(() => {});
}

/**
 * 커뮤니티 카드가 깔렸을 때만 채팅에 남긴다. 액션마다 남기면 판이 묻힌다.
 *
 * **이모지만 보내면 디스코드가 크게 그린다.** 그래서 "플랍" 같은 이름표를 붙이지
 * 않는다 — 글자가 하나라도 섞이면 카드가 글자 크기로 쪼그라든다. 어느 스트리트인지는
 * 바로 아래 판의 제목에 있으므로 여기서 또 적을 이유가 없다.
 *
 * (블랙잭에서는 반대로 골랐다. 거기서는 카드가 누구 것인지 알 수 없어서 이름을 붙이는
 * 대신 작아지는 쪽을 택했는데, 홀덤의 보드는 모두가 함께 쓰는 것이라 헷갈릴 일이 없다.)
 */
async function showBoard(game, label) {
  if (!game.message?.channel) return;
  const cards = handText(game.board);
  const content = isJumboable(cards) ? cards : `**${label}**\n${cards}`;
  game.boardBottom = false;
  await game.message.channel.send({ content })
    .catch((err) => console.warn('[홀덤] 보드 알림 실패:', err.message));
  await repost(game);
}

// ---------------------------------------------------------------- 대사
//
// 블랙잭과 같은 얼개다 — Gemini 로 먼저 지어 보고 안 되면 미리 써 둔 줄로 물러선다.
// 대사는 전부 드라이버 안에서만 나간다(웹훅이 느려서 인터랙션 응답 경로에 두면 안 된다).

/** 한 핸드에 Gemini 로 지을 수 있는 대사 수. 홀덤은 라운드가 넷이라 자리가 더 많다. */
const AI_PER_HAND = 3;

function aiBudget(game) {
  if (game.aiHandNo !== game.handNo) {
    game.aiHandNo = game.handNo;
    game.aiLeft = AI_PER_HAND;
  }
  return game.aiLeft;
}

/**
 * 그 캐릭터로 한 줄. 말했으면 true.
 *
 * 메모는 **화자별로** 만든다(holdem/lines.js) — 블랙잭처럼 모두의 카드를 넘기면
 * NPC 가 남의 홀 카드를 말한다.
 */
async function say(game, character, key, vars = {}, { always = false, p, live: liveP = 0 } = {}) {
  if (!always && !sometimes(p)) return false;
  if (!game.message?.channel) return false;

  let text = null;
  if (liveP && aiBudget(game) > 0 && Math.random() < liveP) {
    const said = (game.spoken[character] ??= []);
    const situation = memo(game, key, vars, character);
    if (situation) {
      text = await casinoTalk.line({
        game: 'holdem',
        character,
        role: 'player',
        situation,
        said,
        veto: spoilerVeto(game, character),
      });
    }
    if (text) { game.aiLeft -= 1; said.push(text); }
  }

  if (!text) text = line(key, vars);
  if (!text) return false;

  game.boardBottom = false;                 // 판이 대사에 밀렸다
  await sayAsOrPlain(game.message.channel, character, text, '홀덤');
  await sleep(700);
  return true;
}

/**
 * 아직 살아 있는 상대들이 **이번 핸드에 어떻게 나왔는지**.
 *
 * 계속 올린 상대에게 7♠2♦ 를 쥐여 주고 승률을 재면 자기 손을 실제보다 좋게 본다.
 * 그래서 각자에게 시작패 문턱을 하나씩 매겨 넘긴다(holdem/ai.js 의 readRange).
 *
 * 흐름 기록(game.hist)은 원래 대사가 읽으려고 만든 것인데, 여기가 두 번째 쓰임이다.
 * 전부 화면에 보였던 공개 정보라 봇만 아는 것이 없다.
 */
function opponentReads(game, me) {
  const others = live(game.seats).filter((s) => s !== me);
  if (!others.length) return 1;                 // 남은 상대가 없어도 0 은 안 넘긴다
  return others.map((s) => readRange(
    (game.hist ?? []).filter((h) => h.id === s.id).map((h) => h.act),
  ));
}

/** 모브가 둔 수를 한국어로. 「20 레이즈」처럼 액수가 먼저다. */
const MOVE_TEXT = {
  fold: () => '폴드',
  check: () => '체크',
  call: (n) => `${n} 콜`,
  raise: (n) => `${n} 레이즈`,
  allin: (n) => `${n} 올인`,
};

/**
 * 모브는 **수만 말한다.** 성격을 지어내지 않는다.
 *
 * 엘리트 에너미 서른다섯에게 각자 말투를 줄 수도 없고, Gemini 를 부르면 한 판에 대사가
 * 수십 번 나가 한도를 혼자 다 쓴다. 대신 판이 조용하지 않을 만큼만 — 큰 수와 폴드는
 * 늘, 체크·콜은 가끔. 어차피 자리 표의 "방금" 칸에 다 남는다.
 */
async function mobSays(game, seat, action, amount, always) {
  if (!always && !sometimes(chatterOdds(game))) return;
  if (!game.message?.channel) return;
  const text = MOVE_TEXT[action]?.(amount);
  if (!text) return;

  game.boardBottom = false;                 // 판이 대사에 밀렸다
  await game.message.channel.send({ content: `**${seat.name}** ${text}` });
  await sleep(400);
}

const seatSays = (game, seat, key, vars, opts = {}) => (
  seat.kind === 'npc'
    ? say(game, seat.character, `player.${seat.character}.${key}`, vars, { p: 0.55, live: 0.3, ...opts })
    : Promise.resolve(false)
);

/** 옆자리 반응. 수를 둔 사람이 아닌 다른 NPC 가 말한다. */
async function banter(game, actor, key, vars = {}, p = 0.4) {
  const watchers = game.seats.filter((s) => s.kind === 'npc' && s !== actor && !s.out && !s.folded);
  if (!watchers.length) return false;
  const w = watchers[Math.floor(Math.random() * watchers.length)];
  return say(game, w.character, `banter.${w.character}.${key}`,
    { name: actor.name, ...vars }, { p, live: 0.55 });
}

/**
 * 판을 접으며 하는 인사. 앉아 있던 NPC 가 각자 한마디씩.
 *
 * 시작할 때 인사를 하고 끝날 때 아무 말도 없으면 판이 끊긴 것처럼 보인다.
 * 판에 한 번뿐인 자리라 전원 무조건 말하고, 마지막 핸드가 예산을 다 썼어도 따로 받는다.
 */
async function closeTable(game) {
  game.aiHandNo = -1;
  const final = state.standings(game);
  const rows = final.map(({ seat, chips, delta }) => ({ name: seat.name, chips, delta }));

  for (const { seat, delta } of final) {
    if (seat.kind !== 'npc') continue;
    // 결산 전체를 넘긴다 — 누가 얼마를 벌고 잃었는지 알아야 남에게 말을 걸 수 있다.
    await seatSays(game, seat, 'close',
      { amount: `${Math.abs(delta)}칩`, delta, table: rows, me: seat.name },
      { always: true, live: 0.8 });
  }
  await repost(game);
}

/** 판을 열며 하는 인사. bard 주인인 미겔이 있으면 미겔이, 없으면 마티암이 한다. */
async function openTable(game) {
  game.opened = true;
  const host = game.seats.find((s) => s.character === 'migel')
    ?? game.seats.find((s) => s.kind === 'npc');
  if (host) await seatSays(game, host, 'welcome', {}, { always: true, live: 1 });
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
      if (!game.opened) await openTable(game);

      // 스트리트가 바뀌었으면 보드를 알리고 판을 다시 띄운다.
      if (game.phase !== street) {
        street = game.phase;
        if (STREET_NAME[street]) {
          await showBoard(game, STREET_NAME[street]);
          const talker = game.seats.find((s) => s.kind === 'npc' && !s.folded && !s.out);
          if (talker && await seatSays(game, talker, 'street', { street: STREET_NAME[street] },
            { p: 0.4 })) await repost(game);
        } else {
          await draw(game);
        }
      }

      if (game.phase === 'showdown') { await settleAndShow(game); continue; }
      if (game.phase === 'settled') return;      // 사람이 [다음 핸드] 를 누를 때까지

      const seat = state.currentSeat(game);
      if (!seat) { await draw(game); return; }

      // 사람 차례면 물러난다. 그 전에 **판이 밀려났으면 아래에 다시 띄우고 이름을 부른다** —
      // 대사와 카드에 밀려 판이 위로 올라가면 자기 차례인 줄 모르고 기다리게 된다.
      // 알림은 새 메시지로 나갈 때만 울리므로 부르는 효과도 여기서만 생긴다.
      //
      // 이미 맨 아래에 있으면 제자리에서 고치기만 한다. 안 그러면 스트리트가 바뀔 때
      // showBoard 가 띄운 판 바로 밑에 또 하나가 붙어 판이 겹친다.
      if (seat.kind === 'human') {
        const mark = `${game.handNo}:${game.phase}:${game.turn}`;
        if (game.boardBottom || game.turnCalled === mark) { await draw(game); return; }
        game.turnCalled = mark;
        await repost(game);
        return;
      }

      await sleep(thinkPause(game));
      if (game.phase === 'done') return;

      const move = chooseAction(seat.style ?? seat.character, {
        hole: seat.hole,
        board: game.board,
        opponents: opponentReads(game, seat),
        toCall: state.toCallFor(game, seat),
        pot: state.pot(game),
        legal: state.actionsFor(game),
        raises: state.raisesFor(game),
      });
      // 고른 수를 먼저 말하고 둔다. 결과를 보고 말하면 "선택할 때의 반응" 이 안 된다.
      //
      // **폴드도 늘 말한다.** 그 판에서 그 사람이 빠지는 유일한 순간이라, 여기서 조용하면
      // 한 핸드 내내 한마디도 안 하고 사라지는 일이 생긴다(실제로 그랬다).
      // 체크·콜은 한 라운드에 여러 번 오므로 가끔만.
      // 무슨 마음으로 두는지를 자리에 적어 둔다. 대사가 읽는다 — 허세인지 진심인지를
      // 알려 주지 않으면 블러프하면서 별로라고 스스로 광고한다(holdem/lines.js).
      seat.stance = { action: move.action, strength: move.strength, bluff: move.bluff };

      const big = move.action === 'allin' || move.action === 'raise';
      const speaks = big || move.action === 'fold';
      const amount = move.action === 'allin' ? seat.bet + seat.chips : move.to;
      if (seat.kind === 'mob') await mobSays(game, seat, move.action, amount, speaks);
      else {
        await seatSays(game, seat, move.action, { amount },
          { always: speaks, live: speaks ? 0.6 : 0.25 });
      }

      state.act(game, move.action, move.to);
      await draw(game);

      // 큰 수에는 옆자리가 한마디 한다. 모브는 잡담을 안 한다 — 수만 말한다.
      if (seat.kind === 'npc' && (big || move.action === 'fold')) {
        const key = move.action === 'fold' ? 'fold' : (move.action === 'allin' ? 'allin' : 'raise');
        if (await banter(game, seat, key, { amount }, big ? 0.5 : 0.22)) await repost(game);
      }
    }
  } finally {
    game.driving = false;
    // 도는 동안 들어온 클릭이 있었으면 지금 처리한다(블랙잭에서 겪은 그 구멍).
    if (game.rekick) { game.rekick = false; kick(game); }
  }
}

/** 팟을 나누고 결과를 보여준다. 칩 저장도 여기서 — 인터랙션 경로 밖이라 await 해도 된다. */
/**
 * 이 핸드의 전적. 칩 증감과 **같은 쓰기**로 나간다(wallet.commit).
 *
 * 정산 시점에는 이미 다 알고 있는 값들이라 따로 재는 게 없다. 카운터는 전부 더하기라
 * 락 없는 스토어에 안전하고, 최댓값(최고 팟·최고 족보)도 순서를 안 탄다.
 *
 * 최고 족보는 **이름이 아니라 순위 숫자**로 담는다 — 서버가 큰 쪽만 남기려면 견줄 수
 * 있어야 하고, 이름은 못 견준다. 보여줄 때 다시 이름으로 바꾼다(POKER_ORDER).
 */
function handStats(game, results) {
  const shown = new Map((results.shown ?? []).map((x) => [x.seatIndex, x.hand]));
  const bump = {};

  results.rows.forEach((r, i) => {
    if (r.put === 0 && r.won === 0) return;              // 그 핸드에 아무것도 안 한 자리
    const c = { hands: 1, holdemHands: 1 };
    if (r.net > 0) { c.won = 1; c.holdemWon = 1; c.earned = r.net; } else if (r.net < 0) c.lost = -r.net;
    if (r.won > 0) c.bestPot = r.won;

    if (r.seat.allIn) {
      if (r.net > 0) c.allInWon = 1; else if (r.net < 0) c.allInLost = 1;
    }

    const category = shown.get(i)?.category;
    if (category) {
      // CATEGORIES 는 센 것부터라 그대로 쓰면 큰 수가 약한 손이 된다. 뒤집는다 —
      // 스트레이트 플러시 9 … 하이카드 1, 0 은 "기록 없음".
      c.bestHand = CATEGORIES.length - CATEGORIES.indexOf(category);

      // 족보는 **최댓값과 별개로 하나씩 따로** 센다. 칭호가 묻는 것이 "그 족보를 직접
      // 만들어 봤나" 라서, 최댓값만 두면 풀하우스 한 번에 아래가 전부 딸려 온다.
      const counter = counterForHand(category);
      if (counter) c[counter] = 1;

      // 야수의 심장 — 하이카드로 전부 밀었다. **깐 경우에만** 센다: 전원이 접으면
      // 패를 안 까고, 프리플랍 올인은 두 장뿐이라 거의 다 하이카드로 나온다.
      if (r.seat.allIn && isHighCard(category)) c.allInHigh = 1;
    }

    bump[r.seat.id] = c;
  });

  return bump;
}

/**
 * 이번 정산으로 **새로 생긴 칭호**를 알린다.
 *
 * 칭호는 저장하지 않고 전적에서 계산해 내므로, 무엇이 새것인지 알려면 **판을 열 때의
 * 목록**과 견줘야 한다(game.titles). 커밋 응답이 쓰고 난 뒤의 계정을 주니 그걸로 잰다.
 *
 * 커밋이 실패하면 응답이 비어 있어 아무 말도 안 한다 — 저장이 안 된 칭호를 announce
 * 하면 다음에 또 새것으로 나온다.
 */
async function announceTitles(game, accounts) {
  if (!game.message?.channel) return;
  for (const [id, account] of Object.entries(accounts)) {
    const seat = game.seats.find((s) => s.id === id);
    if (!seat) continue;
    const now = earnedTitles(account, { npc: seat.kind === 'npc' });
    const fresh = gainedTitles(game.titles?.[id] ?? [], now);
    game.titles = { ...(game.titles ?? {}), [id]: now.map((t) => t.key) };
    if (!fresh.length) continue;

    const lines = fresh.map((t) => `🏅 **${t.name}** · _${t.desc}_`);
    game.boardBottom = false;
    await game.message.channel.send({ content: [`**${seat.name}** 새 칭호`, ...lines].join('\n') })
      .catch((err) => console.warn('[카지노] 칭호 알림 실패:', err.message));
  }
}

async function settleAndShow(game) {
  state.settle(game);

  // **결과를 먼저 붙잡아 둔다.** 아래 await 이 도는 동안 사람이 [다음 핸드] 를 누르면
  // beginHand 가 game.results 를 비운다. 그러면 이 함수가 null 을 읽고 터진다.
  const results = game.results;

  await repost(game);
  // **성공했을 때만** 기준점을 옮긴다. 실패하면 밀린 몫이 장부에 남아 있다가
  // 다음 커밋이 성공할 때 함께 반영된다 — 서버가 잠깐 죽었다 살아나면 저절로 만회된다.
  const saved = await commit(game.guildId, game.chips.deltas(), handStats(game, results));
  game.saveFailed = !saved.ok;
  if (saved.ok) game.chips.rebase();
  await announceTitles(game, saved.accounts);

  // 결과에 반응한다. 이긴 사람은 늘, 진 사람은 가끔.
  const shown = new Map((results.shown ?? []).map((x) => [x.seatIndex, x.hand]));
  const winners = results.rows.filter((r) => r.won > 0);
  let spoke = false;

  for (let i = 0; i < results.rows.length; i += 1) {
    const r = results.rows[i];
    if (r.seat.kind !== 'npc' || (r.put === 0 && r.won === 0)) continue;
    const key = r.won > 0 ? (winners.length > 1 ? 'chop' : 'win') : 'lose';
    spoke = await seatSays(game, r.seat, key, {
      amount: `${Math.abs(r.net)}칩`,
      hand: handName(shown.get(i)),
    }, { always: r.won > 0, live: 0.55 }) || spoke;
  }
  if (spoke) await repost(game);
}

function kick(game) {
  if (game.phase === 'lobby') return;
  if (game.driving) { game.rekick = true; return; }

  // 끝난 판이라도 마무리 인사는 한 번 한다. 한 핸드도 안 돌고 접었으면 할 말이 없다.
  if (game.phase === 'done') {
    if (game.closed || !game.handNo) return;
    game.closed = true;
    closeTable(game).catch((err) => console.error('[홀덤] 마무리 대사 오류:', err));
    return;
  }

  runDriver(game).catch((err) => console.error('[홀덤] 드라이버 오류:', err));
}

// 방치로 끝난 판도 마무리 인사를 한다 — 인터랙션 없이 끝나는 유일한 길이다.

// 방치된 판을 접는다.
setInterval(() => {
  for (const game of state.expired()) {
    draw(game).then(() => kick(game)).catch(() => {});
  }
}, 60_000).unref();

// ---------------------------------------------------------------- 명령

const data = new SlashCommandBuilder()
  .setName('홀덤')
  .setDescription('카지노 bard 에서 텍사스 홀덤을 합니다.')
    .addSubcommand((s) => s.setName('시작').setDescription('새 판을 엽니다')
      .addStringOption((o) => o.setName('판돈').setDescription('기본은 로우 — 블라인드 10/20')
        .addChoices(...STAKES_CHOICES))
      .addIntegerOption((o) => o.setName('모브').setDescription('엘리트 에너미를 몇 자리 앉힐지')
        .setMinValue(1).setMaxValue(state.MAX_SEATS - 1)))
  .addSubcommand((s) => s.setName('판').setDescription('판을 다시 띄웁니다'))
  .addSubcommand((s) => s.setName('족보').setDescription('손의 순서를 알려줍니다'))
  .addSubcommand((s) => s.setName('그만').setDescription('진행 중인 판을 접습니다'));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  // 족보는 판이 없어도 볼 수 있어야 한다. 판이 도는 중이라면 남의 화면을 밀지 않게
  // 나만 보이게 띄운다 — 규칙을 확인하는 사이에 판이 위로 올라가면 곤란하다.
  if (sub === '족보') {
    await interaction.reply({ embeds: [ranking()], flags: MessageFlags.Ephemeral });
    return;
  }

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
      stakes: interaction.options.getString('판돈'),
    });
    state.addSeat(game, state.humanSeat(interaction.user, interaction.member?.displayName));

    // 모브는 **판을 만들 때 한 번에** 앉힌다. 인원만 정하면 알아서 골라 오는 것이
    // 이 옵션의 전부라, 대기실에서 하나씩 부를 이유가 없다.
    drawMobs(interaction.options.getInteger('모브') ?? 0).forEach((mob, i) => {
      state.addSeat(game, state.mobSeat(mob, i, game.stakes));
    });

    await room.send({ embeds: [howto(game)] })
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
  kick(liveGame);                  // 한 핸드라도 돌았으면 마무리 인사를 한다
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
    await interaction.reply({ ...holeMessage(game, seat), flags: MessageFlags.Ephemeral });
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
    // 칩이 영구 저장이라 **한 계정은 한 판에만** 앉는다. 두 판에 앉으면 같은 칩을
    // 겹쳐 걸게 되고, 판마다 자기 장부를 들고 시작하니 서로를 볼 수가 없다.
    const at = seatedAt(interaction.user.id, { except: game.channelId });
    if (at) { await deny(interaction, seatedMessage('그쪽', at)); return true; }

    const err = state.addSeat(
      game,
      state.humanSeat(interaction.user, interaction.member?.displayName),
    );
    if (err) { await deny(interaction, err); return true; }
    return false;
  }

  if (action === 'npc') {
    // NPC 가 더 잘 걸린다 — hasNpc 는 한 판 안에서만 보므로 두 채널이 각각 부를 수 있다.
    const seat = state.npcSeat(arg);
    const at = seatedAt(seat.id, { except: game.channelId });
    if (at) { await deny(interaction, seatedMessage(seat.name, at)); return true; }

    const err = state.addSeat(game, seat);
    if (err) { await deny(interaction, err); return true; }
    return false;
  }

  if (action === 'start') {
    if (interaction.user.id !== game.starterId) {
      await deny(interaction, '판을 연 사람만 시작할 수 있어요.');
      return true;
    }

    // **먼저 응답을 잡는다.** load 는 HTTP 라 콜드 스타트 한 번이면 3초를 넘기고,
    // 그러면 클릭이 통째로 날아간다(10062). 상수를 돌려주던 동안에는 안 보이던 함정이다.
    // 여기서부터는 이 가지가 draw·kick 까지 직접 책임진다(true 를 주면 뒤가 안 돈다).
    await interaction.deferUpdate();

    // 참가와 시작 **사이에** 다른 판이 열릴 수 있다. 여기서 한 번 더 본다.
    for (const s of game.seats) {
      const at = seatedAt(s.id, { except: game.channelId });
      if (at) { await denyLate(interaction, seatedMessage(s.name, at)); return true; }
    }

    // 모브는 지갑이 없다. 서버에 물어보지도 않고, 앉을 때 정한 만큼 들고 온다.
    const mobs = game.seats.filter((s) => s.kind === 'mob');
    const walled = game.seats.filter((s) => s.kind !== 'mob');

    let account;
    try {
      account = await loadAccounts(game.guildId, walled.map((s) => s.id));
    } catch (err) {
      // 못 읽었으면 **판을 안 연다.** 기본값으로 진행하면 칩이 복제된다 — 실제 잔액이
      // 200인 사람이 1000으로 놀고, 다음 커밋이 성공할 때 그 차액이 서버에 얹힌다.
      await denyLate(interaction, `칩 잔액을 읽지 못해 판을 열 수 없어요. ${err.message}`);
      return true;
    }

    // 이 등급에 앉을 만큼 없는 사람이 있으면 판을 안 연다. 잔액은 여기서 처음 알 수
    // 있어서(참가 버튼에서 매번 HTTP 를 칠 수는 없다) 검사도 여기 있다.
    // NPC 는 이제 자동으로 안 채워지므로, 모자라면 어떻게 채우는지 같이 알려 준다.
    const poor = walled
      .map((s) => {
        const why = tooPoor(game.stakes, account[s.id].chips, s.name);
        if (!why) return null;
        return s.kind === 'npc' ? `${why} \`/급여\` 로 일당을 줄 수 있어요.` : why;
      })
      .filter(Boolean);
    if (poor.length) { await denyLate(interaction, poor.join('\n')); return true; }

    // 지금 가진 칭호를 적어 둔다. 칭호는 저장하지 않고 전적에서 계산해 내므로,
    // **무엇이 새것인지 알려면 판을 열 때의 목록과 견줘야 한다**(announceTitles).
    game.titles = Object.fromEntries(walled.map((s) => [
      s.id, earnedTitles(account[s.id], { npc: s.kind === 'npc' }).map((t) => t.key),
    ]));

    // buyIn 으로 한 판 몫만 떼어 온다 — 나머지는 계정에 남는다. 모브 몫은 그 위에 얹는다.
    const err = state.start(game, {
      ...buyIn(Object.fromEntries(walled.map((s) => [s.id, account[s.id].chips])), game.stakes.stack),
      ...Object.fromEntries(mobs.map((s) => [s.id, s.buyIn])),
    });
    if (err) { await denyLate(interaction, err); return true; }

    await draw(game);
    kick(game);
    return true;
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
