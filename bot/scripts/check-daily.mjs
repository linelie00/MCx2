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
 *   6. 낚시꾼이 기척을 바르게 읽고(숨은 줄을 후보에서 안 지운다), `/요트 낚시` 와 같은 셈으로 정산하는지
 *   7. 던전이 체력을 한 톨도 새지 않고, 들어올 때 체력을 넘겨 저장하지 않고, 성격대로 교대·도망하고,
 *      이기면 전리품·지면 쓰러짐으로 끝나는지. 쓰러진 상대에게는 부활의 영약을 사다 먹이는지
 *   8. 기록이 맞는 사람에게 맞는 칸으로 가고, 일상 칭호가 사람 명부에 안 섞이고, 많이 불려 다닌
 *      상대가 쉬고 싶어 하는지
 *   9. 일기가 둘이 한 날은 상대에게도 남고, 멘션을 이름으로 바꾸고, 새것이 위로 보이는지
 */
process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= 'x';
process.env.DISCORD_GUILD_ID ||= 'x';

const {
  choose, planShop, planGift, planMake, weighted, HURT, KEEP, HUMAN_GIFT_CAP, POTIONS,
} = await import('../src/daily/pick.js');
const { MAX_CRAFTS, MODES } = await import('../src/casino/crafts.js');
const fishing = await import('../src/yacht/fishing.js');
const { candidatesOf, narrow, holdFor, takeTurn } = await import('../src/daily/angler.js');
const { COMMON_ROWS } = await import('../src/casino/fish.js');
const delve = await import('../src/daily/delve.js');
const holdem = await import('../src/holdem/state.js');
const { DUNGEON_FLOOR } = await import('../src/daily/pick.js');
const { LINES, fill, canned } = await import('../src/daily/lines.js');
const { runDay, labelOf, recordOf, diaryOf } = await import('../src/daily/run.js');
const { diaryTab } = await import('../src/commands/profile.js');
const titles = await import('../src/casino/titles.js');
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
  eq('골드도 가진 것도 없으면 이야기·낚시·던전만', runs.every((c) => ['talk', 'fish', 'dungeon'].includes(c.kind)), true);
  eq('낚시도 혼자도 둘이도', [true, false].every((d) => runs.some((c) => c.kind === 'fish' && c.duo === d)), true);
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

// ---------------------------------------------------------------- 낚시꾼
console.log('\n낚시꾼');
eq('남길 것: 위칸은 그 눈', holdFor('threes', [3, 1, 3, 6, 2]), [true, false, true, false, false]);
eq('남길 것: L스트는 창 안의 눈을 하나씩', holdFor('lStraight', [2, 3, 3, 5, 6]), [true, true, false, true, true]);
eq('남길 것: 초이스는 4 이상', holdFor('choice', [1, 4, 6, 3, 5]), [false, true, true, false, true]);
eq('남길 것: 포카드는 가장 많은 눈', holdFor('fourKind', [2, 5, 5, 1, 5]), [false, true, true, false, true]);
eq('기척 좁히기: 가까우면 한 칸 옆만', narrow(COMMON_ROWS, 'threes', 1).sort(), ['deuces', 'fours']);
eq('기척 좁히기: 아무 기척 없으면 세 칸 이상', narrow(COMMON_ROWS, 'aces', 3).includes('threes'), false);
{
  const die = seeded(20);
  const d6 = () => 1 + Math.floor(die() * 6);
  let lost = 0; let caught = 0; let bad = 0;
  for (let i = 0; i < 300; i += 1) {
    const round = fishing.build({ channelId: 'x', userId: 'npc:migel', name: '미겔', rand: die });
    let cands = candidatesOf(round);
    while (round.phase === 'fishing') {
      const out = takeTurn(round, cands, { die: d6, rand: die });
      if (out.key && !out.caught && !fishing.canWrite({ ...round.sheet, [out.key]: null }, out.key, out.dice, round.hidden)) bad += 1;
      if (out.caught) break;
      if (out.key && !round.hidden.legend) cands = narrow(cands, out.key, out.gap);
      if (!round.hidden.legend && !cands.includes(round.hidden.row)) lost += 1;
    }
    if (round.caught) caught += 1;
  }
  eq('기척을 읽어도 숨은 줄은 후보에서 안 빠진다', lost, 0);
  eq('적을 수 없는 칸에는 안 적는다', bad, 0);
  eq('웬만큼은 낚는다(300판 중 절반 넘게)', caught > 150, true);
}
{
  const round = fishing.build({ channelId: 'x', userId: 'npc:matiam', name: '마티암' });
  round.hidden = { key: 'goldChipShark', row: 'yacht', legend: true };
  eq('전설 판은 그 자리 하나만 후보', candidatesOf(round), ['yacht']);
  const out = takeTurn(round, candidatesOf(round), { die: () => 4 });
  eq('전설(요트): 같은 눈 다섯이면 요트 칸에 적어 낚는다', [out.key, Boolean(out.caught)], ['yacht', true]);
  const reward = fishing.rewardOf(round, 'npc:matiam');
  eq('전설 정산: 아이템·도감·MT +1·전적', [reward.items, reward.mt, reward.bump['npc:matiam'].fishLegend, reward.bump['npc:matiam'].fishRounds],
    [{ 'npc:matiam': { goldChipShark: 1 } }, { 'npc:matiam': 1 }, 1, 1]);
}
{
  const round = fishing.build({ channelId: 'x', userId: 'npc:migel', name: '미겔' });
  round.hidden = { key: 'lordOfWater', row: 'bonus', legend: true };
  const out = takeTurn(round, candidatesOf(round), { die: () => 6 });
  eq('전설(소계): 윗칸에 가장 큰 점수로 적는다', out.key, 'sixes');
  eq('판을 짓기만 하면 채널에 안 걸린다', fishing.get('x'), null);
}

