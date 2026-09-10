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
 *   3. **카드가 바뀌면 두 줄짜리 알림을 보내고 판을 다시 띄운다.** 첫 줄은 누가 무엇을
 *      했고 무슨 카드가 나왔는지, 둘째 줄은 그래서 지금 패가 어떤지. 판만 고치면
 *      순식간에 지나가고, 판은 알림에 밀려 위로 올라가므로 매번 아래에 새로 띄운다.
 */
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import * as state from '../blackjack/state.js';
import { chooseAction, chooseInsurance, chooseBet } from '../blackjack/ai.js';
import { loadAccounts, commit, buyIn } from '../casino/wallet.js';
import { earned as earnedTitles, gained as gainedTitles } from '../casino/titles.js';
import { awardCard } from '../casino/titleCard.js';
import { displayOf } from '../casino/accounts.js';
import { seatedAt, seatedMessage } from '../casino/tables.js';
import { STAKES_CHOICES, tooPoor } from '../casino/stakes.js';
import {
  PREFIX, howto, lobbyEmbed, lobbyRows, boardEmbed, boardRows, resultEmbed,
} from '../blackjack/render.js';
import { cardText, handText, handValue, isBlackjack } from '../casino/cards.js';
import {
  line, sometimes, betKey, memo, RESULT_KEY, REACT_KEY,
} from '../blackjack/lines.js';
import * as casinoTalk from '../ai/casinoTalk.js';
import { sayAsOrPlain } from '../discord/webhook.js';
import { base, fail } from '../embeds.js';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** 채팅에 남길 때 쓰는 이름. 판의 버튼과 같은 영어 표기를 쓴다. */
const ACTION_LABEL = {
  hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split', surrender: 'Surrender',
};

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
 * 무슨 일이 있었는지 채팅에 남기고 판을 다시 띄운다.
 *
 *   첫 줄  누가 무엇을 했고 무슨 카드가 나왔는지
 *   둘째 줄 그래서 지금 그 사람의 패가 어떤지
 *
 * 처음엔 카드만 든 메시지를 보냈다. 디스코드가 **이모지만 있는 메시지**를 크게 그리기
 * 때문인데, 정작 누구 패인지 알 수가 없어 헷갈렸다. 글자가 섞이면 이모지는 작아지지만,
 * 카드 그림을 작아도 읽히게 그려 뒀으므로 맥락을 얻는 편이 낫다.
 */
async function showMove(game, { name, action, card, cards, split = false }) {
  const head = `**${name}** — ${action}${card ? ` ${cardText(card)}` : ''}`;
  const { total, bust } = handValue(cards);
  // 쪼갠 손의 21은 Blackjack 이 아니다(1:1 로 친다). 판의 handLine 은 이미 그렇게
  // 적고 있는데 여기만 안 그래서, 같은 손이 두 군데에서 다르게 보였다.
  const tag = bust ? '　_Bust_' : (!split && isBlackjack(cards) ? '　_Blackjack_' : '');
  const body = `${handText(cards)}　**${total}**${tag}`;

  await game.message.channel.send({ content: `${head}\n${body}` })
    .catch((err) => console.warn('[블랙잭] 카드 알림 실패:', err.message));
  await repost(game);
}

// ---------------------------------------------------------------- 대사
//
// **대사는 전부 드라이버 안에서만 나간다.** 웹훅은 느리고 레이트리밋이 있어서
// 인터랙션 응답 경로에 두면 3초 시한을 갉아먹는다. 사람이 누른 것에 대한 반응도
// 마찬가지다 — 버튼을 누르면 kick() 이 드라이버를 깨우므로 거기서 말하면 된다.

