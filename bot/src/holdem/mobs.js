/**
 * mobs — 홀덤 자리를 채우는 엘리트 에너미들
 *
 * 미겔·마티암과 다르다. **지갑이 없고, 판마다 새로 생기고, 판이 끝나면 사라진다.**
 * 그래서 파산도 저장도 없다 — 앉을 때마다 최소 입장과 한 스택 사이에서 아무렇게나
 * 들고 온다. 「모험 일지 — 에너미 기록」에 있는 엘리트 에너미가 그대로 손님이 된다.
 *
 * **성향은 설명에서 뽑았다.** 그냥 무작위 숫자를 뿌리면 서른다섯이 다 똑같이 느껴진다.
 * 노리는 게 잘 안 맞는 대신 맞으면 크게 아픈 놈(모노스코피)은 좁게 보다가 크게 밀고,
 * 뭐가 튀어나올지 모르는 놈(구덩이)은 허세가 잦다. 판에서 그게 실제로 다르게 보인다.
 *
 * 세 값의 뜻은 `ai.js` 의 STYLES 와 같다. 견줄 곳을 적어 두면 감이 잡힌다.
 *
 *   loose  넓게 보는 정도.  -0.10(아주 좁게) ~ +0.15(아주 넓게).  미겔 0.08 · 마티암 -0.05
 *   bluff  안 좋은데 미는 빈도. 0(안 함) ~ 0.30(자주).            미겔 0.16 · 마티암 0.03
 *   raise  올릴 때 큰 쪽을 고르는 비율. 0.2 ~ 0.8.                 미겔 0.62 · 마티암 0.34
 *
 * `seen` 은 기록의 "처치" 횟수다. 자주 마주친 놈일수록 자주 나오게 뽑기 가중치로 쓴다.
 */

/**
 * 이름 · 처치 · 성향.
 *
 * `note` 는 판에 띄우는 한 줄 소개다. 서른다섯을 다 기억할 사람은 없으니, 어떤 상대인지
 * 정도는 보여 준다.
 */
