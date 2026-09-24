/**
 * check-daily — `/일상` 의 고르기·미리 써 둔 대사·장면 흐름
 *
 *   node scripts/check-daily.mjs
 *
 * 디스코드도 서버도 제미나이도 안 부른다. 장면은 가짜 `io` 로 돌린다.
 *
 *   1. 고르기가 **못 하는 일을 고르지 않는지** — 골드 없이 장보기, 줄 것 없이 선물, 못 오는 상대
 *   2. 사람에게 가는 선물이 값 상한을 넘지 않는지
 *   3. 미리 써 둔 대사가 **모든 대목에** 있고, 마티암이 "요"·"씨" 를 쓰지 않는지
 *   4. 장면이 **혼잣말로 시작하고**, 한 번의 쓰기로 맞는 것을 옮기고, 실패하면 `oops` 로 맺는지
 *   5. 요리·제작이 독을 안 넣고, `/요리` 와 같은 셈으로 저장하고, 망가진 것은 버리고,
 *      다친 쪽은 바로 먹고, 심사관이 막히면 재료를 안 쓰는지
 */
process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= 'x';
process.env.DISCORD_GUILD_ID ||= 'x';

const {
  choose, planShop, planGift, planMake, weighted, HURT, KEEP, HUMAN_GIFT_CAP, POTIONS,
} = await import('../src/daily/pick.js');
const { MAX_CRAFTS, MODES } = await import('../src/casino/crafts.js');
const { LINES, fill, canned } = await import('../src/daily/lines.js');
const { runDay, labelOf } = await import('../src/daily/run.js');
const busy = await import('../src/daily/busy.js');
const { seatedAt, seatedMessage } = await import('../src/casino/tables.js');
const { ITEM_BY_KEY, buyPrice } = await import('../src/casino/items.js');

let ok = 0; let bad = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok += 1; console.log(`  ✓ ${name}`); }
  else { bad += 1; console.log(`  ✗ ${name}\n     받음 ${JSON.stringify(got)} / 기대 ${JSON.stringify(want)}`); }
};

