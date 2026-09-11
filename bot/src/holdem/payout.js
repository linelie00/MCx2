/**
 * payout — 홀덤이 계정을 건드리는 **유일한 자리**
 *
 * 모드가 셋이 되면서 "언제 무엇을 저장하는가" 가 갈렸다. 그걸 정산 함수 안에
 * `if (mode === …)` 로 흩뿌리면, 앞으로 생길 호출부마다 그 검사를 기억해야 한다.
 * 한 번 잊으면 **체력 100 이 골드 100 으로 조용히 저장된다** — 알아채기까지 오래
 * 걸리는 종류의 사고다.
 *
 * 그래서 쓰는 길을 여기 하나로 모으고, 첫 줄에서 장부의 단위를 본다. 어긋나면
 * **던진다.** 드라이버의 `.catch` 가 찍고 판이 눈에 띄게 멈춘다 — 조용히 틀리는
 * 것보다 낫다(`wallet.js` 의 buyIn 이 이미 같은 주장을 한다).
 *
 * 모드마다 저장하는 때가 다르다.
 *
 *   cash     핸드마다 골드 + 전적. 지금까지 하던 그대로
 *   tourney  핸드마다 **전적만**. 골드는 끝에 한 번 — 그게 "우승자가 판돈을 다 가져간다"
 *   dungeon  핸드마다 **체력**. 전적은 던전 것만. 골드는 한 푼도 안 나간다
 *
 * **던전이 핸드마다 쓰는 이유.** 봇이 재시작하면 진행 중이던 판은 사라진다(메모리에만
 * 있다). 끝에만 쓰면 지고 있을 때 재배포 한 번으로 그 판이 없던 일이 된다.
 */
import { apply } from '../casino/wallet.js';
import { MAX_HP } from '../casino/items.js';
import { one } from '../casino/loot.js';

/**
 * 넘긴 체력을 골드로 바꾸는 값. **체력 1 = 2골드.**
 *
 * 넘긴 체력은 적에게서 뺏은 것이고 적은 지갑이 없다 — 즉 여기서 **골드가 새로 생긴다.**
 * 처음엔 5 였는데 너무 후했다. 이기면 적의 체력을 거의 통째로 넘기게 되니, 전리품 골드
 * (일반 평균 135 · 엘리트 299)에 **그만큼이 한 번 더** 얹혔다(일반 ~225 · 엘리트 ~450).
 * 2 면 일반 ~90 · 엘리트 ~180 으로, 전리품 골드보다 작은 덤이 된다.
 */
export const OVER_RATE = 2;

/**
 * 미겔·마티암의 남은 기운을 아이템으로 바꿀 때의 값어치(체력 1 = 5골드어치).
 * **골드 환산과 따로 둔다** — 골드를 줄이면서 아이템까지 같이 줄일 까닭은 없었다.
 */
const ALLY_ITEM_RATE = 5;

/** 최대치를 넘긴 몫. **판 안에만 있는 숫자다** — 서버는 이걸 모른다. */
export const overOf = (game, id) => Math.max(0, game.gold.get(id) - MAX_HP);

/**
 * 지원군(미겔·마티암)이 넘친 기운으로 오너를 고칠 때, **오너가 잃은 체력의 몇 할까지.**
 * 회복 스킬을 썼다는 설정이다. 다 고쳐 주면 던전에서 다치는 것이 뜻을 잃는다.
 */
export const ALLY_HEAL_SHARE = 0.5;

/** 남은 기운을 아이템으로 바꿀 때 한 번에 주는 개수 상한. */
const ALLY_ITEM_CAP = 5;

/**
 * 남은 기운을 아이템으로. 값이 `value` 골드어치가 될 때까지 전리품 풀에서 뽑는다.
 * 값이 0 인 것도 칸을 차지하도록 적어도 2골드로 센다 — 안 그러면 끝없이 뽑는다.
 *
 * **엘리트 쪽 가중치로 뽑는다**(값의 쏠림이 완만하다). 보통 가중치로 뽑았더니 기운 9 에
 * 나뭇가지·손수건 같은 싼 것이 여덟 개 쏟아졌다 — 같은 값어치라면 적고 괜찮은 것이 낫다.
 */
function lootWorth(value, rand) {
  const got = {};
  let left = value;
  for (let i = 0; i < ALLY_ITEM_CAP && left > 0; i += 1) {
    const item = one(rand, 'elite');
    got[item.key] = (got[item.key] ?? 0) + 1;
    left -= Math.max(item.price, 2);
  }
  return got;
}

/** 장부가 세고 있는 것이 맞는지. 아니면 크게 터뜨린다. */
function expect(game, unit) {
  const got = game.gold?.unit;
  if (got !== unit) {
    throw new Error(`[홀덤] ${game.mode} 판의 장부가 ${got} 인데 ${unit} 으로 보내려 했습니다`);
  }
}

