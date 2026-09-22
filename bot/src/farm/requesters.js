/**
 * farm/requesters — 게시판에 의뢰를 넣는 사람들 (5a)
 *
 * **게시판에서만 나온다.** 미겔·마티암처럼 캐릭터(페르소나 · 웹훅)로 만든 것이 아니다 — 이름 · 말투 ·
 * 한마디만 여기 있다. 서버는 주문마다 정해진 수(`seed`)만 주고, 누가 무슨 말을 하는지는 그 수로
 * 여기서 고른다. 같은 주문은 늘 같은 사람이 같은 말을 한다.
 *
 *   likes  이 작물이면 먼저 나선다(헨젤 — 사과). 좋아하는 작물 주문의 절반은 그 사람이 넣는다
 *   lines  한마디. `({ crop, qty, obj })` 를 받는다 — `obj` 는 목적격 조사까지 붙은 작물 이름
 *   liked  좋아하는 작물일 때의 한마디
 */

/** 받침이 있으면 앞, 없으면 뒤 — `을/를` · `이/가`. 한글이 아니면 뒤. */
export function josa(word, [withB, withoutB]) {
  const ch = String(word ?? '').trim().slice(-1).charCodeAt(0);
  if (ch < 0xac00 || ch > 0xd7a3) return `${word}${withoutB}`;
  return `${word}${(ch - 0xac00) % 28 ? withB : withoutB}`;
}

