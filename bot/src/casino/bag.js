/**
 * bag — 그 사람이 가진 것을 자동완성에 보여 주기
 *
 * `/사용 이름:` 은 내가 만든 요리를, `/요리 재료1:` 은 내가 가진 재료를 먼저 보여 줘야
 * 한다. 둘 다 **서버의 계정에만** 있어서 자동완성이 읽어야 하는데, 자동완성도 3초 시한을
 * 탄다(`/사용` 머리말). 게다가 칠 때마다 불린다.
 *
 * 그래서 **짧게 캐시하고, 늦으면 기다리지 않는다.** 800ms 안에 못 읽으면 "모름" 을 주고,
 * 부르는 쪽이 명부로 물러선다 — 사망 검사와 같은 원칙이다(`alive.js`). 캐시는 만들고·
 * 먹고·사고판 쪽이 비운다(`forgetBag`). 던전 전리품처럼 안 비우는 길은 TTL 이 받쳐 준다.
 */
import { getAccounts } from '../api.js';
import { cached, invalidate } from '../cache.js';
import { GRADE_BY_KEY } from './crafts.js';

const TTL = 15_000;
const WAIT_MS = 800;

const keyOf = (id) => `bag:${id}`;

/** 그 사람의 계정. 제때 못 읽으면 `null`. */
async function accountFor(id, { wait = WAIT_MS } = {}) {
  const load = cached(keyOf(id), TTL, async () => (await getAccounts([id])).accounts?.[id] ?? {});
  // **늦은 실패도 받아 둔다.** 기다리다 포기한 뒤에 조회가 실패하면, 아무도 안 받는
  // 거절이 되어 노드가 프로세스를 죽인다.
  load.catch(() => {});
  let timer;
  const late = new Promise((r) => { timer = setTimeout(() => r(null), wait); });
  try {
    return await Promise.race([load, late]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 그 사람의 계정 통째로(골드·창고·만든 것). **못 읽으면 `null`.** `/양도` 자동완성이 쓴다. */
export const walletFor = (id, opts) => accountFor(id, opts);

/** 그 사람의 만든 것. 못 읽으면 빈 목록. */
export async function craftsFor(id, opts) {
  return (await accountFor(id, opts))?.crafts ?? [];
}

/** 그 사람의 창고 `{ 키: 개수 }`. **못 읽으면 `null`** — 빈 창고와 구분해야 명부로 물러설 수 있다. */
export async function itemsFor(id, opts) {
  const account = await accountFor(id, opts);
  return account ? account.items ?? {} : null;
}

/** 그 사람의 에너미 도감 `{ 이름: { met, won } }`. 못 읽으면 빈 도감. */
export async function enemiesFor(id, opts) {
  return (await accountFor(id, opts))?.enemies ?? {};
}

/** 가진 것이 바뀌었다. 다음 자동완성이 서버를 다시 보게 한다. */
export const forgetBag = (id) => invalidate(keyOf(id));
/** 예전 이름. 만든 것만 바뀌어도 창고와 한 캐시다. */
export const forgetCrafts = forgetBag;

/** 한 줄 이름. `🥇 꿀 바른 멧돼지 구이` */
export const craftLabel = (c) => `${GRADE_BY_KEY[c.grade]?.emoji ?? '❔'} ${c.name}`;

/** 자동완성의 값. 명부의 키와 안 겹치게 앞에 붙인다. */
export const CRAFT_VALUE = 'craft:';

export default { craftsFor, itemsFor, enemiesFor, forgetBag, forgetCrafts, craftLabel, CRAFT_VALUE };