/**
 * 한 핸드에 Gemini 로 지을 수 있는 대사 수.
 *
 * 한 핸드에 대사 자리가 스무 번 넘게 오는데 전부 Gemini 로 가면 분당 한도를 혼자
 * 다 쓰고 사람이 치는 /캐입 이 굶는다. 그렇다고 판 시작·블랙잭 같은 큰 자리만
 * 지으면 평범한 핸드는 늘 똑같은 소리라 티가 난다. 그래서 **핸드마다 몇 장씩**
 * 나눠 쓴다 — 큰 자리를 먼저 채우고, 남으면 평범한 자리에서도 가끔 나간다.
 */
const AI_PER_HAND = 4;

function aiBudget(game) {
  if (game.aiHandNo !== game.handNo) {
    game.aiHandNo = game.handNo;
    game.aiLeft = AI_PER_HAND;
  }
  return game.aiLeft;
}

/**
 * 그 캐릭터로 한 줄 말한다. 말했으면 true.
 *
 * **Gemini 로 지어 보고, 안 되면 미리 써 둔 줄로 물러선다.** 한도가 찼든 키가
 * 없든 API 가 죽었든 판은 늘 말이 있는 채로 돈다 — 요트에서는 그럴 때 대사가
 * 그냥 비었는데, 여기서는 캔드 대사가 바닥에 깔려 있다. `live` 가 그 자리를
 * Gemini 로 지을 확률이고, 0 이면 언제나 캔드다.
 *
 * `npc` 딜러는 Gemini 를 쓰지 않는다 — 페르소나가 없어 지을 말투가 없고, 짧고
 * 사무적인 것이 그 자리의 성격이다.
 *
 * 판이 위로 밀리므로 부른 쪽이 곧 showMove 나 repost 로 다시 띄워야 한다.
 * 여기서 매번 repost 하면 대사 한 줄마다 판이 하나씩 늘어난다.
 */
async function say(game, character, key, vars = {}, { always = false, p, live = 0 } = {}) {
  if (!always && !sometimes(p)) return false;
  if (!game.message?.channel) return false;

  let text = null;
  if (live && character !== 'npc' && aiBudget(game) > 0 && Math.random() < live) {
    const said = (game.spoken[character] ??= []);
    const situation = memo(game, key, vars, character);
    if (situation) {
      text = await casinoTalk.line({
        character,
        game: 'blackjack',
        role: character === game.dealerCharacter ? 'dealer' : 'player',
        situation,
        said,
      });
    }
    if (text) { game.aiLeft -= 1; said.push(text); }
  }

  if (!text) text = line(key, vars);
  if (!text) return false;

  await sayAsOrPlain(game.message.channel, character, text, '블랙잭');
  await sleep(700);
  return true;
}

/**
 * 딜러가 말한다. 미겔이 손님 자리에 앉아 있으면 npc 가 딜러다.
 *
 * **둘은 말수가 다르다.** 미겔은 판을 끌고 가는 인물이라 배분·베팅·차례를 거의 매번
 * 짚어 주는 편이 자연스럽고, npc 는 이름 그대로 진행만 하는 자리라 말수가 적은 것이
 * 성격이다. 그래서 기본 확률을 딜러에 따라 다르게 준다.
 */
const DEALER_CHATTINESS = { migel: 0.72, npc: 0.3 };

const dealerSays = (game, key, vars, opts = {}) =>
  say(game, game.dealerCharacter, `dealer.${game.dealerCharacter}.${key}`, vars, {
    p: DEALER_CHATTINESS[game.dealerCharacter],
    live: 0.2,
    ...opts,
  });

/** NPC 플레이어가 말한다. 사람 자리는 말하지 않는다. */
const playerSays = (game, seat, key, vars, opts = {}) => (
  seat.kind === 'npc'
    ? say(game, seat.character, `player.${seat.character}.${key}`, vars,
      { p: 0.62, live: 0.25, ...opts })
    : Promise.resolve(false)
);

