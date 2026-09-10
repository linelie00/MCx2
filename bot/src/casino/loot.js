/**
 * loot — 던전에서 떨구는 것
 *
 * 표를 따로 만들지 않는다. **명부에 값이 이미 있으니 그걸 쓴다** — 싼 것일수록 흔하게.
 * 나뭇가지(1골드)는 자주 나오고 정체 모를 화석(100골드)은 드물다.
 *
 * 가중치는 `1 / (price + 8)` 이다. `1 / price` 로 하면 두 가지가 깨진다. 값이 0 인
 * 것에서 0으로 나누고, 그보다 **값 0 짜리가 압도적으로 흔해진다** — 그 무리에 회복
 * 100 짜리 같은 것이 섞여 있으면 던전 보상이 그것만 쏟아진다. `+ 8` 이 그 쏠림을
 * 눌러서, 값 0 과 1골드짜리가 비슷한 정도로 나온다.
 *
 * **빼는 것은 명부에 `loot: false` 로 적는다**(`sell` 과 같은 결). 이야기용 물건과
 * 가공이 끝난 보석이 거기 든다 — 던전 바닥에 루비가 굴러다니면 안 된다.
 * `소비`(회복약)는 갈래로 통째로 뺀다. 그건 상점 물건이다.
 */
import { ITEMS } from './items.js';

/** 한 번에 떨구는 가짓수. */
export const LEAST = 2;
export const MOST = 5;

/** 값이 낮을수록 흔하게. 8 은 값 0 짜리가 혼자 튀지 않게 눌러 주는 값이다. */
const SOFT = 8;

/** 뽑기 풀. 잡화이고 명부가 막지 않은 것. */
export const POOL = ITEMS.filter((i) => i.kind === '잡화' && i.loot !== false);

const WEIGHT = POOL.map((i) => 1 / (i.price + SOFT));
const TOTAL = WEIGHT.reduce((a, b) => a + b, 0);

/** 하나 뽑는다. */
export function one(rand = Math.random) {
  let n = rand() * TOTAL;
  for (let i = 0; i < POOL.length; i += 1) {
    n -= WEIGHT[i];
    if (n <= 0) return POOL[i];
  }
  return POOL[POOL.length - 1];
}

/**
 * 던전 하나를 깬 값. `{ 키: 개수 }` 로 돌려준다 — 그대로 `apply({ items })` 에 넣는다.
 *
 * **같은 것이 두 번 나올 수 있다.** 그러면 개수가 늘 뿐이라 자연스럽고, 뽑을 때마다
 * 풀에서 빼면 싼 것이 금방 동나서 가중치가 무너진다.
 */
export function roll(rand = Math.random) {
  const count = LEAST + Math.floor(rand() * (MOST - LEAST + 1));
  const out = {};
  for (let i = 0; i < count; i += 1) {
    const item = one(rand);
    out[item.key] = (out[item.key] ?? 0) + 1;
  }
  return out;
}

/** 사람이 읽을 한 줄. `나뭇가지 ×2 · 도토리` */
export const listText = (drops, byKey) => Object.entries(drops)
  .map(([key, n]) => `**${byKey[key]?.name ?? key}**${n > 1 ? ` ×${n}` : ''}`)
  .join(' · ');

export default { POOL, LEAST, MOST, one, roll, listText };
