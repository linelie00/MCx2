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
 * 입출력은 `io` 로 받는다 — 검사(`scripts/check-daily.mjs`)가 디스코드와 서버 없이 돌린다.
 *   io.say(who, text)   캐릭터로 한 줄      io.note(text)   작은 글씨 한 줄
 *   io.apply(moves)     계정 쓰기          io.monologue / io.reply   `daily/talk.js` 의 것
 */
import { ITEM_BY_KEY, MAX_HP, healOf } from '../casino/items.js';
import { NPC_ID } from '../casino/accounts.js';
import { NAME } from '../ai/persona.js';
import { josa } from '../farm/requesters.js';
import { canned, fill } from './lines.js';

const num = (n) => Number(n ?? 0).toLocaleString('ko-KR');
const itemOf = (key) => ITEM_BY_KEY[key];
const stack = (key, count) => `${itemOf(key)?.name ?? key} ×${count}`;
const pickOne = (list, rand) => list[Math.floor(rand() * list.length)];

/** 스레드 이름과 요약 카드의 꼬리표. */
export function labelOf({ kind, duo, plan }) {
  if (kind === 'talk') return duo ? { icon: '💬', label: '수다' } : { icon: '💭', label: '혼잣말' };
  if (kind === 'shop') return plan?.drink ? { icon: '🍶', label: '약 사러' } : { icon: '🛒', label: '장보기' };
  return { icon: '🎁', label: '선물' };
}

/** 이야깃거리. 둘 다 꺼낼 만한 것 + 그 사람만의 것 + 가방에 든 물건 하나. */
const TOPICS = {
  both: ['오늘 날씨', '요즘 마을 분위기', '어젯밤 꾼 꿈', '다음에 가 보고 싶은 곳', '출출한 배'],
  migel: ['새로 만들고 있는 노래', '류트 줄 손질', '마티암을 놀려 줄 궁리'],
  matiam: ['수선할 옷가지', '잘린 목 언저리의 뻐근함', '미겔이 또 무슨 일을 벌일지'],
};

function topicOf(ctx) {
  const bag = Object.entries(ctx.me?.items ?? {}).filter(([k, n]) => n > 0 && itemOf(k));
  const pool = [...TOPICS.both, ...TOPICS[ctx.character]];
  if (bag.length) pool.push(`가방에 든 ${itemOf(pickOne(bag, ctx.rand)[0]).name}`);
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
async function answer(ctx, io, { who, from, heard, facts, fallback, vars }) {
  const text = await io.reply({
    character: who,
    facts: [...factsOf(ctx, who), ...facts],
    transcript: [{ who: from, text: heard }],
    ask: '방금 받은 것에 대한 내 한마디.',
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

  const facts = [
    ...factsOf(ctx, me),
    plan.drink
      ? `상점에서 ${obj} ${num(plan.cost)}골드에 사서 ${duo ? `다친 ${NAME[partner]}에게 먹일` : '바로 마실'} 참이다.`
      : `상점에서 ${item.name} ${plan.count}개를 ${num(plan.cost)}골드에 ${duo ? `${NAME[partner]}에게 줄 셈으로 ` : ''}살 참이다.`,
    duo ? `${NAME[partner]}의 체력 ${num(ctx.partnerAccount?.hp ?? MAX_HP)}/${MAX_HP}` : null,
  ];
  const beats = duo
    ? [
      plan.drink
        ? { key: 'open', canned: 'potionForOpen', ask: `혼잣말 — 다친 ${NAME[partner]}에게 줄 회복약을 사러 가기로 하는 말. **약을 사러 간다는 것이 드러나게.**` }
        : { key: 'open', canned: 'shopForOpen', ask: `혼잣말 — ${NAME[partner]}에게 줄 것을 사러 가기로 하는 말. **${NAME[partner]} 몫을 사러 간다는 것이 드러나게.**` },
      plan.drink
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
  if (plan.drink) await io.note(`🍶 ${josa(NAME[partner], ['이', '가'])} 약을 마셨다 · ${hpText}`);
  const thanks = await answer(ctx, io, {
    who: receiver,
    from: me,
    heard: said.hand,
    facts: [plan.drink
      ? `${josa(NAME[me], ['이', '가'])} 사 온 ${obj} 받아 마셨다. 체력 ${before} → ${after}`
      : `${josa(NAME[me], ['이', '가'])} 상점에서 사 온 ${item.name} ${plan.count}개를 나에게 줬다`],
    fallback: plan.drink ? 'drinkThanks' : 'thanks',
    vars,
  });
  await io.say(receiver, thanks);
  return {
    lines: [
      `${plan.drink ? '🍶' : '🛒'} ${NAME[partner]}에게 ${bought}`,
      plan.drink ? `❤️ ${NAME[partner]} ${hpText}` : null,
    ].filter(Boolean),
  };
}

// ---------------------------------------------------------------- 🎁 선물

async function runGift(ctx, io) {
  const me = ctx.character;
  const partner = ctx.partner;
  const { duo, plan } = ctx.choice;
  const item = itemOf(plan.key);
  const meId = NPC_ID[me];
  // 혼자 하는 선물은 **명령한 사람에게** 간다. 둘이 하는 선물은 상대에게.
  const target = duo ? NAME[partner] : ctx.human.name;
  const toId = duo ? NPC_ID[partner] : ctx.human.id;
  const vars = { item: item.name, count: plan.count, target, giver: NAME[me] };
  const obj = josa(item.name, ['을', '를']);

  const facts = [
    ...factsOf(ctx, me),
    `가방에 든 ${item.name} ${plan.count}개를 ${target}에게 줄 참이다.`,
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
  const saved = await io.apply({ items: { [meId]: { [plan.key]: -plan.count }, [toId]: { [plan.key]: plan.count } } });
  if (!saved.ok) {
    await io.say(me, fill(canned(me, 'oops', ctx.rand), vars));
    return { lines: [`🎁 주려던 ${obj} 못 건넸어요 — 저장이 안 됐어요.`] };
  }

  const to = duo ? NAME[partner] : `<@${ctx.human.id}>`;
  await io.note(`🎁 ${josa(NAME[me], ['이', '가'])} ${to}에게 ${josa(`${item.name} ${plan.count}개`, ['을', '를'])} 건넸다`);
  if (duo) {
    const thanks = await answer(ctx, io, {
      who: partner,
      from: me,
      heard: said.hand,
      facts: [`${josa(NAME[me], ['이', '가'])} 가방에서 ${item.name} ${plan.count}개를 꺼내 나에게 줬다`],
      fallback: 'thanks',
      vars,
    });
    await io.say(partner, thanks);
  } else {
    await io.say(me, said.after);
  }
  return { lines: [`🎁 ${to}에게 ${stack(plan.key, plan.count)}`] };
}

/**
 * 한 장면을 진행한다. `{ lines }` — 요약 카드에 적을 줄들.
 *
 * ctx  `{ character, partner, me, partnerAccount, human, choice, setting, rand }`
 *      human 은 `{ id, name }`(명령한 사람), setting 은 "가을 4일째, 날씨는 맑음" 같은 한 줄(없으면 null)
 */
export async function runDay(ctx, io) {
  const run = { talk: runTalk, shop: runShop, gift: runGift }[ctx.choice.kind];
  return run({ rand: Math.random, ...ctx }, io);
}

export default { runDay, labelOf };