/** 씨앗이 있는 난수 — 검사가 매번 같게 돈다. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rich = { gold: 3000, hp: 100, items: { acorn: 5, driedRose: 1, ruby: 1, potionSmall: 1 } };
const broke = { gold: KEEP, hp: 100, items: {} };
const hurt = { gold: 3000, hp: 20, items: {} };

// ---------------------------------------------------------------- 고르기
console.log('\n고르기');
eq('무게가 다 0 이면 null', weighted([['a', 0], ['b', 0]], Math.random), null);
eq('무게 0 인 것은 안 나온다', [...Array(200)].map(() => weighted([['a', 0], ['b', 1]], Math.random)).every((v) => v === 'b'), true);

eq('남길 골드 밖에 없으면 장을 안 본다', planShop(broke, broke, {}, Math.random), null);
const potion = planShop(hurt, hurt, {}, seeded(1));
eq('다쳤으면 회복약을 사서 바로 마신다', [POTIONS.includes(potion.key), potion.drink, potion.count], [true, true, 1]);
eq('회복약은 제일 싼 것부터', potion.key, 'potionSmall');
eq('다친 상대 몫도 회복약', planShop(rich, hurt, {}, seeded(2)).drink, true);
{
  const r = seeded(3);
  const plans = [...Array(300)].map(() => planShop(rich, rich, { sweet: 3 }, r));
  eq('안 다쳤으면 재료를 산다', plans.every((p) => ITEM_BY_KEY[p.key].kind === '재료' && !p.drink), true);
  eq('한 번에 300골드를 안 넘는다', plans.every((p) => p.cost <= 300), true);
  eq('값은 사는 값 × 개수', plans.every((p) => p.cost === buyPrice(ITEM_BY_KEY[p.key]) * p.count), true);
  eq('개수는 1~5', plans.every((p) => p.count >= 1 && p.count <= 5), true);
  eq('파는 재료만', plans.every((p) => ITEM_BY_KEY[p.key].shop === true), true);
}

eq('가진 게 없으면 선물을 못 한다', planGift(broke, { kind: 'human' }, Math.random), null);
{
  const r = seeded(4);
  const gifts = [...Array(300)].map(() => planGift(rich, { kind: 'human' }, r));
  eq('사람에게는 값싼 것만(루비·회복약 안 됨)', gifts.every((g) => Math.max(ITEM_BY_KEY[g.key].price, buyPrice(ITEM_BY_KEY[g.key])) <= HUMAN_GIFT_CAP), true);
  eq('가진 것보다 많이 안 준다', gifts.every((g) => g.count <= rich.items[g.key]), true);
  const toHurt = [...Array(300)].map(() => planGift(rich, { kind: 'npc', account: hurt }, r));
  eq('다친 상대에게는 회복약이 잘 간다', toHurt.filter((g) => g.key === 'potionSmall').length > 150, true);
}

{
  const r = seeded(5);
  const runs = [...Array(2000)].map(() => choose({
    character: 'migel', me: rich, partner: { account: rich, free: false }, human: { free: false }, rand: r,
  }));
  eq('상대가 못 오면 늘 혼자', runs.every((c) => !c.duo), true);
  eq('받을 사람이 없으면 선물이 없다', runs.some((c) => c.kind === 'gift'), false);
  eq('그래도 장보기와 혼잣말은 한다', ['shop', 'talk'].every((k) => runs.some((c) => c.kind === k)), true);
}
{
  const r = seeded(6);
  const runs = [...Array(2000)].map(() => choose({
    character: 'matiam', me: broke, partner: { account: broke, free: true }, human: { free: true }, rand: r,
  }));
  eq('골드도 가진 것도 없으면 이야기만', runs.every((c) => c.kind === 'talk'), true);
  eq('이야기는 혼자도 둘이도', [true, false].every((d) => runs.some((c) => c.duo === d)), true);
}
{
  const r = seeded(7);
  const runs = [...Array(2000)].map(() => choose({
    character: 'migel', me: hurt, partner: { account: rich, free: true }, human: { free: true }, rand: r,
  }));
  const shops = runs.filter((c) => c.kind === 'shop');
  eq('다쳤으면 장보기가 제일 흔하다', shops.length > runs.length / 2, true);
  eq('다친 내 장보기는 내 약', shops.every((c) => !c.duo && c.plan.drink), true);
}
{
  const r = seeded(8);
  const runs = [...Array(2000)].map(() => choose({
    character: 'migel', me: rich, partner: { account: hurt, free: true }, human: { free: true }, rand: r,
  }));
  eq('상대가 다쳤으면 상대 약을 사다 준다', runs.filter((c) => c.kind === 'shop').every((c) => c.duo && c.plan.drink), true);
  eq('다 나온다', ['talk', 'shop', 'gift'].every((k) => runs.some((c) => c.kind === k)), true);
  eq('선물은 둘이면 상대에게, 혼자면 사람에게 — 둘 다 나온다', [true, false].every((d) => runs.some((c) => c.kind === 'gift' && c.duo === d)), true);
}

// ---------------------------------------------------------------- 요리·제작 고르기
console.log('\n요리·제작 고르기');
const pantry = {
  gold: 1000,
  hp: 100,
  items: {
    acorn: 2, driedMeat: 1, redApple: 1, prettyMushroom: 3, waterCentipede: 1, // 재료(독 둘)
    leatherScrap: 1, fadedRibbon: 1, fertilizer: 2, potionSmall: 1, // 잡화 · 거름 · 약
  },
  crafts: [],
};
{
  const r = seeded(10);
  const cooks = [...Array(300)].map(() => planMake('cook', pantry, {}, r));
  const keysOf = (plans) => plans.flatMap((p) => Object.keys(p.counts));
  eq('요리에는 독을 안 넣는다', keysOf(cooks).filter((k) => ITEM_BY_KEY[k].poison), []);
  eq('요리에는 재료만', keysOf(cooks).every((k) => ITEM_BY_KEY[k].kind === '재료'), true);
  eq('요리 재료는 두세 가지, 하나씩', cooks.every((p) => [2, 3].includes(Object.keys(p.counts).length) && Object.values(p.counts).every((n) => n === 1)), true);
  const crafts = [...Array(300)].map(() => planMake('craft', pantry, {}, r));
  eq('제작에는 잡화만 — 거름은 빼고', keysOf(crafts).every((k) => ITEM_BY_KEY[k].kind === '잡화' && k !== 'fertilizer'), true);
  eq('재료가 하나뿐이면 하나로', planMake('cook', { items: { acorn: 1 } }, {}, r)?.counts, { acorn: 1 });
  eq('쓸 재료가 없으면 null', planMake('cook', { items: { prettyMushroom: 3 } }, {}, r), null);
}
{
  const r = seeded(11);
  const pick = (opts) => [...Array(1500)].map(() => choose({
    character: 'matiam', me: pantry, partner: { account: pantry, free: true }, human: { free: true, crafts: 0 }, rand: r, ...opts,
  }));
  eq('심사관을 못 부르면 요리·제작이 없다', pick({ canMake: false }).some((c) => ['cook', 'craft'].includes(c.kind)), false);
  const runs = pick({ canMake: true });
  eq('부를 수 있으면 요리도 제작도 나온다', ['cook', 'craft'].every((k) => runs.some((c) => c.kind === k)), true);
  const full = { ...pantry, crafts: Array(MAX_CRAFTS).fill({ id: 'x', name: 'x', grade: 'bronze', kind: '요리', price: 1 }) };
  const packed = [...Array(1500)].map(() => choose({
    character: 'matiam', me: full, partner: { account: full, free: true }, canMake: true, rand: r,
  }));
  eq('둘 다 만든 것이 가득이면 요리·제작이 없다', packed.some((c) => ['cook', 'craft'].includes(c.kind)), false);
}
{
  const r = seeded(12);
  const made = {
    items: {},
    crafts: [
      { id: 'cheap0001', kind: '요리', name: '도토리 수프', grade: 'silver', price: 30, mt: 0, heal: 10 },
      { id: 'dear00001', kind: '제작', name: '루비 반지', grade: 'gold', price: 500, mt: 0, heal: 0 },
      { id: 'mtmt00001', kind: '요리', name: '황금 스튜', grade: 'platinum', price: 150, mt: 5, heal: 40 },
      { id: 'burnt0001', kind: '요리', name: '숯', grade: 'stone', price: 0, mt: 0, heal: -10 },
    ],
  };
  const toHuman = [...Array(200)].map(() => planGift(made, { kind: 'human', crafts: 0 }, r));
  eq('사람에게는 싸고 MT 없는 만든 것만', [...new Set(toHuman.map((g) => g?.craft?.id))], ['cheap0001']);
  eq('사람의 만든 것 칸이 차면 만든 것은 못 준다', planGift(made, { kind: 'human', crafts: MAX_CRAFTS }, r), null);
  eq('칸 수를 모르면 준다고 치지 않는다', planGift(made, { kind: 'human' }, r), null);
  const toNpc = [...Array(300)].map(() => planGift(made, { kind: 'npc', account: { hp: 100, crafts: [] } }, r));
  eq('상대에게는 비싼 것도 주되 망가진 것은 안 준다', [...new Set(toNpc.map((g) => g.craft.id))].sort(), ['cheap0001', 'dear00001', 'mtmt00001']);
}

// ---------------------------------------------------------------- 미리 써 둔 대사
console.log('\n미리 써 둔 대사');
const KEYS = ['muse', 'chat', 'bye', 'shopOpen', 'shopBrowse', 'shopAfter', 'potionOpen', 'potionAfter',
  'shopForOpen', 'shopForHand', 'potionForOpen', 'potionForHand', 'giftOpen', 'giftHand', 'giftAfter',
  'thanks', 'drinkThanks', 'oops',
  'cookOpen', 'cookForOpen', 'cookDuring', 'cookGood', 'cookMeh', 'cookBroke', 'cookHand',
  'craftOpen', 'craftForOpen', 'craftDuring', 'craftGood', 'craftMeh', 'craftBroke', 'craftHand',
  'eatAfter', 'eatThanks', 'laugh', 'makeGiveUp'];
for (const c of ['migel', 'matiam']) {
  eq(`${c}: 대목이 다 있다`, KEYS.filter((k) => !LINES[c][k]?.length), []);
  eq(`${c}: 혼잣말은 세 줄 한 벌`, LINES[c].muse.every((set) => set.length === 3), true);
  eq(`${c}: 수다는 네 줄 한 벌`, LINES[c].chat.every((set) => set.length === 4), true);
}
const vars = { item: '꿀', count: 2, partner: '마티암', target: '겨울', giver: '미겔' };
const every = Object.values(LINES).flatMap((byKey) => Object.values(byKey).flat(2));
eq('자리표시가 다 채워진다', every.map((t) => fill(t, vars)).filter((t) => /\{/.test(t)), []);
eq('조사는 받침을 본다', [fill('{item:을}', { item: '꿀' }), fill('{item:을}', { item: '도토리' }), fill('{item:이}', { item: '사과' })], ['꿀을', '도토리를', '사과가']);

/** 마티암이 **스스로** 하는 말 — 수다 한 벌에서는 짝수 줄만(홀수 줄은 미겔). 미겔의 한 벌에서는 홀수 줄. */
const matiamSays = [
  ...Object.entries(LINES.matiam).filter(([k]) => k !== 'chat' && k !== 'muse').flatMap(([, v]) => v),
  ...LINES.matiam.muse.flat(),
  ...LINES.matiam.chat.flatMap((set) => set.filter((_, i) => i % 2 === 0)),
  ...LINES.migel.chat.flatMap((set) => set.filter((_, i) => i % 2 === 1)),
];
eq('마티암은 문장 끝에 "요" 를 안 붙인다', matiamSays.filter((t) => /요[.!?~…]*$/.test(fill(t, vars))), []);
eq('마티암은 "씨" 를 안 붙인다', matiamSays.filter((t) => /씨/.test(fill(t, vars))), []);
const migelSays = [
  ...Object.entries(LINES.migel).filter(([k]) => k !== 'chat' && k !== 'muse').flatMap(([, v]) => v),
  ...LINES.migel.muse.flat(),
  ...LINES.migel.chat.flatMap((set) => set.filter((_, i) => i % 2 === 0)),
  ...LINES.matiam.chat.flatMap((set) => set.filter((_, i) => i % 2 === 1)),
];
eq('미겔은 "하하!" 로 웃지 않는다(마티암 웃음)', migelSays.filter((t) => /하하!/.test(t)), []);

