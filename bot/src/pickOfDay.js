/**
 * pickOfDay — "오늘의 ○○" 를 하루 동안 고정해서 뽑는다.
 *
 * 단순히 hash(날짜) % 목록길이 로 하면 목록이 하나만 늘어도 오늘의 항목이 바뀐다.
 * 갤러리는 사진을 올리는 순간 그렇게 되니 곤란하다.
 *
 * 그래서 항목마다 (날짜, id) 해시 점수를 매기고 최고점을 고른다. 항목이 추가돼도
 * 기존 최고점은 대개 유지되므로 하루 중 결과가 거의 흔들리지 않는다.
 */
import crypto from 'node:crypto';

/** KST 기준 YYYY-MM-DD. 서버 시간대와 무관하게 한국 날짜로 하루를 나눈다. */
export function dayKey(date = new Date()) {
  // 'sv-SE' 로케일이 YYYY-MM-DD 형식을 준다.
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(date);
}

const score = (key, id) =>
  crypto.createHash('sha256').update(`${key}:${id}`).digest().readUInt32BE(0);

/**
 * 오늘의 항목 하나. idOf 는 항목의 안정적인 식별자를 뽑는 함수.
 * 식별자가 바뀌면 결과도 바뀌므로, 내용이 아니라 id 를 쓴다.
 */
export function pickOfDay(list, idOf = (x) => x.id, key = dayKey()) {
  if (!list?.length) return null;
  return list.reduce((best, cur) =>
    (score(key, idOf(cur)) > score(key, idOf(best)) ? cur : best));
}

/** 그냥 무작위. /○○ 랜덤 용. */
export function pickRandom(list) {
  if (!list?.length) return null;
  return list[crypto.randomInt(list.length)];
}

export default { dayKey, pickOfDay, pickRandom };
