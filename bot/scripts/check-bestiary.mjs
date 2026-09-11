/**
 * 에너미 도감 — 서버 없이 화면만 그려 본다.
 *
 *   node scripts/check-bestiary.mjs
 *
 * 보는 것:
 *   - 못 만난 에너미는 이름이 **어디에도** 안 새는지(목록 · 셀렉트)
 *   - 만나면 이름·설명, 이기면 성향·체력이 열리는지
 *   - 모든 탭의 모든 쪽에서 customId 가 안 겹치는지(50035 — 이미 두 번 물렸다)
 *   - 성향 말이 일흔다섯 모두에게 붙는지
 */
import assert from 'node:assert/strict';
import {
  listPayload, cardPayload, styleOf, ENEMIES, TOTAL,
} from '../src/commands/bestiary.js';
import { MOBS, NORMALS } from '../src/holdem/mobs.js';

let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); } catch (err) { failed += 1; console.log(`  ✗ ${name}\n    ${err.message}`); }
}

const ID = '100000000000000001';
const json = (p) => JSON.stringify(p.embeds.map((e) => e.toJSON()).concat(p.components.map((c) => c.toJSON())));
const ids = (p) => p.components.flatMap((r) => r.toJSON().components.map((c) => c.custom_id));

const METONLY = NORMALS[0].name;       // 만나기만
const BEATEN = MOBS[0].name;           // 이긴 엘리트
const book = { [METONLY]: { met: 2, won: 0 }, [BEATEN]: { met: 1, won: 1 } };

check('일흔다섯, 이름이 다 다르다', () => {
  assert.equal(TOTAL, 75);
  assert.equal(new Set(ENEMIES.map((m) => m.name)).size, 75);
});

check('빈 도감은 전부 ??? 이고 셀렉트가 없다', () => {
  for (const tab of ['n', 'e']) {
    for (const page of [0, 1]) {
      const p = listPayload(ID, {}, tab, page);
      const text = json(p);
      for (const m of ENEMIES) assert.equal(text.includes(m.name), false, `${m.name} 이 샜다`);
      assert.equal(p.components.some((r) => r.toJSON().components.some((c) => c.type === 3)), false);
    }
  }
});

check('만난 것만 이름이 보이고, 셀렉트에도 그것만', () => {
  const p = listPayload(ID, book, 'n', 0);
  const text = json(p);
  assert.ok(text.includes(METONLY));
  assert.ok(text.includes('만남 2'));
  const others = NORMALS.slice(1).filter((m) => text.includes(m.name));
  assert.deepEqual(others.map((m) => m.name), [], '못 만난 이름이 샜다');
  const select = p.components.at(-1).toJSON().components[0];
  assert.deepEqual(select.options.map((o) => o.value), [METONLY]);
});

check('진행도 — 만남 2 · 처치 1', () => {
  const fields = listPayload(ID, book, 'e', 0).embeds[0].toJSON().fields;
  assert.match(fields[0].value, /2 \/ 75$/);
  assert.match(fields[1].value, /1 \/ 75$/);
});

check('모든 탭·쪽에서 customId 가 안 겹친다', () => {
  for (const tab of ['n', 'e']) {
    for (const page of [0, 1, 2]) {
      const all = ids(listPayload(ID, book, tab, page));
      assert.equal(new Set(all).size, all.length, `${tab}:${page} ${all.join(' ')}`);
      assert.ok(all.every((c) => c.length <= 100));
    }
  }
});

check('NPC id 도 customId 맨 뒤에 들어간다', () => {
  const all = ids(listPayload('npc:migel', book, 'n', 0));
  assert.ok(all.every((c) => c.endsWith(':npc:migel')));
});

check('만나기만 했으면 성향이 잠겨 있다', () => {
  const text = json(cardPayload(ID, book, METONLY));
  assert.ok(text.includes(NORMALS[0].note));
  assert.ok(text.includes('쓰러뜨리면 적혀요'));
  assert.equal(text.includes('보는 패'), false);
  assert.equal(cardPayload(ID, book, METONLY).embeds[0].toJSON().fields[2].value, '🔒');
});

check('이겼으면 성향과 체력이 열린다', () => {
  const p = cardPayload(ID, book, BEATEN);
  const text = json(p);
  for (const label of ['보는 패', '허세', '올리는 크기', styleOf({ ...MOBS[0], elite: true }).name]) {
    assert.ok(text.includes(label), label);
  }
  assert.ok(p.embeds[0].toJSON().title.startsWith('⚔️ 엘리트'));
  assert.match(p.embeds[0].toJSON().fields[2].value, /\*\*\d+\*\*/);
});

check('못 만난 이름·없는 이름은 카드가 없다', () => {
  assert.equal(cardPayload(ID, book, NORMALS[1].name), null);
  assert.equal(cardPayload(ID, book, '없는 놈'), null);
  assert.equal(cardPayload(ID, {}, BEATEN), null);
});

check('일흔다섯 모두 성향 카드가 그려진다', () => {
  const full = Object.fromEntries(ENEMIES.map((m) => [m.name, { met: 1, won: 1 }]));
  const seen = new Set();
  for (const m of ENEMIES) {
    const p = cardPayload(ID, full, m.name);
    assert.ok(p, m.name);
    const d = p.embeds[0].toJSON().description;
    assert.equal(d.includes('undefined'), false, m.name);
    seen.add(styleOf(m).name);
  }
  // 네 갈래가 다 나와야 말이 뜻이 있다. 전부 한 갈래면 경계를 잘못 잡은 것이다.
  assert.equal(seen.size, 4, [...seen].join(' · '));
});

console.log(failed ? `\n실패 ${failed}건` : '\n전부 통과');
process.exit(failed ? 1 : 0);
