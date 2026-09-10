/**
 * loot — 던전에서 떨구는 것
 *
 * 표를 따로 만들지 않는다. **명부에 값이 이미 있으니 그걸 쓴다** — 싼 것일수록 흔하게.
 * 나뭇가지(1골드)는 자주 나오고 정체 모를 화석(100골드)은 드물다.
 *
 * 가중치는 `1 / (값 + soft)` 다. `1 / 값` 으로 하면 두 가지가 깨진다. 값이 0 인
 * 것에서 0으로 나누고, 그보다 **값 0 짜리가 압도적으로 흔해진다** — 그 무리에 회복
 * 100 짜리 같은 것이 섞여 있으면 던전 보상이 그것만 쏟아진다. `soft` 가 그 쏠림을
 * 눌러서, 값 0 과 1골드짜리가 비슷한 정도로 나온다.
 *
 * **등급이 둘이다.** 엘리트를 눕히면 가짓수가 늘고, 값 가중치가 완만해져 비싼 것이
 * 잘 나오고, 골드도 MT 확률도 높다. 표를 따로 만들지 않고 `soft` 하나로 기울기를 바꾼다.
 *
 * **빼는 것은 명부에 `loot: false` 로 적는다**(`sell` 과 같은 결). 이야기용 물건과
 * 가공이 끝난 보석이 거기 든다 — 던전 바닥에 루비가 굴러다니면 안 된다.
 * `소비`(회복약)는 갈래로 통째로 뺀다. 그건 상점 물건이다.
 */
import { ITEMS } from './items.js';

/**
 * 등급마다 다른 씀씀이.
 *
 *   least·most  아이템 가짓수
 *   soft        값 가중치의 완충값. **클수록 비싼 것이 잘 나온다** — 가중치가
 *               `1/(값+soft)` 라, soft 가 값보다 커지면 값 차이가 묻힌다.
 *               8 이면 200골드짜리가 1골드짜리보다 23배 드물고, 60 이면 4배쯤 드물다
 *   gold        떨구는 골드 범위(10 단위로 끊는다)
 *   mt          MT 가 나올 확률
 */
export const TIER = {
  normal: { least: 2, most: 5, soft: 8, gold: [20, 250], mt: 0.03 },
  elite: { least: 4, most: 8, soft: 60, gold: [100, 500], mt: 0.15 },
};

/** 뽑기 풀. 잡화이고 명부가 막지 않은 것. */
export const POOL = ITEMS.filter((i) => i.kind === '잡화' && i.loot !== false);

/** 등급마다 가중치표를 미리 만들어 둔다. 뽑을 때마다 다시 재면 아깝다. */
const TABLE = Object.fromEntries(Object.entries(TIER).map(([key, t]) => {
  const weight = POOL.map((i) => 1 / (i.price + t.soft));
  return [key, { weight, total: weight.reduce((a, b) => a + b, 0) }];
}));

/** 하나 뽑는다. */
export function one(rand = Math.random, tier = 'normal') {
  const { weight, total } = TABLE[tier] ?? TABLE.normal;
  let n = rand() * total;
  for (let i = 0; i < POOL.length; i += 1) {
    n -= weight[i];
    if (n <= 0) return POOL[i];
  }
  return POOL[POOL.length - 1];
}

/**
 * 던전 하나를 깬 값. `{ items, gold, mt }`.
 *
 * `items` 는 `{ 키: 개수 }` 라 그대로 `apply({ items })` 에 들어간다.
 * **같은 것이 두 번 나올 수 있다** — 그러면 개수가 늘 뿐이라 자연스럽고, 뽑을 때마다
 * 풀에서 빼면 싼 것이 금방 동나서 가중치가 무너진다.
 *
 * 골드는 **10 단위로 끊는다.** 지갑에 어중간한 수가 쌓이면 값을 견주기가 나쁘다.
 * MT 는 얻는 길이 좁은 재화라 확률로만 준다 — 엘리트를 눕혀야 눈에 띄게 붙는다.
 */
export function roll(rand = Math.random, { elite = false } = {}) {
  const key = elite ? 'elite' : 'normal';
  const t = TIER[key];

  const count = t.least + Math.floor(rand() * (t.most - t.least + 1));
  const items = {};
  for (let i = 0; i < count; i += 1) {
    const item = one(rand, key);
    items[item.key] = (items[item.key] ?? 0) + 1;
  }

  const [lo, hi] = t.gold;
  const gold = Math.round((lo + rand() * (hi - lo)) / 10) * 10;

  return { items, gold, mt: rand() < t.mt ? 1 : 0 };
}

/** 사람이 읽을 한 줄. `나뭇가지 ×2 · 도토리 · 120골드 · MT ×1` */
export function listText(drops, byKey) {
  const out = Object.entries(drops.items ?? {})
    .map(([key, n]) => `**${byKey[key]?.name ?? key}**${n > 1 ? ` ×${n}` : ''}`);
  if (drops.gold) out.push(`**${drops.gold.toLocaleString('ko-KR')}골드**`);
  if (drops.mt) out.push(`🪙 **MT ×${drops.mt}**`);
  return out.join(' · ');
}

export default { POOL, TIER, one, roll, listText };
