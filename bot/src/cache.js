/**
 * cache — 아주 단순한 TTL 메모리 캐시
 *
 * 갤러리 조회는 572장을 통째로 돌려준다. 명령마다 그걸 다시 받을 이유가 없다.
 * 자동완성은 응답 시한이 3초라 특히 캐시가 필요하다.
 *
 * 프로세스 메모리에만 있고, 재시작하면 비워진다. 그래도 되는 데이터만 담는다.
 */
const store = new Map();

/**
 * key 로 캐시된 값을 주거나, 없으면 load() 를 불러 채운다.
 * 진행 중인 요청은 프라미스째로 담아 두어 동시에 여러 번 부르지 않는다.
 */
export function cached(key, ttlMs, load) {
  const hit = store.get(key);
  if (hit && hit.until > Date.now()) return hit.value;

  const value = Promise.resolve()
    .then(load)
    .catch((err) => {
      // 실패는 캐시하지 않는다. 다음 호출에서 다시 시도해야 한다.
      store.delete(key);
      throw err;
    });

  store.set(key, { value, until: Date.now() + ttlMs });
  return value;
}

/** 쓰기 직후처럼 캐시가 낡았음이 확실할 때. prefix 로 시작하는 항목을 지운다. */
export function invalidate(prefix = '') {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export default { cached, invalidate };
