/**
 * ai — NPC 가 무엇을 남기고 어디에 적을지 정한다
 *
 * 남길 조합 32가지를 각각 여러 번 굴려 보고(몬테카를로) 가장 좋아 보이는 것을 고른다.
 * 두 사람은 **같은 시뮬레이션 결과를 다르게 읽는다.**
 *
 *   미겔 (강심장)  결과 분포를 좋은 쪽으로 기울여 읽고, 한 번 더 굴리는 걸 좋아한다.
 *                  0점을 버려야 해도 요트 칸만은 끝까지 비워 둔다.
 *   마티암 (신중)  나쁜 쪽으로 기울여 읽고, 만들어진 것을 쥐고 있는다.
 *                  상단 보너스를 챙기고, 버릴 때는 잃을 게 가장 적은 칸부터 버린다.
 *
 * 시뮬레이터로 측정한 결과(각 120판, 실제 판과 같은 TRIALS=200):
 *
 *            평균   보너스   턴당 고정
 *   미겔      144     3%       2.3
 *   마티암    145    17%       3.0
 *
 * 점수는 일부러 비슷하게 맞췄다 — 한쪽이 늘 이기면 같이 놀 맛이 없다. 대신
 * **보너스 성공률과 턴당 고정 개수**가 갈린다. 사람이 알아채는 건 평균이 아니라 이쪽이다.
 * (아무것도 안 쥐고 최고점 칸에 적는 단순한 기준선이 평균 100점이니, 둘 다 그보다 잘 둔다.)
 *
 * 값을 만질 거라면 scripts/simulate-yacht.mjs 로 재 보면 된다. 특히 rerollBias 는
 * 세게 주면(±0.9) 마티암이 아예 안 굴려서 점수가 100점대로 무너진다.
 *
 * 이 파일도 디스코드를 모른다. 순수 함수라 시뮬레이터로 검증한다.
 */
import {
  CATEGORY_KEYS, DICE_COUNT, ROUNDS, categoryOf, scoreFor, openCategories,
  totals, bonusLost, reroll,
} from './rules.js';

/** 시뮬레이션 전용 RNG. 한 번 판단에 수만 번 굴리므로 crypto 를 쓰지 않는다. */
const fastRand = () => 1 + Math.floor(Math.random() * 6);

/**
 * 남길 조합을 몇 번씩 굴려 볼지. 늘리면 판단이 안정되지만 느려진다.
 * 시뮬레이터는 수천 판을 돌리므로 YACHT_TRIALS 로 낮춰 쓴다.
 */
const TRIALS = Number(process.env.YACHT_TRIALS) || 200;

export const STYLES = {
  migel: {
    name: '미겔',
    // 좋은 쪽 꼬리로 기울인다 — 한 방을 노린다.
    risk: 0.75,
    // 굴리는 걸 좋아한다. 다시 굴릴 주사위 하나당 가산점.
    rerollBias: 0.4,
    // 상단 보너스에 관심이 없다.
    bonusPace: 0,
    // 0점을 크게 두려워하지 않는다.
    zeroPenalty: -2,
    // 같은 점수면 폼 나는 쪽(야찌·큰 스트레이트)을 고른다.
    flair: 6,
    // 0점을 버려야 할 때, 이 라운드 전에는 요트 칸만은 안 버린다.
    // 꿈을 오래 붙들고 있는 게 보는 사람 눈에 띈다.
    keepYachtUntil: 11,
    dumpCheapest: false,
    // 변덕이 조금 있다 — 값이 이만큼 안에서 비슷하면 아무거나 고른다.
    topN: 3,
    holdSlack: 1.5,
    commitSlack: 3,
  },
  matiam: {
    name: '마티암',
    // 나쁜 쪽으로 기울인다 — 최악을 줄인다.
    risk: -0.65,
    // 이미 만들어진 것을 쥐고 있고 싶어 한다.
    rerollBias: -0.2,
    bonusPace: 4.0,
    zeroPenalty: -18,
    flair: 0,
    keepYachtUntil: 0,
    // 0점을 버려야 하면 잃을 게 가장 적은 칸부터 버린다.
    dumpCheapest: true,
    // 거의 안 흔들린다.
    topN: 2,
    holdSlack: 0.5,
    commitSlack: 1,
  },
};