// ---------------------------------------------------------------- 던전 고르기 · 판
console.log('\n던전');
{
  const r = seeded(30);
  const pickN = (opts) => [...Array(1500)].map(() => choose({ character: 'migel', rand: r, ...opts }));
  eq('체력이 30 아래면 던전에 안 간다', pickN({ me: { gold: 0, hp: DUNGEON_FLOOR - 1 } }).some((c) => c.kind === 'dungeon'), false);
  const runs = pickN({ me: { gold: 0, hp: 100 }, partner: { account: { hp: 20 }, free: true } });
  eq('상대가 30 아래면 혼자 간다', runs.filter((c) => c.kind === 'dungeon').every((c) => !c.duo), true);
  eq('상대가 멀쩡하면 둘이도 간다', pickN({ me: { gold: 0, hp: 100 }, partner: { account: { hp: 90 }, free: true } })
    .some((c) => c.kind === 'dungeon' && c.duo), true);
  const fallen = pickN({ me: { gold: 1500, hp: 100 }, partner: { account: { hp: 0 }, free: false, dead: true } });
  const revives = fallen.filter((c) => c.kind === 'shop' && c.plan.revive);
  eq('쓰러진 상대가 있고 골드가 넉넉하면 부활의 영약을 사다 먹인다', revives.length > 500, true);
  eq('부활의 영약은 상대 몫이다', revives.every((c) => c.duo && c.plan.key === 'potionRevive' && c.plan.drink), true);
  eq('골드가 모자라면 영약은 없다', pickN({ me: { gold: 1100, hp: 100 }, partner: { account: { hp: 0 }, dead: true } })
    .some((c) => c.plan?.revive), false);
}
{
  const mob = { name: '적', seen: 1, loose: 0, bluff: 0.1, raise: 0.5, note: '', elite: false };
  const { game } = delve.open({ owner: 'npc:matiam', hp: 80, mob });
  eq('던전은 체력 장부로 연다', game.gold.unit, 'hp');
  eq('짓기만 하고 채널에 안 건다', holdem.get(game.channelId), null);
  eq('부른 쪽이 먼저 싸운다', delve.fighterOf(game).id, 'npc:matiam');
  game.gold.reconcile('npc:matiam', 10);
  delve.fighterOf(game).gold = 10;
  eq('마티암은 바닥나면 대개 물러선다', delve.between(game, () => 0.5).step, 'flee');
  const { game: g2 } = delve.open({ owner: 'npc:migel', hp: 80, mob });
  g2.gold.reconcile('npc:migel', 10);
  delve.fighterOf(g2).gold = 10;
  eq('미겔은 바닥나도 거의 안 물러선다', delve.between(g2, () => 0.5).step, 'next');
  const { game: g3 } = delve.open({ owner: 'npc:migel', partner: 'npc:matiam', hp: 100, partnerHp: 90, mob });
  g3.gold.reconcile('npc:migel', 30);
  delve.fighterOf(g3).gold = 30;
  eq('둘이면 바닥나기 전에 교대한다', delve.between(g3, () => 0.99), { step: 'swap', to: 'npc:matiam' });
  delve.swap(g3, 'npc:matiam');
  eq('교대하면 상대가 싸우고, 물러난 쪽은 쉰다', [delve.fighterOf(g3).id, g3.reserves, g3.allyUsed], ['npc:matiam', ['npc:migel'], true]);
  // 싸우던 마티암이 쓰러졌다 — 쉬던 미겔(체력 30)이 성격대로.
  g3.gold.reconcile('npc:matiam', 0);
  delve.fighterOf(g3).gold = 0;
  eq('쓰러지면 미겔은 곧잘 이어 싸운다', delve.afterFall(g3, () => 0.3), { step: 'avenge', to: 'npc:migel' });
  eq('아니면 업고 물러난다', delve.afterFall(g3, () => 0.9), { step: 'carry', by: 'npc:migel' });
  g3.gold.reconcile('npc:migel', 10);
  eq('바닥난 채로는 복수하러 안 나선다', delve.afterFall(g3, () => 0), { step: 'carry', by: 'npc:migel' });
  eq('혼자 왔으면 쓰러짐으로 끝', delve.afterFall(game, () => 0), { step: 'end' });
}
{
  // 판을 끝까지 — 체력 총합(흩어진 몫 포함)이 처음과 같아야 한다.
  let leaked = 0;
  for (let i = 0; i < 30; i += 1) {
    const mob = { name: '적', seen: 1, loose: 0, bluff: 0.1, raise: 0.5, note: '', elite: i % 3 === 0 };
    const duo = i % 2 === 0;
    const { game } = delve.open({ owner: 'npc:migel', partner: duo ? 'npc:matiam' : null, hp: 70, partnerHp: duo ? 60 : 0, mob });
    const start = Object.values(game.gold.snapshot()).reduce((a, n) => a + n, 0);
    for (let h = 0; h < 200; h += 1) {
      delve.playHand(game);
      const step = delve.between(game);
      if (step.step === 'end' || step.step === 'flee') break;
      if (step.step === 'swap') delve.swap(game, step.to);
      if (!holdem.nextHand(game)) break;
    }
    const total = Object.values(game.gold.snapshot()).reduce((a, n) => a + n, 0) + (game.burned ?? 0);
    if (total !== start) leaked += 1;
  }
  eq('던전 30판 — 체력이 한 톨도 안 샌다', leaked, 0);
}

