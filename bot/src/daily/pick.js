/**
 * daily/pick — 오늘 무엇을 할지 (`/일상`)
 *
 * **규칙이 고른다.** AI 는 정해진 일을 받아 말만 한다(`daily/talk.js`). AI 에게 고르게 하면
 * 할 수 없는 일(골드도 없이 장보기)을 고르거나, 한도에 막힌 날 아무것도 못 한다.
 *
 *   1. 할 수 있는 일마다 **계획**을 먼저 짠다 — 무엇을 몇 개, 누구에게.
 *   2. 계획이 선 일만 후보로 남기고, 성격(`LIKES`)과 상태로 무게를 준다.
 *   3. 혼자 할지 둘이 할지는 그다음이다. 상대가 못 오면 혼자다.
 *
 * 순수 함수다 — 계정과 난수만 받는다. 서버 없이 검사한다(`scripts/check-daily.mjs`).
 */
import { ITEMS, ITEM_BY_KEY, MAX_HP, buyPrice } from '../casino/items.js';

/** 다친 것으로 보는 체력. 이 아래면 회복약 쪽으로 기운다. */
export const HURT = 50;

/** 장을 보고도 남겨 둘 골드. 미겔·마티암은 `/급여` 로만 버니 바닥까지 쓰지 않는다. */
export const KEEP = 200;

/** 한 번 장보기에 쓰는 몫 — 쓸 수 있는 골드의 이만큼, 많아도 이 값까지. 회복약은 따로다. */
const SPEND_SHARE = 0.3;
const SPEND_MAX = 300;

/** 한 번에 사는 개수 상한. */
const MAX_BUY = 5;

/**
 * 사람에게 주는 선물의 값 상한(살 때 값). `/양도` 가 NPC → 사람을 막는 까닭과 같다 —
 * `/급여` 로 넣은 일당이 선물의 모양으로 사람 지갑에 새어 나오면 안 된다. 회복약은 다 넘는다.
 */
export const HUMAN_GIFT_CAP = 200;

/**
 * 회복약. 상점 재고(`commands/shop.js` 의 STOCK)에서 **부활의 영약만 뺐다** — 쓰러진 캐릭터는
 * 일상을 못 보내니 스스로 살 일이 없다. 싼 것부터.
 */
export const POTIONS = ['potionSmall', 'potionMedium', 'potionLarge'];

/** 장바구니 — 상점이 파는 재료(`shop: true`). 상점의 진열대(SHELVES)를 짓는 규칙과 같다. */
const GROCERIES = ITEMS.filter((i) => i.kind === '재료' && i.shop);

/** 입맛 — 재료 진열대(`CATS`)마다 무게. 상대 것을 살 때는 **상대의** 입맛을 본다. */
const TASTE = {
  migel: { sweet: 3, fruit: 3, grain: 1.5, spice: 1, meat: 1, veg: 1 },
  matiam: { meat: 3, veg: 2, spice: 2, grain: 1.5, fruit: 1, sweet: 1 },
};

/** 하고 싶은 일의 무게 — 성격이다. 미겔은 말하고 주는 쪽, 마티암은 챙겨 두는 쪽. */
const LIKES = {
  migel: { talk: 3, shop: 2, gift: 3 },
  matiam: { talk: 2, shop: 3, gift: 2 },
};

/** 혼자도 둘이도 할 수 있을 때 둘이 할 확률. */
const DUO = { talk: 0.6, shop: 0.35, gift: 0.5 };

export const PARTNER = { migel: 'matiam', matiam: 'migel' };

const hpOf = (acct) => Number(acct?.hp ?? MAX_HP);
const goldOf = (acct) => Number(acct?.gold ?? 0);
const isPotion = (key) => POTIONS.includes(key) || key === 'potionRevive';

/** `[값, 무게]` 목록에서 무게대로 하나. 무게가 다 0 이면 null. */
export function weighted(list, rand) {
  const live = list.filter(([, w]) => w > 0);
  const total = live.reduce((s, [, w]) => s + w, 0);
  if (!total) return null;
  let x = rand() * total;
  for (const [v, w] of live) {
    x -= w;
    if (x < 0) return v;
  }
  return live[live.length - 1][0];
}

/**
 * 장보기 계획. `{ key, count, cost, drink }` 또는 null(살 게 없다).
 *
 * `buyer` 가 골드를 내고 `forAcct` 가 받는다(혼자면 같은 계정). 받는 쪽이 다쳤으면 회복약을
 * 사서 **바로 마시게** 한다(`drink`) — 쌓아 두는 약은 이야기가 안 된다.
 */