/**
 * 옆자리 반응 — 미겔과 마티암이 서로의 수를 보고 한마디 한다.
 *
 * 자기 수에 대한 대사(`player.*`)와 달리 **말하는 사람이 아닌 자리**가 화자다.
 * 그래서 둘이 같이 앉아 있을 때만 나온다. 딜러는 여기 끼지 않는다 — 딜러는
 * `result.*` 로 이미 이름을 부르며 반응하므로 겹치면 같은 말을 두 번 하는 꼴이 된다.
 *
 * 늘 나오면 한 수마다 두 줄씩 붙어 판이 잡담에 묻히므로 볼 만한 수에만, 그것도
 * 열에 넷 정도만 낸다.
 */
async function banter(game, actor, event, { p = 0.4 } = {}) {
  const watchers = game.seats.filter((s) => s.kind === 'npc' && s !== actor && !s.out);
  if (!watchers.length) return false;
  const watcher = watchers[Math.floor(Math.random() * watchers.length)];
  // 옆자리 반응은 판을 보고 지을 때 가장 잘 산다. 여기는 Gemini 쪽에 무게를 준다.
  return say(game, watcher.character, `banter.${watcher.character}.${event}`,
    { name: actor.name }, { p, live: 0.6 });
}

/** 마티암이 딜러 미겔에게 거는 말. 미겔이 딜러일 때만. */
async function banterAtDealer(game, event) {
  if (game.dealerCharacter !== 'migel') return false;
  const matiam = game.seats.find((s) => s.character === 'matiam' && !s.out);
  if (!matiam) return false;
  return say(game, 'matiam', `banter.matiam.${event}`, {}, { p: 0.45, live: 0.7 });
}

/**
 * 21이 된 손을 **그 자리에서** 축하한다.
 *
 * 21은 배분 때(Blackjack) 아니면 한 장 더 받다가(3장 이상) 결정되는데, 반응이 정산까지
 * 밀려 있었다. 그때쯤이면 딜러가 카드를 다 뽑고 정산표까지 나온 뒤라 판이 제일
 * 뜨거운 순간을 그냥 지나쳐 버린다.
 *
 * 첫 두 장인지 아닌지로 말을 나눈다. 배당이 다르기도 하지만(3:2 대 1:1) 무엇보다
 * 놀랄 거리가 다르다 — Blackjack 은 받은 운이고 3장 21은 만든 것이다.
 *
 * 아직 딜러 밑장을 안 열었으므로 **배당 이야기는 하지 않는다.** 딜러도 Blackjack 이면
 * 푸시다. 여기서는 축하만 하고, 얼마를 받는지는 정산에서 말한다.
 */
async function cheer21(game, hand) {
  hand.cheered = true;
  const seat = state.seatOfHand(game, hand);
  const natural = !hand.fromSplit && isBlackjack(hand.cards);
  const key = natural ? 'blackjack' : 'made21';

  await dealerSays(game, natural ? 'dealtBlackjack' : 'made21', { name: seat.name },
    { always: true, live: natural ? 0.85 : 0.6 });
  await playerSays(game, seat, key, {}, { always: true, live: natural ? 0.8 : 0.6 });
  await banter(game, seat, key, { p: natural ? 0.5 : 0.35 });
  await repost(game);
}

/**
 * 아직 축하 안 한 21이 있으면 축하한다.
 *
 * 드라이버가 한 바퀴 돌 때마다 훑는다. 사람이 Hit 해서 21이 되든 NPC 가 그러든
 * 결국 여기를 지나므로, 누가 만들었는지 자리마다 따로 붙일 필요가 없다.
 * 이미 축하한 손은 hand.cheered 로 거른다 — 손 인덱스는 Split 때 밀리므로 못 쓴다.
 */
async function cheerAll21(game) {
  for (const hand of game.hands) {
    if (hand.cheered) continue;
    const { total, bust } = handValue(hand.cards);
    if (bust || total !== 21) continue;
    await cheer21(game, hand);
  }
}