export const MOBS = [
  { name: '빨간 슬라임', seen: 4, loose: 0.06, bluff: 0.18, raise: 0.50, note: '왜 빨간지는 아무도 모른다' },
  { name: '바란손', seen: 3, loose: 0.00, bluff: 0.05, raise: 0.40, note: '박자를 지킨다' },
  { name: '모노스코피', seen: 3, loose: -0.08, bluff: 0.06, raise: 0.78, note: '어쩌다 맞히면 크게 아프다' },
  { name: '카트로베로', seen: 2, loose: -0.02, bluff: 0.08, raise: 0.55, note: '냄새로 먼저 찾아낸다' },
  { name: '사네롯', seen: 2, loose: 0.10, bluff: 0.10, raise: 0.45, note: '먹을수록 커진다' },
  { name: '듀라한', seen: 2, loose: -0.03, bluff: 0.12, raise: 0.70, note: '손이 날렵하다' },
  { name: '깨끔발', seen: 2, loose: 0.04, bluff: 0.07, raise: 0.22, note: '슬그머니 다가와 허를 찌른다' },
  { name: '큰 국자', seen: 2, loose: 0.14, bluff: 0.24, raise: 0.60, note: '국자라고 우겨서 국자다' },
  { name: '구덩이', seen: 1, loose: 0.12, bluff: 0.30, raise: 0.65, note: '뭐가 뻗어나올지 모른다' },
  { name: '미시시 코라손', seen: 3, loose: 0.11, bluff: 0.22, raise: 0.72, note: '산성 피를 흩뿌린다' },
  { name: '보우', seen: 1, loose: 0.09, bluff: 0.14, raise: 0.48, note: '게르와 늘 함께다' },
  { name: '게르', seen: 1, loose: 0.09, bluff: 0.11, raise: 0.44, note: '보우를 따라다닌다' },
  { name: '테자트', seen: 1, loose: 0.05, bluff: 0.19, raise: 0.68, note: '도적단의 우두머리' },
  { name: '주례', seen: 1, loose: -0.06, bluff: 0.04, raise: 0.52, note: '권위만큼 근육도 빵빵하다' },
  { name: '메탈리스트', seen: 2, loose: -0.05, bluff: 0.09, raise: 0.80, note: '한 방 한 방이 강력하다' },
  { name: '무한의 수', seen: 2, loose: -0.04, bluff: 0.00, raise: 0.42, note: '수치대로만 둔다' },
  { name: '안드로', seen: 3, loose: 0.07, bluff: 0.21, raise: 0.58, note: '아무도 구조를 못 읽는다' },
  { name: '마녀 헨젤', seen: 1, loose: 0.13, bluff: 0.20, raise: 0.46, note: '사과를 좋아한다' },
  { name: '페일레이', seen: 3, loose: 0.08, bluff: 0.15, raise: 0.54, note: '바람 따라 흐른다' },
  { name: '타오라', seen: 2, loose: 0.10, bluff: 0.17, raise: 0.75, note: '끝없이 쏟아진다' },
  { name: '심해고동', seen: 2, loose: 0.03, bluff: 0.26, raise: 0.28, note: '평안한 척 장기를 터뜨린다' },
  { name: '카르바로크', seen: 1, loose: -0.07, bluff: 0.03, raise: 0.50, note: '정확히 발사한다' },
  { name: '아르도라도', seen: 3, loose: 0.06, bluff: 0.16, raise: 0.79, note: '눈이 멀 만큼 번쩍인다' },
  { name: '바케스본본', seen: 2, loose: -0.01, bluff: 0.06, raise: 0.36, note: '크기에 맞춰 잘라 담는다' },
  { name: '라즈카트', seen: 2, loose: 0.15, bluff: 0.13, raise: 0.38, note: '분신끼리 서로 챙긴다' },
  { name: '카르가스크', seen: 2, loose: -0.06, bluff: 0.05, raise: 0.74, note: '한 번 휘두르면 땅이 갈라진다' },
  { name: '티리예', seen: 1, loose: -0.09, bluff: 0.02, raise: 0.66, note: '눌려서 단단해졌다' },
  { name: '헤스페르', seen: 2, loose: -0.10, bluff: 0.01, raise: 0.62, note: '완벽한 것만 고른다' },
  { name: '시드린', seen: 2, loose: 0.08, bluff: 0.10, raise: 0.24, note: '수십 발을 조금씩 날린다' },
  { name: '참회자', seen: 3, loose: -0.04, bluff: 0.04, raise: 0.44, note: '늘 다리부터 자른다' },
  { name: '용사', seen: 2, loose: 0.09, bluff: 0.23, raise: 0.76, note: '망설임이 없다' },
  { name: '코베르트', seen: 1, loose: 0.00, bluff: 0.08, raise: 0.48, note: '고대부터 목격됐다' },
  { name: '모르니야', seen: 2, loose: 0.07, bluff: 0.12, raise: 0.77, note: '그대로 돌격한다' },
  { name: '프레젠', seen: 1, loose: 0.12, bluff: 0.29, raise: 0.56, note: '실체가 없다는 말도 있다' },
  { name: '베깃앵거', seen: 2, loose: 0.05, bluff: 0.25, raise: 0.34, note: '소리가 없어 어디 있는지 모른다' },
];

/**
 * **일반 에너미.** 엘리트와 같은 모양이되 훨씬 약하다.
 *
 * 약한 것을 어떻게 만드나 — `loose` 를 크게 준다. `ai.js:235` 의 `edge` 는
 * `strength - odds + loose` 라, 이 값이 크면 **승산이 없는데도 콜한다.** 포커에서
 * 돈을 잃는 제일 흔한 길이 그것이고, 그래서 넓게 보는 놈일수록 실제로 약하다.
 * 엘리트는 -0.10~+0.15 사이에 있고, 여기는 0.14~0.35 다.
 *
 * 체력도 낮다(`hpOf`). 엘리트가 60~120 인 데 비해 30~60 이다.
 */