// ---------------------------------------------------------------- 장면
console.log('\n장면');

/** 가짜 io. AI 는 `ai` 가 주는 대로(기본은 막힘 → 미리 써 둔 줄), 저장은 `saveOk` 대로. */
/** 심사관의 답 — 무난히 잘 만든 것. */
const JUDGED = {
  ok: true,
  judged: { fit: 25, craft: 24, harmony: 8, heal: 20, detox: 10, desc: '노릇하게 잘 익었다.', verdict: '정성이 보인다.' },
};

function fakeIo({ ai = null, saveOk = true, replies = null, judged = JUDGED, recipeOut = undefined } = {}) {
  const log = [];
  let turn = 0;
  return {
    log,
    card: async (mode, craft, info) => { log.push(['card', mode.key, craft, info]); },
    recipe: async () => (recipeOut !== undefined ? recipeOut
      : ai ? { open: 'AI 시작', name: 'AI 요리', process: '씻고 썰어 약불에 익히고 간을 맞췄다.', during: 'AI 도중' } : null),
    judge: async (mode, input) => { log.push(['judge', mode.key, input]); return judged; },
    say: async (who, text) => { log.push(['say', who, text]); },
    note: async (text) => { log.push(['note', text]); },
    apply: async (moves) => {
      log.push(['apply', moves]);
      if (!saveOk) return { ok: false, accounts: {} };
      return { ok: true, accounts: { 'npc:migel': { gold: 2900, hp: 60 }, 'npc:matiam': { gold: 1000, hp: 60 } } };
    },
    monologue: async ({ beats }) => (ai ? Object.fromEntries(beats.map((b) => [b.key, `AI ${b.key}`])) : null),
    reply: async () => {
      turn += 1;
      if (replies) return replies(turn);
      return ai ? `AI 대답 ${turn}` : null;
    },
  };
}
const ctxOf = (choice, extra = {}) => ({
  character: 'migel', partner: 'matiam', me: rich, partnerAccount: { gold: 1000, hp: 30, items: {} },
  human: { id: '12345', name: '겨울' }, choice, setting: '가을 4일째, 날씨는 맑음', rand: seeded(9), ...extra,
});
const says = (log) => log.filter(([k]) => k === 'say');
const applies = (log) => log.filter(([k]) => k === 'apply').map(([, m]) => m);