/**
 * 판을 접으며 하는 인사. 딜러가 마무리하고, NPC 손님들이 각자 결산에 반응한다.
 *
 * 시작할 때 인사를 하고 끝날 때 아무 말도 없으면 판이 끊긴 것처럼 보인다. 여기는
 * 한 판에 딱 한 번뿐인 자리라 전원 무조건 말하게 두고 Gemini 쪽에 무게를 준다.
 *
 * 정산 결과 화면은 이미 떠 있으므로 대사만 얹고 마지막에 한 번 다시 띄운다.
 */
async function closeTable(game) {
  const rows = state.standings(game);
  const top = [...rows].sort((a, b) => b.delta - a.delta).find((r) => r.delta > 0);
  const broke = game.endedReason === 'broke';

  // 마지막 핸드가 예산을 다 썼더라도 마무리 인사는 지어 준다. 판에 한 번뿐인 자리다.
  game.aiHandNo = -1;

  await dealerSays(game, broke ? 'broke' : 'close', {
    name: top?.seat.name,
    amount: top ? `+${top.delta}칩` : null,
  }, { always: true, live: 0.9 });

  for (const { seat, delta } of rows) {
    if (seat.kind !== 'npc') continue;
    const key = delta > 0 ? 'closeWin' : (delta < 0 ? 'closeLose' : 'closeEven');
    await playerSays(game, seat, key, { amount: `${Math.abs(delta)}칩` },
      { always: true, live: 0.8 });
  }

  await repost(game);
}

/** 판을 열며 하는 인사. 딜러가 누구든 한 번은 반드시 한다. */
async function openTable(game) {
  game.opened = true;
  await dealerSays(game, 'welcome', {}, { always: true, live: 1 });
  // 미겔이 손님 자리에 앉았으면 "오늘은 내가 플레이어다" 를 본인이 덧붙인다.
  for (const seat of game.seats) {
    if (seat.kind === 'npc') {
      await playerSays(game, seat, 'welcome', {}, { always: true, live: 1 });
    }
  }
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

    // 고른 수를 먼저 말하고 둔다. 결과를 보고 말하면 "선택할 때의 반응" 이 안 된다.
    // 흔한 hit/stand 는 가끔만, 드물고 판이 갈리는 수(더블·스플릿·서렌더)는 늘 말한다.
    const rare = action === 'double' || action === 'split' || action === 'surrender';
    const spoke = await playerSays(game, seat, action, {},
      { always: rare, live: rare ? 0.7 : 0.25 });

    const before = hand.cards.length;
    const res = state.act(game, action);
    await sleep(900);
    if (game.phase === 'done') return;

    if (hand.cards.length > before) {
      await showMove(game, {
        name: seat.name,
        action: ACTION_LABEL[action] ?? action,
        card: hand.cards[hand.cards.length - 1],
        cards: hand.cards,
        split: hand.fromSplit,
      });
    } else if (spoke) {
      // 스플릿·스탠드·서렌더는 새 카드가 없다. 대사가 나갔으면 판이 위로 밀렸으니 다시 띄운다.
      await repost(game);
    } else {
      await draw(game);
    }

    // 볼 만한 수가 나왔으면 옆자리가 한마디 한다.
    const busted = handValue(hand.cards).bust;
    const notable = (busted && 'bust')
      || (isBlackjack(hand.cards) && 'blackjack')
      || (rare && action)
      || null;
    if (notable && await banter(game, seat, notable)) await repost(game);

    if (res.moved) return;
  }
}

