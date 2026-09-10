/**
 * wallet — 칩
 *
 * 칩은 **서버에 영구 저장된다.** 세 게임이 한 잔액을 나눠 쓰고, 판이 끝나도 남는다.
 * 저장소는 사이트 서버의 `/api/accounts` 다 — 봇 서비스에는 볼륨이 없어서 봇이 직접
 * 파일에 쓸 데가 없고, 있더라도 재배포마다 날아간다.
 *
 * 규칙 둘이 이 파일의 모양을 정한다.
 *
 *   1. **잔액이 아니라 증감(delta)을 보낸다.** 서버의 JSON 스토어에는 락이 없다.
 *      잔액을 통째로 보내면 두 판이 동시에 정산할 때 나중 것이 앞의 것을 지운다.
 *      증감은 더하기라 순서가 섞여도 결과가 같다.
 *   2. **load 는 던지고 commit 은 안 던진다.** 잔액을 못 읽었는데 진행하면 칩이
 *      복제되므로 판을 열면 안 되고, 못 썼을 때는 인메모리 장부에서만 움직인 것이라
 *      판을 막을 이유가 없다. 밀린 몫은 다음 커밋이 만회한다(ledger.rebase 참고).
 *
 * 판이 도는 동안은 동기 ledger 만 만진다. 버튼 처리 안에 await 이 끼면 "상태 변경은
 * 동기로" 라는 불변식이 깨지기 때문이다.
 *
 * **주의 — `load` 는 인터랙션 3초 시한 안에 있다.** 시작 버튼을 누른 그 인터랙션에서
 * 부른다. 그래서 부르는 쪽이 `deferUpdate()` 로 **먼저 응답을 잡아 두고** 불러야 한다.
 * 상수를 돌려주던 동안에는 티가 안 났지만, HTTP 가 들어간 지금은 콜드 스타트 한 번에
 * 클릭이 통째로 날아간다(10062). `commit` 은 드라이버 안이라 시한과 무관하다.
 */
import { getAccounts, postAccountDeltas } from '../api.js';

/** 처음 보는 사람의 잔액. 등록 절차가 없다 — 저장소에 없으면 이 값으로 친다. */
export const START_CHIPS = 1000;

/**
 * 저장되는 계정인지. `mob:` 으로 시작하는 자리는 **지갑이 없다.**
 *
 * 모브(엘리트 에너미)는 판마다 새로 생기고 판이 끝나면 사라진다. 서버에 보내면
 * 계정 파일이 한 번 쓰고 버릴 id 로 영영 불어난다.
 */
export const isPersistent = (id) => typeof id === 'string' && !id.startsWith('mob:');

/**
 * 불러온 잔액을 **한 판에 들고 앉을 만큼**으로 줄인다. `cap` 은 그 자리의 등급이
 * 정한다(`casino/stakes.js` 의 `stack`).
 *
 * 잔액 전부를 들고 앉게 두면 블랙잭 All-in **버튼 하나가 평생 모은 돈을 건다.**
 * 홀덤은 제로섬이라 한 핸드에 남의 저금이 통째로 넘어가고, 매일 1000까지만 채워지는
 * 미겔은 부자 앞에서 늘 숏스택인데 holdem/ai.js 는 50BB 기준으로 맞춰 놨다.
 *
 * **맡겨 두는 방식(고정 바이인 + 판 끝에 반환)이 아니다.** 판이 정상 종료되지 않는
 * 길이 셋이나 있어서(방치 정리·봇 재시작·재배포) 맡긴 칩이 사라진다. 대신 그냥
 * **덜 들고 앉는다** — 나머지는 계정에서 아예 나가지 않으므로, 20000 가진 사람이
 * 한 스택을 다 잃으면 그 몫만 얹힌다. 지금의 증감 모델 그대로다.
 *
 * 대가는 판 안에서 재바이인이 없다는 것. 그게 카지노 테이블이다.
 */