export function planShop(buyer, forAcct, taste, rand) {
  const spare = goldOf(buyer) - KEEP;
  if (spare <= 0) return null;

  if (hpOf(forAcct) < HURT) {
    const potion = POTIONS.map((k) => ITEM_BY_KEY[k]).find((p) => buyPrice(p) <= spare);
    if (potion) return { key: potion.key, count: 1, cost: buyPrice(potion), drink: true };
  }

  const budget = Math.min(SPEND_MAX, Math.floor(spare * SPEND_SHARE));
  const pool = GROCERIES.filter((i) => buyPrice(i) > 0 && buyPrice(i) <= budget);
  const item = weighted(pool.map((i) => [i, taste[i.cat] ?? 1]), rand);
  if (!item) return null;
  const most = Math.min(MAX_BUY, Math.floor(budget / buyPrice(item)));
  const count = 1 + Math.floor(rand() * most);
  return { key: item.key, count, cost: buyPrice(item) * count, drink: false };
}

/** 선물로 고를 무게. 다친 상대에게는 약이 먼저다. 미끼는 선물답지 않다. */
function giftWeight(item, hurt) {
  if (isPotion(item.key)) return hurt ? 8 : 0.5;
  if (item.key === 'bait' || item.key === 'fineBait') return 0.2;
  return item.kind === '잡화' ? 2 : 1;
}

/**
 * 선물 계획. `{ key, count }` 또는 null(줄 것이 없다).
 * `to` 는 `{ kind: 'npc', account }` 또는 `{ kind: 'human' }`. 사람에게는 값이 싼 것만(`HUMAN_GIFT_CAP`).
 * 값싼 것을 여럿 가졌으면 한 줌(최대 셋)을, 아니면 하나를 준다.
 */
export function planGift(giver, to, rand) {
  const hurt = to.kind === 'npc' && hpOf(to.account) < HURT;
  const pool = Object.entries(giver?.items ?? {})
    .map(([key, n]) => [ITEM_BY_KEY[key], Number(n)])
    .filter(([item, n]) => item && n > 0)
    .filter(([item]) => to.kind !== 'human' || Math.max(item.price, buyPrice(item)) <= HUMAN_GIFT_CAP);
  const picked = weighted(pool.map(([item, n]) => [[item, n], giftWeight(item, hurt)]), rand);
  if (!picked) return null;
  const [item, n] = picked;
  const count = item.price <= 5 && n >= 2 ? 1 + Math.floor(rand() * Math.min(3, n)) : 1;
  return { key: item.key, count };
}

/**
 * 오늘 할 일. `{ kind, duo, plan }` — kind 는 `talk` · `shop` · `gift`.
 *
 *   me       부른 캐릭터의 계정
 *   partner  `{ account, free }` — free 는 쓰러지지 않았고 판에도 다른 일상에도 없는 것
 *   human    `{ free }` — 명령한 사람이 선물을 받을 수 있는지(판에 앉아 있지 않은지). 없으면 null
 *
 * 둘이 하는 선물은 상대에게, 혼자 하는 선물은 명령한 사람에게 간다.
 */
export function choose({ character, me, partner = null, human = null, rand = Math.random }) {
  const free = Boolean(partner?.free);
  const options = {
    talk: { solo: {}, duo: free ? {} : null },
    shop: {
      solo: planShop(me, me, TASTE[character], rand),
      duo: free ? planShop(me, partner.account, TASTE[PARTNER[character]], rand) : null,
    },
    gift: {
      solo: human?.free ? planGift(me, { kind: 'human' }, rand) : null,
      duo: free ? planGift(me, { kind: 'npc', account: partner.account }, rand) : null,
    },
  };

  const weightOf = (kind) => {
    const o = options[kind];
    if (!o.solo && !o.duo) return 0;
    let w = LIKES[character][kind];
    // 누가 다쳤으면 약부터 — 나든 상대든
    if (kind === 'shop' && (o.solo?.drink || o.duo?.drink)) w *= 3;
    if (kind === 'gift' && o.duo && isPotion(o.duo.key) && hpOf(partner.account) < HURT) w *= 2;
    return w;
  };
  const kind = weighted(Object.keys(options).map((k) => [k, weightOf(k)]), rand);
  const o = options[kind];

  let duo;
  if (o.solo && o.duo) {
    // 한쪽만 다쳤으면 다친 쪽 약이 먼저다. 나머지는 성격대로 굴린다.
    duo = kind === 'shop' && o.solo.drink !== o.duo.drink ? o.duo.drink : rand() < DUO[kind];
  } else {
    duo = Boolean(o.duo);
  }
  return { kind, duo, plan: duo ? o.duo : o.solo };
}

export default {
  HURT, KEEP, HUMAN_GIFT_CAP, POTIONS, PARTNER, weighted, planShop, planGift, choose,
};