export const REQUESTERS = [
  {
    key: 'migel',
    name: '미겔',
    emoji: '🎸',
    lines: [
      ({ crop, qty }) => `가게에 ${crop} ${qty}개만 부탁해. 손님들이 자꾸 찾더라고.`,
      ({ obj, qty }) => `오늘 안주로 ${obj} 좀 쓰려고. ${qty}개면 충분해.`,
    ],
  },
  {
    key: 'matiam',
    name: '마티암',
    emoji: '🪡',
    lines: [
      ({ crop, qty }) => `이번 주 스튜에 쓸 윤나는 ${crop} ${qty}개만….`,
      ({ obj, qty }) => `모험단 저녁에 ${obj} 넣고 싶어. ${qty}개, 되도록 좋은 걸로.`,
    ],
  },
  {
    key: 'zeta',
    name: '제타',
    emoji: '⚔️',
    title: '단장',
    lines: [
      ({ obj, qty }) => `단장이 ${obj} ${qty}개 주문한다! 최고로 좋은 것만 가져와라!`,
      ({ crop, qty }) => `원정 식량이다. ${crop} ${qty}개, 기한 안에 반드시 준비한다!`,
      ({ crop, qty }) => `${crop} ${qty}개면 모험단이 사흘은 버틴다! 맡긴다!`,
    ],
  },
  {
    key: 'hansel',
    name: '헨젤',
    emoji: '🧙',
    title: '마녀',
    likes: ['redApple'],
    liked: [
      ({ crop, qty }) => `사과 파이에 넣을 ${crop} ${qty}개가 필요해. 벌레 먹은 거 가져오면 두꺼비로 만든다.`,
      ({ qty }) => `사과. ${qty}개. 빨갛고 반짝이는 걸로. …뭘 봐, 독 안 넣어.`,
    ],
    lines: [
      ({ obj, qty }) => `${obj} ${qty}개 가져와. 약 달이는 데 쓸 거야. 묻지 마.`,
      ({ crop, qty }) => `흥, 또 너야? ${crop} ${qty}개. 빨리 가져와.`,
      ({ crop, qty }) => `${crop} ${qty}개. 사과가 아니라서 기분은 별로지만.`,
    ],
  },
  {
    key: 'seiya',
    name: '세이야',
    emoji: '🎒',
    title: '떠돌이 상인',
    lines: [
      ({ crop, qty }) => `저, 저기… 혹시 ${crop} ${qty}개 구할 수 있을까요…? 다음 마을에 가져가려고요….`,
      ({ obj, qty }) => `실례지만… ${obj} ${qty}개만 사고 싶어요. 값은 제대로 쳐 드릴게요…!`,
      ({ crop, qty }) => `${crop} ${qty}개면… 수레가 덜 허전할 것 같아요. 부탁드려도 될까요…?`,
    ],
  },
  {
    key: 'smith',
    name: '스미스',
    emoji: '🥖',
    title: '빵집 아저씨',
    lines: [
      ({ crop, qty }) => `내일 아침 빵에 넣을 ${crop} ${qty}개가 필요해요. 늘 고마워요!`,
      ({ crop, qty }) => `${crop} ${qty}개면 동네 아이들 간식을 넉넉히 굽겠네요. 부탁드려요.`,
      ({ obj, qty }) => `새 빵을 궁리 중이에요. ${obj} ${qty}개만 나눠 주실래요?`,
    ],
  },
  {
    key: 'tezat',
    name: '테자트',
    emoji: '🗡️',
    title: '도적',
    lines: [
      ({ crop, qty }) => `훗, ${crop} ${qty}개쯤이야 훔칠 수도 있지만… 사, 사는 게 낫겠지? 부탁할게….`,
      ({ obj, qty }) => `이 몸이 ${obj} ${qty}개 원한다! …아, 아니 그러니까 좀 팔아 주면 안 될까요?`,
      ({ crop, qty }) => `${crop} ${qty}개. 값은 두둑이… 아니 적당히… 아무튼 제발요.`,
    ],
  },
  {
    key: 'anonHum',
    name: '익명의 훔',
    emoji: '❔',
    anon: true,
    lines: [
      ({ crop, qty }) => `${crop} ${qty}개 구함. 사례함.`,
      ({ crop, qty }) => `급함. ${crop} ${qty}개.`,
    ],
  },
  {
    key: 'anonElf',
    name: '익명의 엘프',
    emoji: '🍃',
    anon: true,
    lines: [
      ({ obj, qty }) => `숲의 잔치에 쓸 ${obj} ${qty}개 구합니다. 이름은 묻지 말아 주세요.`,
      ({ crop, qty }) => `달이 차기 전에 ${crop} ${qty}개가 필요합니다.`,
    ],
  },
  {
    key: 'anonDwarf',
    name: '익명의 드워프',
    emoji: '⛏️',
    anon: true,
    lines: [
      ({ crop, qty }) => `${crop} ${qty}개! 맥주 안주로 쓸 거다. 누군지는 알 거 없고.`,
      ({ crop, qty }) => `광산에 내려가기 전에 ${crop} ${qty}개. 두말 않는다.`,
    ],
  },
];

export const REQUESTER_BY_KEY = Object.fromEntries(REQUESTERS.map((r) => [r.key, r]));

/** `seed` 에서 수 하나씩 뽑는다(같은 seed 면 늘 같다). */
const part = (seed, k) => Math.floor(seed / (k || 1)) % 1000;

/**
 * 주문 하나의 의뢰인과 한마디 `{ who, line }`. 좋아하는 작물이면 절반은 그 사람이 나선다.
 * `cropName` 은 화면에 적을 작물 이름(사과 → "새빨간 사과").
 */
export function voiceOf(order, cropName) {
  const seed = Number(order.seed) || 0;
  const fans = REQUESTERS.filter((r) => r.likes?.includes(order.crop));
  const who = fans.length && part(seed, 1) % 2 === 0
    ? fans[part(seed, 7) % fans.length]
    : REQUESTERS[part(seed, 13) % REQUESTERS.length];
  const lines = who.likes?.includes(order.crop) && who.liked ? who.liked : who.lines;
  const say = lines[part(seed, 101) % lines.length];
  return { who, line: say({ crop: cropName, qty: order.qty, obj: josa(cropName, ['을', '를']) }) };
}

export default { REQUESTERS, REQUESTER_BY_KEY, voiceOf, josa };