/**
 * 한 핸드가 끝났다. `{ ok, accounts }`.
 *
 * `stats` 는 그 핸드의 전적 카운터(`{ id: {…} }`). 던전은 자기 것만 쓰므로 안 받는다.
 */
export async function hand(game, stats = {}) {
  if (game.mode === 'dungeon') return dungeonHand(game);

  expect(game, 'gold');

  // 토너먼트는 **골드를 안 옮긴다.** 스택은 판 안에서만 오가고, 끝에 한 번 정산한다.
  // 그래서 rebase 도 안 한다 — net() 이 판 시작 대비 누적으로 남아 있어야 한다.
  if (game.mode === 'tourney') return apply({ bump: stats });

  const saved = await apply({ deltas: game.gold.deltas(), bump: stats });
  if (saved.ok) game.gold.rebase();
  return saved;
}

/**
 * 던전 한 핸드. 체력만 쓴다.
 *
 * **서버는 체력을 최대치에서 자른다.** 그래서 장부의 증감을 그대로 보내면 넘긴 몫이
 * 잘려 나가고, 응답으로 장부를 맞추는 순간 **판 안의 스택까지 100 으로 끌려 내려온다** —
 * 애써 뺏은 체력이 핸드마다 사라진다.
 *
 * 그래서 **보내는 것은 최대치까지만**이고, 넘긴 몫은 판 안에만 둔다. 그 몫은 그대로
 * 다시 걸 수 있고, 판이 끝날 때 `settleOverflow` 가 한 번에 정산한다.
 *
 * 보낼 몫은 **서버에 들어 있는 값과 견줘서** 잰다(`game.stored`). 그래야 목표가 늘
 * 0~최대치 안이라 서버가 자를 일이 아예 없다 — 자르지 않으면 어긋날 일도 없다.
 */
async function dungeonHand(game) {
  expect(game, 'hp');

  const stored = (game.stored ??= {});
  const want = game.gold.snapshot();
  const hp = {};
  for (const [id, n] of Object.entries(want)) {
    if (id.startsWith('mob:')) continue;
    // 처음 보는 id 는 지금 값을 기준으로 삼는다. 기준 없이 보내면 남의 체력을 밀어낸다.
    if (stored[id] === undefined) { stored[id] = Math.min(n, MAX_HP); continue; }
    const d = Math.min(n, MAX_HP) - stored[id];
    if (d) hp[id] = d;
  }
  if (!Object.keys(hp).length) return { ok: true, accounts: {} };

  const saved = await apply({ hp });
  if (!saved.ok) return saved;

  for (const id of Object.keys(want)) {
    const got = saved.accounts[id]?.hp;
    if (got === undefined) continue;
    stored[id] = got;
    // 넘긴 몫은 서버가 모르니 응답 위에 그대로 얹는다.
    game.gold.reconcile(id, got + Math.max(0, want[id] - MAX_HP));
  }
  for (const seat of game.seats) {
    if (seat.kind === 'mob') continue;
    seat.gold = game.gold.get(seat.id);
  }
  game.gold.rebase();
  return saved;
}

/**
 * 넘긴 체력을 정산한다. **판이 끝날 때 한 번** — 이기든 도망치든 방치로 닫히든.
 * 교체할 때는 안 한다. 쉬는 동안에도 장부에 남아, 다시 불려 나오면 그대로 걸 수 있다.
 *
 * 누구의 몫이냐에 따라 가는 곳이 다르다.
 *
 *   오너(사람)       골드. 체력 1 = OVER_RATE 골드
 *   미겔·마티암      먼저 **오너를 고친다** — 잃은 체력의 ALLY_HEAL_SHARE 까지(회복 스킬).
 *                    남은 기운은 **그 캐릭터에게 아이템**으로(같은 값어치만큼 전리품에서)
 *
 * **쓰러진 오너는 못 고친다.** 부활은 부활의 영약으로만이다. 그때는 전부 아이템이 된다.
 *
 * 한 번의 쓰기로 골드·오너 체력·아이템이 같이 간다. 서버의 체력은 이미 최대치에 멈춰
 * 있으므로 지원군의 체력은 안 쓴다 — 장부만 최대치로 내린다.
 *
 * `{ ok, gold: { id: 골드 }, heal: [{ from, hp }], items: { id: { 키: 개수 } }, spare: { id: 체력 }, to, rate }`.
 */
