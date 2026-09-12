/**
 * check-items — 아이템 명부 회귀 검사
 *
 *   node scripts/check-items.mjs
 *
 * 명부는 시트에서 옮긴 것이라 손으로 고칠 일이 잦다. **키가 저장되는 값**이라
 * 오타 하나가 남의 창고를 비운다 — 모양이 어긋나면 여기서 걸린다.
 *
 * 명부를 보여 주는 `/아이템` 도 같이 본다. 서버를 안 부르는 명령이라 가짜 인터랙션만
 * 있으면 끝까지 돌아서, 따로 띄울 것이 없다.
 */
import {
  ITEMS, ITEM_BY_KEY, MAX_HP, CATS, forSale, healOf, findItem,
} from '../src/casino/items.js';
import { BY_KEY as FISH_BY_KEY } from '../src/casino/fish.js';

process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= 'x';
process.env.DISCORD_GUILD_ID ||= 'x';
const cmd = (await import('../src/commands/items.js')).default;
const { SHELVES } = await import('../src/commands/shop.js');
const { width } = await import('../src/text.js');

let ok = 0; let bad = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok += 1; console.log(`  ✓ ${name}`); }
  else { bad += 1; console.log(`  ✗ ${name}\n     받음 ${JSON.stringify(got)} / 기대 ${JSON.stringify(want)}`); }
};

console.log('\n모양');
eq('181종 — 시트 95 + 요리 재료 42 + 독 8 + 괴식 10 + 낚시 24 + 미끼 2', ITEMS.length, 181);
eq('키가 안 겹친다', Object.keys(ITEM_BY_KEY).length, ITEMS.length);
eq('이름이 안 겹친다', new Set(ITEMS.map((i) => i.name)).size, ITEMS.length);
eq('키는 영문 카멜케이스', ITEMS.filter((i) => !/^[a-z][A-Za-z0-9]*$/.test(i.key)).map((i) => i.key), []);
eq('갈래는 셋', [...new Set(ITEMS.map((i) => i.kind))].sort(), ['소비', '잡화', '재료']);
eq('값은 0 이상 정수', ITEMS.filter((i) => !Number.isInteger(i.price) || i.price < 0).map((i) => i.key), []);
eq('sell 은 참/거짓', ITEMS.filter((i) => typeof i.sell !== 'boolean').map((i) => i.key), []);
eq('팔 수 있으면 값이 있다', ITEMS.filter((i) => i.sell && i.price <= 0).map((i) => i.key), []);

console.log('\n설명');
eq('빈 설명이 없다', ITEMS.filter((i) => !i.desc?.trim()).map((i) => i.key), []);
eq('줄바꿈이 없다', ITEMS.filter((i) => /\n/.test(i.desc)).map((i) => i.key), []);
eq('트위터 핸들이 없다', ITEMS.filter((i) => i.desc.includes('@')).map((i) => i.key), []);
eq('임베드 한 칸에 들어간다', ITEMS.filter((i) => i.desc.length > 200).map((i) => i.key), []);

console.log('\n재료');
const FOOD = ITEMS.filter((i) => i.kind === '재료');
eq('재료 백열하나 — 낚시로 스물이 늘었다', FOOD.length, 111);
eq('잡화는 예순넷 — 낚시 잡동사니 넷', ITEMS.filter((i) => i.kind === '잡화').length, 64);
eq('진열대가 다 있다', FOOD.filter((i) => !CATS.some((c) => c.key === i.cat)).map((i) => i.key), []);
eq('진열대는 재료만', ITEMS.filter((i) => i.kind !== '재료' && (i.cat || i.shop)).map((i) => i.key), []);
eq('상점에서 파는 재료는 값이 있다', FOOD.filter((i) => i.shop && !(i.price > 0)).map((i) => i.key), []);
eq('값이 0 인 재료는 옮겨 온 넷뿐 — 못 판다', FOOD.filter((i) => !i.price).map((i) => i.key).sort(), ['bugPile', 'fallenBread', 'wetMoss', 'wrinkledSausage']);
eq('상점 서른둘', FOOD.filter((i) => i.shop).length, 32);
eq('던전 여든여덟', FOOD.filter((i) => i.loot !== false).length, 88);
// 낚시로만 나오는 것(전설)은 던전에서 막아 뒀다 — 그건 "안 나는" 것이 아니다.
eq('어디서도 안 나는 재료는 없다',
  FOOD.filter((i) => !i.shop && i.loot === false && !FISH_BY_KEY[i.key]).map((i) => i.key), []);
