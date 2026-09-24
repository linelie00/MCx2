/**
 * daily/run — 스레드에서 하루 한 장면을 진행한다 (`/일상`)
 *
 * 무엇을 할지는 `daily/pick.js` 가 이미 정했다. 여기는 그걸 **말하고, 저장하고, 요약한다.**
 *
 *   말    캐릭터가 웹훅으로 직접 말한다. 대사는 AI(`daily/talk.js`), 막히면 `daily/lines.js`
 *   적기  산 것·건넨 것은 작은 글씨 한 줄. 무엇이 오갔는지가 대사에 묻히지 않게
 *   저장  한 장면에 **한 번의 쓰기**(`wallet.apply`) — 골드와 아이템·체력이 같이 움직인다
 *
 * **모든 일은 혼잣말로 시작한다** — 무엇을 하러 가는지가 첫 줄에 드러난다. 대화가 아닌 일도
 * 혼잣말을 섞어 가며 진행한다.
 *
 * AI 가 쓰는 대목은 **사실이 정해진 뒤에** 부른다. 무엇을 몇 개 얼마에 사는지 메모로 주고
 * 대사만 받는다. 저장이 실패하면 "산 뒤의 말" 은 버리고 미리 써 둔 `oops` 로 맺는다.
 *
 * 요리·제작은 `/요리` 와 **같은 길**을 간다 — 🎲 는 봇이 굴리고, 심사관(`ai/judge.js`)이 점수를,
 * 공식(`casino/crafts.js`)이 등급을 낸다. 다른 것은 무엇을 어떻게 만들지를 **캐릭터가 짓는다**는 것뿐.
 *
 * 입출력은 `io` 로 받는다 — 검사(`scripts/check-daily.mjs`)가 디스코드와 서버 없이 돌린다.
 *   io.say(who, text)   캐릭터로 한 줄      io.note(text)   작은 글씨 한 줄
 *   io.apply(moves)     계정 쓰기          io.card(mode, craft, info)   `/요리` 의 결과 카드
 *   io.tryFish(id)      하루 낚시 한 번    io.fishCard(round, extra)    `/요트 낚시` 의 결과 카드
 *   io.embed(card)      카드 한 장         io.dungeon.{met,hand,overflow,won,lost}   `holdem/payout.js` 의 것
 *   io.monologue · io.reply · io.recipe · io.judge   `daily/talk.js` 의 것
 *
 * ctx 에 `die`(주사위 한 개, 1~6)를 주면 낚시 주사위를 그걸로 굴린다 — 검사용. 없으면 요트와 같은 굴림.
 */
import { ITEM_BY_KEY, MAX_HP, healOf } from '../casino/items.js';
import {
  MODES, GRADE_BY_KEY, roll, scoreOf, gradeOf, priceOf, effectOf, newId, bumpOf,
} from '../casino/crafts.js';
import { NPC_ID } from '../casino/accounts.js';
import { isFish, isLegend } from '../casino/fish.js';
import * as fishing from '../yacht/fishing.js';
import { categoryOf } from '../yacht/rules.js';
import { faces } from '../yacht/render.js';
import { NAME } from '../ai/persona.js';
import { josa } from '../farm/requesters.js';
import { canned, fill } from './lines.js';
import { HURT } from './pick.js';
import { candidatesOf, narrow, takeTurn } from './angler.js';
import * as delve from './delve.js';
import * as holdem from '../holdem/state.js';
import { drawEnemy } from '../holdem/mobs.js';
import { roll as rollLoot, listText } from '../casino/loot.js';
import { describe } from '../casino/poker.js';

const num = (n) => Number(n ?? 0).toLocaleString('ko-KR');
const itemOf = (key) => ITEM_BY_KEY[key];
const stack = (key, count) => `${itemOf(key)?.name ?? key} ×${count}`;
const pickOne = (list, rand) => list[Math.floor(rand() * list.length)];

/** 스레드 이름과 요약 카드의 꼬리표. */
export function labelOf({ kind, duo, plan }) {
  if (kind === 'talk') return duo ? { icon: '💬', label: '수다' } : { icon: '💭', label: '혼잣말' };
  if (kind === 'shop' && plan?.revive) return { icon: '💫', label: '부활의 영약' };
  if (kind === 'shop') return plan?.drink ? { icon: '🍶', label: '약 사러' } : { icon: '🛒', label: '장보기' };
  if (kind === 'dungeon') return { icon: '⚔️', label: '던전' };
  if (kind === 'cook' || kind === 'craft') return { icon: MODE_OF[kind].icon, label: MODE_OF[kind].verb };
  if (kind === 'fish') return { icon: '🎣', label: '낚시' };
  return { icon: '🎁', label: '선물' };
}

/** 이야깃거리. 둘 다 꺼낼 만한 것 + 그 사람만의 것 + 가방에 든 물건 하나 + 요즘 만든 것 하나. */
const TOPICS = {
  both: ['오늘 날씨', '요즘 마을 분위기', '어젯밤 꾼 꿈', '다음에 가 보고 싶은 곳', '출출한 배'],
  migel: ['새로 만들고 있는 노래', '류트 줄 손질', '마티암을 놀려 줄 궁리'],
  matiam: ['수선할 옷가지', '잘린 목 언저리의 뻐근함', '미겔이 또 무슨 일을 벌일지'],
};

function topicOf(ctx) {
  const bag = Object.entries(ctx.me?.items ?? {}).filter(([k, n]) => n > 0 && itemOf(k));
  const pool = [...TOPICS.both, ...TOPICS[ctx.character]];
  if (bag.length) pool.push(`가방에 든 ${itemOf(pickOne(bag, ctx.rand)[0]).name}`);
  const made = ctx.me?.crafts ?? [];
  if (made.length) pool.push(`요즘 만든 ${pickOne(made, ctx.rand).name}`);
  return pickOne(pool, ctx.rand);
}

/** 누구의 메모든 앞에 붙는 것 — 오늘이 어떤 날이고 나는 어떤 상태인지. */
function factsOf(ctx, who) {
  const acct = who === ctx.character ? ctx.me : ctx.partnerAccount;
  return [
    ctx.setting ? `오늘: ${ctx.setting}` : null,
    `나: ${NAME[who]} · 체력 ${num(acct?.hp ?? MAX_HP)}/${MAX_HP} · 골드 ${num(acct?.gold)}`,
  ];
}

/**
 * 혼자 하는 대목들. AI 가 준 줄을 쓰고, 빠진 줄은 미리 써 둔 줄로 채운다.
 * `beats` 는 `[{ key, ask, canned }]` — canned 는 `lines.js` 의 대목 이름.
 */
async function scripted(ctx, io, who, facts, beats, vars) {
  const ai = (await io.monologue({ character: who, facts, beats })) ?? {};
  return Object.fromEntries(beats.map((b) => [
    b.key, ai[b.key] || fill(canned(who, b.canned, ctx.rand), vars),
  ]));
}