// ---------------------------------------------------------------- 미리 써 둔 대사
console.log('\n미리 써 둔 대사');
const KEYS = ['muse', 'chat', 'bye', 'shopOpen', 'shopBrowse', 'shopAfter', 'potionOpen', 'potionAfter',
  'shopForOpen', 'shopForHand', 'potionForOpen', 'potionForHand', 'giftOpen', 'giftHand', 'giftAfter',
  'thanks', 'drinkThanks', 'oops',
  'cookOpen', 'cookForOpen', 'cookDuring', 'cookGood', 'cookMeh', 'cookBroke', 'cookHand',
  'craftOpen', 'craftForOpen', 'craftDuring', 'craftGood', 'craftMeh', 'craftBroke', 'craftHand',
  'eatAfter', 'eatThanks', 'laugh', 'makeGiveUp',
  'fishOpen', 'fishInvite', 'watchCome', 'fishCast', 'fishNear', 'fishLegend',
  'fishGot', 'fishLegendGot', 'fishJunk', 'fishNone', 'fishCheer', 'fishTease', 'fishClosed',
  'delveOpen', 'delveInvite', 'delveCome', 'delveFace', 'delveWin', 'delveHit', 'delveLow',
  'swapOut', 'swapIn', 'fleeLine', 'delveWon', 'delveFled', 'fallen', 'delveCheer', 'delveSigh', 'fallenCry',
  'avenge', 'carryOut',
  'reviveOpen', 'reviveHand', 'revived', 'askJoin', 'decline', 'titleGot'];
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

/**
 * 가짜 던전 서버 — `payout.dungeonHand` 가 하는 일 그대로. **상한(들어올 때 체력)까지만** 저장하고,
 * 넘긴 몫은 판 안에 남긴다. 서버가 들고 있는 값을 `server` 에 적어 둔다.
 */
