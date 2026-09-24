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
 * 요리·제작은 **재료만 규칙이 고른다.** 무엇을 어떻게 만들지는 AI 가 짓고, 등급은 `/요리` 와
 * 같은 심사관이 매긴다. 그래서 심사관을 부를 수 없는 날(`canMake`)에는 후보에서 빠진다.
 *
 * 순수 함수다 — 계정과 난수만 받는다. 서버 없이 검사한다(`scripts/check-daily.mjs`).
 */
import { ITEMS, ITEM_BY_KEY, MAX_HP, buyPrice } from '../casino/items.js';
import { MAX_CRAFTS, GRADE_BY_KEY } from '../casino/crafts.js';

/** 다친 것으로 보는 체력. 이 아래면 회복약·먹을 것 쪽으로 기운다. */
export const HURT = 50;

/** 장을 보고도 남겨 둘 골드. 미겔·마티암은 `/급여` 로만 버니 바닥까지 쓰지 않는다. */
export const KEEP = 200;

/** 한 번 장보기에 쓰는 몫 — 쓸 수 있는 골드의 이만큼, 많아도 이 값까지. 회복약은 따로다. */
const SPEND_SHARE = 0.3;
const SPEND_MAX = 300;

/** 한 번에 사는 개수 상한. */
const MAX_BUY = 5;

/**
 * 사람에게 주는 선물의 값 상한(살 때 값 · 만든 것은 파는 값). `/양도` 가 NPC → 사람을 막는
 * 까닭과 같다 — `/급여` 로 넣은 일당이 선물의 모양으로 사람 지갑에 새어 나오면 안 된다.
 * 회복약은 다 넘는다. 만든 것은 **MT 가 붙은 것도 안 된다**(`/mt상점` 에서 바꿀 수 있다).
 */
export const HUMAN_GIFT_CAP = 200;

/**
 * 회복약. 상점 재고(`commands/shop.js` 의 STOCK)에서 **부활의 영약만 뺐다** — 쓰러진 캐릭터는
 * 일상을 못 보내니 스스로 살 일이 없다. 싼 것부터.
 */
export const POTIONS = ['potionSmall', 'potionMedium', 'potionLarge'];

/** 장바구니 — 상점이 파는 재료(`shop: true`). 상점의 진열대(SHELVES)를 짓는 규칙과 같다. */
const GROCERIES = ITEMS.filter((i) => i.kind === '재료' && i.shop);

/** 입맛 — 재료 진열대(`CATS`)마다 무게. 상대 것을 살 때·만들 때는 **상대의** 입맛을 본다. */
const TASTE = {
  migel: { sweet: 3, fruit: 3, grain: 1.5, spice: 1, meat: 1, veg: 1 },
  matiam: { meat: 3, veg: 2, spice: 2, grain: 1.5, fruit: 1, sweet: 1 },
};

/**
 * 손이 가는 잡화 — 제작 재료의 무게. 마티암은 재봉사라 천·가죽·끈, 미겔은 음유시인이라
 * 반짝이고 소리 나는 것. 나머지는 1.
 */
const HANDY = {
  migel: { glassMarble: 3, tearCrystal: 3, redFeather: 3, catWhisker: 2, brokenWatch: 2, whiteShell: 2 },
  matiam: { leatherScrap: 3, fadedRibbon: 3, handkerchief: 3, silverChain: 3, brokenBracelet: 2, brokenComb: 2 },
};

/** 하고 싶은 일의 무게 — 성격이다. 미겔은 말하고 주는 쪽, 마티암은 챙겨 두고 손으로 만드는 쪽. */
const LIKES = {
  migel: { talk: 3, shop: 2, gift: 3, cook: 2, craft: 1, fish: 2 },
  matiam: { talk: 2, shop: 3, gift: 2, cook: 2, craft: 3, fish: 2 },
};

/** 혼자도 둘이도 할 수 있을 때 둘이 할 확률. */
const DUO = { talk: 0.6, shop: 0.35, gift: 0.5, cook: 0.4, craft: 0.3, fish: 0.35 };

export const PARTNER = { migel: 'matiam', matiam: 'migel' };