// 셀렉트 한 칸이 25 가 한도다. 넘으면 그 진열대가 통째로 안 뜬다.
eq('진열대마다 25 이하', CATS.filter((c) => FOOD.filter((i) => i.cat === c.key && i.shop).length > 25).map((c) => c.key), []);
eq('가게 물건은 던전에 안 굴러다닌다', ['flour', 'sugar', 'oil', 'pepper', 'saffron'].filter((k) => ITEM_BY_KEY[k].loot !== false), []);
eq('들에서 나는 것은 상점에 없다', ['raspberry', 'pineMushroom', 'rawMeat', 'keeperBerry'].filter((k) => ITEM_BY_KEY[k].shop), []);

console.log('\n독과 괴식');
const POISONED = ITEMS.filter((i) => i.poison);
eq('독은 열세 가지', POISONED.length, 13);
eq('독은 1~3 단계', POISONED.filter((i) => ![1, 2, 3].includes(i.poison)).map((i) => i.key), []);
eq('독은 날로 먹으면 아플 수 있다', POISONED.filter((i) => !(Math.min(...[i.heal].flat()) < 0)).map((i) => i.key), []);
eq('독 재료는 상점에 없다 — 던전에서만', POISONED.filter((i) => i.shop || i.loot === false).map((i) => i.key), []);
// 날로 먹었을 때 가장 나쁜 경우. 약한 독은 죽지 않을 만큼, 치명은 크게.
const worst = (lv) => POISONED.filter((i) => i.poison === lv).map((i) => Math.min(...[i.heal].flat()));
eq('약한 독은 −20 안쪽', worst(1).every((h) => h >= -20), true);
eq('치명은 −50 넘게', worst(3).every((h) => h <= -50), true);
eq('독 이름에 독이라고 안 적는다', POISONED.filter((i) => /독|죽음|치명/.test(i.name)).map((i) => i.name), []);
eq('괴식은 참/거짓만', ITEMS.filter((i) => i.monster !== undefined && i.monster !== true).map((i) => i.key), []);
eq('괴식 열여덟', ITEMS.filter((i) => i.monster).length, 18);

console.log('\n회복력');
const shape = (h) => (Array.isArray(h)
  ? h.length === 2 && h.every(Number.isInteger) && h[0] <= h[1]
  : Number.isInteger(h));
eq('숫자 아니면 [a, b]', ITEMS.filter((i) => !shape(i.heal)).map((i) => i.key), []);
eq('최대치를 안 넘는다', ITEMS.filter((i) => Math.max(...[i.heal].flat()) > MAX_HP).map((i) => i.key), []);
eq('HP 최대치는 100', MAX_HP, 100);
eq('범위로 적힌 것은 다섯 — 회복약 넷과 비명 뿌리', ITEMS.filter((i) => Array.isArray(i.heal)).length, 5);
eq('먹으면 깎이는 것 쉰셋', ITEMS.filter((i) => i.heal < 0).length, 53);

const small = ITEM_BY_KEY.potionSmall;
const rolled = new Set(Array.from({ length: 500 }, () => healOf(small)));
eq('범위 안에서만 나온다', [...rolled].every((v) => v >= 15 && v <= 20), true);
eq('양 끝이 다 나온다', [rolled.has(15), rolled.has(20)], [true, true]);
eq('고정값은 그대로', healOf(ITEM_BY_KEY.twig), -1);
eq('없는 것은 0', healOf(null), 0);

console.log('\n찾기');
eq('키로', findItem('twig')?.name, '나뭇가지');
eq('이름으로', findItem('나뭇가지')?.key, 'twig');
eq('공백은 무시', findItem('소형회복약')?.key, 'potionSmall');
eq('없으면 null', findItem('없는물건'), null);
eq('상점에 나오는 것', forSale().length, ITEMS.filter((i) => i.price > 0).length);
eq('값 0 인 것은 상점에 없다', forSale().filter((i) => i.price === 0).length, 0);

console.log('\n시트에서 옮긴 값 몇 개');
eq('부활의 영약', [ITEM_BY_KEY.potionRevive.price, ITEM_BY_KEY.potionRevive.heal], [1000, [100, 100]]);
eq('제일 비싼 건 부활의 영약', ITEMS.reduce((a, b) => (a.price >= b.price ? a : b)).key, 'potionRevive');
eq('잡화 중 제일 비싼 건 루비',
  ITEMS.filter((i) => i.kind === '잡화').reduce((a, b) => (a.price >= b.price ? a : b)).key, 'ruby');
eq('원석 여섯', ITEMS.filter((i) => i.key.startsWith('ore')).length, 6);
eq('깨진 값은 안 넘어왔다',
  ['아이스크림', '고고고', '따꼼약', '아무튼 먹으면 죽는거'].filter((n) => findItem(n)), []);
eq('값 없던 요리는 뺐다',
  ['전사의 스튜', '바다 루비', '지네 담금주', '투명 드래곤 스튜'].filter((n) => findItem(n)), []);