export const NORMALS = [
  { name: '리톨',       seen: 23, loose: 0.22, bluff: 0.20, raise: 0.55, note: '몸집은 작아도 손이 맵다' },
  { name: '챠콜페더',     seen: 14, loose: 0.24, bluff: 0.16, raise: 0.45, note: '검은 자국을 남기며 난다' },
  { name: '슬라임',      seen: 30, loose: 0.30, bluff: 0.05, raise: 0.25, note: '느리게, 그러나 끝까지 온다' },
  { name: '올리앤더',     seen: 16, loose: 0.18, bluff: 0.24, raise: 0.40, note: '하얀 나무인 척하다 꽃을 편다' },
  { name: '씩씩거리는 사슴', seen: 19, loose: 0.26, bluff: 0.14, raise: 0.60, note: '영역을 침범당해 화가 났다' },
  { name: '사악한 까마귀',  seen: 12, loose: 0.20, bluff: 0.22, raise: 0.50, note: '부리가 칼끝 같다' },
  { name: '플립플랍',     seen: 14, loose: 0.25, bluff: 0.28, raise: 0.42, note: '뒤집기 전에는 아무것도 모른다' },
  { name: '라우트',      seen: 20, loose: 0.19, bluff: 0.18, raise: 0.66, note: '빛 사이에 숨었다가 그대로 벤다' },
  { name: '송송충',      seen: 12, loose: 0.21, bluff: 0.30, raise: 0.38, note: '나뭇가지인 줄 알고 집으면 늦다' },
  { name: '스위치',      seen: 28, loose: 0.28, bluff: 0.10, raise: 0.75, note: '꼬리가 딸깍이면 도망쳐야 한다' },
  { name: '미친갈매기',    seen: 14, loose: 0.35, bluff: 0.32, raise: 0.55, note: '마물도 아니고 그냥 미쳤다' },
  { name: '티프 도라',    seen:  5, loose: 0.22, bluff: 0.08, raise: 0.48, note: '도적단이 기른 개. 복슬복슬하다' },
  { name: '도적단 용병',   seen:  2, loose: 0.24, bluff: 0.12, raise: 0.62, note: '머리보다 팔을 쓴다' },
  { name: '티프 디라',    seen:  2, loose: 0.23, bluff: 0.09, raise: 0.50, note: '도라와 같은 곳에서 자랐다' },
  { name: '도적단 걸',    seen:  3, loose: 0.20, bluff: 0.20, raise: 0.44, note: '아마도 도적단원이다' },
  { name: '알리아네트',    seen: 14, loose: 0.27, bluff: 0.02, raise: 0.30, note: '사람이 오면 새빨개져서 티가 난다' },
  { name: '도적단 보이',   seen:  1, loose: 0.26, bluff: 0.16, raise: 0.40, note: '아마도 도적단원이다' },
  { name: '보우와 게르',   seen:  1, loose: 0.32, bluff: 0.05, raise: 0.22, note: '다쳐서 둘 다 약해졌다' },
  { name: '세시',       seen:  4, loose: 0.19, bluff: 0.14, raise: 0.52, note: '호수에서 낚시꾼을 기다린다' },
  { name: '하늘걸이',     seen: 18, loose: 0.17, bluff: 0.10, raise: 0.36, note: '다리가 길어 늪에 안 빠진다' },
  { name: '굶주린 매',    seen: 10, loose: 0.28, bluff: 0.18, raise: 0.58, note: '눈부터 노린다' },
  { name: '작은 마녀',    seen:  4, loose: 0.20, bluff: 0.26, raise: 0.46, note: '마녀를 축소해 놓은 것 같다' },
  { name: '차가운 손가락',  seen:  9, loose: 0.22, bluff: 0.15, raise: 0.40, note: '닿은 자리가 오래 시리다' },
  { name: '빨간 혼령',    seen:  3, loose: 0.24, bluff: 0.27, raise: 0.44, note: '마녀가 불러낸 것' },
  { name: '호문쿨루스',    seen:  3, loose: 0.26, bluff: 0.20, raise: 0.48, note: '이제 유리병은 필요 없다' },
  { name: '우드 가디언',   seen:  1, loose: 0.15, bluff: 0.06, raise: 0.30, note: '나무껍질 외피가 아주 단단하다' },
  { name: '고리뱀',      seen:  2, loose: 0.21, bluff: 0.16, raise: 0.64, note: '고리가 되어 굴러온다. 독이 있다' },
  { name: '사과 벌레',    seen:  3, loose: 0.23, bluff: 0.30, raise: 0.35, note: '사과인 줄 알았을 것이다' },
  { name: '글라스와커',    seen:  6, loose: 0.29, bluff: 0.12, raise: 0.54, note: '눈이 멀어 소리와 냄새로 찾는다' },
  { name: '앙골라',      seen: 27, loose: 0.18, bluff: 0.22, raise: 0.50, note: '그늘 아래를 지나면 옹이가 열린다' },
  { name: '뱀부',       seen: 16, loose: 0.25, bluff: 0.10, raise: 0.32, note: '나무 마물이라는데 아무래도 풀이다' },
  { name: '푸석초록',     seen: 24, loose: 0.30, bluff: 0.14, raise: 0.36, note: '제가 만든 바람에 굴러다닌다' },
  { name: '트렌트의 가지',  seen: 11, loose: 0.20, bluff: 0.24, raise: 0.56, note: '가지치고는 너무 빨리 자란다' },
  { name: '리빙 아머',    seen:  2, loose: 0.16, bluff: 0.18, raise: 0.42, note: '안에 있는 무언가가 움직인다' },
  { name: '운디네',      seen:  6, loose: 0.27, bluff: 0.08, raise: 0.38, note: '온순하다더니 오늘은 아니다' },
  { name: '물 고릴라',    seen: 10, loose: 0.24, bluff: 0.20, raise: 0.60, note: '물속에서 고릴라가 사는 데는 방법이 있다' },
  { name: '마계 병사',    seen:  9, loose: 0.31, bluff: 0.16, raise: 0.68, note: '필사적이다' },
  { name: '공격 인형',    seen:  3, loose: 0.22, bluff: 0.14, raise: 0.70, note: '괴물을 견제하려고 만들어졌다' },
  { name: '방어 인형',    seen:  2, loose: 0.14, bluff: 0.04, raise: 0.24, note: '버티는 것이 일이다' },
  { name: '저격 인형',    seen:  3, loose: 0.17, bluff: 0.10, raise: 0.66, note: '멀리서 한 번에 끝낸다' },
];

