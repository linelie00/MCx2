/**
 * titles — 칭호 명부
 *
 * **칭호는 저장하지 않는다.** 계정의 전적에서 그때그때 계산해 낸다. 그래서
 * 부여 시점도, 경합도, 마이그레이션도 없고 — 나중에 칭호를 추가하면 이미 조건을
 * 만족한 사람이 **그 자리에서** 갖게 된다. 저장하는 것은 "지금 달고 있는 것" 하나뿐이고,
 * 그것도 이름이 아니라 **키**로 둔다(이름을 고쳐도 달고 있던 게 안 날아가게).
 *
 * 조건은 전부 **누적값이나 최댓값**이라 한 번 얻으면 안 없어진다. "지금 잔액이 0"
 * 같은 조건을 쓰면 달고 있던 칭호가 갑자기 사라지는데, 그건 안 하기로 했다.
 *
 * **여기는 카지노 전용이 아니다.** 계정 레코드를 같이 쓰는 것이면 무엇이든 온다 —
 * 뽑기·요리·상점 칭호도 이 명부에 `when` 하나 적으면 끝이다. 그때는 `when` 이
 * `stats` 말고 `account.items` 를 봐도 되고, 그래서 두 번째 인자로 계정을 통째로 넘긴다.
 */
import { CATEGORIES } from './poker.js';

/** 전적이 비어 있어도 안전하게 읽는다. 처음 보는 계정은 stats 가 통째로 없다. */
const n = (s, k) => Number(s?.[k] ?? 0);

/** 최소 표본을 걸고 재는 비율. 열 판에서 6승은 60% 지만 아무 뜻이 없다. */
const rate = (s, min) => (n(s, 'hands') >= min ? n(s, 'won') / n(s, 'hands') : 0);

/**
 * 명부. 순서가 곧 목록에 보이는 순서다.
 *
 *   key    저장·비교에 쓰는 이름. **바꾸지 않는다** — 달고 있는 사람의 칭호가 날아간다
 *   group  칭호 탭에서 묶어 보여줄 갈래
 *   when   가졌는지. `(stats, account)` 를 받는다
 */