eq('소비는 회복약 넷과 미끼 둘', ITEMS.filter((i) => i.kind === '소비').map((i) => i.key),
  ['potionSmall', 'potionMedium', 'potionLarge', 'potionRevive', 'bait', 'fineBait']);
// 미끼는 **먹는 물건이 아니다.** 회복이 0 이라 `/사용` 이 알아서 거절한다 — 그 약속을 못 박아 둔다.
eq('미끼는 못 먹는다', ITEMS.filter((i) => ['bait', 'fineBait'].includes(i.key) && i.heal !== 0), []);
eq('미끼는 던전에서 안 나온다',
  ITEMS.filter((i) => ['bait', 'fineBait'].includes(i.key) && i.loot !== false), []);
eq('미끼는 상점 미끼 칸에 있다',
  SHELVES.find((sh) => sh.key === 'baits')?.keys, ['bait', 'fineBait']);
eq('소비는 전부 값이 있다', ITEMS.filter((i) => i.kind === '소비' && !i.price), []);

// ---------------------------------------------------------------- /아이템
// 명부를 보여 주는 쪽도 여기서 같이 본다. 서버를 안 부르는 명령이라 가짜 인터랙션만
// 있으면 끝까지 돈다.

const show = async (name) => {
  let out = null;
  await cmd.execute({
    options: { getString: () => name, getSubcommand: () => '정보' },
    async reply(p) { out = p; },
  });
  return out;
};
const click = async (customId, values) => {
  let out = null;
  await cmd.component({ customId, values, async update(p) { out = p; } });
  return out;
};
/** 동기로 한 번 누른다. component 안에 await 이 없어 update 가 그 자리에서 불린다. */
const click2 = (customId, values) => {
  let out = null;
  cmd.component({ customId, values, async update(p) { out = p; } });
  return out;
};
const complete = async (typed) => {
  let got = null;
  await cmd.autocomplete({ options: { getFocused: () => typed }, async respond(r) { got = r; } });
  return got;
};
const read = (p) => {
  const e = p?.embeds?.[0]?.data ?? {};
  const rows = p?.components ?? [];
  const sel = rows.map((r) => r.components[0]).find((b) => b?.data?.type === 3);
  return {
    title: e.title,
    body: e.description ?? '',
    footer: e.footer?.text,
    fields: (e.fields ?? []).map((f) => `${f.name}=${f.value}`),
    ids: rows.flatMap((r) => r.components.map((b) => b.data.custom_id)),
    labels: rows.flatMap((r) => r.components.map((b) => b.data.label)).filter(Boolean),
    options: sel ? sel.options.map((o) => o.data.value) : null,
  };
};
const lines = (body) => body.split(String.fromCharCode(10)).filter((l) => l && !l.startsWith('```'));

console.log('\n/아이템 — 목록');
let c = read(await show(null));
eq('전체 181종', c.fields[0], '종류=**181**');
eq('열 쪽', c.fields[1], '쪽=1 / 10');
eq('한 쪽에 스무 줄', lines(c.body).length, 20);
eq('갈래 버튼 넷', c.labels.slice(0, 4), ['전체', '소비', '잡화', '재료']);
eq('넘김 버튼', c.labels.slice(4), ['◀', '▶']);
eq('셀렉트도 스물', c.options.length, 20);
eq('셀렉트 값은 키', c.options[0], 'potionSmall');

console.log('\n/아이템 — 갈래와 쪽');
c = read(await click('item:list:use:0'));
eq('소비는 여섯', c.fields[0], '종류=**6**');
eq('한 쪽뿐이면 넘김 버튼이 없다', c.labels, ['전체', '소비', '잡화', '재료']);
eq('회복약이 보인다', /소형 회복약/.test(c.body), true);
eq('잡화는 안 보인다', /나뭇가지/.test(c.body), false);

c = read(await click('item:list:misc:2'));
eq('잡화 마지막 쪽', c.fields[1], '쪽=3 / 4');
eq('마지막 것이 보인다', /훔-엘프의 피/.test(c.body), true);
// 쪽을 넘길 때마다 표가 들썩이면 안 된다 — 줄의 **칸 수**가 어느 쪽에서나 같아야 한다.
const widths = new Set([0, 1, 2, 3, 4].flatMap(
  (n) => lines(read(click2(`item:list:misc:${n}`)).body).map(width)));
eq('쪽을 넘겨도 표 폭이 그대로', widths.size, 1);
eq('범위를 넘겨도 안 터진다', read(await click('item:list:misc:99')).fields[1], '쪽=4 / 4');