{
  const io = fakeIo();
  const choice = { kind: 'shop', duo: false, plan: { key: 'honey', count: 2, cost: ITEM_BY_KEY.honey ? buyPrice(ITEM_BY_KEY.honey) * 2 : 0, drink: false } };
  if (!ITEM_BY_KEY.honey) choice.plan = { key: 'salt', count: 2, cost: buyPrice(ITEM_BY_KEY.salt) * 2, drink: false };
  const out = await runDay(ctxOf(choice), io);
  eq('장보기: 첫 마디는 미겔의 혼잣말', io.log[0][0] === 'say' && io.log[0][1] === 'migel', true);
  eq('장보기: 첫 마디가 장보기를 말한다(미리 써 둔 줄)', LINES.migel.shopOpen.includes(io.log[0][2]), true);
  eq('장보기: 한 번의 쓰기로 골드 −, 아이템 +', applies(io.log), [{ deltas: { 'npc:migel': -choice.plan.cost }, items: { 'npc:migel': { [choice.plan.key]: 2 } } }]);
  eq('장보기: 세 줄 말한다(정하기·고르기·다 사고)', says(io.log).length, 3);
  eq('장보기: 요약에 남은 골드', out.lines.some((l) => l.includes('2,900')), true);
  eq('꼬리표', labelOf(choice), { icon: '🛒', label: '장보기' });
}
{
  const io = fakeIo({ ai: true });
  const choice = { kind: 'shop', duo: true, plan: { key: 'potionSmall', count: 1, cost: 450, drink: true } };
  const out = await runDay(ctxOf(choice, { rand: () => 0 }), io);
  eq('약 사다 주기: AI 가 준 줄을 쓴다', io.log[0], ['say', 'migel', 'AI open']);
  eq('약 사다 주기: 상대 체력이 오른다', applies(io.log), [{ deltas: { 'npc:migel': -450 }, hp: { 'npc:matiam': 15 } }]);
  eq('약 사다 주기: 마지막은 마티암의 한마디', says(io.log).at(-1)[1], 'matiam');
  eq('약 사다 주기: 요약에 마티암 체력', out.lines.some((l) => l.includes('마티암 체력 30 → 60')), true);
}
{
  const io = fakeIo({ saveOk: false });
  const choice = { kind: 'gift', duo: false, plan: { key: 'acorn', count: 2 } };
  const out = await runDay(ctxOf(choice), io);
  eq('선물 실패: 사람에게 가는 한 번의 쓰기였다', applies(io.log), [{ items: { 'npc:migel': { acorn: -2 }, 12345: { acorn: 2 } } }]);
  eq('선물 실패: oops 로 맺는다', LINES.migel.oops.includes(says(io.log).at(-1)[2]), true);
  eq('선물 실패: 건넸다는 줄이 없다', io.log.some(([k, t]) => k === 'note' && t.includes('건넸다')), false);
  eq('선물 실패: 요약이 실패를 말한다', out.lines[0].includes('못 건넸어요'), true);
}
{
  const io = fakeIo();
  const choice = { kind: 'gift', duo: false, plan: { key: 'acorn', count: 2 } };
  await runDay(ctxOf(choice), io);
  eq('사람에게 선물: 이름을 부른다', says(io.log)[1][2].includes('겨울'), true);
  eq('사람에게 선물: 멘션은 적기에만', io.log.some(([k, t]) => k === 'note' && t.includes('<@12345>')), true);
}
{
  const io = fakeIo();
  const choice = { kind: 'talk', duo: false, plan: {} };
  const out = await runDay(ctxOf(choice), io);
  eq('혼잣말: 세 줄이 한 벌에서 나온다', LINES.migel.muse.some((set) => JSON.stringify(set) === JSON.stringify(says(io.log).map(([, , t]) => t))), true);
  eq('혼잣말: 쓰기가 없다', applies(io.log), []);
  eq('혼잣말: 요약에 첫 줄', out.lines[1].startsWith('> '), true);
}
{
  const io = fakeIo({ ai: true });
  const choice = { kind: 'talk', duo: true, plan: {} };
  await runDay(ctxOf(choice), io);
  eq('수다: 여섯 줄, 번갈아', says(io.log).map(([, who]) => who), ['migel', 'matiam', 'migel', 'matiam', 'migel', 'matiam']);
  eq('수다: 첫 줄 뒤에 상대가 온다', io.log[1][0] === 'note' && io.log[1][1].includes('다가왔다'), true);
}
{
  const io = fakeIo({ replies: (n) => (n <= 2 ? `AI ${n}` : null) });
  const choice = { kind: 'talk', duo: true, plan: {} };
  await runDay(ctxOf(choice), io);
  eq('수다: 도중에 막히면 그 사람이 맺는다', says(io.log).map(([, who]) => who), ['migel', 'matiam', 'migel']);
  eq('수다: 맺는 말은 bye', LINES.migel.bye.includes(says(io.log).at(-1)[2]), true);
}
{
  const io = fakeIo();
  const choice = { kind: 'talk', duo: true, plan: {} };
  await runDay(ctxOf(choice), io);
  eq('수다: 처음부터 막히면 미리 써 둔 한 벌', says(io.log).length, 4);
}

