/**
 * dayKey — 하루를 나누는 기준 날짜 (KST)
 *
 * 서버가 어느 시간대에서 돌든 **한국 날짜**로 하루를 센다. 출첵과 NPC 일일 충전이
 * 이걸로 판정하므로, 서버 시간대가 바뀌었다고 하루가 두 번 오면 칩이 새로 생긴다.
 *
 * 봇의 `bot/src/pickOfDay.js` 가 오늘의 그림·대사를 고를 때 쓰는 것과 **같은 방식**이다.
 * 두 곳이 다른 날짜를 쓰면 "오늘"의 뜻이 갈라지므로 계산도 똑같이 맞춰 둔다.
 */
const KST = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });

/** 오늘의 `YYYY-MM-DD` (한국 기준). */
const dayKey = (date = new Date()) => KST.format(date);

module.exports = { dayKey };