async function runDriver(game) {
  if (game.driving) return;
  game.driving = true;
  try {
    for (;;) {
      if (game.phase === 'done') return;
      if (!game.opened) await openTable(game);
      await cheerAll21(game);

      // --- 베팅: NPC 는 알아서 건다
      if (game.phase === 'betting') {
        let bet = false;
        for (const seat of state.active(game)) {
          if (seat.kind !== 'npc' || seat.bet) continue;
          const amount = chooseBet(seat.character, {
            chips: seat.chips,
            betUnits: game.stakes.betUnits,
            lastBet: seat.bet,
            lastWon: seat.lastWon,
          });
          state.placeBet(game, seat, amount || game.stakes.minBet);
          bet = true;
        }
        if (bet) await draw(game);
        if (await reactToBets(game)) await repost(game);
        if (!state.allBetsIn(game)) return;      // 사람을 기다린다

        await dealerSays(game, 'deal');
        state.deal(game);
        await draw(game);
        for (const hand of game.hands) {
          await sleep(700);
          const seat = state.seatOfHand(game, hand);
          await showMove(game, { name: seat.name, action: '배분', cards: hand.cards });
          // 그 손의 카드 알림 바로 밑에 붙어야 누구 것인지 헷갈리지 않는다.
          if (isBlackjack(hand.cards)) await cheer21(game, hand);
        }

        if (state.needsInsurance(game)) {
          state.beginInsurance(game);
          await dealerSays(game, 'insuranceOffer', {}, { always: true });
          for (const seat of state.active(game)) {
            if (seat.kind !== 'npc') continue;
            const takes = chooseInsurance(seat.character);
            state.answerInsurance(game, seat, takes);
            await playerSays(game, seat, takes ? 'insurance' : 'insuranceDecline', {}, { p: 0.6 });
          }
          await repost(game);
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
        if (seat.kind !== 'npc') {
          // 사람 차례만 알린다. NPC 는 곧 자기 수를 말하므로 두 번 말하는 꼴이 된다.
          if (await announceTurn(game, seat)) await repost(game);
          return;
        }
        await playNpcHand(game);
        continue;
      }

      // --- 딜러
      if (game.phase === 'dealer') {
        await sleep(800);
        await dealerSays(game, 'reveal');
        state.revealHole(game);
        await showMove(game, { name: '딜러', action: '홀 카드 공개', cards: game.dealer });

        // 아무도 안 남았으면(전원 버스트·서렌더) 딜러는 뽑을 이유가 없다.
        if (state.anyoneAlive(game)) {
          // 뽑는다는 말은 처음 한 번만. 카드마다 말하면 딜러가 혼자 떠드는 판이 된다.
          let first = true;
          while (state.dealerDraw(game)) {
            if (first) { first = false; await dealerSays(game, 'draw'); }
            await sleep(900);
            if (game.phase === 'done') return;
            await showMove(game, {
              name: '딜러',
              action: 'Hit',
              card: game.dealer[game.dealer.length - 1],
              cards: game.dealer,
            });
          }
        }
        await settleAndShow(game);
        continue;
      }

      return;      // settled — 사람이 [다음 핸드] 를 누를 때까지 기다린다
    }
  } finally {
    game.driving = false;
    // 도는 동안 들어온 클릭이 있었으면 지금 처리한다. 아래 kick() 참고.
    if (game.rekick) { game.rekick = false; kick(game); }
  }
}

/**
 * 아직 반응 안 한 베팅에 딜러가 한마디 한다. 말했으면 true.
 *
 * 사람이 건 것과 NPC 가 건 것을 한자리에서 처리한다 — 사람이 버튼을 누르면 kick() 이
 * 드라이버를 깨우므로 결국 여기를 지난다. 이미 반응한 자리는 `핸드:자리` 로 기억한다
 * (베팅액은 다음 핸드에 0으로 돌아가므로 그것만으로는 구별이 안 된다).
 */
async function reactToBets(game) {
  let spoke = false;
  for (const seat of state.active(game)) {
    const mark = `${game.handNo}:${seat.id}`;
    if (!seat.bet || game.said.has(mark)) continue;
    game.said.add(mark);

    // 걸 때 이미 깎였으므로, 최소 베팅도 못 남겼으면 사실상 전부 건 것이다.
    const allIn = seat.chips < game.stakes.minBet;
    const key = game.dealerCharacter === 'npc'
      ? (allIn ? 'bet.allin' : 'bet')
      : `bet.${allIn ? 'allin' : betKey(seat)}`;
    const vars = { name: seat.name, amount: `${seat.bet}칩` };
    spoke = await dealerSays(game, key, vars, { always: allIn }) || spoke;
  }
  return spoke;
}

/** 사람 차례를 알린다. 한 손에 한 번만 — 사람이 버튼을 누를 때마다 드라이버가 돈다. */
async function announceTurn(game, seat) {
  const mark = `turn:${game.handNo}:${game.turn}`;
  if (game.said.has(mark)) return false;
  game.said.add(mark);
  return dealerSays(game, 'turn', { name: seat.name });
}

/**
 * 정산하고 결과를 보여준다. 칩 저장도 여기서 — 인터랙션 경로 밖이라 await 해도 된다.
 *
 * 대사가 제일 몰리는 자리다. 네 자리가 각자 손을 둘씩 가지면 결과만 여덟 줄이고 거기
 * 플레이어 반응까지 붙는다. 그래서 **꼭 말해야 하는 것**(딜러 버스트·블랙잭, 플레이어
 * 블랙잭·버스트·서렌더)만 무조건 내보내고 나머지는 예산 안에서만 말한다.
 */
const RESULT_BUDGET = 4;

/**
 * 이 핸드의 전적. 칩 증감과 **같은 쓰기**로 나간다(wallet.commit).
 *
 * **자리 단위로 센다.** 결과는 손 단위로 나오는데(스플릿하면 한 사람이 여럿), 한 사람이
 * 한 판에 두 핸드를 둔 것으로 세면 전적이 부풀고 승률도 이상해진다. 그 자리의 순증감을
 * 합쳐 하나로 본다.
 *
 * 블랙잭 횟수만은 손 단위다 — 스플릿한 손에서 나온 21은 블랙잭이 아니므로(rules.js)
 * 손마다 세도 부풀지 않는다.
 */
function handStats(game) {
  const bump = {};
  for (const seat of state.active(game)) {
    const mine = game.results.filter((r) => r.seat === seat);
    if (!mine.length) continue;

    const net = mine.reduce((a, r) => a + r.net, 0);
    const c = { hands: 1, blackjackHands: 1 };
    if (net > 0) { c.won = 1; c.blackjackWon = 1; c.earned = net; } else if (net < 0) c.lost = -net;

    const bj = mine.filter((r) => r.outcome === 'blackjack').length;
    if (bj) c.blackjacks = bj;
    c.bestBet = Math.max(...mine.map((r) => r.hand.bet));

    // 올인은 **걸 때** 표시해 둔다(state.placeBet). 정산 시점에는 이미 돌려받은 뒤라
    // 칩만 봐서는 다 밀었는지 알 수가 없다.
    if (seat.wentAllIn) {
      if (net > 0) c.allInWon = 1; else if (net < 0) c.allInLost = 1;
    }

    bump[seat.id] = c;
  }
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
    const npc = seat.kind === 'npc';
    const now = earnedTitles(account, { npc });
    const fresh = gainedTitles(game.titles?.[id] ?? [], now);
    game.titles = { ...(game.titles ?? {}), [id]: now.map((t) => t.key) };
    if (!fresh.length) continue;

    // 미겔·마티암 얼굴은 로컬 파일이라 displayOf 가 첨부까지 챙겨 준다. 사람은
    // 앉을 때 담아 둔 CDN 주소를 쓴다.
    const face = npc ? displayOf(id) : { avatar: seat.avatar, avatarFile: null };
    await game.message.channel.send(awardCard({
      name: seat.name, avatar: face.avatar, avatarFile: face.avatarFile, fresh, held: now.length,
    })).catch((err) => console.warn('[카지노] 칭호 알림 실패:', err.message));
  }
}