const hpOf = (acct) => Number(acct?.hp ?? MAX_HP);
const goldOf = (acct) => Number(acct?.gold ?? 0);
const isPotion = (key) => POTIONS.includes(key) || key === 'potionRevive';
const hurt = (acct) => hpOf(acct) < HURT;
/** 만든 것 칸이 남았는지. */
const room = (acct) => (acct?.crafts?.length ?? 0) < MAX_CRAFTS;

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

  if (hurt(forAcct)) {
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

/** 요리에 넣는 것 — 재료이되 **독은 뺀다.** 미겔·마티암은 무엇이 독인지 안다. */
const cookable = (item) => item.kind === '재료' && !item.poison;

/** 밭에 넣는 것 — 잡화지만 무엇을 만들 재료는 아니다(`/농장 거름`). */
const FARM_GEAR = new Set(['compost', 'fertilizer', 'goldFertilizer', 'earPlug']);
const craftable = (item) => item.kind === '잡화' && !FARM_GEAR.has(item.key);

/**
 * 요리·제작 재료. `{ counts: { 키: 1 } }` 또는 null(쓸 재료가 없다).
 *
 * `owner` 의 가방에서 **서로 다른 것 두세 가지**를 하나씩 고른다(하나뿐이면 하나). 셋이면 등급
 * 고정값을 다 받는다(`crafts.FLAT_FULL`). 요리는 입맛(`taste`)대로 — 상대에게 만들어 줄 때는
 * 상대의 입맛이다. 괴식은 가끔만. 제작은 손이 가는 잡화(`handy`)대로.
 */
export function planMake(kind, owner, { taste = {}, handy = {} } = {}, rand = Math.random) {
  const fits = kind === 'cook' ? cookable : craftable;
  let pool = Object.entries(owner?.items ?? {})
    .map(([key, n]) => [ITEM_BY_KEY[key], Number(n)])
    .filter(([item, n]) => item && n > 0 && fits(item))
    .map(([item]) => item);
  if (!pool.length) return null;

  const weightOf = (item) => (kind === 'cook'
    ? (taste[item.cat] ?? 1) * (item.monster ? 0.3 : 1)
    : handy[item.key] ?? 1);
  const want = pool.length === 1 ? 1 : Math.min(pool.length, 2 + Math.floor(rand() * 2));
  const counts = {};
  for (let i = 0; i < want; i += 1) {
    const item = weighted(pool.map((it) => [it, weightOf(it)]), rand);
    counts[item.key] = 1;
    pool = pool.filter((it) => it !== item);
  }
  return { counts };
}

/** 선물로 고를 무게. 다친 상대에게는 약과 먹을 것이 먼저다. 미끼는 선물답지 않다. */
function giftWeight(item, hurtTarget) {
  if (isPotion(item.key)) return hurtTarget ? 8 : 0.5;
  if (item.key === 'bait' || item.key === 'fineBait') return 0.2;
  return item.kind === '잡화' ? 2 : 1;
}

/** 만든 것을 선물로 고를 무게. 손수 만든 것이라 명부의 물건보다 조금 더 손이 간다. */
const craftWeight = (craft, hurtTarget) => (craft.kind === '요리' && hurtTarget && craft.heal > 0 ? 5 : 3);

/**
 * 선물 계획. `{ key, count }`(명부의 물건) · `{ craft }`(만든 것) 또는 null(줄 것이 없다).
 *
 * `to` 는 `{ kind: 'npc', account }` 또는 `{ kind: 'human', crafts }` — crafts 는 받을 사람이 가진
 * 만든 것 수(칸이 차면 만든 것은 못 준다). 사람에게는 값이 싼 것만(`HUMAN_GIFT_CAP`).
 * 값싼 물건을 여럿 가졌으면 한 줌(최대 셋)을, 아니면 하나를 준다. 망가진 것(스톤)은 안 준다.
 */
export function planGift(giver, to, rand) {
  const toHuman = to.kind === 'human';
  const hurtTarget = !toHuman && hurt(to.account);
  const items = Object.entries(giver?.items ?? {})
    .map(([key, n]) => [ITEM_BY_KEY[key], Number(n)])
    .filter(([item, n]) => item && n > 0)
    .filter(([item]) => !toHuman || Math.max(item.price, buyPrice(item)) <= HUMAN_GIFT_CAP)
    .map(([item, n]) => [{ item, n }, giftWeight(item, hurtTarget)]);
  const hasRoom = toHuman ? (to.crafts ?? MAX_CRAFTS) < MAX_CRAFTS : room(to.account);
  const crafts = hasRoom
    ? (giver?.crafts ?? [])
      .filter((c) => GRADE_BY_KEY[c.grade] && c.grade !== 'stone')
      .filter((c) => !toHuman || (Number(c.price) <= HUMAN_GIFT_CAP && !c.mt))
      .map((c) => [{ craft: c }, craftWeight(c, hurtTarget)])
    : [];

  const picked = weighted([...items, ...crafts], rand);
  if (!picked) return null;
  if (picked.craft) return { craft: picked.craft };
  const { item, n } = picked;
  const count = item.price <= 5 && n >= 2 ? 1 + Math.floor(rand() * Math.min(3, n)) : 1;
  return { key: item.key, count };
}

/**
 * 오늘 할 일. `{ kind, duo, plan }` — kind 는 `talk` · `shop` · `gift` · `cook` · `craft` · `fish`.
 *
 *   me       부른 캐릭터의 계정
 *   partner  `{ account, free }` — free 는 쓰러지지 않았고 판에도 다른 일상에도 없는 것
 *   human    `{ free, crafts }` — 명령한 사람이 선물을 받을 수 있는지(판에 앉아 있지 않은지)와
 *            그 사람이 가진 만든 것 수. 없으면 null
 *   canMake  심사관(제미나이)을 부를 수 있는지. 아니면 요리·제작을 안 한다
 *
 * 둘이 하는 선물·장보기·요리·제작은 **상대 몫**이다. 혼자 하는 선물은 명령한 사람에게 간다.
 * 낚시는 늘 할 수 있다 — 둘이면 상대가 옆에서 구경한다. 하루 낚시(다섯 번)는 일상(세 번)보다 많다.
 */
export function choose({
  character, me, partner = null, human = null, canMake = false, rand = Math.random,
}) {
  const free = Boolean(partner?.free);
  const other = PARTNER[character];
  const make = (kind, forAcct, who) => (canMake && room(forAcct)
    ? planMake(kind, me, { taste: TASTE[who], handy: HANDY[who] }, rand)
    : null);
  const options = {
    talk: { solo: {}, duo: free ? {} : null },
    shop: {
      solo: planShop(me, me, TASTE[character], rand),
      duo: free ? planShop(me, partner.account, TASTE[other], rand) : null,
    },
    gift: {
      solo: human?.free ? planGift(me, { kind: 'human', crafts: human.crafts }, rand) : null,
      duo: free ? planGift(me, { kind: 'npc', account: partner.account }, rand) : null,
    },
    cook: { solo: make('cook', me, character), duo: free ? make('cook', partner.account, other) : null },
    craft: { solo: make('craft', me, character), duo: free ? make('craft', partner.account, other) : null },
    fish: { solo: {}, duo: free ? {} : null },
  };

  /** 누가 다쳤는지 — `[나, 상대]`. 약이나 먹을 것은 다친 쪽 몫이 먼저다. */
  const needs = (kind, o) => {
    if (kind === 'shop') return [Boolean(o.solo?.drink), Boolean(o.duo?.drink)];
    if (kind === 'cook') return [hurt(me), free && hurt(partner.account)];
    return [false, false];
  };

  const weightOf = (kind) => {
    const o = options[kind];
    if (!o.solo && !o.duo) return 0;
    let w = LIKES[character][kind];
    const [mine, theirs] = needs(kind, o);
    if (kind === 'shop' && (mine || theirs)) w *= 3;
    if (kind === 'cook' && ((mine && o.solo) || (theirs && o.duo))) w *= 2;
    if (kind === 'gift' && o.duo && hurt(partner.account) && (isPotion(o.duo.key) || o.duo.craft?.kind === '요리')) w *= 2;
    return w;
  };
  const kind = weighted(Object.keys(options).map((k) => [k, weightOf(k)]), rand);
  const o = options[kind];

  let duo;
  if (o.solo && o.duo) {
    // 한쪽만 다쳤으면 다친 쪽 몫이 먼저다. 나머지는 성격대로 굴린다.
    const [mine, theirs] = needs(kind, o);
    duo = mine !== theirs ? theirs : rand() < DUO[kind];
  } else {
    duo = Boolean(o.duo);
  }
  return { kind, duo, plan: duo ? o.duo : o.solo };
}

export default {
  HURT, KEEP, HUMAN_GIFT_CAP, POTIONS, PARTNER, weighted, planShop, planMake, planGift, choose,
};