export const TITLES = [
  // ---------------------------------------------------------------- 들른 자
  { key: 'firstStep', name: '첫걸음', group: '들른 자', desc: 'bard 의 문을 열고 들어왔다.', when: (s) => n(s, 'hands') >= 1 },
  { key: 'hundred', name: '백전', group: '들른 자', desc: '백 번을 겨뤘다. 이겼는지는 별개다.', when: (s) => n(s, 'hands') >= 100 },
  { key: 'regular', name: '단골손님', group: '들른 자', desc: '이제 자리를 안 물어봐도 된다.', when: (s) => n(s, 'hands') >= 500 },
  { key: 'allNighter', name: '밤을 새운 자', group: '들른 자', desc: '해가 뜨는 걸 여기서 봤다.', when: (s) => n(s, 'hands') >= 2000 },
  { key: 'fixture', name: 'bard의 터줏대감', group: '들른 자', desc: '미겔보다 이 가게에 오래 있었을지도 모른다.', when: (s) => n(s, 'hands') >= 5000 },

  // ---------------------------------------------------------------- 승부
  { key: 'firstWin', name: '첫 승', group: '승부', desc: '처음으로 칩을 긁어 왔다.', when: (s) => n(s, 'won') >= 1 },
  { key: 'evenHand', name: '반타작', group: '승부', desc: '백 판을 두고도 반은 이겼다.', when: (s) => rate(s, 100) >= 0.5 },
  { key: 'winningHabit', name: '이기는 버릇', group: '승부', desc: '운이라고 하기엔 좀 오래됐다.', when: (s) => rate(s, 200) >= 0.55 },
  { key: 'houseFriend', name: '하우스의 친구', group: '승부', desc: '카지노가 제일 반기는 손님.', when: (s) => n(s, 'hands') >= 100 && n(s, 'won') / n(s, 'hands') < 0.4 },
  { key: 'gambler', name: '승부사', group: '승부', desc: '전부를 걸 수 있는 사람만 전부를 가져간다.', when: (s) => n(s, 'allInWon') >= 1 },

  // ---------------------------------------------------------------- 칩 (NPC 제외)
  { key: 'pocketed', name: '주머니가 두둑한', group: '칩', desc: '미들 자리에 앉아도 되겠다.', npc: false, when: (s) => n(s, 'peak') >= 5000 },
  { key: 'wealthy', name: '만석꾼', group: '칩', desc: '하이 자리 한 스택을 통째로 들고 있다.', npc: false, when: (s) => n(s, 'peak') >= 20000 },
  { key: 'vaultKeeper', name: '금고지기', group: '칩', desc: '이쯤 되면 맡아 두는 쪽이다.', npc: false, when: (s) => n(s, 'peak') >= 100000 },

  // ---------------------------------------------------------------- 자학
  { key: 'tuition', name: '수업료', group: '자학', desc: '천 칩쯤은 배우는 값으로 치자.', when: (s) => n(s, 'lost') >= 1000 },
  { key: 'donor', name: '기부천사', group: '자학', desc: 'bard 의 살림에 크게 보탰다.', when: (s) => n(s, 'lost') >= 10000 },
  { key: 'rockBottom', name: '바닥을 본 자', group: '자학', desc: '그래도 아직 앉아 있다.', when: (s) => n(s, 'lost') >= 50000 },
  { key: 'doubleDown', name: '두 배로 잃다', group: '자학', desc: '딴 것의 두 배를 잃었다. 계산은 맞다.', when: (s) => n(s, 'hands') >= 100 && n(s, 'lost') >= n(s, 'earned') * 2 },
  { key: 'shoved', name: '전부 걸었다가', group: '자학', desc: '가진 것을 전부 걸었다. 이제 가진 것이 없다.', when: (s) => n(s, 'allInLost') >= 1 },
  { key: 'neverLearns', name: '못 배우는 사람', group: '자학', desc: '열 번이면 배울 만도 한데.', when: (s) => n(s, 'allInLost') >= 10 },
  { key: 'smallChange', name: '잔돈', group: '자학', desc: '쉰 판을 했는데 제일 큰 팟이 잔돈이었다.', when: (s) => n(s, 'holdemHands') >= 50 && n(s, 'bestPot') < 500 },
  { key: 'timidHand', name: '소심한 손', group: '자학', desc: '백 판 내내 최소 베팅. 안전한 건 맞다.', when: (s) => n(s, 'blackjackHands') >= 100 && n(s, 'bestBet') <= 100 },

  // ---------------------------------------------------------------- 홀덤
  { key: 'reader', name: '판을 읽는 눈', group: '홀덤', desc: '홀덤만 백 판. 이제 보이는 게 있다.', when: (s) => n(s, 'holdemHands') >= 100 },
  { key: 'bigHand', name: '큰 손', group: '홀덤', desc: '한 판에 오천을 쓸어 왔다.', when: (s) => n(s, 'bestPot') >= 5000 },
  { key: 'sweeper', name: '판을 쓸어 담다', group: '홀덤', desc: '테이블이 통째로 넘어왔다.', when: (s) => n(s, 'bestPot') >= 20000 },
  { key: 'counting', name: '숫자세기', group: '홀덤', desc: '다섯 장이 나란히 이어졌다.', when: (s) => n(s, 'handStraight') >= 1 },
  { key: 'puyo', name: '뿌요뿌요', group: '홀덤', desc: '같은 무늬만 다섯 장. 색이 맞았다.', when: (s) => n(s, 'handFlush') >= 1 },
  { key: 'cozyHouse', name: '아늑한 집', group: '홀덤', desc: '셋과 둘이 한 지붕 아래.', when: (s) => n(s, 'handFullHouse') >= 1 },
  { key: 'fourOwner', name: '네 장의 주인', group: '홀덤', desc: '같은 숫자 네 장. 남은 한 장은 장식이다.', when: (s) => n(s, 'handQuads') >= 1 },
  { key: 'crown', name: '왕관', group: '홀덤', desc: '같은 무늬로 이어진 다섯 장. 평생 몇 번이나 볼까.', when: (s) => n(s, 'handStraightFlush') >= 1 },
  { key: 'beastHeart', name: '야수의 심장', group: '홀덤', desc: '심장이 패보다 컸다.', when: (s) => n(s, 'allInHigh') >= 1 },

  // ---------------------------------------------------------------- 블랙잭
  { key: 'blackjack', name: '블랙잭', group: '블랙잭', desc: '첫 두 장에 21. 딜러도 어쩔 수 없다.', when: (s) => n(s, 'blackjacks') >= 1 },
  { key: 'bjCollector', name: '블랙잭의 수집가', group: '블랙잭', desc: '스물다섯 번이나 그랬다.', when: (s) => n(s, 'blackjacks') >= 25 },
  { key: 'wallOf21', name: '21의 벽', group: '블랙잭', desc: '백 판을 넘겼다. 21은 아직도 멀다.', when: (s) => n(s, 'blackjackHands') >= 100 },
  { key: 'fearless', name: '겁 없는 베팅', group: '블랙잭', desc: '한 손에 천을 걸었다.', when: (s) => n(s, 'bestBet') >= 1000 },
];