async function settleAndShow(game) {
  state.settle(game);
  await draw(game);
  // **성공했을 때만** 기준점을 옮긴다. 실패하면 밀린 몫이 장부에 남아 있다가
  // 다음 커밋이 성공할 때 함께 반영된다 — 서버가 잠깐 죽었다 살아나면 저절로 만회된다.
  const saved = await commit(game.guildId, game.chips.deltas(), handStats(game));
  game.saveFailed = !saved.ok;
  if (saved.ok) game.chips.rebase();
  await announceTitles(game, saved.accounts);

  const dealerBust = handValue(game.dealer).bust;
  const dealerBj = isBlackjack(game.dealer);
  if (dealerBust) {
    await dealerSays(game, 'bust', {}, { always: true, live: 0.9 });
    await banterAtDealer(game, 'dealerBust');
  } else if (dealerBj) {
    await dealerSays(game, 'blackjack', {}, { always: true, live: 0.9 });
    await banterAtDealer(game, 'dealerBlackjack');
  }

  let budget = RESULT_BUDGET;
  for (const r of game.results) {
    // 이미 그 자리에서 축하한 손은 여기서 또 떠들지 않는다. 배당 이야기는 남아 있으니
    // 아주 막지는 않고 예산 안으로 내린다.
    const big = (r.outcome === 'blackjack' && !r.hand.cheered)
      || r.outcome === 'bust' || r.outcome === 'surrender';
    if (!big && budget <= 0) continue;

    const vars = { name: r.seat.name, amount: `${Math.abs(r.net)}칩` };
    if (await dealerSays(game, `result.${RESULT_KEY[r.outcome]}`, vars,
      { always: big, live: big ? 0.8 : 0.25 })) {
      budget -= 1;
    }
    if (await playerSays(game, r.seat, REACT_KEY[r.outcome], vars,
      { always: big, live: big ? 0.8 : 0.3 })) {
      budget -= 1;
    }
    // 사람이 터지거나 블랙잭이 뜨면 NPC 가 한마디 한다. NPC 끼리는 두던 자리에서
    // 이미 주고받았으므로 여기서 또 하지 않는다.
    if (r.seat.kind === 'human' && big && budget > 0
        && await banter(game, r.seat, r.outcome)) {
      budget -= 1;
    }
  }

  await repost(game);
}