/** 받는 쪽의 한마디. 건넨 말을 듣고 답한다. */
async function answer(ctx, io, {
  who, from, heard, facts, fallback, vars, ask = '방금 받은 것에 대한 내 한마디.',
}) {
  const text = await io.reply({
    character: who,
    facts: [...factsOf(ctx, who), ...facts],
    transcript: [{ who: from, text: heard }],
    ask,
  });
  return text || fill(canned(who, fallback, ctx.rand), vars);
}

// ---------------------------------------------------------------- 💬 대화

const TURNS = 6;

async function runTalk(ctx, io) {
  const me = ctx.character;
  const topic = topicOf(ctx);

  if (!ctx.choice.duo) {
    const beats = [
      { key: 'first', ask: '혼잣말 — 오늘은 혼자 느긋하게 보내기로 정하는 말. 무엇을 하며 보낼지가 드러나게.' },
      { key: 'second', ask: `혼잣말 — ${topic}에 대해 떠올리는 말.` },
      { key: 'third', ask: '혼잣말 — 생각을 맺는 말.' },
    ];
    const ai = (await io.monologue({ character: me, facts: [...factsOf(ctx, me), `떠올릴 거리: ${topic}`], beats })) ?? {};
    // 한 줄이라도 빠지면 **세 줄을 통째로** 미리 써 둔 한 벌로 — 섞으면 생각이 중간에 끊긴다.
    const said = beats.every((b) => ai[b.key]) ? beats.map((b) => ai[b.key]) : canned(me, 'muse', ctx.rand);
    for (const text of said) await io.say(me, text);
    return { lines: ['💭 혼자 느긋하게 보냈어요.', `> ${said[0]}`] };
  }

  const partner = ctx.partner;
  const other = (who) => (who === me ? partner : me);
  const factsFor = (who) => [
    ...factsOf(ctx, who),
    `같이 있는 사람: ${NAME[other(who)]}`,
    who === me ? `내가 ${josa(NAME[partner], ['을', '를'])} 불렀다` : `${josa(NAME[me], ['이', '가'])} 나를 불러서 왔다`,
    `이야깃거리: ${topic}`,
  ];
  const transcript = [];
  for (let i = 0; i < TURNS; i += 1) {
    const who = i % 2 === 0 ? me : partner;
    const ask = i === 0 ? `${josa(NAME[partner], ['을', '를'])} 불러 세워 말을 건다. 이야깃거리를 꺼낸다.`
      : i === TURNS - 1 ? '이야기를 자연스럽게 맺는다.'
        : '방금 들은 말에 대답하며 이야기를 이어 간다. 되묻거나 딴소리를 해도 좋다.';
    const text = await io.reply({ character: who, facts: factsFor(who), transcript, ask });

    if (!text) {
      if (i === 0) {
        // 처음부터 막혔으면 미리 써 둔 한 벌로 — [부른 쪽, 상대, 부른 쪽, 상대]
        const set = canned(me, 'chat', ctx.rand);
        for (const [j, line] of set.entries()) {
          await io.say(j % 2 === 0 ? me : partner, line);
          transcript.push({ who: j % 2 === 0 ? me : partner, text: line });
          if (j === 0) await io.note(`${josa(NAME[partner], ['이', '가'])} 다가왔다.`);
        }
      } else {
        await io.say(who, fill(canned(who, 'bye', ctx.rand), {}));
      }
      break;
    }
    transcript.push({ who, text });
    await io.say(who, text);
    if (i === 0) await io.note(`${josa(NAME[partner], ['이', '가'])} 다가왔다.`);
  }
  return { lines: [`💬 ${josa(NAME[partner], ['과', '와'])} 이야기를 나눴어요.`, `> ${transcript[0]?.text ?? ''}`] };
}

// ---------------------------------------------------------------- 🛒 장보기