/** 뽑기 가중치. 자주 마주친 놈이 자주 나온다. */
const WEIGHT = MOBS.map((m) => m.seen);
const TOTAL = WEIGHT.reduce((a, b) => a + b, 0);

/** 가중치대로 하나. 이미 뽑힌 이름은 건너뛴다 — 한 판에 같은 놈이 둘이면 이상하다. */
function pickOne(taken, rand) {
  const pool = MOBS.filter((m) => !taken.has(m.name));
  if (!pool.length) return null;
  const total = pool.reduce((a, m) => a + m.seen, 0);
  let n = rand() * total;
  for (const m of pool) {
    n -= m.seen;
    if (n <= 0) return m;
  }
  return pool[pool.length - 1];
}

/**
 * 던전에서 마주치는 확률. **다섯에 한 번은 엘리트다.**
 *
 * 낮게 잡은 이유는 엘리트가 두껍고(최대 120) 잘 두기 때문이다 — 자주 나오면 던전이
 * 늘 길고 험한 곳이 된다. 가끔 나와야 만났을 때 무섭다.
 */
export const ELITE_CHANCE = 0.2;

/** 그 에너미의 체력. 엘리트는 두껍다. 자주 마주친 놈일수록 조금 더 두껍다. */
export const hpOf = (e) => (e.elite
  ? Math.max(60, Math.min(120, 60 + e.seen * 10))
  : Math.max(30, Math.min(60, 30 + e.seen)));

/**
 * 던전에 나올 한 마리. `{ …에너미, elite }`.
 *
 * 먼저 등급을 뽑고 그 안에서 가중치대로 고른다. 둘을 한 통에 넣고 뽑으면 수가 많은
 * 쪽(일반 40종)이 등급 확률을 삼켜 버린다.
 */
export function drawEnemy(rand = Math.random) {
  const elite = rand() < ELITE_CHANCE;
  const pool = elite ? MOBS : NORMALS;
  const total = pool.reduce((a, m) => a + m.seen, 0);
  let n = rand() * total;
  for (const m of pool) {
    n -= m.seen;
    if (n <= 0) return { ...m, elite };
  }
  return { ...pool[pool.length - 1], elite };
}

/** 서로 다른 에너미 `count` 마리. 가중치대로 뽑는다. **현금 판의 `모브:` 는 엘리트다.** */
export function drawMobs(count, rand = Math.random) {
  const taken = new Set();
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const m = pickOne(taken, rand);
    if (!m) break;
    taken.add(m.name);
    out.push(m);
  }
  return out;
}

export default { MOBS, NORMALS, drawMobs, drawEnemy, hpOf, ELITE_CHANCE, TOTAL };