export const TITLE_BY_KEY = Object.fromEntries(TITLES.map((t) => [t.key, t]));

/** 명부 전체 수. 수집률 게이지가 이걸 분모로 쓴다. */
export const TOTAL = TITLES.length;

/**
 * 그 계정이 가진 칭호들. 명부 순서를 지킨다.
 *
 * `npc: false` 로 표시된 칭호는 미겔·마티암이 못 받는다 — `/급여` 로 넣은 칩이
 * 최고 잔액을 올려서 칩 계열이 공짜가 되기 때문이다.
 */
export function earned(account, { npc = false } = {}) {
  const stats = account?.stats ?? {};
  return TITLES.filter((t) => (t.npc !== false || !npc) && t.when(stats, account));
}

/**
 * 새로 생긴 칭호만. 정산 뒤 "새 칭호" 알림이 쓴다.
 *
 * **앞은 키 목록, 뒤는 칭호 목록**이다. 판이 도는 동안 들고 있기엔 키가 가볍고,
 * 알림에는 이름과 설명이 필요해서 모양이 다르다.
 */
export function gained(beforeKeys, after) {
  const had = new Set(beforeKeys);
  return after.filter((t) => !had.has(t.key));
}

/**
 * 홀덤 족보 → 카운터 이름. 쇼다운에서 깐 손만 센다.
 *
 * **최댓값이 아니라 족보마다 따로 센다.** 최댓값으로 두면 풀하우스 한 번에 그 아래가
 * 전부 딸려 오는데, 칭호는 "그 족보를 직접 만들어 봤나" 를 묻는 것이라 맞지 않는다.
 * 트리페어 아래(원페어·투페어·트리플)는 쇼다운만 가면 거의 나와서 명부에 없다.
 */
export const HAND_COUNTER = {
  straight: 'handStraight',
  flush: 'handFlush',
  fullHouse: 'handFullHouse',
  quads: 'handQuads',
  straightFlush: 'handStraightFlush',
};

/** 명부에 없는 족보가 생기면 조용히 무시된다 — 카운터 이름이 없을 뿐이다. */
export const counterForHand = (category) => HAND_COUNTER[category] ?? null;

/** 하이카드인지. `야수의 심장` 이 이걸 본다. */
export const isHighCard = (category) => category === CATEGORIES[CATEGORIES.length - 1];

export default { TITLES, TITLE_BY_KEY, TOTAL, earned, gained, counterForHand, isHighCard };
