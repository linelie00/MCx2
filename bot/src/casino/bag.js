/**
 * bag — 그 사람이 만든 것(`crafts`)을 자동완성에 보여 주기
 *
 * 명부의 물건은 봇이 다 알지만, `/요리`·`/제작` 이 만든 것은 **서버의 계정에만** 있다.
 * `/사용 이름:` 에서 그걸 고르게 하려면 자동완성이 계정을 읽어야 하는데, 자동완성도
 * 3초 시한을 탄다(`/사용` 머리말).
 *
 * 그래서 **짧게 캐시하고, 늦으면 기다리지 않는다.** 800ms 안에 못 읽으면 명부의 물건만
 * 보여 준다 — 사망 검사와 같은 원칙이다(`alive.js`). 캐시는 만들고·먹고·판 쪽이 비운다.
 */
import { getAccounts } from '../api.js';
import { cached, invalidate } from '../cache.js';
import { GRADE_BY_KEY } from './crafts.js';

const TTL = 30_000;
const WAIT_MS = 800;

const keyOf = (id) => `crafts:${id}`;

/** 그 사람의 만든 것. 못 읽으면 빈 목록. */
export async function craftsFor(id, { wait = WAIT_MS } = {}) {
  const load = cached(keyOf(id), TTL, async () => (await getAccounts([id])).accounts?.[id]?.crafts ?? []);
  // **늦은 실패도 받아 둔다.** 기다리다 포기한 뒤에 조회가 실패하면, 아무도 안 받는
  // 거절이 되어 노드가 프로세스를 죽인다.
  load.catch(() => {});
  let timer;
  const late = new Promise((r) => { timer = setTimeout(() => r(null), wait); });
  try {
    return (await Promise.race([load, late])) ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** 만든 것이 바뀌었다. 다음 자동완성이 서버를 다시 보게 한다. */
export const forgetCrafts = (id) => invalidate(keyOf(id));

/** 한 줄 이름. `🥇 꿀 바른 멧돼지 구이` */
export const craftLabel = (c) => `${GRADE_BY_KEY[c.grade]?.emoji ?? '❔'} ${c.name}`;

/** 자동완성의 값. 명부의 키와 안 겹치게 앞에 붙인다. */
export const CRAFT_VALUE = 'craft:';

export default { craftsFor, forgetCrafts, craftLabel, CRAFT_VALUE };