export function buyIn(balances, cap) {
  // 상한을 빠뜨리면 Math.min 이 조용히 NaN 을 만들고, 그 NaN 이 장부를 거쳐 증감으로
  // 나간다. 서버가 정수가 아니라고 막아 주긴 하지만 그건 마지막 그물이다 — 돈을
  // 다루는 자리에서는 여기서 크게 터지는 편이 낫다.
  if (!Number.isFinite(cap)) throw new Error(`buyIn: 상한이 없습니다 (${cap})`);
  return Object.fromEntries(Object.entries(balances).map(([id, n]) => [id, Math.min(n, cap)]));
}

/**
 * 올인처럼 임의의 금액을 걸 때, **그 자리의 단위**에 맞게 내림한다.
 *
 * 단위는 자리마다 다르다(`casino/stakes.js` 의 `unit`). 모든 베팅이 그 배수여야
 * 블랙잭 3:2 배당과 서렌더 절반 반환이 정수로 떨어진다 — 지갑이 소수를 안고
 * 영구 저장으로 가면 안 된다.
 */
export const roundToUnit = (amount, unit) => Math.max(0, Math.floor(amount / unit) * unit);

/**
 * 판을 시작할 때 잔액을 불러온다.
 *
 * **실패하면 던진다.** 부르는 쪽은 그걸 받아 **판을 안 여는 것**이 맞다.
 * 못 읽었다고 START_CHIPS 로 진행하면 칩이 복제된다 — 실제 잔액이 200인 사람이
 * 1000으로 놀고, 나중에 커밋이 성공하면 그 차액이 그대로 서버에 얹힌다.
 *
 * **아무것도 쓰지 않는다.** 한동안 여기서 미겔·마티암을 자동으로 채웠는데, 지금은
 * 사람이 `/급여` 로 일당을 줄 때만 늘어난다 — 일해서 번 돈이라는 설정이라 시간이
 * 주는 것이 아니라 누가 줘야 하는 것이다.
 *
 * 길드는 안 본다 — 계정은 디스코드 유저 하나에 하나다.
 */
export async function load(guildId, userIds) {
  const { accounts } = await getAccounts(userIds);
  return Object.fromEntries(userIds.map((id) => [id, accounts?.[id]?.chips ?? START_CHIPS]));
}

/**
 * 정산 결과를 남긴다. deltas 는 `{ id: ±n }`. **성공 여부를 돌려준다.**
 *
 * 던지지 않는 이유는 저장이 판을 막을 이유가 아니어서다 — 대사가 그렇듯 있으면 좋은
 * 것이다. 실패하면 부르는 쪽이 판에 "저장 안 됨" 을 띄우고 계속 돈다. 칩은 인메모리
 * 장부에서만 움직였으므로 그 핸드가 없던 일이 될 뿐이고, `ledger.rebase` 를 안 하니
 * 밀린 몫은 다음 커밋이 성공할 때 함께 반영된다.
 *
 * 0인 증감과 **지갑 없는 자리(모브)** 는 빼고 보낸다. 앉기만 하고 아무 일 없던
 * 계정에 updatedAt 을 찍을 이유가 없고, 모브는 애초에 서버가 몰라야 한다.
 *
 * `bump` 는 그 핸드의 전적 카운터다. **칩과 같은 한 번의 쓰기로 나간다** — 따로 보내면
 * 칩만 저장되고 전적은 빠지는 어긋남이 생긴다.
 */
export async function commit(guildId, deltas, bump = {}) {
  const moved = Object.fromEntries(
    Object.entries(deltas).filter(([id, n]) => n !== 0 && isPersistent(id)),
  );
  if (!Object.keys(moved).length) return true;

  // 전적은 **칩이 움직인 자리 것만** 보낸다. 서버가 deltas 에 없는 id 를 거절하고,
  // 애초에 칩이 안 움직였으면 그 사람이 그 핸드에 낸 것도 없다.
  const counters = Object.fromEntries(
    Object.entries(bump).filter(([id, c]) => moved[id] !== undefined && Object.keys(c).length),
  );

  try {
    await postAccountDeltas(moved, counters);
    return true;
  } catch (err) {
    console.warn('[카지노] 칩 저장 실패 — 다음 정산에서 다시 시도합니다:', err.message);
    return false;
  }
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

export default { START_CHIPS, isPersistent, buyIn, roundToUnit, load, commit, ledger };
