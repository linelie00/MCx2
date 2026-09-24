/**
 * daily/delve — 미겔·마티암이 버튼 없이 던전을 돈다 (`/일상`)
 *
 * `/홀덤 던전` 과 **같은 판**이다 — 같은 상태 기계(`holdem/state.js`), 같은 판단(`holdem/ai.js` 의
 * `chooseAction` — 지원군으로 싸울 때 이미 쓰는 그것), 같은 체력 판돈·블라인드·상한이다.
 * 사람이 버튼으로 하던 것 셋을 여기서 정한다.
 *
 *   한 수   미겔·마티암은 제 성향대로, 에너미도 제 성향대로(`chooseAction`)
 *   교대    둘이 갔으면, 싸우던 쪽 체력이 바닥나면 쉬던 쪽이 나선다(`state.swapFighter`).
 *           쓰러지면 성격대로 — 이어 싸우거나(`afterFall`) 업고 물러난다
 *   도망    **성격대로** — 마티암은 바닥나면 대개 물러서고, 미겔은 거의 끝까지 싸운다.
 *           그래서 둘 다 **쓰러질 수 있다**
 *
 * 판은 `state.build` 로 **짓기만** 한다 — 채널에 걸지 않는다. 걸면 `/홀덤` 의 방치 청소가
 * 이 판을 주워 마무리를 한 번 더 태운다. 서버(체력 저장·전리품)는 부르는 쪽이 부른다(`daily/run.js`).
 */
import * as state from '../holdem/state.js';
import { chooseAction, readRange } from '../holdem/ai.js';
import { live } from '../holdem/rules.js';
import { DUNGEON } from '../casino/stakes.js';
import { hpOf as mobHp } from '../holdem/mobs.js';

/** 이 체력 아래면 바닥난 것이다 — 도망을 생각한다. */
export const LOW = 15;

/** 바닥났을 때 물러설 확률 — 성격이다(`holdem/ai.js` 의 STYLES 와 같은 결: 마티암 신중 · 미겔 강심장). */
export const FLEE = { migel: 0.1, matiam: 0.8 };

/** 교대할 문턱 — 들어올 때 체력의 이만큼 아래로 떨어지면 쉬던 쪽을 부른다. 바닥(LOW)보다 먼저다. */
export const SWAP_SHARE = 0.35;

/**
 * 같이 온 쪽이 **쓰러졌을 때** 이어 싸울 확률 — 아니면 쓰러진 쪽을 업고 물러난다. 이것도 성격이다.
 * 미겔은 곧잘 복수하러 나서고, 마티암은 대개 데리고 나간다.
 *
 * 둘 다 늘 이어 싸우게 두면 둘이 간 던전의 열에 하나가 **둘 다 쓰러짐**으로 끝났다 — 그러면
 * 서로를 일으킬 수도 없어 두 캐릭터의 일상이 한꺼번에 멈춘다.
 */
export const AVENGE = { migel: 0.5, matiam: 0.15 };

/** 폭주 방지. 블라인드가 오르니 정상적으로는 한참 전에 끝난다 — 그래도 넘기면 물러선다. */
export const MAX_HANDS = 80;

const characterOf = (id) => String(id).replace(/^npc:/, '');
export const fighterOf = (game) => game.seats.find((s) => s.kind !== 'mob');
export const mobOf = (game) => game.seats.find((s) => s.kind === 'mob');

/**
 * 던전을 연다. `{ game }` 또는 `{ error }`.
 *
 * 부른 캐릭터(`owner`)가 먼저 싸운다. 둘이 갔으면 상대는 **쉬는 자리**(`reserves`)에서 시작한다 —
 * `/홀덤 던전` 의 지원군과 같은 자리다. 장부에는 처음부터 둘 다 실린다(나중에는 못 싣는다).
 */
export function open({
  owner, partner = null, hp, partnerHp = 0, mob, rand = Math.random,
}) {
  const game = state.build({
    channelId: `daily:${owner}`, homeChannelId: null, guildId: null, starterId: owner, mode: 'dungeon',
  });
  game.stakes = DUNGEON;
  game.base = DUNGEON;
  game.owner = owner;
  state.addSeat(game, state.npcSeat(characterOf(owner)));
  game.ownerName = game.seats[0].name;
  game.allyUsed = false;
  game.called = [];

  const enemy = state.mobSeat(mob, 0, DUNGEON, rand);
  enemy.elite = mob.elite;
  enemy.buyIn = mobHp(mob);
  state.addSeat(game, enemy);
  game.reserves = partner ? [partner] : [];

  const error = state.start(game, {
    [owner]: hp,
    [enemy.id]: enemy.buyIn,
    ...(partner ? { [partner]: partnerHp } : {}),
  });
  return error ? { error } : { game };
}