{
  const io = fakeIo({ ai: true });
  const choice = { kind: 'cook', duo: false, plan: { counts: { acorn: 1, redApple: 1 } } };
  const out = await runDay(ctxOf(choice, { rand: () => 0.9 }), io);
  eq('요리: 첫 마디는 AI 가 지은 혼잣말', io.log[0], ['say', 'migel', 'AI 시작']);
  eq('요리: 심사관은 캐릭터가 지은 이름·과정을 읽는다', [io.log.find(([k]) => k === 'judge')[2].name, io.log.find(([k]) => k === 'judge')[2].counts], ['AI 요리', { acorn: 1, redApple: 1 }]);
  const [moves] = applies(io.log);
  eq('요리: 재료를 빼고 내 만든 것에 넣는다', [moves.items, moves.crafts['npc:migel'].add.length, moves.hp], [{ 'npc:migel': { acorn: -1, redApple: -1 } }, 1, undefined]);
  const craft = moves.crafts['npc:migel'].add[0];
  eq('요리: 🎲 19 · 점수 85 면 플래티넘(`/요리` 와 같은 셈)', [craft.dice, craft.score, craft.grade, craft.mt], [19, 85, 'platinum', 5]);
  eq('요리: 전적은 `/요리` 와 같은 칸', moves.bump, { 'npc:migel': { cooked: 1, bestCook: 4 } });
  eq('요리: 결과 카드가 나간다', io.log.some(([k, mode]) => k === 'card' && mode === 'cook'), true);
  eq('요리: 요약 첫 줄이 등급', out.lines[0], '💠 플래티넘 — AI 요리');
  eq('꼬리표: 요리', labelOf(choice), { icon: '🍳', label: '요리' });
}
{
  const io = fakeIo({ ai: true });
  const choice = { kind: 'cook', duo: true, plan: { counts: { driedMeat: 1 } } };
  const out = await runDay(ctxOf(choice, { rand: () => 0.9 }), io);
  const [moves] = applies(io.log);
  eq('다친 상대 몫 요리: 받자마자 먹는다 — 만든 것에는 안 넣는다', [Boolean(moves.hp?.['npc:matiam'] > 0), moves.crafts], [true, undefined]);
  eq('다친 상대 몫 요리: 재료는 부른 쪽에서', moves.items, { 'npc:migel': { driedMeat: -1 } });
  eq('다친 상대 몫 요리: 마지막은 마티암', says(io.log).at(-1)[1], 'matiam');
  eq('다친 상대 몫 요리: 요약에 먹었다', out.lines[1].includes('바로 먹었어요'), true);
}
{
  const io = fakeIo({ ai: true });
  const choice = { kind: 'craft', duo: true, plan: { counts: { leatherScrap: 1 } } };
  await runDay(ctxOf(choice, { rand: () => 0.5 }), io);
  const [moves] = applies(io.log);
  eq('상대 몫 제작: 상대의 만든 것에 넣는다', [moves.crafts['npc:matiam']?.add?.[0]?.kind, moves.hp], ['제작', undefined]);
  eq('상대 몫 제작: 전적은 제작 칸', Object.keys(moves.bump['npc:migel']), ['crafted', 'bestCraft']);
}
{
  const io = fakeIo();
  const choice = { kind: 'cook', duo: true, plan: { counts: { acorn: 1 } } };
  const out = await runDay(ctxOf(choice, { rand: () => 0 }), io);
  const [moves] = applies(io.log);
  eq('🎲 1: 스톤 — 재료는 쓰고 만든 것은 버린다', [moves.items, moves.crafts, moves.hp], [{ 'npc:migel': { acorn: -1 } }, undefined, undefined]);
  eq('🎲 1: 탄 것도 전적에 남는다', moves.bump['npc:migel'].burnt, 1);
  eq('🎲 1: 버렸다고 적는다', io.log.some(([k, t]) => k === 'note' && t.includes('버렸다')), true);
  eq('🎲 1: 상대가 한마디 한다(미리 써 둔 줄)', LINES.matiam.laugh.includes(says(io.log).at(-1)[2]), true);
  eq('🎲 1: 요약', out.lines[1], '🪨 망가져서 버렸어요.');
  eq('AI 가 조리법을 못 지으면 첫 재료로 이름을 짓는다', io.log.find(([k]) => k === 'judge')[2].name.startsWith('도토리 '), true);
}
{
  const io = fakeIo({ judged: { ok: false, error: '한도' } });
  const choice = { kind: 'craft', duo: false, plan: { counts: { leatherScrap: 1 } } };
  const out = await runDay(ctxOf(choice), io);
  eq('심사관이 막히면 아무것도 안 쓴다', applies(io.log), []);
  eq('심사관이 막히면 만들다 만다', LINES.migel.makeGiveUp.includes(says(io.log).at(-1)[2]), true);
  eq('심사관이 막히면 요약이 재료는 그대로라고', out.lines[0].includes('재료는 그대로'), true);
}
{
  const io = fakeIo();
  const craft = { id: 'soup00001', kind: '요리', name: '도토리 수프', grade: 'silver', price: 30, mt: 0, heal: 10 };
  const out = await runDay(ctxOf({ kind: 'gift', duo: true, plan: { craft } }), io);
  eq('만든 것 선물: 통째로 옮긴다', applies(io.log), [{ crafts: { 'npc:migel': { remove: ['soup00001'] }, 'npc:matiam': { add: [craft] } } }]);
  eq('만든 것 선물: 요약에 등급 이모지', out.lines[0], '🎁 마티암에게 🥈 도토리 수프');
}

// ---------------------------------------------------------------- 자리
console.log('\n자리');
{
  const day = busy.open('thread-1', 'npc:migel');
  const at = seatedAt('npc:migel');
  eq('하루를 보내는 중이면 앉은 것으로 친다', [at?.mode, at?.channelId], ['daily', 'thread-1']);
  eq('거절 문구는 판이 아니라 하루', seatedMessage('미겔', at).includes('하루를 보내는 중'), true);
  eq('같은 채널의 판이 물어도 하루는 안 빠진다', seatedAt('npc:migel', { except: 'thread-1' })?.mode, 'daily');
  eq('상대는 아직 자유', seatedAt('npc:matiam'), null);
  busy.join(day, 'npc:matiam');
  eq('불려 오면 상대도 바쁘다', seatedAt('npc:matiam')?.mode, 'daily');
  busy.close(day);
  eq('끝나면 둘 다 풀린다', [seatedAt('npc:migel'), seatedAt('npc:matiam')], [null, null]);
}

console.log(`\n${ok + bad}건 중 통과 ${ok} · 실패 ${bad}`);
process.exit(bad ? 1 : 0);