async function runShop(ctx, io) {
  const me = ctx.character;
  const partner = ctx.partner;
  const { duo, plan } = ctx.choice;
  const item = itemOf(plan.key);
  const meId = NPC_ID[me];
  const toId = duo ? NPC_ID[partner] : meId;
  const receiver = duo ? partner : me;
  const vars = { item: item.name, count: plan.count, partner: NAME[partner], giver: NAME[me] };
  const obj = josa(item.name, ['을', '를']);

  // 쓰러진 상대에게 부활의 영약 — 장보기의 한 갈래다(`pick.js`). 상대가 쓰러져 있어서 부를 수는 없고, 찾아간다.
  const revive = Boolean(plan.revive);
  const facts = [
    ...factsOf(ctx, me),
    revive ? `${josa(NAME[partner], ['이', '가'])} 쓰러져 있다(체력 0). 부활의 영약으로만 일어난다` : null,
    plan.drink
      ? `상점에서 ${obj} ${num(plan.cost)}골드에 사서 ${duo ? `${revive ? '쓰러진' : '다친'} ${NAME[partner]}에게 먹일` : '바로 마실'} 참이다.`
      : `상점에서 ${item.name} ${plan.count}개를 ${num(plan.cost)}골드에 ${duo ? `${NAME[partner]}에게 줄 셈으로 ` : ''}살 참이다.`,
    duo ? `${NAME[partner]}의 체력 ${num(ctx.partnerAccount?.hp ?? MAX_HP)}/${MAX_HP}` : null,
  ];
  const beats = duo
    ? [
      revive
        ? { key: 'open', canned: 'reviveOpen', ask: `혼잣말 — 쓰러진 ${josa(NAME[partner], ['을', '를'])} 일으키려고 부활의 영약을 사러 가기로 하는 말. **영약을 사러 간다는 것이 드러나게.**` }
        : plan.drink
          ? { key: 'open', canned: 'potionForOpen', ask: `혼잣말 — 다친 ${NAME[partner]}에게 줄 회복약을 사러 가기로 하는 말. **약을 사러 간다는 것이 드러나게.**` }
          : { key: 'open', canned: 'shopForOpen', ask: `혼잣말 — ${NAME[partner]}에게 줄 것을 사러 가기로 하는 말. **${NAME[partner]} 몫을 사러 간다는 것이 드러나게.**` },
      revive
        ? { key: 'hand', canned: 'reviveHand', ask: `쓰러져 있는 ${NAME[partner]}에게 부활의 영약을 먹이며 하는 말.` }
        : plan.drink
          ? { key: 'hand', canned: 'potionForHand', ask: `${NAME[partner]}에게 회복약을 건네며 마시라고 하는 말.` }
          : { key: 'hand', canned: 'shopForHand', ask: `${NAME[partner]}에게 사 온 ${obj} 건네며 하는 말.` },
    ]
    : [
      plan.drink
        ? { key: 'open', canned: 'potionOpen', ask: '혼잣말 — 몸이 무거워 회복약을 사러 가기로 하는 말. **약을 사러 간다는 것이 드러나게.**' }
        : { key: 'open', canned: 'shopOpen', ask: '혼잣말 — 오늘은 장을 보러 가기로 정하는 말. **장을 보러 간다는 것이 드러나게.**' },
      ...(plan.drink ? [] : [{ key: 'browse', canned: 'shopBrowse', ask: `혼잣말 — 진열대에서 ${obj} 고르며 하는 말.` }]),
      plan.drink
        ? { key: 'after', canned: 'potionAfter', ask: '혼잣말 — 약을 마시고 난 뒤의 말.' }
        : { key: 'after', canned: 'shopAfter', ask: '혼잣말 — 다 사고 나서 하는 말.' },
    ];
  const said = await scripted(ctx, io, me, facts, beats, vars);

  await io.say(me, said.open);
  if (said.browse) await io.say(me, said.browse);

  const heal = plan.drink ? healOf(item, ctx.rand) : 0;
  const saved = await io.apply({
    deltas: { [meId]: -plan.cost },
    ...(plan.drink ? { hp: { [toId]: heal } } : { items: { [toId]: { [plan.key]: plan.count } } }),
    // 「힐러」 — 쓰러진 이에게 부활의 영약을 먹였다. `/사용` 으로 먹였을 때와 같은 칸이다.
    ...(revive ? { bump: { [meId]: { reviveGiven: 1 } } } : {}),
  });
  if (!saved.ok) {
    await io.say(me, fill(canned(me, 'oops', ctx.rand), vars));
    return { lines: [`${plan.drink ? '🍶' : '🛒'} 사려던 ${obj} 못 샀어요 — 저장이 안 됐어요.`] };
  }

  const before = Number((duo ? ctx.partnerAccount : ctx.me)?.hp ?? MAX_HP);
  const after = Number(saved.accounts?.[toId]?.hp ?? before + heal);
  const goldLeft = saved.accounts?.[meId]?.gold;
  const bought = `${stack(plan.key, plan.count)} · −${num(plan.cost)}골드`;
  const things = josa(`${item.name} ${plan.count}개`, ['을', '를']);
  const hpText = `체력 ${num(before)} → ${num(after)}`;

  if (!duo) {
    await io.note(plan.drink
      ? `🍶 ${josa(NAME[me], ['이', '가'])} ${obj} 사서 바로 마셨다 · −${num(plan.cost)}골드 · ${hpText}`
      : `🛒 ${josa(NAME[me], ['이', '가'])} ${things} 샀다 · −${num(plan.cost)}골드`);
    await io.say(me, said.after);
    return {
      lines: plan.drink
        ? [`🍶 ${obj} 사서 마셨어요 · −${num(plan.cost)}골드`, `❤️ ${hpText}`]
        : [`🛒 ${bought}`, goldLeft != null ? `💰 남은 골드 ${num(goldLeft)}` : null].filter(Boolean),
    };
  }

  await io.note(`🛒 ${josa(NAME[me], ['이', '가'])} ${NAME[partner]} 몫으로 ${plan.drink ? obj : things} 샀다 · −${num(plan.cost)}골드`);
  await io.say(me, said.hand);
  if (revive) await io.note(`💫 ${josa(NAME[partner], ['이', '가'])} 일어났다 · ${hpText}`);
  else if (plan.drink) await io.note(`🍶 ${josa(NAME[partner], ['이', '가'])} 약을 마셨다 · ${hpText}`);
  const thanks = await answer(ctx, io, {
    who: receiver,
    from: me,
    heard: said.hand,
    facts: [revive
      ? `쓰러져 있다가 ${josa(NAME[me], ['이', '가'])} 먹여 준 부활의 영약으로 일어났다. 체력 ${before} → ${after}`
      : plan.drink
        ? `${josa(NAME[me], ['이', '가'])} 사 온 ${obj} 받아 마셨다. 체력 ${before} → ${after}`
        : `${josa(NAME[me], ['이', '가'])} 상점에서 사 온 ${item.name} ${plan.count}개를 나에게 줬다`],
    fallback: revive ? 'revived' : plan.drink ? 'drinkThanks' : 'thanks',
    vars,
  });
  await io.say(receiver, thanks);
  return {
    lines: [
      `${revive ? '💫' : plan.drink ? '🍶' : '🛒'} ${NAME[partner]}에게 ${bought}`,
      plan.drink ? `❤️ ${NAME[partner]} ${hpText}` : null,
    ].filter(Boolean),
  };
}

// ---------------------------------------------------------------- 🎁 선물

async function runGift(ctx, io) {
  const me = ctx.character;
  const partner = ctx.partner;
  const { duo, plan } = ctx.choice;
  const meId = NPC_ID[me];
  // 혼자 하는 선물은 **명령한 사람에게** 간다. 둘이 하는 선물은 상대에게.
  const target = duo ? NAME[partner] : ctx.human.name;
  const toId = duo ? NPC_ID[partner] : ctx.human.id;

  // 명부의 물건이거나, 손수 만든 것(`/요리`·`/제작`·`/일상`) 하나.
  const craft = plan.craft ?? null;
  const name = craft ? craft.name : itemOf(plan.key).name;
  const what = craft ? `직접 만든 ${craft.kind} ${name}` : `${name} ${plan.count}개`;
  const shown = craft ? `${GRADE_BY_KEY[craft.grade]?.emoji ?? ''} ${name}`.trim() : stack(plan.key, plan.count);
  const vars = { item: name, count: craft ? 1 : plan.count, target, giver: NAME[me] };
  const obj = josa(name, ['을', '를']);

  const facts = [
    ...factsOf(ctx, me),
    `가방에 든 ${josa(what, ['을', '를'])} ${target}에게 줄 참이다.`,
    craft?.desc ? `그 ${craft.kind}의 모양: ${craft.desc.slice(0, 150)}` : null,
    duo ? null : `${target}: 오늘 나를 불러낸 사람`,
  ];
  const beats = [
    { key: 'open', canned: 'giftOpen', ask: `혼잣말 — 가방을 뒤지며 오늘은 ${target}에게 선물을 하기로 하는 말. **선물하려는 것이 드러나게.**` },
    { key: 'hand', canned: 'giftHand', ask: `${target}에게 ${obj} 건네며 하는 말.` },
    ...(duo ? [] : [{ key: 'after', canned: 'giftAfter', ask: '혼잣말 — 건네고 나서 하는 말.' }]),
  ];
  const said = await scripted(ctx, io, me, facts, beats, vars);

  await io.say(me, said.open);
  await io.say(me, said.hand);
  const saved = await io.apply(craft
    ? { crafts: { [meId]: { remove: [craft.id] }, [toId]: { add: [craft] } } }
    : { items: { [meId]: { [plan.key]: -plan.count }, [toId]: { [plan.key]: plan.count } } });
  if (!saved.ok) {
    await io.say(me, fill(canned(me, 'oops', ctx.rand), vars));
    return { lines: [`🎁 주려던 ${obj} 못 건넸어요 — 저장이 안 됐어요.`] };
  }

  const to = duo ? NAME[partner] : `<@${ctx.human.id}>`;
  await io.note(`🎁 ${josa(NAME[me], ['이', '가'])} ${to}에게 ${josa(craft ? name : `${name} ${plan.count}개`, ['을', '를'])} 건넸다`);
  if (duo) {
    const thanks = await answer(ctx, io, {
      who: partner,
      from: me,
      heard: said.hand,
      facts: [`${josa(NAME[me], ['이', '가'])} 가방에서 ${josa(what, ['을', '를'])} 꺼내 나에게 줬다`],
      fallback: 'thanks',
      vars,
    });
    await io.say(partner, thanks);
  } else {
    await io.say(me, said.after);
  }
  return { lines: [`🎁 ${to}에게 ${shown}`] };
}

