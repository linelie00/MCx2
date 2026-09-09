/**
 * wallet — 칩
 *
 * 지금은 판마다 초기화된다. 판을 열 때 모두에게 START_CHIPS 를 주고, 판이 끝나면 잊는다.
 * 그런데 **나중에 영구 저장으로 바꾸고 다른 게임과도 공유**할 생각이라, 그때 호출부를
 * 안 고쳐도 되도록 이음매를 지금 만들어 둔다.
 *
 * 이음매를 진짜로 만드는 규칙 둘:
 *
 *   1. load 와 commit 은 **오늘부터 async 다.** 지금은 상수와 no-op 이지만, 부르는 쪽이
 *      이미 await 하도록 짜여 있으므로 파일이든 HTTP 든 여기만 바꾸면 된다.
 *   2. commit 은 잔액이 아니라 **증감(delta)** 을 받는다. 서버의 JSON 스토어는 락이 없어서
 *      (yacht/state.js 머리말 참고) 나중에 붙일 때 delta 적용만이 안전하다.
 *
 * 판이 도는 동안은 동기 ledger 만 만진다. 버튼 처리 안에 await 이 끼면 "상태 변경은
 * 동기로" 라는 불변식이 깨지기 때문이다. load 는 판 시작 때 한 번, commit 은 정산 때
 * 한 번 — 둘 다 인터랙션 응답 경로 **밖**(NPC 드라이버 안)에서 부른다.
 */

export const START_CHIPS = 1000;

/**
 * 베팅 단위. 모든 베팅이 이 배수여야 블랙잭 3:2 배당과 서렌더 절반 반환이
 * 정수로 떨어진다 — 지갑이 소수를 안고 영구 저장으로 가면 안 된다.
 */
export const CHIP_UNIT = 50;

/** 올인처럼 임의의 금액을 걸 때, 단위에 맞게 내림한다. */
export const roundToUnit = (amount) => Math.max(0, Math.floor(amount / CHIP_UNIT) * CHIP_UNIT);

/**
 * 판을 시작할 때 잔액을 불러온다.
 *
 * 지금은 누구에게나 START_CHIPS 를 준다. 영구 저장으로 갈 때 이 함수 하나만
 * 실제 읽기로 바꾸면 되고, 부르는 쪽은 이미 await 하고 있다.
 */
export async function load(guildId, userIds) {
  return Object.fromEntries(userIds.map((id) => [id, START_CHIPS]));
}

/**
 * 정산 결과를 남긴다. deltas 는 `{ userId: ±n }`.
 *
 * 지금은 아무것도 안 한다 — 판마다 초기화라 남길 데가 없다.
 * 영구 저장으로 갈 때 여기가 쓰기가 된다.
 */
export async function commit(guildId, deltas) {
  void guildId;
  void deltas;
}

/**
 * 판 안에서 쓰는 동기 장부.
 *
 * 칩은 **걸 때 바로 깎는다.** 정산 때만 깎으면 판 도중의 잔액이 거짓이 되어
 * Double·Split 을 낼 수 있는지 판단이 틀린다(100칩으로 세 번 쪼개진다).
 * 그래서 take 는 걸 때, give 는 정산 때만 부른다.
 */
export function ledger(initial) {
  const chips = { ...initial };
  const start = { ...initial };

  return {
    get: (id) => chips[id] ?? 0,
    has: (id, amount) => (chips[id] ?? 0) >= amount,

    /** 걸었다. 모자라면 false 를 주고 아무것도 안 한다. */
    take(id, amount) {
      if ((chips[id] ?? 0) < amount) return false;
      chips[id] -= amount;
      return true;
    },

    /** 돌려줬다. 정산에서만 부른다. */
    give(id, amount) {
      chips[id] = (chips[id] ?? 0) + amount;
    },

    /** 판을 시작할 때와 견준 증감. commit 에 그대로 넘긴다. */
    deltas() {
      return Object.fromEntries(
        Object.keys(chips).map((id) => [id, chips[id] - (start[id] ?? 0)]),
      );
    },

    snapshot: () => ({ ...chips }),
  };
}

export default { START_CHIPS, CHIP_UNIT, roundToUnit, load, commit, ledger };
