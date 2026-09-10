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
 * **응답으로 장부를 맞춘다.** 서버가 체력을 0~최대치로 자르므로, 봇이 −30 을 보냈는데
 * 서버가 20에서 0으로 잘랐다면 장부는 −10 을 더 믿는다. 그대로 `rebase()` 하면 그
 * −10 이 굳어 눈덩이가 된다.
 */
async function dungeonHand(game) {
  expect(game, 'hp');

  const saved = await apply({ hp: game.gold.deltas() });
  if (!saved.ok) return saved;

  for (const seat of game.seats) {
    const hp = saved.accounts[seat.id]?.hp;
    if (hp === undefined) continue;
    game.gold.reconcile(seat.id, hp);
    seat.gold = hp;
  }
  game.gold.rebase();
  return saved;
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

export default { hand, finishTourney, dungeonWon, dungeonLost };