// ---------------------------------------------------------------- 🍳 요리 · 🔨 제작

const MODE_OF = { cook: MODES.요리, craft: MODES.제작 };

/**
 * 솜씨를 말로. 캐릭터에게 등급 이름을 주지 않는다 — 이야기 속 사람은 "브론즈" 를 모른다
 * (심사관의 지문도 같은 규칙이다, `ai/judge.js`). 결과 카드에는 등급이 그대로 뜬다.
 */
const QUALITY = {
  stone: '망가졌다 — 타거나 깨져서 못 쓰게 됐다',
  bronze: '그럭저럭 됐다',
  silver: '꽤 괜찮게 됐다',
  gold: '아주 잘 됐다',
  platinum: '기막히게 잘 됐다',
  diamond: '두고두고 이야기될 만큼 완벽하게 됐다',
};

/** AI 가 조리법을 못 지었을 때. 심사관은 이것도 똑같이 읽는다 — 핵심 공정은 짚어 둔다. */
const FALLBACK = {
  cook: {
    tails: ['볶음', '조림', '수프', '구이', '무침'],
    process: '재료를 깨끗이 씻어 손질하고 먹기 좋게 썬 뒤, 약한 불에서 속까지 천천히 익히며 간을 봐 가며 맞췄다.',
  },
  craft: {
    tails: ['장식', '브로치', '부적', '책갈피', '매듭'],
    process: '재료를 깨끗이 닦아 모양을 다듬고, 거친 곳은 갈아 낸 뒤 끈으로 단단히 엮어 하나로 만들었다.',
  },
};

async function runMake(ctx, io) {
  const me = ctx.character;
  const partner = ctx.partner;
  const { kind, duo, plan } = ctx.choice;
  const mode = MODE_OF[kind];
  const meId = NPC_ID[me];
  // 둘이 하면 **상대 몫으로** 만든다 — 장보기와 같다. 재료는 부른 쪽 가방에서 나온다.
  const toId = NPC_ID[duo ? partner : me];
  const eater = duo ? ctx.partnerAccount : ctx.me;
  const keys = Object.entries(plan.counts).flatMap(([k, n]) => Array(n).fill(k));
  const names = Object.entries(plan.counts).map(([k, n]) => `${itemOf(k).name}${n > 1 ? ` ×${n}` : ''}`);
  const vars = { partner: NAME[partner], giver: NAME[me] };

  const rec = await io.recipe({
    character: me,
    mode,
    facts: [...factsOf(ctx, me), `쓸 재료: ${names.join(', ')}`],
    forWhom: duo ? NAME[partner] : null,
  });
  const name = rec?.name ?? `${itemOf(keys[0]).name} ${pickOne(FALLBACK[kind].tails, ctx.rand)}`;
  const process = rec?.process ?? FALLBACK[kind].process;
  vars.item = name;

  await io.say(me, rec?.open || fill(canned(me, duo ? `${kind}ForOpen` : `${kind}Open`, ctx.rand), vars));
  await io.note(`🧺 ${names.join(', ')}`);
  await io.say(me, rec?.during || fill(canned(me, `${kind}During`, ctx.rand), vars));

  const dice = roll(ctx.rand);
  const answered = await io.judge(mode, { name, process, counts: plan.counts, dice });
  if (!answered?.ok) {
    // 판정을 못 받았으면 **아무것도 안 쓴다** — `/요리` 와 같다. 재료는 그대로다.
    await io.say(me, fill(canned(me, 'makeGiveUp', ctx.rand), vars));
    return { lines: [`${mode.icon} 만들다 말았어요 — 재료는 그대로예요.`] };
  }

  const { judged } = answered;
  const { parts, total } = scoreOf(mode, judged, dice);
  // 독은 애초에 안 넣는다(`pick.js`). 그래도 `/요리` 와 같은 길로 등급을 낸다.
  const { grade, capped, by } = gradeOf(total, dice);
  const { heal, harm } = effectOf(mode, grade, judged, keys, ctx.rand);
  const craft = {
    id: newId(),
    kind: mode.verb,
    name,
    grade: grade.key,
    heal,
    harm,
    price: priceOf(keys, grade),
    mt: grade.mt,
    desc: judged.desc,
    from: keys,
    dice,
    score: total,
  };
  const broken = grade.key === 'stone';
  // **다친 쪽이 받으면 바로 먹는다** — 탈 없이 차는 요리일 때만. 망가진 것은 버린다.
  const eat = !broken && mode.edible && !harm && heal > 0 && Number(eater?.hp ?? MAX_HP) < HURT;

  const saved = await io.apply({
    items: { [meId]: Object.fromEntries(Object.entries(plan.counts).map(([k, n]) => [k, -n])) },
    ...(eat ? { hp: { [toId]: heal } } : {}),
    ...(!eat && !broken ? { crafts: { [toId]: { add: [craft] } } } : {}),
    bump: { [meId]: bumpOf(mode, grade, keys) },
  });
  if (!saved.ok) {
    await io.say(me, fill(canned(me, 'oops', ctx.rand), vars));
    return { lines: [`${mode.icon} 만든 것을 저장하지 못했어요 — 재료는 그대로예요.`] };
  }

  await io.card(mode, { ...craft, verdict: judged.verdict }, {
    parts, total, capped, by, poison: 0, who: NAME[me], names,
  });

  const made = [`만든 것: ${name}`, `솜씨: ${QUALITY[grade.key]}`, `모양: ${judged.desc}`];
  const before = Number(eater?.hp ?? MAX_HP);
  const hpText = `체력 ${num(before)} → ${num(saved.accounts?.[toId]?.hp ?? before + heal)}`;
  const title = `${grade.emoji} ${grade.label} — ${name}`;

  if (broken) {
    await io.note(`${grade.emoji} ${josa(name, ['은', '는'])} 못 쓰게 돼서 버렸다`);
    const sigh = await io.reply({
      character: me,
      facts: [...factsOf(ctx, me), ...made],
      ask: '혼잣말 — 망가진 것을 보고 하는 말.',
    });
    const sighLine = sigh || fill(canned(me, `${kind}Broke`, ctx.rand), vars);
    await io.say(me, sighLine);
    if (duo) {
      const laugh = await answer(ctx, io, {
        who: partner,
        from: me,
        heard: sighLine,
        facts: [`${josa(NAME[me], ['이', '가'])} 나에게 주려고 만들던 ${josa(name, ['이', '가'])} 망가졌다`],
        fallback: 'laugh',
        vars,
        ask: '그걸 본 내 한마디.',
      });
      await io.say(partner, laugh);
    }
    return { lines: [title, '🪨 망가져서 버렸어요.'] };
  }

  if (!duo) {
    if (eat) await io.note(`🍽️ ${josa(NAME[me], ['이', '가'])} 바로 먹었다 · ${hpText}`);
    const line = await io.reply({
      character: me,
      facts: [...factsOf(ctx, me), ...made, eat ? `다쳐 있어서 바로 먹었다. ${hpText}` : null],
      ask: eat ? '혼잣말 — 먹고 나서 하는 말.' : '혼잣말 — 다 만든 것을 보고 하는 말.',
    });
    const good = grade.rank >= GRADE_BY_KEY.gold.rank;
    await io.say(me, line || fill(canned(me, eat ? 'eatAfter' : `${kind}${good ? 'Good' : 'Meh'}`, ctx.rand), vars));
    return { lines: [title, eat ? `🍽️ 바로 먹었어요 · ${hpText}` : `📦 ${NAME[me]}의 만든 것에 넣었어요.`] };
  }

  const hand = await io.reply({
    character: me,
    facts: [...factsOf(ctx, me), ...made, `같이 있는 사람: ${NAME[partner]}`],
    ask: `${NAME[partner]}에게 다 만든 ${josa(name, ['을', '를'])} 건네며 하는 말.`,
  });
  const handLine = hand || fill(canned(me, `${kind}Hand`, ctx.rand), vars);
  await io.say(me, handLine);
  await io.note(`🎁 ${josa(NAME[me], ['이', '가'])} ${NAME[partner]}에게 ${josa(name, ['을', '를'])} 건넸다`
    + (eat ? ` · ${josa(NAME[partner], ['이', '가'])} 바로 먹었다 · ${hpText}` : ''));
  const thanks = await answer(ctx, io, {
    who: partner,
    from: me,
    heard: handLine,
    facts: [
      `${josa(NAME[me], ['이', '가'])} 나에게 주려고 만든 ${josa(name, ['을', '를'])} 받았다`,
      `솜씨: ${QUALITY[grade.key]}`,
      `모양: ${judged.desc}`,
      eat ? `다쳐 있어서 받자마자 먹었다. ${hpText}` : null,
    ],
    fallback: eat ? 'eatThanks' : 'thanks',
    vars,
  });
  await io.say(partner, thanks);
  return {
    lines: [title, eat ? `🍽️ ${josa(NAME[partner], ['이', '가'])} 바로 먹었어요 · ${hpText}` : `🎁 ${NAME[partner]}에게 건넸어요.`],
  };
}