/**
 * 드라이버를 띄운다. 기다리지 않는다 — 부르는 쪽은 이미 응답을 마쳤다.
 *
 * **이미 돌고 있으면 예약만 하고 물러난다.** 그냥 물러나면 판이 멈춘다. 드라이버는
 * 사람 차례에서 "네 차례입니다" 를 말하고(웹훅 + 간격으로 1초 넘게 걸린다) 물러나는데,
 * 하필 그 사이에 사람이 버튼을 누르면 그 클릭의 kick 이 버려지고, 드라이버는 곧
 * 끝나 버려서 아무도 다음 차례로 넘겨 주지 않는다.
 */
function kick(game) {
  if (game.phase === 'lobby') return;
  if (game.driving) { game.rekick = true; return; }

  // 끝난 판이라도 마무리 인사는 한 번 한다. 한 장도 안 돌린 채 접었으면 할 말이 없다.
  if (game.phase === 'done') {
    if (game.closed || !game.handNo) return;
    game.closed = true;
    closeTable(game).catch((err) => console.error('[블랙잭] 마무리 대사 오류:', err));
    return;
  }

  runDriver(game).catch((err) => console.error('[블랙잭] 드라이버 오류:', err));
}

// 방치된 판을 접는다. 인터랙션 없이 끝나는 유일한 길이라 마무리 인사도 여기서 깨운다.
setInterval(() => {
  for (const game of state.expired()) {
    draw(game).then(() => kick(game)).catch(() => {});
  }
}, 60_000).unref();

// ---------------------------------------------------------------- 명령