export async function settleOverflow(game, { rand = Math.random } = {}) {
  expect(game, 'hp');

  const owner = game.owner;
  const ids = Object.keys(game.gold.snapshot()).filter((id) => !id.startsWith('mob:'));
  const ownerNow = owner ? game.gold.get(owner) : 0;
  // 고쳐 줄 수 있는 몫. 넘친 오너는 잃은 게 없고, 쓰러진 오너는 고칠 수 없다.
  let budget = ownerNow > 0 ? Math.ceil(Math.max(0, MAX_HP - ownerNow) * ALLY_HEAL_SHARE) : 0;

  const gold = {};
  const heal = [];
  const items = {};
  const spare = {};                                   // 아이템이 된 남은 기운(체력)
  for (const id of ids) {
    const over = overOf(game, id);
    if (!over) continue;
    if (!id.startsWith('npc:')) { gold[id] = over * OVER_RATE; continue; }

    const cure = Math.min(over, budget);
    if (cure > 0) { heal.push({ from: id, hp: cure }); budget -= cure; }
    const rest = over - cure;
    if (rest > 0) { items[id] = lootWorth(rest * ALLY_ITEM_RATE, rand); spare[id] = rest; }
  }
  const cured = heal.reduce((a, h) => a + h.hp, 0);
  const summary = { gold, heal, items, spare, to: owner, rate: OVER_RATE };
  if (!Object.keys(gold).length && !cured && !Object.keys(items).length) return { ok: true, ...summary };

  const saved = await apply({
    deltas: gold,
    hp: cured ? { [owner]: cured } : {},
    items,
  });
  if (!saved.ok) return { ok: false, ...summary };

  // 장부를 맞춘다. 넘긴 사람은 최대치로, 고침을 받은 오너는 그만큼 위로.
  for (const id of ids) {
    if (overOf(game, id)) game.gold.reconcile(id, MAX_HP);
  }
  if (cured) {
    game.gold.reconcile(owner, ownerNow + cured);
    if (game.stored) game.stored[owner] = (game.stored[owner] ?? ownerNow) + cured;
  }
  for (const seat of game.seats) {
    if (seat.kind !== 'mob') seat.gold = game.gold.get(seat.id);
  }
  game.gold.rebase();
  return { ok: true, ...summary, accounts: saved.accounts };
}

/**
 * 토너먼트가 끝났다. **한 번에 정산하고 우승자에게 MT 한 개.**
 *
 * `net()` 은 판을 시작할 때와 견준 증감이라, 그대로가 곧 "들고 앉은 것을 우승자가 다"
 * 이다. 그래서 핸드마다 `rebase()` 를 안 했다.
 *
 * 방치로 끝나도 같은 길을 탄다 — 그 시점 스택으로 정산한다. 안 그러면 상금이 통째로
 * 사라진다.
 */
export async function finishTourney(game, winnerId) {
  expect(game, 'gold');
  const saved = await apply({
    deltas: game.gold.net(),
    mt: winnerId ? { [winnerId]: 1 } : {},
  });
  if (saved.ok) game.gold.rebase();
  return saved;
}

/**
 * 던전을 깼다. 떨군 것을 **한 번의 쓰기로** 넣는다 — 아이템·골드·MT·전적·도감이 같이 간다.
 *
 * 체력은 이미 핸드마다 저장돼 있으므로 여기서 안 건드린다.
 *
 *   foe    쓰러뜨린 에너미 이름 — 도감에 "이겼다" 를 적는다(성향이 드러난다)
 *   elite  엘리트였는지 — `엘리트` 칭호
 *   solo   지원군을 한 번도 안 불렀는지 — `솔플` 칭호
 */
export const dungeonWon = (id, drops, { foe = null, elite = false, solo = false } = {}) => apply({
  items: { [id]: drops.items },
  deltas: drops.gold ? { [id]: drops.gold } : {},
  mt: drops.mt ? { [id]: drops.mt } : {},
  bump: {
    [id]: { dungeonWon: 1, ...(elite ? { eliteKill: 1 } : {}), ...(solo ? { soloWon: 1 } : {}) },
  },
  enemies: foe ? { [id]: { [foe]: { won: 1 } } } : {},
});

/**
 * 던전에서 졌다. 체력은 이미 저장돼 있으므로 전적만.
 *
 * `died` 는 **쓰러진 자리**다 — 지원군이 대신 싸우다 쓰러졌으면 주인이 아니라 지원군이
 * 죽은 것이라 `던전 속에 피어난 장미` 도 지원군에게 핀다.
 */
export const dungeonLost = (id, died = id) => apply({
  bump: died === id
    ? { [id]: { dungeonLost: 1, dungeonDied: 1 } }
    : { [id]: { dungeonLost: 1 }, [died]: { dungeonDied: 1 } },
});

/** 에너미를 만났다 — 도감에 이름과 설명이 열린다. 판이 열리자마자 적는다. */
export const metEnemy = (id, foe) => apply({ enemies: { [id]: { [foe]: { met: 1 } } } });

export default {
  hand, finishTourney, dungeonWon, dungeonLost, metEnemy, settleOverflow, overOf, OVER_RATE, ALLY_HEAL_SHARE,
};
