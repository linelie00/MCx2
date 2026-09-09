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

/** 처음 보는 사람의 잔액. 등록 절차가 없다 — 저장소에 없으면 이 값으로 친다. */
export const START_CHIPS = 1000;

/**
 * 한 판에 들고 앉을 수 있는 최대. 나머지는 계정에 남는다.
 *
 * 잔액 전부를 들고 앉게 두면 블랙잭 All-in **버튼 하나가 평생 모은 돈을 건다.**
 * 홀덤은 제로섬이라 한 핸드에 남의 저금이 통째로 넘어가고, 매일 1000으로 채워지는
 * 미겔은 부자 앞에서 늘 숏스택인데 holdem/ai.js 는 50BB 기준으로 맞춰 놨다.
 *
 * **맡겨 두는 방식(고정 바이인 + 판 끝에 반환)이 아니다.** 판이 정상 종료되지 않는
 * 길이 셋이나 있어서(방치 정리·봇 재시작·재배포) 맡긴 칩이 사라진다. 대신 그냥
 * **덜 들고 앉는다** — 나머지는 계정에서 아예 나가지 않으므로, 20000 가진 사람이
 * 1000을 다 잃으면 -1000 이 얹혀 19000 이 된다. 지금의 증감 모델 그대로다.
 *
 * 대가는 판 안에서 재바이인이 없다는 것. 그게 카지노 테이블이다.
 */
export const TABLE_STACK = 1000;

/** 불러온 잔액을 판에 들고 앉을 만큼으로 줄인다. */
export const buyIn = (balances, cap = TABLE_STACK) => Object.fromEntries(
  Object.entries(balances).map(([id, n]) => [id, Math.min(n, cap)]),
);

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
 *
 * **기준점이 둘이다.** 견주는 곳이 둘인데 묻는 것이 다르기 때문이다.
 *
 *   origin  판을 시작한 시점. 안 움직인다. **화면이 쓴다** — 결산은 "이 판에서
 *           얼마를 벌었나" 이므로 판 내내 누적이어야 한다.
 *   base    마지막으로 서버에 보낸 시점. **commit 이 쓴다** — 정산은 핸드마다
 *           오는데 누적값을 매번 보내면 앞 핸드 몫이 겹쳐 얹힌다.
 *
 * 하나로 두면 반드시 한쪽이 틀린다. 실제로 그렇게 돼 있었고, 그대로 저장을 붙이면
 * 핸드마다 칩이 복제되거나(base 로 안 쓸 때) 결산이 전부 +0 으로 뜬다(origin 으로 안 쓸 때).
 */
export function ledger(initial) {
  const chips = { ...initial };
  const origin = { ...initial };
  let base = { ...initial };

  const diff = (from) => Object.fromEntries(
    Object.keys(chips).map((id) => [id, chips[id] - (from[id] ?? 0)]),
  );

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

    /** 마지막 커밋 이후의 증감. **commit 만 쓴다.** */
    deltas: () => diff(base),

    /** 판을 시작할 때와 견준 증감. **표시만 쓴다**(결산·순위·대사 메모). */
    net: () => diff(origin),

    /**
     * 커밋에 성공했다. 기준점을 지금으로 옮긴다.
     *
     * **실패하면 부르지 않는다.** 그러면 밀린 몫이 base 에 남아 있다가 다음 커밋이
     * 성공할 때 함께 반영된다 — 서버가 잠깐 죽었다 살아나면 저절로 만회된다.
     */
    rebase() { base = { ...chips }; },

    snapshot: () => ({ ...chips }),
  };
}

export default { START_CHIPS, TABLE_STACK, buyIn, CHIP_UNIT, roundToUnit, load, commit, ledger };