function fakeDungeon(log) {
  const server = {};
  return {
    server,
    met: async (id, foe) => { log.push(['met', id, foe]); return { ok: true }; },
    hand: async (game) => {
      const want = game.gold.snapshot();
      for (const [id, n] of Object.entries(want)) {
        if (id.startsWith('mob:')) continue;
        const cap = Math.min(game.cap[id], 100);
        server[id] ??= game.stored[id];
        const d = Math.min(n, cap) - game.stored[id];
        if (!d) continue;
        server[id] = Math.max(0, Math.min(100, server[id] + d));
        game.stored[id] = server[id];
        game.gold.reconcile(id, server[id] + Math.max(0, n - cap));
      }
      for (const seat of game.seats) if (seat.kind !== 'mob') seat.gold = game.gold.get(seat.id);
      game.gold.rebase();
      log.push(['hand', { ...server }]);
      return { ok: true };
    },
    overflow: async (game) => { log.push(['overflow']); return { ok: true, gold: {}, heal: [], items: {}, spare: {}, to: game.owner }; },
    won: async (id, drops, opts) => { log.push(['won', id, drops, opts]); return { ok: true }; },
    lost: async (id, died) => { log.push(['lost', id, died]); return { ok: true }; },
  };
}

function fakeIo({
  ai = null, saveOk = true, replies = null, judged = JUDGED, recipeOut = undefined, fishLeft = 4,
} = {}) {
  const log = [];
  let turn = 0;
  return {
    log,
    dungeon: fakeDungeon(log),
    embed: async (card) => { log.push(['embed', card]); },
    tryFish: async (id) => { log.push(['tryFish', id]); return fishLeft == null ? { ok: false, left: 0 } : { ok: true, left: fishLeft }; },
    fishCard: async (round, extra) => { log.push(['fishCard', round.caught, extra]); },
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

{
  const io = fakeIo({ fishLeft: null });
  const out = await runDay(ctxOf({ kind: 'fish', duo: false, plan: {} }), io);
  eq('낚시: 하루 낚시를 다 썼으면 못 던진다', [applies(io.log), LINES.migel.fishClosed.includes(says(io.log).at(-1)[2])], [[], true]);
  eq('낚시: 못 던진 요약', out.lines[0].includes('못 던졌어요'), true);
}
{
  // rand 0.5 로 지은 판은 일반이 **6의 눈** 줄에 숨는다(COMMON_ROWS 의 가운데). 주사위가 전부 6 이면 언젠가 닿는다.
  const io = fakeIo();
  const out = await runDay(ctxOf({ kind: 'fish', duo: false, plan: {} }, { rand: () => 0.5, die: () => 6 }), io);
  eq('낚시: 첫 마디는 가기로 하는 혼잣말', LINES.migel.fishOpen.includes(io.log.find(([k]) => k === 'say')[2]), true);
  eq('낚시: 자기 몫 낚시를 쓴다', io.log.find(([k]) => k === 'tryFish')[1], 'npc:migel');
  eq('낚시: 기회마다 한 줄', io.log.filter(([k, t]) => k === 'note' && String(t).startsWith('🎲')).length >= 1, true);
  const [moves] = applies(io.log);
  const got = Object.keys(moves.items['npc:migel'] ?? {})[0];
  eq('낚시: 낚은 것이 가방·도감에 들어간다', [Boolean(got), Boolean(moves.fish['npc:migel'][got])], [true, true]);
  eq('낚시: 전적은 `/요트 낚시` 와 같은 칸', [moves.bump['npc:migel'].fishRounds, moves.bump['npc:migel'].fishCaught], [1, 1]);
  eq('낚시: 결과 카드가 나간다', io.log.some(([k]) => k === 'fishCard'), true);
  eq('낚시: 요약', out.lines[0].startsWith('🎣 ') && !out.lines[0].includes('빈손'), true);
  eq('꼬리표: 낚시', labelOf({ kind: 'fish', duo: false, plan: {} }), { icon: '🎣', label: '낚시' });
}
{
  // 주사위가 전부 1 이면 6의 눈에는 영영 못 닿는다 — 여섯 번을 다 쓰고 빈손.
  const io = fakeIo({ ai: true });
  const out = await runDay(ctxOf({ kind: 'fish', duo: true, plan: {} }, { rand: () => 0.5, die: () => 1 }), io);
  const [moves] = applies(io.log);
  eq('빈손 낚시: 아무것도 안 넣고 빈 판만 센다', [moves.items, moves.bump['npc:migel']], [{}, { fishRounds: 1, fishEmpty: 1 }]);
  eq('빈손 낚시: 여섯 번을 다 던진다', io.log.filter(([k, t]) => k === 'note' && String(t).startsWith('🎲')).length, 6);
  eq('빈손 낚시: 상대가 옆에 앉는다', io.log.some(([k, t]) => k === 'note' && t.includes('옆에 앉았다')), true);
  eq('빈손 낚시: 마지막은 구경하던 상대', says(io.log).at(-1)[1], 'matiam');
  eq('빈손 낚시: 요약', out.lines[0], '🎣 빈손으로 돌아왔어요.');
}

{
  const io = fakeIo();
  const out = await runDay(ctxOf({ kind: 'shop', duo: true, plan: { key: 'potionRevive', count: 1, cost: 1000, drink: true, revive: true } },
    { partnerAccount: { gold: 500, hp: 0, items: {} } }), io);
  eq('부활의 영약: 골드를 내고 상대를 일으키고 「힐러」 를 센다', applies(io.log),
    [{ deltas: { 'npc:migel': -1000 }, hp: { 'npc:matiam': 100 }, bump: { 'npc:migel': { reviveGiven: 1 } } }]);
  eq('부활의 영약: 사러 가는 혼잣말로 시작', LINES.migel.reviveOpen.includes(io.log[0][2]), true);
  eq('부활의 영약: 일어났다고 적는다', io.log.some(([k, t]) => k === 'note' && t.includes('일어났다')), true);
  eq('부활의 영약: 일어난 상대가 맺는다', says(io.log).at(-1)[1], 'matiam');
  eq('부활의 영약: 요약', out.lines[0].startsWith('💫 마티암에게'), true);
  eq('꼬리표: 부활의 영약', labelOf({ kind: 'shop', duo: true, plan: { revive: true, drink: true } }), { icon: '💫', label: '부활의 영약' });
}
{
  // 던전을 끝까지 여러 판 — 혼자·둘이 섞어서. 결과는 셋 중 하나이고, 그에 맞는 정산이 한 번씩 나가야 한다.
  const seen = { won: 0, dead: 0, fled: 0 };
  let bad = [];
  for (let i = 0; i < 16; i += 1) {
    const io = fakeIo();
    const duo = i % 2 === 1;
    const out = await runDay(ctxOf({ kind: 'dungeon', duo, plan: {} }, {
      me: { gold: 0, hp: 70, items: {} }, partnerAccount: { gold: 0, hp: 60, items: {} }, rand: seeded(40 + i),
    }), io);
    const won = io.log.filter(([k]) => k === 'won');
    const lost = io.log.filter(([k]) => k === 'lost');
    const hands = io.log.filter(([k]) => k === 'hand');
    const kind = won.length ? 'won' : lost.length ? 'dead' : 'fled';
    seen[kind] += 1;
    const first = io.log.find(([k]) => k === 'say');
    if (!(first[1] === 'migel' && LINES.migel.delveOpen.includes(first[2]))) bad.push(`${i}: 첫 마디 ${first}`);
    if (won.length + lost.length > 1) bad.push(`${i}: 정산이 두 번`);
    if (io.log.filter(([k]) => k === 'met').length !== 1) bad.push(`${i}: 도감이 한 번이 아니다`);
    if (io.log.filter(([k]) => k === 'overflow').length !== 1) bad.push(`${i}: 넘친 기운 정산이 한 번이 아니다`);
    if (hands.some(([, srv]) => (srv['npc:migel'] ?? 0) > 70 || (srv['npc:matiam'] ?? 0) > 60)) bad.push(`${i}: 들어올 때 체력을 넘겨 저장했다`);
    if (!duo && hands.some(([, srv]) => 'npc:matiam' in srv)) bad.push(`${i}: 혼자 갔는데 상대 체력을 건드렸다`);
    const icon = { won: '⚔️', dead: '💀', fled: '🏃' }[kind];
    if (!out.lines[0].startsWith(icon)) bad.push(`${i}: 요약 ${out.lines[0]}`);
    if (io.log.filter(([k]) => k === 'embed').length !== 1) bad.push(`${i}: 결과 카드가 한 장이 아니다`);
    const notes = io.log.filter(([k]) => k === 'note').length;
    if (notes > hands.length + 8) bad.push(`${i}: 중계가 ${notes}줄 — 잔잔한 핸드가 안 묶였다`);
    // 쓰러진 쪽(판을 진 쪽 + 그 앞에 쓰러진 쪽)은 저마다 마지막 말을 한다.
    const died = [
      ...lost.map(([, , who]) => who),
      ...applies(io.log).flatMap((m) => Object.keys(m.bump ?? {}).filter((id) => m.bump[id].dungeonDied)),
    ];
    for (const id of died) {
      const who = id.slice(4);
      if (!says(io.log).some(([, w, t]) => w === who && LINES[who].fallen.includes(t))) bad.push(`${i}: ${who} 가 쓰러지며 말을 안 했다`);
    }
    if (!duo && died.length > 1) bad.push(`${i}: 혼자 갔는데 둘이 쓰러졌다`);
  }
  eq('던전 16판 — 정산·저장·중계가 결과와 맞는다', bad, []);
  eq('던전 16판 — 이긴 판이 있다', seen.won > 0, true);
  eq('꼬리표: 던전', labelOf({ kind: 'dungeon', duo: false, plan: {} }), { icon: '⚔️', label: '던전' });
}

// ---------------------------------------------------------------- 기록 · 칭호
console.log('\n기록 · 칭호');
{
  const ctxDuo = { character: 'migel', partner: 'matiam', choice: { kind: 'talk', duo: true } };
  eq('수다: 둘 다 함께한 것·수다를 센다', recordOf(ctxDuo, { marks: { chat: true } }), {
    'npc:migel': { dailyDone: 1, dailyDuo: 1, dailyChat: 1 }, 'npc:matiam': { dailyDuo: 1, dailyChat: 1 },
  });
  eq('사람에게 선물: 부른 쪽만', recordOf({ character: 'matiam', partner: 'migel', choice: { kind: 'gift', duo: false } }, { marks: { giftHuman: true } }),
    { 'npc:matiam': { dailyDone: 1, dailyGiftHuman: 1 } });
  eq('던전: 업고 나온 쪽 · 대신 싸운 쪽', recordOf({ ...ctxDuo, choice: { kind: 'dungeon', duo: true } }, { marks: { carry: 'npc:matiam', avenge: null } }), {
    'npc:migel': { dailyDone: 1, dailyDuo: 1 }, 'npc:matiam': { dailyDuo: 1, dailyCarry: 1 },
  });
  eq('저장 못 한 장면은 한 것만 센다', recordOf({ character: 'migel', partner: 'matiam', choice: { kind: 'shop', duo: false } }, { lines: [] }),
    { 'npc:migel': { dailyDone: 1 } });
}
{
  const npcStats = { stats: { dailyDone: 1, dailyDuo: 10, dailyCarry: 1 } };
  const npcHeld = titles.earned(npcStats, { npc: true }).map((t) => t.key);
  eq('미겔·마티암은 일상 칭호를 받는다', ['dayOne', 'bestBuddy', 'broadBack'].every((k) => npcHeld.includes(k)), true);
  eq('사람은 같은 전적이어도 일상 칭호를 못 받는다', titles.earned(npcStats).some((t) => t.group === '일상'), false);
  eq('사람의 수집 분모에 일상 칭호가 없다', titles.TOTAL, titles.TITLES.filter((t) => !t.npcOnly).length);
  eq('미겔·마티암의 분모에는 골드 칭호가 없다', titles.totalFor(true), titles.TITLES.filter((t) => t.npc !== false).length);
  eq('일상 칭호는 전부 미겔·마티암 것', titles.TITLES.filter((t) => t.group === '일상').every((t) => t.npcOnly), true);
}
{
  const day = '2099-01-01';
  eq('처음엔 안 지쳤다', busy.tired('npc:matiam', () => 0, day), false);
  busy.noteJoin('npc:matiam', day);
  eq('한 번 불려 나가도 괜찮다', busy.tired('npc:matiam', () => 0, day), false);
  busy.noteJoin('npc:matiam', day);
  eq('두 번이면 반쯤 쉬고 싶다', [busy.tired('npc:matiam', () => 0.4, day), busy.tired('npc:matiam', () => 0.6, day)], [true, false]);
  busy.noteJoin('npc:matiam', day);
  eq('세 번이면 대개 쉬고 싶다', busy.tired('npc:matiam', () => 0.7, day), true);
  eq('날이 바뀌면 다시 센다', busy.joinsToday('npc:matiam', '2099-01-02'), 0);
}
{
  const io = fakeIo();
  const out = await runDay(ctxOf({ kind: 'talk', duo: false, plan: {} }, { declined: true }), io);
  eq('거절: 부른 쪽이 먼저 청하고 상대가 쉬겠다고 한다', says(io.log).slice(0, 2).map(([, who, t]) => [who, LINES[who][who === 'migel' ? 'askJoin' : 'decline'].includes(t)]),
    [['migel', true], ['matiam', true]]);
  eq('거절: 요약에 쉬고 싶대요', out.lines.at(-1).includes('쉬고 싶대요'), true);
}
{
  const io = fakeIo();
  const out = await runDay(ctxOf({ kind: 'gift', duo: true, plan: { key: 'acorn', count: 1 } }), io);
  eq('상대에게 선물하면 챙겨 준 것으로 남는다', out.marks, { care: true });
  const io2 = fakeIo({ saveOk: false });
  const out2 = await runDay(ctxOf({ kind: 'gift', duo: false, plan: { key: 'acorn', count: 1 } }), io2);
  eq('못 건넨 선물은 안 남는다', out2.marks, undefined);
}

// ---------------------------------------------------------------- 일기
console.log('\n일기');
{
  const ctxDuo = { character: 'migel', partner: 'matiam', choice: { kind: 'shop', duo: true, plan: {} }, human: { id: '12345', name: '겨울' } };
  const pages = diaryOf(ctxDuo, { lines: ['🛒 마티암에게 꿀 ×2 · −40골드'] }, { icon: '🛒', label: '장보기' });
  eq('둘이 한 날은 두 사람 일기에', Object.keys(pages).sort(), ['npc:matiam', 'npc:migel']);
  eq('부른 쪽은 함께, 불려 간 쪽은 누가 불렀는지', [pages['npc:migel'].with, pages['npc:migel'].by, pages['npc:matiam'].with, pages['npc:matiam'].by],
    ['npc:matiam', null, 'npc:migel', 'npc:migel']);
  const revive = diaryOf({ ...ctxDuo, choice: { kind: 'shop', duo: true, plan: { revive: true } } }, { lines: ['💫 마티암에게 부활의 영약'] }, { icon: '💫', label: '부활의 영약' });
  eq('일으켜 준 날은 "함께" 가 아니다', [revive['npc:migel'].with, revive['npc:matiam'].with, revive['npc:matiam'].by], [null, null, 'npc:migel']);
  const gift = diaryOf({ ...ctxDuo, choice: { kind: 'gift', duo: false, plan: {} } }, { lines: ['🎁 <@12345>에게 도토리 ×2', '_x_'] }, { icon: '🎁', label: '선물' });
  eq('멘션은 이름으로 — 일기를 펼칠 때마다 불리면 안 된다', gift['npc:migel'].lines[0], '🎁 겨울에게 도토리 ×2');
  eq('혼자 한 날은 부른 쪽 일기에만', Object.keys(gift), ['npc:migel']);
  eq('긴 줄은 자른다', [...diaryOf(ctxDuo, { lines: ['가'.repeat(300)] }, { icon: 'x', label: 'y' })['npc:migel'].lines[0]].length, 200);
}
{
  const diary = [...Array(7)].map((_, i) => ({ day: `2026-09-${String(10 + i)}`, icon: '🎣', label: '낚시', lines: ['> 말', `${i}`], with: null, by: i === 6 ? 'npc:matiam' : null }));
  const first = diaryTab({ diary }, 0);
  eq('일기: 새것이 위', first.text.split('\n')[0].startsWith('**9/16**'), true);
  eq('일기: 불려 간 날은 누가 불렀는지', first.text.split('\n')[0].includes('마티암이 불러서'), true);
  eq('일기: 인용 줄은 「」 로', first.text.includes('「말」'), true);
  eq('일기: 다섯 날씩 넘긴다', [first.pages, diaryTab({ diary }, 1).text.split('\n\n').length], [2, 2]);
  eq('일기: 빈 일기', diaryTab({}, 0).text.includes('아직 적힌 날이 없어요'), true);
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