// ---------------------------------------------------------------- 🎣 낚시

/**
 * `/요트 낚시` 와 **같은 판**을 버튼 없이 둔다(`daily/angler.js`). 하루 무료 낚시(다섯 번)도
 * 그 캐릭터 몫에서 쓴다 — 일상이 하루 세 번이라 모자랄 일은 없지만, 모자라면 못 던진다.
 *
 * 한 기회마다 작은 글씨 한 줄 — 굴린 눈, 적은 칸, 기척. 아깝게 빗나가면 한 번 중얼거린다.
 * 둘이면 상대가 옆에서 구경하다 끝에 한마디 한다. 정산·도감·전적·MT 는 `/요트 낚시` 와 같다
 * (`fishing.rewardOf`), 결과 카드도 같다.
 */
async function runFish(ctx, io) {
  const me = ctx.character;
  const partner = ctx.partner;
  const { duo } = ctx.choice;
  const meId = NPC_ID[me];
  const vars = { partner: NAME[partner], giver: NAME[me] };

  const quota = await io.tryFish(meId);
  if (!quota?.ok) {
    await io.say(me, fill(canned(me, 'fishClosed', ctx.rand), vars));
    return { lines: ['🎣 오늘은 낚싯대를 못 던졌어요 — 하루 낚시를 다 썼어요.'] };
  }

  const beats = [
    { key: 'open', canned: 'fishOpen', ask: '혼잣말 — 오늘은 낚시를 하러 가기로 정하는 말. **낚시하러 간다는 것이 드러나게.**' },
    ...(duo ? [{ key: 'invite', canned: 'fishInvite', ask: `${NAME[partner]}에게 낚시 구경을 오라고 부르는 말.` }] : []),
    { key: 'cast', canned: 'fishCast', ask: '혼잣말 — 찌를 던지며 하는 말.' },
  ];
  const said = await scripted(ctx, io, me, factsOf(ctx, me), beats, vars);

  await io.say(me, said.open);
  if (duo) {
    await io.say(me, said.invite);
    await io.note(`${josa(NAME[partner], ['이', '가'])} 옆에 앉았다.`);
    await io.say(partner, fill(canned(partner, 'watchCome', ctx.rand), vars));
  }

  const round = fishing.build({ channelId: 'daily', userId: meId, name: NAME[me], color: null, rand: ctx.rand });
  round.left = quota.left;
  if (round.hidden.legend) {
    await io.note(fishing.openingLine(round.hidden).replace(/\*\*/g, ''));
    await io.say(me, fill(canned(me, 'fishLegend', ctx.rand), vars));
  }
  await io.say(me, said.cast);

  let cands = candidatesOf(round);
  let muttered = false;
  while (round.phase === 'fishing') {
    const out = takeTurn(round, cands, { die: ctx.die, rand: ctx.rand });
    const at = out.key ? ` → ${categoryOf(out.key).short}` : '';
    await io.note(`🎲 ${faces(out.dice)}${at} · ${out.caught ? '🎣 찌가 쑥 들어갔다!' : out.hint}`);
    if (out.caught) break;
    if (out.key && !round.hidden.legend) cands = narrow(cands, out.key, out.gap);
    // 아깝게 빗나가면 한 번만 중얼거린다 — 매번 하면 기척 줄이 대사에 묻힌다.
    if (out.gap === 1 && !round.hidden.legend && !muttered) {
      muttered = true;
      await io.say(me, fill(canned(me, 'fishNear', ctx.rand), vars));
    }
  }

  const saved = await io.apply(fishing.rewardOf(round, meId));
  if (!saved.ok) {
    await io.say(me, fill(canned(me, 'oops', ctx.rand), vars));
    return { lines: ['🎣 건져 올린 것을 놓쳤어요 — 저장이 안 됐어요.'] };
  }
  await io.fishCard(round, { book: saved.accounts?.[meId]?.fish ?? null });

  const c = round.caught;
  const item = c ? itemOf(c.key) : null;
  const legend = Boolean(c && isLegend(c.key));
  const junk = Boolean(c && !legend && !isFish(c.key));
  const what = c ? `${item.name}${c.cm ? ` ${c.cm}cm` : ''}` : null;
  if (legend) await io.note(`✦ 전설의 값 · ${josa(NAME[me], ['이', '가'])} MT 1을 받았다`);

  const line = await io.reply({
    character: me,
    facts: [
      ...factsOf(ctx, me),
      ...(c
        ? [`낚은 것: ${what}`, `어떤 것: ${item.desc}`, legend ? '전설이다. 평생 한 번 볼까 말까 한 것' : junk ? '물고기가 아니라 잡동사니다' : null]
        : ['여섯 번을 던졌지만 아무것도 못 낚았다. 빈손이다']),
    ],
    ask: c ? '혼잣말 — 방금 건져 올린 것을 보고 하는 말.' : '혼잣말 — 빈손으로 낚싯대를 거두며 하는 말.',
  });
  const lastLine = line || fill(canned(me, !c ? 'fishNone' : legend ? 'fishLegendGot' : junk ? 'fishJunk' : 'fishGot', ctx.rand), vars);
  await io.say(me, lastLine);

  if (duo) {
    const cheer = await answer(ctx, io, {
      who: partner,
      from: me,
      heard: lastLine,
      facts: [
        `옆에서 ${josa(NAME[me], ['이', '가'])} 낚시하는 것을 구경했다`,
        c ? `${josa(NAME[me], ['이', '가'])} 낚은 것: ${what}` : `${josa(NAME[me], ['은', '는'])} 아무것도 못 낚았다`,
        legend ? '전설이다. 평생 한 번 볼까 말까 한 것' : junk ? '물고기가 아니라 잡동사니다' : null,
      ],
      fallback: c && !junk ? 'fishCheer' : 'fishTease',
      vars,
      ask: '옆에서 구경하다가 하는 한마디.',
    });
    await io.say(partner, cheer);
  }

  return {
    lines: c
      ? [`🎣 ${what}${legend ? ' ✦ 전설 · MT +1' : ''}`, `🎲 ${round.turn}번째에 낚았어요.`]
      : ['🎣 빈손으로 돌아왔어요.', `🎲 ${round.tries}번 모두 빗나갔어요.`],
  };
}