/**
 * 칸마다 "이 정도면 본전"인 점수.
 *
 * 이게 없으면 판단이 전혀 안 된다. 칸 값을 점수 그대로 보면 Choice 가 항상 열려 있고
 * 늘 20점쯤 나오기 때문에, 어떤 주사위를 남기든 "최선은 20점"으로 똑같이 평가된다.
 * 실제로 그렇게 만들었다가 평균 90점짜리 봇이 나왔다 — 남길 조합 사이에 기울기가
 * 아예 없었던 것이다.
 *
 * 그래서 점수가 아니라 **본전 대비 초과분**으로 평가한다. 상단은 눈금당 3개(=63점,
 * 보너스 경계)를 본전으로 두면 4개째부터 자동으로 보상이 붙는다.
 */
const PAR = {
  aces: 3, deuces: 6, threes: 9, fours: 12, fives: 15, sixes: 18,
  choice: 22, fourKind: 13, fullHouse: 16, sStraight: 10, lStraight: 10, yacht: 5,
};

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * 시뮬레이션 결과 분포를 성향에 맞는 한 숫자로 줄인다. 여기가 두 사람이 갈리는 지점이다.
 *
 * 꼬리만 보면(상위 25% 평균 같은 식) 안 된다. 실제로 그렇게 만들었더니, 남은 칸이 전부
 * 어려운 후반에 **어떤 조합을 쥐어도 값이 똑같이 바닥**이라 마티암이 아무것도 안 쥐고
 * 굴리는 판이 나왔다. 성공이 드문 구간에서는 꼬리에 정보가 없다.
 *
 * 그래서 평균을 기준으로 두고 꼬리 쪽으로 **기울이기만** 한다.
 *   risk > 0  좋은 쪽 꼬리로 — 한 방을 노린다 (미겔)
 *   risk < 0  나쁜 쪽 꼬리로 — 최악을 줄인다 (마티암)
 * 평균이 뼈대라 판단력은 유지되고, 기울기만큼 성향이 드러난다.
 */
function aggregate(values, style) {
  const v = [...values].sort((a, b) => a - b);
  const m = mean(v);
  if (!style.risk) return m;

  const cut = Math.max(1, Math.ceil(v.length * 0.25));
  const tail = style.risk > 0
    ? mean(v.slice(v.length - cut))
    : mean(v.slice(0, cut));
  return m + Math.abs(style.risk) * (tail - m);
}

/**
 * 이 눈을 그 칸에 적으면 얼마나 좋은가. 점수 자체에 성향 보정을 얹은 값이다.
 * 실제 점수가 아니라 판단용 값이므로 밖으로 내보내지 않는다.
 */
function placementValue(key, score, sheet, style, forCommit = true) {
  const cat = categoryOf(key);
  let v = score - PAR[key];

  // 보너스가 아직 살아 있을 때만 상단 진행을 따로 쳐 준다. 이미 받았거나 물 건너갔으면
  // 상단은 그냥 점수일 뿐이다. face 로 자동 스케일되므로 칸마다 손볼 필요가 없다.
  if (cat.section === 'upper' && style.bonusPace) {
    const t = totals(sheet);
    if (t.bonus === 0 && !bonusLost(sheet)) {
      v += style.bonusPace * (score - 3 * cat.face);
    }
  }

  // 0점 벌점은 "이 칸에 적을까" 를 정할 때만 의미가 있다. 남길 주사위를 고를 때 넣으면
  // 후반에 모든 조합의 값을 똑같이 바닥으로 눌러 버려 판단이 사라진다.
  if (forCommit && score === 0) v += style.zeroPenalty;
  if (style.flair && score > 0 && (key === 'yacht' || key === 'lStraight')) v += style.flair;

  return v;
}

/** 지금 눈으로 얻을 수 있는 최선의 값. 시뮬레이션의 평가 함수다. */
function handValue(dice, sheet, style) {
  let best = -Infinity;
  for (const key of openCategories(sheet)) {
    const v = placementValue(key, scoreFor(key, dice), sheet, style, false);
    if (v > best) best = v;
  }
  return best === -Infinity ? 0 : best;
}

/**
 * 시뮬레이션 안쪽에서 쓰는 값싼 정책.
 * 바깥 한 겹만 32가지를 다 따져 보고, 그 뒤 굴림은 "가장 많은 눈을 쥔다" 정도로 근사한다.
 * 안쪽까지 전부 따지면 32^n 이 되는데 그만한 정확도가 필요하지 않다.
 */
function greedyHold(dice) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d] += 1;
  let modal = 1;
  for (let f = 2; f <= 6; f += 1) if (c[f] > c[modal]) modal = f;
  return dice.map((d) => d === modal);
}

