/**
 * affinity — 이웃 밭 궁합 · 세 자매 · 윤작과 연작 (docs/FARM.md §5, 3a)
 *
 * 밭 하나에 걸리는 보정을 셈한다. 파일도 시간도 무작위도 모르는 순수 함수다.
 *
 *   growth   물 한 번에 쌓이는 성장에 곱하는 배율의 **더하기 몫**. 이웃 궁합·세 자매를 더해
 *            **±30% 에서 자른다.** 연작(×0.85)·그늘 없는 버섯(×0.5)은 자르지 않고 따로 곱한다
 *   quality  품질 점수 보정(3b 가 읽는다). 이웃 궁합·세 자매·윤작/연작을 더한 값
 *   soil     수확 때 토질 경험에 곱하는 배율 — 연작 ×0, 윤작 ×1.5, 콩 이웃 ×1.5
 *   notes    화면에 적을 줄 `{ good, text }` — 봇은 이것만 그린다(규칙을 다시 갖지 않는다)
 *
 * **상하좌우로 맞닿은 밭**만 본다. 대각선은 안 본다. 이웃은 열린 밭에 작물이 정해져 있을 때만
 * 친다(`plot.crop`).
 *
 * 윤작·연작은 밭의 `history`(그 밭에서 **다 거두고 비운** 작물 계열, 최근 셋)로 본다.
 *   연작 — 직전과 같은 계열이거나, 재수확 작물이 아닌데 **비우지 않고 한 칸씩 이어 심어**
 *          한 작물로 아홉 칸 넘게 거뒀을 때(`streak`). 칸 하나를 늘 남겨 두는 것으로 연작을
 *          피하지 못하게 한다
 *   윤작 — 직전 둘과 지금 것이 모두 다른 계열
 *   다년생(`perennial`)은 둘 다 따지지 않는다.
 */
const { CROP_BY_KEY } = require('./crops');

/** 계열 이름(화면용). */
const FAMILY = {
  root: '뿌리', allium: '파속', leaf: '잎', fruitveg: '열매', gourd: '박', legume: '콩',
  grain: '곡물', herb: '허브', berry: '베리', tree: '과수', fungus: '버섯', monster: '괴식',
};

/** 한 밭에 걸리는 궁합 보정의 한도. */
const CAP = 0.3;
/** 연작의 성장 배율. */
const SAME_GROWTH = 0.85;
/** 그늘이 필요한 작물(버섯)이 그늘 없이 자랄 때. */
const NO_SHADE = 0.5;
/** 비우지 않고 이어 심어 이만큼 넘게 거두면 연작으로 본다(재수확 작물은 빼고). */
const STREAK = 9;

/** 3×3 키패드 배치에서 상하좌우 이웃 밭 index. */
function neighbors(i) {
  const r = Math.floor(i / 3); const c = i % 3;
  const out = [];
  if (r > 0) out.push(i - 3);
  if (r < 2) out.push(i + 3);
  if (c > 0) out.push(i - 1);
  if (c < 2) out.push(i + 1);
  return out;
}
const adjacent = (a, b) => neighbors(a).includes(b);

/** 밭 번호(키패드 1~9) — 화면 문구용. */
const no = (i) => i + 1;

/** 그 밭의 작물(열려 있고 정해져 있을 때만). */
const cropAt = (farm, i) => (farm.plots[i]?.open ? CROP_BY_KEY[farm.plots[i].crop] ?? null : null);

/**
 * 이웃 하나가 나(`me`)에게 주는 보정. 규칙은 §5 표 그대로다.
 * 돌려주는 것 `[{ growth, quality, soil, text }]` — 해당 없으면 빈 배열.
 */
function pairRules(me, other) {
  const a = me.family; const b = other.family;
  const out = [];
  if (b === 'legume') out.push({ soil: 0.5, text: '콩 이웃 — 토질 경험 +50%' });
  if (b === 'legume' && (a === 'grain' || a === 'leaf')) out.push({ growth: 0.1, text: '콩 이웃 +10%' });
  if ((a === 'allium' && b === 'root') || (a === 'root' && b === 'allium')) {
    out.push({ growth: 0.1, quality: 5, text: `${a === 'root' ? '파속' : '뿌리'} 이웃 +10% · 벌레를 쫓는다` });
  }
  if ((a === 'allium' && b === 'legume') || (a === 'legume' && b === 'allium')) {
    out.push({ growth: -0.1, text: `${a === 'legume' ? '파속' : '콩'} 이웃 −10%` });
  }
  if (b === 'herb' && (a === 'fruitveg' || a === 'leaf')) out.push({ quality: 5, text: '허브 이웃 — 품질 +5' });
  if (other.aura && a !== 'herb') out.push({ quality: other.aura, text: `${other.name} 향 — 품질 +${other.aura}` });
  if (a === 'gourd' && b === 'gourd') out.push({ growth: -0.1, text: '박끼리 덩굴 다툼 −10%' });
  if ((a === 'fruitveg' && b === 'root') || (a === 'root' && b === 'fruitveg')) {
    out.push({ growth: -0.1, text: `${a === 'root' ? '열매' : '뿌리'} 이웃 −10%` });
  }
  if (other.tall) {
    if (a === 'fungus' || a === 'leaf') out.push({ growth: 0.1, text: `${other.name} 그늘 +10%` });
    if (a === 'fruitveg' || a === 'gourd') out.push({ growth: -0.05, text: `${other.name} 그늘 −5%` });
  }
  if (other.scream) out.push({ growth: -0.1, text: `${other.name} 비명 −10%` });
  return out;
}