const data = new SlashCommandBuilder()
  .setName('블랙잭')
  .setDescription('카지노 bard 에서 블랙잭을 합니다.')
    .addSubcommand((s) => s.setName('시작').setDescription('새 판을 엽니다')
      .addStringOption((o) => o.setName('판돈').setDescription('기본은 로우 — 블라인드 10/20')
        .addChoices(...STAKES_CHOICES)))
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
      stakes: interaction.options.getString('판돈'),
    });
    state.addSeat(game, state.humanSeat(interaction.user, interaction.member?.displayName));

    // 규칙 안내를 판보다 먼저 한 번. 스레드를 못 만들었을 때도 순서가 맞게, 판은
    // 항상 새 메시지로 보낸다(예전엔 안내 메시지를 판으로 덮어써서 하나 아꼈는데,
    // 그러면 규칙이 판 아래로 가서 버튼이 위에 오게 된다).
    await room.send({ embeds: [howto(game)] })
      .catch((err) => console.warn('[블랙잭] 규칙 안내 실패:', err.message));
    game.message = await room.send(payloadFor(game));
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
  kick(live);                    // 한 판이라도 돌았으면 마무리 인사를 한다
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
  for (const move of queued) await showMove(game, move);

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

    let account;
    try {
      account = await loadAccounts(game.guildId, game.seats.map((s) => s.id));
    } catch (err) {
      // 못 읽었으면 **판을 안 연다.** 기본값으로 진행하면 칩이 복제된다 — 실제 잔액이
      // 200인 사람이 1000으로 놀고, 다음 커밋이 성공할 때 그 차액이 서버에 얹힌다.
      await denyLate(interaction, `칩 잔액을 읽지 못해 판을 열 수 없어요. ${err.message}`);
      return true;
    }

    // 이 등급에 앉을 만큼 없는 사람이 있으면 판을 안 연다. 잔액은 여기서 처음 알 수
    // 있어서(참가 버튼에서 매번 HTTP 를 칠 수는 없다) 검사도 여기 있다.
    // NPC 는 이제 자동으로 안 채워지므로, 모자라면 어떻게 채우는지 같이 알려 준다.
    const poor = game.seats
      .map((s) => {
        const why = tooPoor(game.stakes, account[s.id].chips, s.name);
        if (!why) return null;
        return s.kind === 'npc' ? `${why} \`/급여\` 로 일당을 줄 수 있어요.` : why;
      })
      .filter(Boolean);
    if (poor.length) { await denyLate(interaction, poor.join('\n')); return true; }

    // 지금 가진 칭호를 적어 둔다. 칭호는 저장하지 않고 전적에서 계산해 내므로,
    // **무엇이 새것인지 알려면 판을 열 때의 목록과 견줘야 한다**(announceTitles).
    game.titles = Object.fromEntries(game.seats.map((s) => [
      s.id, earnedTitles(account[s.id], { npc: s.kind === 'npc' }).map((t) => t.key),
    ]));

    // buyIn 으로 한 판 몫만 떼어 온다 — 나머지는 계정에 남는다.
    const err = state.start(game, buyIn(
      Object.fromEntries(game.seats.map((s) => [s.id, account[s.id].chips])), game.stakes.stack,
    ));
    if (err) { await denyLate(interaction, err); return true; }

    await draw(game);

    const queued = game.pendingChat.splice(0);
    for (const move of queued) await showMove(game, move);

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
    const err = state.placeBet(game, seat, state.allIn(game, seat));
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
  // 카드가 늘었으면 판을 그린 뒤에 알린다. 여기서 보내면 응답이 그만큼 늦어진다.
  if (hand.cards.length > before) {
    game.pendingChat.push({
      name: seat.name,
      action: ACTION_LABEL[arg] ?? arg,
      card: hand.cards[hand.cards.length - 1],
      cards: [...hand.cards],
      split: hand.fromSplit,
    });
  }
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