/**
 * 남길 조합 하나를 TRIALS 번 굴려 보고 성향에 맞는 대표값을 낸다.
 *
 * rerollBias 는 "굴리는 것 자체를 얼마나 좋아하는가"다. 기댓값만으로는 두 사람의 손이
 * 거의 똑같이 움직여서(둘 다 결국 최선을 찾으니까) 보는 사람 눈에 성향이 안 보였다.
 * 미겔은 한 번 더 굴려 보고 싶어 하고 마티암은 만들어진 걸 쥐고 있고 싶어 한다 —
 * 그 취향을 다시 굴릴 주사위 개수당 작은 값으로 준다.
 */
function evaluateHold(dice, held, sheet, rollsLeft, style, rand) {
  const values = new Array(TRIALS);
  for (let t = 0; t < TRIALS; t += 1) {
    let d = reroll(dice, held, rand);
    for (let r = rollsLeft - 1; r > 0; r -= 1) d = reroll(d, greedyHold(d), rand);
    values[t] = handValue(d, sheet, style);
  }
  const free = held.filter((h) => !h).length;
  return aggregate(values, style) + (style.rerollBias || 0) * free;
}

/**
 * 최선에 **거의 붙어 있는** 후보들 중에서 무작위로 고른다. 매번 똑같은 판이 되는 것을
 * 막으려는 것이지 일부러 못 두려는 게 아니다.
 *
 * 처음엔 그냥 상위 N개 중에서 골랐는데, 값 차이가 큰데도 섞어 버려서 1라운드에 15점짜리
 * Choice 를 태우는 짓을 했다. 그래서 epsilon 안에 든 후보로 먼저 좁힌다.
 */
function pickAmongBest(scored, topN, epsilon) {
  const sorted = [...scored].sort((a, b) => b.value - a.value);
  const best = sorted[0].value;
  const near = sorted.filter((s) => best - s.value <= epsilon);
  const pool = near.slice(0, Math.max(1, Math.min(topN, near.length)));
  return pool[Math.floor(Math.random() * pool.length)].item;
}

/**
 * 어떤 주사위를 남길지. rollsLeft 는 앞으로 더 굴릴 수 있는 횟수다.
 * 0이면 부를 일이 없다(더 못 굴리니 바로 칸을 고른다).
 */
export function chooseHold(styleKey, dice, sheet, rollsLeft, rand = fastRand) {
  const style = STYLES[styleKey];
  if (!style) throw new Error(`모르는 성향: ${styleKey}`);
  if (rollsLeft <= 0) return dice.map(() => true);

  // 32가지를 다 보되, 남기는 눈이 같으면 결과도 같다(4를 어느 자리에서 쥐든 똑같다).
  // 같은 조합을 여러 번 시뮬레이션하지 않도록 눈의 조합으로 묶는다 — 보통 절반 아래로 준다.
  const seen = new Map();
  for (let mask = 0; mask < (1 << DICE_COUNT); mask += 1) {
    const held = Array.from({ length: DICE_COUNT }, (_, i) => Boolean(mask & (1 << i)));
    const key = dice.filter((_, i) => held[i]).sort().join('');
    if (!seen.has(key)) seen.set(key, held);
  }

  const scored = [...seen.values()].map((held) => ({
    item: held,
    value: evaluateHold(dice, held, sheet, rollsLeft, style, rand),
  }));
  return pickAmongBest(scored, style.topN, style.holdSlack);
}

/** 지금까지 몇 칸을 적었는지로 라운드를 안다. 1부터 센다. */
const roundOf = (sheet) => CATEGORY_KEYS.filter((k) => sheet[k] !== null).length + 1;

/**
 * 어느 칸에 적을지.
 *
 * 값이 가장 큰 칸을 고르되, 성향별 금지 규칙을 먼저 걸러낸다. 이 규칙들이 사람 눈에
 * 보이는 부분이다 — 미겔이 마지막까지 요트 칸을 비워 두는 것 같은.
 */