console.log('\n/아이템 — 한 장');
c = read(await show('potionSmall'));
eq('이름이 제목', c.title, '🍶 소형 회복약');
eq('설명이 본문에', /젤린/.test(c.body), true);
eq('못 파는 것은 그렇게 적는다', /팔 수는 없어요/.test(c.body), true);
eq('갈래·값 두 칸 — 회복은 안 보인다', c.fields, ['갈래=소비', '값=450골드']);
eq('돌아갈 버튼 하나', c.labels, ['목록으로']);

c = read(await show('twig'));
eq('팔 수 있는 것은 양쪽 다', /사기 \*\*1골드\*\* · 팔기 \*\*1골드\*\*/.test(c.body), true);
eq('깎이는 것도 안 보인다', c.fields.some((f) => /회복/.test(f)) || /−1|-1/.test(c.body), false);

c = read(await show('dragonBlood'));
eq('상점에 없는 것', /상점에 없어요/.test(c.body), true);
eq('값 칸은 비운다', c.fields[1], '값=_없음_');

eq('먹어 봐야 안다', read(await show('redFeather')).footer, '먹으면 어떻게 될지는 먹어 봐야 알아요');
eq('목록에도 회복 칸이 없다', /\s[−-]?\d+\s*$/m.test(read(await click('item:list:use:0')).body.replace(/[\d,]+골드/g, '')), false);
eq('없는 키를 주면 목록으로', read(await show('없는키')).fields[0], '종류=**181**');
eq('독은 카드에 안 적는다 — 먹어 봐야 안다', /☠️|독/.test(read(await show('deathCap')).body), false);
eq('괴식이면 카드에 적는다', /🪱 \*\*괴식\*\*/.test(read(await show('bugPile')).body), true);
eq('멀쩡한 것은 아무 표시 없다', /☠️|🪱/.test(read(await show('honey')).body), false);

console.log('\n/아이템 — 재료');
c = read(await click('item:list:food:0'));
eq('재료 탭', [c.fields[0], c.fields[1]], ['종류=**111**', '쪽=1 / 6']);
eq('재료가 보인다', /이쁘니 버섯/.test(c.body), true);
eq('잡화는 안 보인다', /나뭇가지/.test(c.body), false);
c = read(await show('honey'));
eq('재료 한 장', [c.title, c.fields[0]], ['🧺 꿀 한 병', '갈래=재료']);

console.log('\n/아이템 — 고르고 돌아오기');
c = read(await click('item:pick:misc:2', ['ruby']));
eq('고른 것이 열린다', c.title, '🎒 루비');
eq('보던 자리를 들고 돌아간다', c.ids, ['item:list:misc:2']);
eq('돌아가면 그 쪽이다', read(await click(c.ids[0])).fields[1], '쪽=3 / 4');

// **모든 쪽의 customId 가 서로 달라야 한다.** 같은 것이 둘 있으면 디스코드가 그 메시지를
// 통째로 거절한다(50035). 탭 버튼이 0쪽을 가리키면 2쪽의 `◀` 와 부딪히는데, 1쪽만 보고
// 넘어가면 안 걸린다 — 갈래마다 모든 쪽을 다 그려 본다.
console.log('\n/아이템 — customId 중복');
const dups = [];
for (const kind of ['all', 'use', 'misc', 'food']) {
  for (let n = 0; n < 8; n += 1) {
    const got = read(click2(`item:list:${kind}:${n}`)).ids;
    const twice = got.filter((v, i) => got.indexOf(v) !== i);
    if (twice.length) dups.push(`${kind}:${n} → ${twice.join(', ')}`);
  }
}
eq('모든 갈래·모든 쪽에서 안 겹친다', dups, []);
eq('한 장에서도 안 겹친다', ['potionSmall', 'ruby', 'twig'].flatMap((k) => {
  const got = read(click2('item:pick:all:0', [k])).ids;
  return got.filter((v, i) => got.indexOf(v) !== i);
}), []);
eq('탭 버튼은 쪽 자리에 t 를 쓴다', read(click2('item:list:all:0')).ids.slice(0, 4),
  ['item:list:all:t', 'item:list:use:t', 'item:list:misc:t', 'item:list:food:t']);
eq('t 로 눌러도 첫 쪽', read(click2('item:list:misc:t')).fields[1], '쪽=1 / 4');

console.log('\n/아이템 — 자동완성');
eq('이름 조각으로', (await complete('회복')).length, 3);
eq('키로도', (await complete('ore')).length, 6);
eq('공백은 무시', (await complete('소형회복약')).map((x) => x.value), ['potionSmall']);
eq('빈 입력은 스물다섯까지', (await complete('')).length, 25);
eq('돌려주는 값은 키', (await complete('루비')).every((x) => ITEM_BY_KEY[x.value]), true);
eq('없는 것', await complete('없는물건'), []);

console.log(`\n${bad ? '✗' : '✓'} ${ok + bad}건 중 통과 ${ok} · 실패 ${bad}`);
process.exit(bad ? 1 : 0);
