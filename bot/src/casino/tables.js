/**
 * tables — 지금 어느 판에 앉아 있는지
 *
 * 골드가 영구 저장이 되면서 생긴 규칙 하나: **한 계정은 한 번에 한 판에만 앉는다.**
 *
 * 증감을 보내는 방식이라 산수 자체는 순서가 섞여도 맞다. 문제는 **같은 골드를 두 곳에서
 * 건다**는 것이다. #a 블랙잭과 #b 홀덤에 앉아 둘 다 1000을 잃으면 서버는 -2000 을 받아
 * 잔액이 마이너스가 된다. 판마다 자기 장부를 들고 시작하니 서로를 볼 수가 없다.
 *
 * **사람보다 NPC 가 더 잘 걸린다.** 각 게임의 `hasNpc` 는 한 판 안에서만 보므로 두 채널이
 * 각각 미겔을 부를 수 있고, 그렇게 마이너스로 간 계정을 다음 날 일일 충전이 1000으로
 * 올려 준다 — 매일 공짜 골드가 풀에 들어간다.
 *
 * 나중에 `/아이템 양도` 도 이걸 쓴다. 판이 도는 동안 골드는 인메모리 장부에만 있고 서버는
 * 판 시작 시점 잔액을 들고 있어서, 그 사이에 서버 잔액을 건드리면 정산 delta 가 얹히며
 * 없던 골드가 생기거나 사라진다.
 */
import * as blackjack from '../blackjack/state.js';
import * as holdem from '../holdem/state.js';

const GAMES = [
  { name: '블랙잭', mod: blackjack },
  { name: '홀덤', mod: holdem },
];

/**
 * 그 계정이 **다른 채널의** 판에 앉아 있으면 `{ game, channelId }`, 아니면 null.
 *
 * `except` 는 지금 보고 있는 채널이다. 같은 판에 두 번 앉는 것은 각 게임의 `addSeat` 가
 * 이미 막으므로 여기서 또 볼 이유가 없고, 안 빼면 자기 자신 때문에 늘 걸린다.
 */
export function seatedAt(id, { except = null } = {}) {
  for (const { name, mod } of GAMES) {
    for (const game of mod.openGames()) {
      if (game.channelId === except) continue;
      // 모브는 판마다 새로 생기므로 판을 건너 겹칠 일이 없다. id 도 mob:0 처럼
      // 판 안에서만 유일해서, 안 거르면 다른 판의 mob:0 과 헷갈린다.
      if (game.seats.some((s) => s.kind !== 'mob' && s.id === id)) {
        return { game: name, channelId: game.channelId };
      }
    }
  }
  return null;
}

/** 거절 문구. **어디에 앉아 있는지** 알려 줘야 정리하러 갈 수 있다. */
export const seatedMessage = (who, at) =>
  `${who}은(는) 이미 <#${at.channelId}> 의 ${at.game} 판에 앉아 있어요.`
  + ' 골드를 두 판에서 겹쳐 걸 수는 없어요.';

export default { seatedAt, seatedMessage };