export function chooseCategory(styleKey, dice, sheet) {
  const style = STYLES[styleKey];
  if (!style) throw new Error(`모르는 성향: ${styleKey}`);

  const open = openCategories(sheet);
  if (!open.length) throw new Error('적을 칸이 없습니다');

  const round = roundOf(sheet);
  const scored = open.map((key) => ({
    item: key,
    score: scoreFor(key, dice),
    value: placementValue(key, scoreFor(key, dice), sheet, style),
  }));

  // 점수가 나는 칸이 하나라도 있으면 무조건 그쪽에 적는다. 성향 규칙은 **0점을 어디에
  // 버릴지**에만 개입한다 — 여기서 걸러 버리면 진짜 야찌를 굴리고도 못 적는 일이 생긴다.
  const scoring = scored.filter((s) => s.score > 0);
  if (scoring.length) return pickAmongBest(scoring, style.topN, style.commitSlack);

  // 여기부터는 어디든 0점을 적어야 하는 상황이다.
  let pool = scored;

  // 미겔은 요트 칸만은 끝까지 비워 둔다. 꿈을 오래 붙들고 있는 게 보는 사람 눈에 띈다.
  if (round < style.keepYachtUntil) {
    const notYacht = pool.filter((s) => s.item !== 'yacht');
    if (notYacht.length) pool = notYacht;
  }

  // 마티암은 손실이 가장 작은 칸부터 버린다(Aces 는 최대 5점, Deuces 는 10점…).
  if (style.dumpCheapest) {
    const cheapest = Math.min(...pool.map((s) => lossOf(s.item)));
    pool = pool.filter((s) => lossOf(s.item) === cheapest);
  }

  return pickAmongBest(pool, style.topN, style.commitSlack);
}

/** 그 칸을 0으로 버렸을 때 잃는 최대 점수. 어디부터 버릴지 정하는 데만 쓴다. */
function lossOf(key) {
  const cat = categoryOf(key);
  if (cat.section === 'upper') return cat.face * DICE_COUNT;
  return { choice: 30, fourKind: 30, fullHouse: 30, sStraight: 15, lStraight: 30, yacht: 50 }[key];
}

/**
 * 방금 둔 수에서 **말할 만한 순간**을 골라 낸다.
 *
 * 매 턴 떠들면 성격이 아니라 소음이 된다(3자리 12라운드면 24번이다). 사람이 이미
 * 반응하고 있는 순간에만 한 줄 얹는 편이 훨씬 낫고, Gemini 호출도 그만큼 아낀다.
 *
 * 우선순위가 높은 것 하나만 돌려준다. 부르는 쪽이 문턱과 판당 상한을 건다.
 *
 * detail 을 꼬박꼬박 "내가 …" 로 쓰는 이유가 있다. 그냥 "야찌가 나왔다!" 라고 줬더니
 * 미겔이 **자기가 낸 야찌를 두고 마티암을 칭찬했다.** 말투 예시가 온통 상대에게 말을
 * 거는 대사라서, 주어가 흐리면 남이 한 일로 읽어 버린다.
 */
export function turnEvents({
  gained, key, sheetBefore, sheetAfter, round, myTotal, bestOtherTotal,
}) {
  const before = totals(sheetBefore);
  const after = totals(sheetAfter);
  const out = [];

  if (key === 'yacht' && gained > 0) out.push({ kind: 'yacht', priority: 100, detail: '내가 야찌를 냈다!' });
  else if (gained === 0) {
    out.push({
      kind: 'bust',
      priority: key === 'yacht' ? 85 : 70,
      detail: `내가 어쩔 수 없이 ${categoryOf(key).short} 칸에 0점을 적었다.`,
    });
  } else if (gained >= 28) {
    out.push({ kind: 'big', priority: 60, detail: `내가 ${categoryOf(key).short} 에 ${gained}점을 적었다.` });
  }

  if (!before.bonus && after.bonus) {
    out.push({ kind: 'bonusGot', priority: 75, detail: '내가 상단 보너스 35점을 챙겼다.' });
  } else if (!bonusLost(sheetBefore) && bonusLost(sheetAfter)) {
    out.push({ kind: 'bonusGone', priority: 55, detail: '내 상단 보너스는 물 건너갔다.' });
  }

  // 역전. 적기 전에는 지고 있었는데 적고 나니 앞선 경우.
  if (before.total <= bestOtherTotal && after.total > bestOtherTotal) {
    out.push({ kind: 'lead', priority: 65, detail: '이걸로 내가 앞서 나갔다.' });
  }

  if (round >= ROUNDS && myTotal !== undefined) {
    out.push({ kind: 'last', priority: 45, detail: '마지막 라운드다.' });
  }

  return out.sort((a, b) => b.priority - a.priority);
}

export default { STYLES, chooseHold, chooseCategory, turnEvents };