/** 세 자매 — 옥수수 · 콩 · 박 세 밭이 이어져 있나(ㄱ자나 일자). `me` 가 그중 하나여야 한다. */
function threeSisters(farm, plot, me) {
  const role = (c) => {
    if (!c) return null;
    if (c.key === 'corn') return 'corn';
    if (c.family === 'legume') return 'legume';
    if (c.family === 'gourd') return 'gourd';
    return null;
  };
  const mine = role(me);
  if (!mine) return false;
  const want = ['corn', 'legume', 'gourd'].filter((r) => r !== mine);
  const holders = (r) => farm.plots.map((_, i) => i).filter((i) => i !== plot && role(cropAt(farm, i)) === r);
  for (const x of holders(want[0])) {
    for (const y of holders(want[1])) {
      const links = [adjacent(plot, x), adjacent(plot, y), adjacent(x, y)].filter(Boolean).length;
      if (links >= 2) return true;      // 셋 중 두 쌍이 맞닿으면 한 줄로 이어진다
    }
  }
  return false;
}

/**
 * 밭 `plot` 에 걸리는 보정. `crop` 을 주면 **그 작물을 심었다고 치고** 셈한다(미리보기).
 * 작물이 없으면 `null`.
 */
function modsFor(farm, plot, cropKey = null) {
  const p = farm.plots[plot];
  const me = CROP_BY_KEY[cropKey ?? p?.crop];
  if (!p?.open || !me) return null;

  let growth = 0; let quality = 0; let soil = 1;
  const notes = [];
  const note = (x, from) => {
    const g = x.growth ?? 0; const q = x.quality ?? 0;
    notes.push({ good: g > 0 || (!g && (q > 0 || x.soil > 0)), text: `${x.text}${from != null ? ` (${no(from)}번)` : ''}` });
  };

  for (const n of neighbors(plot)) {
    const other = cropAt(farm, n);
    if (!other) continue;
    for (const x of pairRules(me, other)) {
      growth += x.growth ?? 0;
      quality += x.quality ?? 0;
      if (x.soil) soil *= 1 + x.soil;
      note(x, n);
    }
  }
  if (threeSisters(farm, plot, me)) {
    growth += 0.2;
    quality += 10;
    note({ growth: 0.2, text: '🌽 세 자매 — 옥수수·콩·박 +20% · 품질 +10' });
  }
  const capped = Math.max(-CAP, Math.min(CAP, growth));
  if (capped !== growth) notes.push({ good: capped > 0, text: `궁합은 ±${CAP * 100}% 까지만 (${Math.round(growth * 100)}% → ${Math.round(capped * 100)}%)` });

  // 그늘이 필요한 작물 — 키 큰 이웃이 없으면 절반
  let extra = 1;
  if (me.shadeNeed && !neighbors(plot).some((n) => cropAt(farm, n)?.tall)) {
    extra *= NO_SHADE;
    notes.push({ good: false, text: `그늘이 없어 ×${NO_SHADE} — 옥수수·해바라기 옆에 심으세요` });
  }

  // 윤작 · 연작
  let rotation = null;
  if (!me.perennial) {
    const hist = p.history ?? [];
    const sameCrop = !cropKey || cropKey === p.crop;
    const streaking = sameCrop && !me.regrow && (p.streak ?? 0) >= STREAK;
    if (hist.at(-1) === me.family || streaking) {
      rotation = 'same';
      extra *= SAME_GROWTH;
      quality -= 10;
      soil = 0;
      notes.push({ good: false, text: `연작(${FAMILY[me.family]}) — 성장 −${Math.round((1 - SAME_GROWTH) * 100)}% · 토질 경험 없음` });
    } else if (hist.length >= 2 && new Set([...hist.slice(-2), me.family]).size === 3) {
      rotation = 'varied';
      quality += 10;
      soil *= 1.5;
      notes.push({ good: true, text: '윤작 — 토질 경험 +50% · 품질 +10' });
    }
  }

  return {
    growth: capped, rate: (1 + capped) * extra, quality, soil, rotation, notes,
  };
}

module.exports = {
  FAMILY, CAP, SAME_GROWTH, NO_SHADE, STREAK, neighbors, adjacent, pairRules, threeSisters, modsFor,
};
