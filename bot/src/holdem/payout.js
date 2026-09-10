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

/**
 * 넘긴 체력을 골드로 바꾸는 값. **체력 1 = 5골드.**
 *
 * 넘긴 체력은 적에게서 뺏은 것이고 적은 지갑이 없다 — 즉 여기서 **골드가 새로 생긴다.**
 * 그래서 값을 짜게 잡았다. 100 에서 시작해 체력 60 짜리를 통째로 뺏어도 300골드로,
 * 던전이 떨구는 골드(20~500)와 비슷한 자리에 머문다.
 */
export const OVER_RATE = 5;

/** 최대치를 넘긴 몫. **판 안에만 있는 숫자다** — 서버는 이걸 모른다. */
export const overOf = (game, id) => Math.max(0, game.gold.get(id) - MAX_HP);

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
 * 다시 걸 수 있고, 나갈 때(끝·도망·교체) `cashOverflow` 가 골드로 바꿔 준다.
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
 * 넘긴 체력을 골드로 바꾼다. **끝·도망·교체 — 판에서 나가는 순간에만.**
 *
 * 서버의 체력은 이미 최대치에 멈춰 있으므로 체력 쓰기는 없다. 골드만 넣고 장부를
 * 최대치로 내린다. `{ ok, gold: { id: 골드 }, rate }`.
 */
export async function cashOverflow(game, ids) {
  expect(game, 'hp');

  const list = ids ?? Object.keys(game.gold.snapshot());
  const gold = {};
  for (const id of list) {
    if (id.startsWith('mob:')) continue;
    const over = overOf(game, id);
    if (over > 0) gold[id] = over * OVER_RATE;
  }
  if (!Object.keys(gold).length) return { ok: true, gold: {}, rate: OVER_RATE };

  const saved = await apply({ deltas: gold });
  if (!saved.ok) return { ok: false, gold, rate: OVER_RATE };

  for (const id of Object.keys(gold)) {
    game.gold.reconcile(id, MAX_HP);
    const seat = game.seats.find((s) => s.id === id);
    if (seat) seat.gold = MAX_HP;
  }
  game.gold.rebase();
  return { ok: true, gold, rate: OVER_RATE, accounts: saved.accounts };
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
 * 던전을 깼다. 떨군 것을 **한 번의 쓰기로** 넣는다 — 아이템·골드·MT·전적이 같이 간다.
 *
 * 체력은 이미 핸드마다 저장돼 있으므로 여기서 안 건드린다.
 */
export const dungeonWon = (id, drops) => apply({
  items: { [id]: drops.items },
  deltas: drops.gold ? { [id]: drops.gold } : {},
  mt: drops.mt ? { [id]: drops.mt } : {},
  bump: { [id]: { dungeonWon: 1 } },
});

/** 던전에서 졌다. 체력은 이미 저장돼 있으므로 전적만. */
export const dungeonLost = (id) => apply({ bump: { [id]: { dungeonLost: 1 } } });

export default { hand, finishTourney, dungeonWon, dungeonLost, cashOverflow, overOf, OVER_RATE };