// ---------------------------------------------------------------- ⚔️ 던전

/**
 * `/홀덤 던전` 과 **같은 판**을 버튼 없이 돈다(`daily/delve.js`). 체력은 핸드마다 저장하고
 * (`payout.hand` — 봇이 재시작해도 그 핸드까지는 남는다), 끝나면 넘친 기운·전리품·전적을 정산한다.
 * **쓰러질 수 있다.** 쓰러지면 부활의 영약으로만 일어난다.
 *
 * 둘이 갔으면 **교대로** 싸운다 — 싸우던 쪽이 바닥나면 쉬던 쪽이 나서고, **쓰러져도 쉬던 쪽이
 * 이어 싸운다**(올인 한 번에 바닥을 건너뛰고 쓰러지는 일이 흔해서다). 쓰러진 쪽은 그대로 쓰러져
 * 있다. 둘 다 쓰러질 수도 있다.
 *
 * 중계는 **굵직한 것만** — 체력이 크게 오간 핸드·올인·쇼다운·끝난 핸드만 한 줄씩, 잔잔한 핸드는
 * 모아 두었다가 다음 굵은 줄 앞에 한 줄로 적는다. 판 도중의 중얼거림은 미리 써 둔 줄이다 —
 * 한 판에 핸드가 스물을 넘기도 해서, 그걸 다 AI 로 부르면 한도를 혼자 쓴다.
 */

/** 크게 딴·잃은 핸드 — 한 번씩 중얼거린다. */
const BIG = 15;
/** 이 아래로 떨어지면 한 번 중얼거린다. */
const LOW_SAY = 25;
/** 이만큼(핸드 전 체력의 몫) 오가면 굵은 핸드다. 적어도 6. */
const LOUD_SHARE = 0.15;

const sign = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');
const charOf = (id) => String(id).replace(/^npc:/, '');
const nameOfId = (id) => NAME[charOf(id)] ?? id;
/** `미겔·마티암` */
const namesOf = (ids) => ids.map(nameOfId).join('·');

/** 굵은 핸드 한 줄. 쇼다운이면 서로의 족보를 붙인다. */
function handLine(game, row, results, allIn) {
  const f = delve.fighterOf(game);
  const m = delve.mobOf(game);
  const shown = new Map((results.shown ?? []).map((x) => [x.seatIndex, x.hand]));
  const fi = game.seats.indexOf(f);
  const mi = game.seats.indexOf(m);
  const vs = shown.has(fi) && shown.has(mi) ? ` (${describe(shown.get(fi))} vs ${describe(shown.get(mi))})` : '';
  return `🃏 ${game.handNo}핸드${allIn ? ' · 올인' : ''} · ${row.name} ${sign(row.net)}${vs} → 체력 ${f.gold} · ${m.name} ${m.gold}`;
}

/** 넘친 기운의 정산을 한두 줄로(`payout.settleOverflow` 의 결과). */
function overflowText(done) {
  if (!done) return '';
  const lines = [];
  for (const h of done.heal ?? []) {
    lines.push(h.from === done.to
      ? `💚 **${nameOfId(h.from)}** — 넘친 기운으로 체력을 **${h.hp}** 되찾았어요`
      : `💚 **${nameOfId(h.from)}** — 넘친 기운으로 ${nameOfId(done.to)}의 체력을 **${h.hp}** 고쳤어요`);
  }
  for (const [id, got] of Object.entries(done.items ?? {})) {
    if (!Object.keys(got).length) continue;
    lines.push(`🎒 **${nameOfId(id)}** — 남은 기운 **${done.spare?.[id] ?? '?'}** → ${listText({ items: got }, ITEM_BY_KEY)}`);
  }
  if (!lines.length) return '';
  if (!done.ok) lines.push('_저장하지 못했어요._');
  return `\n\n${lines.join('\n')}`;
}

/** 전리품을 대사 메모에 쓸 모양으로 — 굵은 글씨 없이. */
const plainDrops = (drops) => [
  ...Object.entries(drops.items ?? {}).map(([k, n]) => `${itemOf(k)?.name ?? k}${n > 1 ? ` ${n}개` : ''}`),
  drops.gold ? `${num(drops.gold)}골드` : null,
  drops.mt ? `MT ${drops.mt}` : null,
].filter(Boolean).join(', ');

