/**
 * check-items — 아이템 명부 회귀 검사
 *
 *   node scripts/check-items.mjs
 *
 * 명부는 시트에서 옮긴 것이라 손으로 고칠 일이 잦다. **키가 저장되는 값**이라
 * 오타 하나가 남의 창고를 비운다 — 모양이 어긋나면 여기서 걸린다.
 */
import { ITEMS, ITEM_BY_KEY, MAX_HP, forSale, healOf, findItem } from '../src/casino/items.js';

let ok = 0; let bad = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok += 1; console.log(`  ✓ ${name}`); }
  else { bad += 1; console.log(`  ✗ ${name}\n     받음 ${JSON.stringify(got)} / 기대 ${JSON.stringify(want)}`); }
};

console.log('\n모양');
eq('99종', ITEMS.length, 99);
eq('키가 안 겹친다', Object.keys(ITEM_BY_KEY).length, ITEMS.length);
eq('이름이 안 겹친다', new Set(ITEMS.map((i) => i.name)).size, ITEMS.length);
eq('키는 영문 카멜케이스', ITEMS.filter((i) => !/^[a-z][A-Za-z0-9]*$/.test(i.key)).map((i) => i.key), []);
eq('용도는 둘뿐', [...new Set(ITEMS.map((i) => i.kind))].sort(), ['소비', '잡화']);
eq('값은 0 이상 정수', ITEMS.filter((i) => !Number.isInteger(i.price) || i.price < 0).map((i) => i.key), []);
eq('sell 은 참/거짓', ITEMS.filter((i) => typeof i.sell !== 'boolean').map((i) => i.key), []);
eq('팔 수 있으면 값이 있다', ITEMS.filter((i) => i.sell && i.price <= 0).map((i) => i.key), []);

console.log('\n설명');
eq('빈 설명이 없다', ITEMS.filter((i) => !i.desc?.trim()).map((i) => i.key), []);
eq('줄바꿈이 없다', ITEMS.filter((i) => /\n/.test(i.desc)).map((i) => i.key), []);
eq('트위터 핸들이 없다', ITEMS.filter((i) => i.desc.includes('@')).map((i) => i.key), []);
eq('임베드 한 칸에 들어간다', ITEMS.filter((i) => i.desc.length > 200).map((i) => i.key), []);

console.log('\n회복력');
const shape = (h) => (Array.isArray(h)
  ? h.length === 2 && h.every(Number.isInteger) && h[0] <= h[1]
  : Number.isInteger(h));
eq('숫자 아니면 [a, b]', ITEMS.filter((i) => !shape(i.heal)).map((i) => i.key), []);
eq('최대치를 안 넘는다', ITEMS.filter((i) => Math.max(...[i.heal].flat()) > MAX_HP).map((i) => i.key), []);
eq('HP 최대치는 100', MAX_HP, 100);
eq('범위로 적힌 것은 일곱', ITEMS.filter((i) => Array.isArray(i.heal)).length, 7);
eq('먹으면 깎이는 것 스물여섯', ITEMS.filter((i) => i.heal < 0).length, 26);

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

console.log(`\n${bad ? '✗' : '✓'} ${ok + bad}건 중 통과 ${ok} · 실패 ${bad}`);
process.exit(bad ? 1 : 0);