/** 상대가 이번 핸드에 얼마나 세게 나왔는지 — `/홀덤` 드라이버의 `opponentReads` 와 같다. */
function reads(game, me) {
  const others = live(game.seats).filter((s) => s !== me);
  if (!others.length) return 1;
  return others.map((s) => readRange((game.hist ?? []).filter((h) => h.id === s.id).map((h) => h.act)));
}

/**
 * 한 핸드를 끝까지 두고 나눈다. `game.results` 를 돌려준다.
 * 핸드는 이미 열려 있어야 한다(`state.start` · `state.nextHand` 가 연다).
 */
export function playHand(game, rand = Math.random) {
  let guard = 0;
  while (!['showdown', 'settled', 'done'].includes(game.phase)) {
    const seat = state.currentSeat(game);
    if (!seat) break;
    const move = chooseAction(seat.style ?? seat.character, {
      hole: seat.hole,
      board: game.board,
      opponents: reads(game, seat),
      toCall: state.toCallFor(game, seat),
      pot: state.pot(game),
      legal: state.actionsFor(game),
      raises: state.raisesFor(game),
      rand,
    });
    // 판단이 못 두는 수를 내면(그럴 일은 없어야 한다) 체크, 안 되면 폴드로 물러선다.
    if (state.act(game, move.action, move.to)) state.act(game, state.actionsFor(game).has('check') ? 'check' : 'fold');
    guard += 1;
    if (guard > 400) throw new Error('[일상] 던전 한 핸드의 베팅이 안 끝난다');
  }
  if (game.phase === 'showdown') state.settle(game);
  return game.results;
}

/**
 * 핸드 사이에 무엇을 할지. `{ step }` — `end`(누군가 쓰러졌다) · `swap`(`to` 가 나선다) ·
 * `flee` · `next`.
 *
 * 교대가 도망보다 먼저다 — 쉬던 쪽이 더 멀쩡하면 물러서지 않고 바꾼다.
 */
export function between(game, rand = Math.random) {
  const f = fighterOf(game);
  const m = mobOf(game);
  if (f.gold <= 0 || m.gold <= 0) return { step: 'end' };
  if (game.handNo >= MAX_HANDS) return { step: 'flee' };

  const low = f.gold <= Math.max(LOW, Math.round((game.cap?.[f.id] ?? f.gold) * SWAP_SHARE));
  const fresh = game.reserves.filter((id) => id !== f.id && game.gold.get(id) > f.gold)
    .sort((a, b) => game.gold.get(b) - game.gold.get(a))[0];
  if (low && fresh) return { step: 'swap', to: fresh };
  if (f.gold <= LOW && rand() < (FLEE[f.character] ?? 0.5)) return { step: 'flee' };
  return { step: 'next' };
}

/**
 * 싸우던 쪽이 쓰러진 직후. `{ step }` — `avenge`(`to` 가 이어 싸운다) · `carry`(`by` 가 업고
 * 물러난다) · `end`(적도 쓰러졌거나 서 있는 쪽이 없다).
 * 이어 싸우려면 체력이 바닥(`LOW`) 위여야 한다 — 바닥난 채로 복수하러 나서지는 않는다.
 */
export function afterFall(game, rand = Math.random) {
  if (mobOf(game).gold <= 0) return { step: 'end' };
  const heir = game.reserves.find((id) => game.gold.get(id) > 0);
  if (!heir) return { step: 'end' };
  if (game.gold.get(heir) > LOW && rand() < (AVENGE[characterOf(heir)] ?? 0.3)) return { step: 'avenge', to: heir };
  return { step: 'carry', by: heir };
}

/** 쉬던 쪽을 내보낸다. 물러난 쪽은 쉬는 자리로 — 다시 부를 수 있다. */
export function swap(game, to) {
  const f = fighterOf(game);
  const from = f.id;
  if (to !== game.owner) {
    game.allyUsed = true;
    if (!game.called.includes(to)) game.called.push(to);
  }
  state.swapFighter(game, f, { ...state.npcSeat(characterOf(to)), kind: 'npc' });
  game.reserves = [...game.reserves.filter((id) => id !== to), from];
  return { from, to };
}

export default {
  LOW, FLEE, SWAP_SHARE, AVENGE, MAX_HANDS, open, playHand, between, afterFall, swap, fighterOf, mobOf,
};