/** 쓰러진 이를 일으키는 법 — 캐릭터마다 한 줄. */
const reviveHow = (ids) => ids.map((id) => `\`/사용 이름:부활의 영약 캐릭터:${nameOfId(id)}\``).join(' · ');

async function runDungeon(ctx, io) {
  const me = ctx.character;
  const partner = ctx.partner;
  const { duo } = ctx.choice;
  const meId = NPC_ID[me];
  const partnerId = NPC_ID[partner];
  const vars = { partner: NAME[partner], giver: NAME[me] };
  const mob = drawEnemy(ctx.rand);
  const foe = mob.name;

  const beats = [
    { key: 'open', canned: 'delveOpen', ask: '혼잣말 — 오늘은 던전에 내려가기로 정하는 말. **던전에 간다는 것이 드러나게.**' },
    ...(duo ? [{ key: 'invite', canned: 'delveInvite', ask: `${NAME[partner]}에게 같이 던전에 가자고 하는 말.` }] : []),
    { key: 'face', canned: 'delveFace', ask: `혼잣말 — 던전에서 ${josa(foe, ['을', '를'])} 마주하고 하는 말.` },
  ];
  const said = await scripted(ctx, io, me, [
    ...factsOf(ctx, me),
    `던전에서 마주칠 적: ${foe}${mob.elite ? ' (엘리트 — 훨씬 세다)' : ''} — ${mob.note}`,
    '던전에서는 체력을 걸고 싸운다. 쓰러지면 부활의 영약으로만 일어난다',
  ], beats, vars);

  const opened = delve.open({
    owner: meId,
    partner: duo ? partnerId : null,
    hp: Number(ctx.me?.hp ?? MAX_HP),
    partnerHp: duo ? Number(ctx.partnerAccount?.hp ?? MAX_HP) : 0,
    mob,
    rand: ctx.rand,
  });
  await io.say(me, said.open);
  if (opened.error) {
    await io.say(me, fill(canned(me, 'oops', ctx.rand), vars));
    return { lines: [`⚔️ 던전에 못 들어갔어요 — ${opened.error}`] };
  }
  const { game } = opened;
  if (duo) {
    await io.say(me, said.invite);
    await io.note(`${josa(NAME[partner], ['이', '가'])} 뒤를 받친다.`);
    await io.say(partner, fill(canned(partner, 'delveCome', ctx.rand), vars));
  }
  // 체력은 **들어올 때 값**으로 적는다 — 자리의 값은 이미 첫 블라인드를 낸 뒤다.
  await io.note(`⚔️ ${mob.elite ? '엘리트 · ' : ''}${foe} — 체력 ${game.cap[delve.mobOf(game).id]}`
    + ` · 블라인드 ${game.stakes.sb}/${game.stakes.bb}\n${mob.note}`);
  await io.say(me, said.face);
  // 도감 — 만났다. 판을 막지 않는다(`/홀덤 던전` 과 같다).
  await io.dungeon.met(meId, foe);

  const quiet = { n: 0, net: 0 };
  const flush = async () => {
    if (!quiet.n) return;
    await io.note(`· 잔잔한 핸드 ${quiet.n}번 (${sign(quiet.net)})`);
    quiet.n = 0;
    quiet.net = 0;
  };
  // 중얼거림은 사람·갈래마다 한 번 — 같은 말을 핸드마다 하면 중계가 대사에 묻힌다.
  const once = new Set();
  const mutter = async (who, key) => {
    if (once.has(`${who}:${key}`)) return;
    once.add(`${who}:${key}`);
    await io.say(who, fill(canned(who, key, ctx.rand), vars));
  };
  const fallen = [];                 // 쓰러진 순서
  let carrier = null;                // 쓰러진 쪽을 업고 나온 쪽
  let level = game.stakes.level ?? 0;
  let unsaved = false;
  const nextHand = async () => {
    if (!holdem.nextHand(game)) return false;
    if ((game.stakes.level ?? 0) !== level) {
      level = game.stakes.level ?? 0;
      await io.note(`📈 블라인드가 ${game.stakes.sb}/${game.stakes.bb}로 올랐다`);
    }
    return true;
  };

  for (;;) {
    const results = delve.playHand(game, ctx.rand);
    const f = delve.fighterOf(game);
    const m = delve.mobOf(game);
    const row = results.rows.find((r) => r.seat === f);
    const net = row?.net ?? 0;
    const allIn = game.seats.some((s) => s.allIn);
    const saved = await io.dungeon.hand(game);
    if (!saved?.ok) unsaved = true;

    const over = f.gold <= 0 || m.gold <= 0;
    if (over || allIn || Math.abs(net) >= Math.max(6, Math.round((f.gold - net) * LOUD_SHARE))) {
      await flush();
      await io.note(handLine(game, row, results, allIn));
    } else {
      quiet.n += 1;
      quiet.net += net;
    }

    if (f.gold <= 0) {
      // 쓰러졌다. 마지막 말을 하고 — 같이 온 쪽이 있으면 성격대로 이어 싸우거나 업고 물러난다.
      fallen.push(f.id);
      await io.say(f.character, fill(canned(f.character, 'fallen', ctx.rand), vars));
      const after = delve.afterFall(game, ctx.rand);
      if (after.step === 'avenge') {
        delve.swap(game, after.to);
        const now = delve.fighterOf(game);
        await io.say(now.character, fill(canned(now.character, 'avenge', ctx.rand), vars));
        await io.note(`🔁 ${josa(now.name, ['이', '가'])} 나섰다 · 체력 ${now.gold}`);
        if (!(await nextHand())) break;
        continue;
      }
      if (after.step === 'carry') {
        carrier = after.by;
        await io.say(charOf(carrier), fill(canned(charOf(carrier), 'carryOut', ctx.rand), vars));
        await io.note(`🏃 ${josa(nameOfId(carrier), ['이', '가'])} ${josa(f.name, ['을', '를'])} 업고 물러났다`);
        holdem.end(game, 'fled');
      }
      break;
    }
    if (!over) {
      if (net >= BIG) await mutter(f.character, 'delveWin');
      else if (net <= -BIG) await mutter(f.character, 'delveHit');
      if (f.gold <= LOW_SAY) await mutter(f.character, 'delveLow');
    }

    const next = delve.between(game, ctx.rand);
    if (next.step === 'end') break;
    if (next.step === 'flee') {
      await flush();
      await io.say(f.character, fill(canned(f.character, 'fleeLine', ctx.rand), vars));
      holdem.end(game, 'fled');
      break;
    }
    if (next.step === 'swap') {
      await flush();
      await io.say(f.character, fill(canned(f.character, 'swapOut', ctx.rand), vars));
      delve.swap(game, next.to);
      const now = delve.fighterOf(game);
      await io.note(`🔁 ${josa(now.name, ['이', '가'])} 나섰다 · 체력 ${now.gold}`);
      await io.say(now.character, fill(canned(now.character, 'swapIn', ctx.rand), vars));
    }
    if (!(await nextHand())) break;
  }
  await flush();

  const f = delve.fighterOf(game);
  const m = delve.mobOf(game);
  const wiped = f.gold <= 0;              // 마지막으로 싸우던 쪽까지 쓰러졌다
  const won = !wiped && m.gold <= 0;
  const hands = `${game.handNo}핸드`;
  const standing = [meId, ...(duo ? [partnerId] : [])].filter((id) => !fallen.includes(id));

  // 넘친 기운은 **끝날 때 한 번** — 이기든 지든 물러나든(`/홀덤 던전` 과 같다).
  const cashed = await io.dungeon.overflow(game);
  let drops = null;
  if (won) {
    drops = rollLoot(ctx.rand, { elite: Boolean(mob.elite) });
    const r = await io.dungeon.won(meId, drops, {
      foe, elite: Boolean(mob.elite), solo: !game.allyUsed, quick: game.handNo === 1, trio: false,
    });
    if (!r?.ok) unsaved = true;
  }
  // 쓰러짐 — 판을 진 것은 한 번(마지막으로 쓰러진 쪽과 함께), 그 앞에 쓰러진 쪽은 쓰러짐만 센다.
  if (wiped) await io.dungeon.lost(meId, f.id);
  const earlier = fallen.filter((id) => !(wiped && id === f.id));
  if (earlier.length) {
    const r = await io.apply({ bump: Object.fromEntries(earlier.map((id) => [id, { dungeonDied: 1 }])) });
    if (!r?.ok) unsaved = true;
  }
  const hpNow = f.gold;
  const down = (fallen.length
    ? `\n💀 **${namesOf(fallen)}** — 쓰러졌어요. 부활의 영약을 먹이면 일어나요: ${reviveHow(fallen)}`
    : '') + (carrier ? `\n🏃 **${nameOfId(carrier)}** 이(가) 업고 나왔어요.` : '');
  const hope = fallen.length && standing.length
    ? `\n_${namesOf(standing)}의 일상에서 영약을 사다 먹일 수도 있어요._`
    : '';

  await io.embed(won
    ? {
      title: mob.elite ? '⚔️ 엘리트를 쓰러뜨렸어요' : '⚔️ 쓰러뜨렸어요',
      description: `**${foe}** 을(를) 눕혔어요. ${hands}.${down}${hope}`
        + `\n\n**주운 것** — ${listText(drops, ITEM_BY_KEY)}${overflowText(cashed)}`,
      color: mob.elite ? 0xc9a227 : 0x8a7a5c,
      footer: `${f.name} 남은 체력 ${hpNow} · /에너미 도감 에 ${foe}의 성향이 적혔어요`,
    }
    : wiped
      ? {
        title: '💀 쓰러졌어요',
        description: `**${foe}** 에게 졌어요. ${hands}.${down}${hope}${overflowText(cashed)}`,
        color: 0x6b5b5b,
      }
      : {
        title: '🏃 물러났어요',
        description: `**${foe}** 을(를) 두고 물러났어요. ${hands}.\n${f.name} 남은 체력 **${hpNow}**.${down}${hope}${overflowText(cashed)}`,
        color: 0x8a7a5c,
      });

  // 끝의 말 — 서 있는 쪽이 한다. 다 쓰러졌으면 쓰러질 때 한 말이 마지막이다.
  if (standing.length) {
    const speaker = charOf(standing[0]);
    const other = charOf(standing[1] ?? '');
    const outcome = won
      ? [`${josa(foe, ['을', '를'])} 쓰러뜨렸다(${hands})`, `주운 것: ${plainDrops(drops)}`]
      : wiped
        ? [`${foe}에게 졌다(${hands})`]
        : [`${foe}에게서 물러났다(${hands})`];
    const downFacts = fallen.map((id) => `${josa(nameOfId(id), ['이', '가'])} 쓰러져 있다. 부활의 영약으로만 일어난다`);
    const line = await io.reply({
      character: speaker,
      facts: [...factsOf(ctx, speaker).slice(0, 1), ...outcome, ...downFacts],
      ask: fallen.length
        ? '혼잣말 — 쓰러진 동료를 부축해 던전을 나서며 하는 말.'
        : won ? '혼잣말 — 던전을 나서며 하는 말.' : '혼잣말 — 도망쳐 나와 숨을 고르며 하는 말.',
    });
    const last = line || fill(canned(speaker, fallen.length ? 'fallenCry' : won ? 'delveWon' : 'delveFled', ctx.rand), vars);
    await io.say(speaker, last);
    if (other) {
      const r = await answer(ctx, io, {
        who: other,
        from: speaker,
        heard: last,
        facts: [`${josa(NAME[speaker], ['과', '와'])} 같이 던전에 갔다`, ...outcome.slice(0, 1)],
        fallback: won ? 'delveCheer' : 'delveSigh',
        vars,
        ask: '같이 던전을 나서며 하는 한마디.',
      });
      await io.say(other, r);
    }
  }

  const head = won
    ? `⚔️ ${josa(foe, ['을', '를'])} 쓰러뜨렸어요 · ${hands}`
    : wiped ? `💀 ${foe}에게 졌어요 · ${hands}` : `🏃 ${foe}에게서 물러났어요 · ${hands}`;
  return {
    lines: [
      head,
      won ? `🎒 ${listText(drops, ITEM_BY_KEY)}` : null,
      !won && !wiped ? `❤️ ${f.name} 남은 체력 ${hpNow}` : null,
      fallen.length ? `💀 ${namesOf(fallen)} 쓰러짐 — 부활의 영약이 있어야 일어나요.` : null,
      carrier ? `🏃 ${josa(nameOfId(carrier), ['이', '가'])} 업고 나왔어요.` : null,
      unsaved ? '_저장하지 못한 것이 있어요._' : null,
    ].filter(Boolean),
  };
}

/**
 * 한 장면을 진행한다. `{ lines }` — 요약 카드에 적을 줄들.
 *
 * ctx  `{ character, partner, me, partnerAccount, human, choice, setting, rand }`
 *      human 은 `{ id, name }`(명령한 사람), setting 은 "가을 4일째, 날씨는 맑음" 같은 한 줄(없으면 null)
 */
export async function runDay(ctx, io) {
  const run = {
    talk: runTalk, shop: runShop, gift: runGift, cook: runMake, craft: runMake, fish: runFish, dungeon: runDungeon,
  }[ctx.choice.kind];
  return run({ rand: Math.random, ...ctx }, io);
}

export default { runDay, labelOf };
