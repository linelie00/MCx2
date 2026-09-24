/**
 * daily/busy — 지금 `/일상` 을 보내는 중인 캐릭터
 *
 * **판과 같은 모양으로 내보낸다**(`{ channelId, mode, seats }`). `casino/tables.js` 의
 * `seatedAt` 이 이것도 판으로 읽어서, 일상 도중인 미겔을 블랙잭에 앉히거나 `/양도` 로 가진
 * 것을 빼 갈 수 없다. 장보기가 골드를 쓰는 사이에 판이 같은 골드를 걸면 잔액이 어긋난다.
 *
 * 한 캐릭터는 한 번에 한 일만 한다. 불려 온 상대도 그동안은 자리가 잡혀 있다(`join`).
 *
 * 인메모리다. 봇이 재시작하면 비지만, 그러면 진행 중이던 일상도 같이 끝난 것이다.
 */
const days = new Set();

/** 하루 한 장면을 연다. 채널은 스레드를 만든 뒤에 바꿔 적는다(`day.channelId = …`). */
export function open(channelId, id) {
  const day = { channelId, mode: 'daily', seats: [{ id, kind: 'npc' }] };
  days.add(day);
  return day;
}

/** 상대를 불렀다. */
export const join = (day, id) => { day.seats.push({ id, kind: 'npc' }); };

/** 끝났다. 몇 번을 불러도 된다. */
export const close = (day) => { days.delete(day); };

/** `seatedAt` 이 판 목록처럼 읽는다. */
export const openGames = () => [...days];

// ---------------------------------------------------------------- 불려 나간 횟수

/**
 * 오늘 상대의 일상에 불려 나간 횟수 — 한국 날짜로 센다. 많이 불려 다닌 날은 쉬고 싶어 한다(`tired`).
 * **인메모리다.** 봇이 재시작하면 다시 센다 — 쉬는 핑계일 뿐이라 서버에 둘 까닭이 없다.
 */
const joins = new Map();
const kstDay = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

export const joinsToday = (id, today = kstDay()) => (joins.get(id)?.day === today ? joins.get(id).n : 0);

/** 불려 나갔다. */
export function noteJoin(id, today = kstDay()) {
  joins.set(id, { day: today, n: joinsToday(id, today) + 1 });
}

/** 쉬고 싶어 하는지 — 오늘 두 번 불려 나갔으면 반쯤, 세 번 넘게면 대개 거절한다. */
export function tired(id, rand = Math.random, today = kstDay()) {
  const n = joinsToday(id, today);
  if (n >= 3) return rand() < 0.75;
  return n >= 2 ? rand() < 0.5 : false;
}

export default { open, join, close, openGames, joinsToday, noteJoin, tired };
