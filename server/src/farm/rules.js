/**
 * rules — 농장 규칙 (순수 함수)
 *
 * 파일도 시간도 모른다. 오늘 날짜(`YYYY-MM-DD`, KST)는 부르는 쪽이 준다. 그래서
 * `scripts/check-farm.js` 가 날짜를 마음대로 넘기며 검사할 수 있다. 무작위도 부르는 쪽이
 * 준다(`rand`) — 규칙은 `land.js` 머리말.
 *
 * **받은 농장을 제자리에서 고친다.** 컨트롤러는 저장된 것을 `structuredClone` 해서 넘기고,
 * 규칙이 거절하면 사본을 버린다 — 반쪽만 고친 농장이 저장될 길이 없다.
 *
 * 크론이 없다. 모든 요청이 맨 먼저 `tick` 으로 **밀린 날을 몰아서** 셈한다(docs/FARM.md §14).
 * 물을 받은 날은 **칸마다 마지막 하루**(`wet`)만 적으면 된다. 물주기도 `tick` 을 먼저
 * 돌리므로, 아직 안 센 날들 가운데 그 칸이 물을 받은 날은 많아야 그 하루뿐이다.
 *
 * 하루치 셈의 무작위(잡초)는 **해시 난수**다. 그래서 조회(`GET`)는 셈만 하고 쓰지 않아도,
 * 몇 번 다시 셈해도 같다.
 *
 * **물은 칸마다 준다.** 물 한 포기에 주는 사람의 체력이 1 든다(컨트롤러가 셈한다). 체력이
 * 모자라면 줄 수 있는 만큼만 주고, 나머지는 다른 사람이 이어서 줄 수 있다.
 *
 * 칸의 모양
 *   { t: 'soil' }                                   빈 흙
 *   { t: 'rock' }                                   돌 — 기력 1로 치운다
 *   { t: 'boulder', grain, swings, cracked }        바위 — 결(1~5)을 찾아 깬다. 결은 봇에 안 보낸다
 *   { t: 'weed' }                                   잡초 — 뽑기 전엔 못 심는다
 *   { t: 'plant', g, thirst, scar, ripeDay, planted, wet }  자라는 작물
 *       g        쌓인 성장. 작물의 `days` 가 되면 다 자란다(토질이 좋으면 한 번에 1 넘게 쌓인다)
 *       thirst   연달아 물을 못 받은 날수
 *       scar     한 번이라도 시들었나 (3단계의 품질·거대 작물이 읽는다)
 *       ripeDay  다 자란 날. 있으면 더는 물이 필요 없고, 대신 과숙·썩음을 센다
 *       wet      마지막으로 물을 받은 날
 *   { t: 'dead', why: 'dry' | 'rot' }               죽음. 치우면 빈 흙
 */
const { CROPS, CROP_BY_KEY, seedPrice, gradeOf, YIELD } = require('./crops');
const land = require('./land');
const affinity = require('./affinity');

/** 밭 수, 한 밭의 칸 수. 둘 다 3×3 이고 키패드 배치다(1 2 3 / 4 5 6 / 7 8 9). */
const PLOTS = 9;
const CELLS = 9;
/** 처음부터 열려 있는 밭 — 키패드 5번(가운데)의 index. */
const START_PLOT = land.PLOT_ORDER[0];

/** thirst 가 이만큼이면 🍂 시듦, 이만큼이면 💀. */
const WITHER = 2;
const DEATH = 4;
/** 다 자란 날로부터 이만큼 지나면 과숙, 이만큼 지나면 썩는다. */
const OVERRIPE_AFTER = 3;
const ROT_AFTER = 6;

/** 등록 뒤 이 안에 폐농하면 '무르기' — 쿨다운이 없다. */
const GRACE_MS = 24 * 60 * 60 * 1000;
/** 무르기가 아닌 폐농 뒤, 다시 등록할 수 있을 때까지. */
const COOLDOWN_DAYS = 7;

/** 소수 성장이 0.1 + 0.2 처럼 어긋나지 않게 자른다. */
const round = (x) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------- 날짜

const DAY_MS = 24 * 60 * 60 * 1000;
/** `YYYY-MM-DD` → 1970-01-01 부터 센 날수. 시간대가 끼지 않게 UTC 자정으로 센다. */
const dayNum = (key) => {
  const [y, m, d] = String(key).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};
const keyOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const addDays = (key, n) => keyOf(dayNum(key) + n);

// ---------------------------------------------------------------- 만들기 · 레벨

const soil = () => ({ t: 'soil' });
const lockedPlot = () => ({
  open: false, crop: null, soilXp: 0, history: [], streak: 0, cells: [],
});

/** 새 농장. 가운데 밭 하나만 열려 있고, 그 밭도 돌과 바위가 반을 넘는다. */
function newFarm({ channelId, guildId, owner, today, now, rand = Math.random }) {
  const plots = Array.from({ length: PLOTS }, lockedPlot);
  plots[START_PLOT] = land.makePlot(rand, { first: true });
  return {
    channelId,
    guildId,
    owner,
    createdAt: now,
    // 등록한 날은 아직 안 센 날이다. 어제까지 센 것으로 두면 오늘부터 셈이 시작된다.
    lastTickDay: addDays(today, -1),
    xp: 0,
    grown: [],              // 이 농장에서 한 번이라도 거둔 작물(첫 수확 경험치)
    compostBits: 0,         // 퇴비 조각 — 셋이면 퇴비 하나(2b)
    water: { day: null, by: [] },   // 오늘 물을 준 사람들
    waterXpDay: null,       // 물주기 경험치(하루 한 번)를 받은 날
    fert: { day: null, plots: {} },  // 오늘 밭마다 넣은 거름 `{ 밭: { fertilizer, compost } }`
    plots,
  };
}

/**
 * 옛 모양의 농장을 지금 모양으로 채운다. **읽을 때마다** 부른다(컨트롤러). 여러 번 불러도 같다.
 *
 * 1단계(MVP)에 연 농장에는 레벨·토질·퇴비 필드가 없고, 물 기록이 **농장에 하루 하나**
 * (`water: { day, by: '한 사람' }`)였다. 2a 부터는 칸마다 `wet` 을 본다. 옛 농장에서는 물을 주면
 * 자라는 칸 **전부**가 같이 받았으므로 `water.day` 를 그 칸들의 `wet` 으로 옮기면 그대로다
 * (그날 물 준 뒤에 심은 칸도 옛 규칙에서 그날치를 받았다). 빠뜨리면 이미 물 받은 칸이
 * 다음 셈에서 목마른 것으로 세어진다.
 */
function upgrade(farm) {
  if (!Number.isFinite(farm.xp)) farm.xp = 0;
  if (!Array.isArray(farm.grown)) farm.grown = [];
  if (!Number.isFinite(farm.compostBits)) farm.compostBits = 0;
  if (farm.waterXpDay === undefined) farm.waterXpDay = null;
  if (!farm.water || typeof farm.water !== 'object') farm.water = { day: null, by: [] };
  if (!Array.isArray(farm.water.by)) farm.water.by = farm.water.by ? [farm.water.by] : [];
  if (!farm.fert || typeof farm.fert !== 'object') farm.fert = { day: null, plots: {} };
  for (const p of farm.plots) {
    if (!Number.isFinite(p.soilXp)) p.soilXp = 0;
    if (!Array.isArray(p.history)) p.history = [];     // 3a — 다 거두고 비운 작물 계열
    if (!Number.isFinite(p.streak)) p.streak = 0;      // 3a — 비우지 않고 이어 거둔 칸 수
    if (!Array.isArray(p.cells)) p.cells = [];
    for (const c of p.cells) {
      if (c.t === 'plant' && c.wet === undefined) c.wet = farm.water.day ?? null;
    }
  }
  return farm;
}

const levelOf = (farm) => land.levelOf(farm.xp);

/**
 * 경험치를 더하고, 레벨이 오르면 **그 레벨의 밭을 연다**(돌투성이로). 무작위가 들어가므로
 * 쓰는 요청에서만 부른다. 오르지 않았으면 `null`.
 */
function gainXp(farm, n, rand) {
  if (!n) return null;
  const from = levelOf(farm);
  farm.xp += n;
  const to = levelOf(farm);
  if (to === from) return null;
  const opened = [];
  for (const i of land.PLOT_ORDER.slice(0, to)) {
    if (farm.plots[i].open) continue;
    farm.plots[i] = land.makePlot(rand);
    opened.push(i);
  }
  const crops = CROPS.filter((c) => c.lv > from && c.lv <= to).map((c) => c.key);
  return { from, to, opened, crops };
}

/** 그 밭에서 물 한 번에 쌓이는 성장 — 토질 배율 × 잡초 × 궁합·연작(`affinity.js`). */
function rateOf(farm, pi) {
  const plot = farm.plots[pi];
  const speed = land.SOIL_SPEED[land.soilStar(plot.soilXp) - 1];
  const weed = plot.cells.some((c) => c.t === 'weed') ? land.WEED_SLOW : 1;
  return speed * weed * (affinity.modsFor(farm, pi)?.rate ?? 1);
}

const loseSoil = (plot, n) => { plot.soilXp = Math.max(0, (plot.soilXp ?? 0) - n); };

/** 퇴비 조각을 퇴비로 바꾼다. 바꾼 개수(계정에 넣을 것)를 돌려준다. 수확·개간이 부른다. */
function takeCompost(farm) {
  const n = Math.floor(farm.compostBits / land.COMPOST_BITS);
  farm.compostBits -= n * land.COMPOST_BITS;
  return n;
}

// ---------------------------------------------------------------- 하루치

/**
 * 밀린 날을 몰아서 센다 — `lastTickDay` 다음 날부터 **어제까지.** 오늘은 아직 안 끝났다.
 *
 * 하루마다
 *   - 다 자란 칸: 과숙을 세다가 `ROT_AFTER` 째 되는 날 썩는다. 물은 안 본다
 *   - 그날 물을 못 받은 칸: thirst +1, `DEATH` 면 죽는다(그 밭 토질 −3)
 *   - 빈 흙: 해시 난수로 잡초가 난다
 * 물을 받은 칸의 성장은 **물을 준 순간** 이미 더했다(`water`). 여기서 또 더하지 않는다.
 */
function tick(farm, today) {
  const end = dayNum(today) - 1;
  for (let d = dayNum(farm.lastTickDay) + 1; d <= end; d += 1) {
    const key = keyOf(d);
    farm.plots.forEach((plot, pi) => {
      if (!plot.open) return;
      plot.cells.forEach((cell, i) => {
        if (cell.t === 'soil') {
          if (land.hashRand(farm.channelId, key, pi, i) < land.WEED_CHANCE) plot.cells[i] = { t: 'weed' };
          return;
        }
        if (cell.t !== 'plant') return;
        if (cell.ripeDay) {
          // 이날이 끝나면 다 자란 지 (d − R + 1)일. 그게 ROT_AFTER 가 되는 밤에 썩는다.
          if (d - dayNum(cell.ripeDay) + 1 >= ROT_AFTER) {
            plot.cells[i] = { t: 'dead', why: 'rot' };
            loseSoil(plot, land.DEATH_SOIL);
          }
          return;
        }
        if (cell.wet === key) return;
        cell.thirst += 1;
        if (cell.thirst >= DEATH) {
          plot.cells[i] = { t: 'dead', why: 'dry' };
          loseSoil(plot, land.DEATH_SOIL);
        }
      });
    });
  }
  if (end > dayNum(farm.lastTickDay)) farm.lastTickDay = keyOf(end);
  return farm;
}

// ---------------------------------------------------------------- 물

/** 오늘 물이 필요한 칸 — `[밭, 칸]`. 시든 칸부터, 그다음 목마른 칸, 그다음 밭이 열린 순서. */
function thirstyCells(farm, today, plot = null) {
  const out = [];
  land.PLOT_ORDER.forEach((pi, order) => {
    if (plot !== null && pi !== plot) return;
    const p = farm.plots[pi];
    if (!p.open || !CROP_BY_KEY[p.crop]) return;
    p.cells.forEach((cell, i) => {
      if (cell.t === 'plant' && !cell.ripeDay && cell.wet !== today) out.push({ pi, i, order, thirst: cell.thirst });
    });
  });
  return out.sort((a, b) => b.thirst - a.thirst || a.order - b.order || a.i - b.i);
}

/**
 * 물을 준다. **칸마다 하루 한 번**, 누구나. `budget` 포기까지만 준다(체력 — 컨트롤러가 셈한다).
 * `plot` 을 주면 그 밭만.
 *
 * 그 자리에서 오늘치 성장을 더한다 — 준 즉시 🌱 이 🌿 로 바뀌는 것이 보여야 재미있다.
 * 시든 칸도 살아난다. 대신 `scar` 가 남는다. 그날 **첫 물**이면 농장 경험치 +2 — 누가 줬든.
 * 주인만 받게 하면 이웃이 먼저 물을 줄수록 주인이 손해를 본다(simulate-farm 이 잡았다).
 */
function water(farm, today, userId, { budget = Infinity, plot = null, rand = Math.random } = {}) {
  if (plot !== null && (!Number.isInteger(plot) || plot < 0 || plot >= PLOTS)) return bad('plot');
  const need = thirstyCells(farm, today, plot);
  if (!need.length) {
    const any = farm.plots.some((p) => p.cells.some((c) => c.t === 'plant' && !c.ripeDay));
    return { ok: false, reason: any ? 'already' : 'noPlants', by: farm.water?.day === today ? farm.water.by : [] };
  }
  if (budget < 1) return { ok: false, reason: 'tired', need: need.length };

  let revived = 0; let ripened = 0;
  const given = need.slice(0, budget);
  for (const { pi, i } of given) {
    const p = farm.plots[pi];
    const crop = CROP_BY_KEY[p.crop];
    const cell = p.cells[i];
    if (cell.thirst >= WITHER) { revived += 1; cell.scar = true; }
    cell.thirst = 0;
    cell.wet = today;
    cell.g = round(cell.g + rateOf(farm, pi));
    if (cell.g >= crop.days) { cell.ripeDay = today; ripened += 1; }
  }

  if (farm.water?.day !== today) farm.water = { day: today, by: [] };
  if (!farm.water.by.includes(userId)) farm.water.by.push(userId);

  let levelUp = null; let xp = 0;
  if (farm.waterXpDay !== today) {
    farm.waterXpDay = today;
    xp = land.XP.water;
    levelUp = gainXp(farm, xp, rand);
  }
  return {
    ok: true, watered: given.length, left: need.length - given.length, revived, ripened, xp, levelUp,
  };
}

// ---------------------------------------------------------------- 심기

/** 모양이 틀린 입력. 컨트롤러가 400 으로 돌려준다(상태가 아니라 호출이 틀린 것). */
const bad = (reason) => ({ ok: false, reason, bad: true });
const badPlot = (plot) => !Number.isInteger(plot) || plot < 0 || plot >= PLOTS;

/**
 * 심는다. `cells` 는 밭 안의 칸 index 배열(0~8).
 *
 * 한 밭에는 **작물 한 종류.** 빈 흙에만 심는다 — 돌·바위·잡초가 있는 칸은 먼저 치운다.
 * 레벨이 모자란 작물은 못 심는다. 골드는 여기서 안 본다(`cost` 만 셈해 돌려준다).
 */
function plant(farm, today, { plot, cells, crop }) {
  if (badPlot(plot)) return bad('plot');
  const c = CROP_BY_KEY[crop];
  if (!c) return bad('crop');
  if (!Array.isArray(cells) || !cells.length || cells.length > CELLS
    || !cells.every((i) => Number.isInteger(i) && i >= 0 && i < CELLS)
    || new Set(cells).size !== cells.length) return bad('cells');

  const p = farm.plots[plot];
  if (!p.open) return { ok: false, reason: 'locked' };
  if (c.lv > levelOf(farm)) return { ok: false, reason: 'level', need: c.lv, crop };
  if (p.crop && p.crop !== crop) return { ok: false, reason: 'otherCrop', crop: p.crop };
  if (cells.some((i) => p.cells[i].t !== 'soil')) return { ok: false, reason: 'occupied' };

  for (const i of cells) {
    p.cells[i] = {
      t: 'plant', g: 0, thirst: 0, scar: false, ripeDay: null, planted: today, wet: null,
    };
  }
  if (p.crop !== crop) p.streak = 0;
  p.crop = crop;
  return { ok: true, cost: seedPrice(c) * cells.length, count: cells.length, crop };
}

// ---------------------------------------------------------------- 수확

/**
 * 다 자란 칸을 거두고, 죽은 칸과 잡초를 치운다. `plot` 을 안 주면 열린 밭 전부.
 *
 * 칸마다 **토질 ★ 과 작물 등급**으로 1~3개(§4). 품질은 3단계 — 지금은 전부 보통.
 * 재수확 작물은 칸이 남아 `regrow` 일 뒤에 다시 익는다.
 * 토질 경험: 거둔 칸마다 +1, 콩 계열 밭이면 한 번에 +10 — 여기에 윤작 ×1.5 · 연작 ×0 · 콩 이웃 ×1.5
 * (`affinity.js`). 농장 경험치: 칸마다 +1, 처음 거둔 작물 +10.
 * 밭이 다 비면 그 작물 계열을 `history` 에 적는다(최근 셋) — 다음 작물의 윤작·연작이 이걸 본다.
 * 잡초는 민들레 하나와 퇴비 조각, 죽은 칸은 퇴비 조각.
 */
function harvest(farm, today, { plot = null } = {}, { rand = Math.random } = {}) {
  if (plot !== null && badPlot(plot)) return bad('plot');
  const targets = plot === null ? farm.plots.filter((p) => p.open) : [farm.plots[plot]];
  if (plot !== null && !targets[0].open) return { ok: false, reason: 'locked' };

  const items = {};
  const add = (key, n) => { items[key] = (items[key] ?? 0) + n; };
  let harvested = 0; let cleared = 0; let weeds = 0; let xp = 0;
  for (const p of targets) {
    const crop = CROP_BY_KEY[p.crop];
    const [lo, hi] = crop ? YIELD[gradeOf(crop)][land.soilStar(p.soilXp) - 1] : [0, 0];
    // 궁합은 **거두기 전** 밭 모양으로 셈한다 — 거두다 이웃이 비면 값이 흔들린다.
    const mods = crop ? affinity.modsFor(farm, farm.plots.indexOf(p)) : null;
    let here = 0;
    p.cells.forEach((cell, i) => {
      if (cell.t === 'dead') { p.cells[i] = soil(); cleared += 1; farm.compostBits += 1; return; }
      if (cell.t === 'weed') { p.cells[i] = soil(); weeds += 1; farm.compostBits += 1; add('dandelion', 1); return; }
      if (cell.t !== 'plant' || !cell.ripeDay || !crop) return;
      add(crop.key, land.between(rand, lo, hi));
      here += 1;
      if (crop.regrow) {
        // 새 한 철이다. 시든 흔적도 지운다.
        Object.assign(cell, { g: round(crop.days - crop.regrow), thirst: 0, scar: false, ripeDay: null });
      } else {
        p.cells[i] = soil();
      }
    });
    if (here) {
      const base = here + (crop.family === 'legume' ? land.LEGUME_SOIL : 0);
      p.soilXp += Math.round(base * (mods?.soil ?? 1));
      if (!crop.regrow) p.streak = (p.streak ?? 0) + here;
      xp += here * land.XP.harvest;
      if (!farm.grown.includes(crop.key)) { farm.grown.push(crop.key); xp += land.XP.firstCrop; }
      harvested += here;
    }
    if (p.crop && p.cells.every((cell) => cell.t === 'soil')) {
      if (crop && !crop.perennial) p.history = [...(p.history ?? []), crop.family].slice(-3);
      p.crop = null;
      p.streak = 0;
    }
  }
  if (!harvested && !cleared && !weeds) return { ok: false, reason: 'nothing' };
  const levelUp = gainXp(farm, xp, rand);
  const compost = takeCompost(farm);
  if (compost) add('compost', compost);
  return {
    ok: true, items, harvested, cleared, weeds, xp, levelUp, compost,
  };
}

// ---------------------------------------------------------------- 개간

/**
 * 개간(§9). 기력은 **계정 기준**이라 컨트롤러가 세어 `stamina`(남은 것)로 준다.
 *
 *   `{ plot, all: true }`   그 밭의 돌을 기력이 닿는 만큼 전부 치운다
 *   `{ plot, cell }`        그 칸이 돌이면 치우고, 잡초면 뽑는다(기력 안 듦)
 *   `{ plot, cell, pos }`   그 칸의 바위를 `pos`(1~5) 자리로 휘두른다
 *
 * 바위: 결을 맞히면 깨진다. **첫 휘두름에 맞히면 완벽** — 좋은 표에서 두 번 뽑는다.
 * 빗나가면 방향 힌트를 주고, `MAX_SWINGS` 번 다 빗나가면 금이 간다 — 다음엔 어디를 쳐도 깨진다.
 * 결 자리와 휘두른 횟수는 칸에 저장된다. 창을 닫았다 열어도 다시 굴려지지 않는다.
 *
 * 돌려주는 `used` 만큼 컨트롤러가 기력을 깎고, `fossils` 만큼 화석 상한을 쓴다.
 * `tool` 은 곡괭이(`land.PICKAXES`). 철부터는 빗나간 힌트에 거리(`dist`)가 붙는다.
 */
function clear(farm, today, { plot, cell = null, pos = null, all = false }, {
  rand = Math.random, stamina = 0, fossilLeft = 0, tool = 'wood',
} = {}) {
  if (badPlot(plot)) return bad('plot');
  const p = farm.plots[plot];
  if (!p.open) return { ok: false, reason: 'locked' };

  const loot = {};
  let fossils = 0;
  const roll = (table) => {
    const key = land.rollLoot(table, rand, { fossilLeft: fossilLeft - fossils });
    if (key === 'oddFossil') fossils += 1;
    loot[key] = (loot[key] ?? 0) + 1;
  };
  const rockOut = (i) => {
    p.cells[i] = soil();
    if (rand() < land.ROCK_LOOT) roll('normal');
  };
  const done = (extra) => {
    const xp = extra.xp ?? 0;
    const levelUp = gainXp(farm, xp, rand);
    const compost = takeCompost(farm);
    if (compost) loot.compost = (loot.compost ?? 0) + compost;
    return {
      ok: true, loot, fossils, levelUp, compost, ...extra, xp,
    };
  };

  if (all) {
    const rocks = p.cells.map((c, i) => (c.t === 'rock' ? i : -1)).filter((i) => i >= 0);
    if (!rocks.length) return { ok: false, reason: 'noRocks' };
    if (stamina < 1) return { ok: false, reason: 'tired' };
    const take = rocks.slice(0, stamina);
    take.forEach(rockOut);
    return done({
      kind: 'rocks', used: take.length, cleared: take.length, left: rocks.length - take.length, xp: take.length * land.XP.rock,
    });
  }

  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return bad('cell');
  const c = p.cells[cell];

  if (c.t === 'weed') {
    p.cells[cell] = soil();
    farm.compostBits += 1;
    loot.dandelion = 1;
    return done({ kind: 'weed', used: 0 });
  }
  if (c.t === 'rock') {
    if (stamina < 1) return { ok: false, reason: 'tired' };
    rockOut(cell);
    return done({ kind: 'rock', used: 1, cleared: 1, xp: land.XP.rock });
  }
  if (c.t !== 'boulder') return { ok: false, reason: 'notStone' };

  if (!Number.isInteger(pos) || pos < 1 || pos > land.GRAIN_SPOTS) return bad('pos');
  if (stamina < 1) return { ok: false, reason: 'tired' };

  if (c.cracked || pos === c.grain) {
    const perfect = !c.cracked && c.swings === 0;
    p.cells[cell] = soil();
    if (perfect) { roll('perfect'); roll('perfect'); } else roll('normal');
    return done({
      kind: 'boulder', used: 1, broke: true, perfect, xp: land.XP.boulder + (perfect ? land.XP.perfect : 0),
    });
  }

  c.swings += 1;
  if (c.swings >= land.MAX_SWINGS) c.cracked = true;
  return done({
    kind: 'boulder', used: 1, broke: false, hint: land.hintOf(c.grain, pos, { exact: land.exactHint(tool) }), swings: c.swings, cracked: c.cracked,
  });
}

// ---------------------------------------------------------------- 거름

/** 오늘 그 밭에 넣은 거름 `{ fertilizer, compost }`. 날이 바뀌었으면 비어 있다. */
const fertToday = (farm, today, plot) => (farm.fert?.day === today ? farm.fert.plots[plot] : null) ?? {};

/**
 * 거름을 넣는다 — 비료(+15)·퇴비(+5) 를 `count` 개. **밭마다 하루 한도**(`land.FERTS`).
 * 이미 ★5 인 밭엔 안 넣는다(`soilMax`).
 * 아이템이 계정에 있는지는 컨트롤러가 본다. 여기서는 한도와 토질만.
 */
function fertilize(farm, today, { plot, item, count = 1 }) {
  if (badPlot(plot)) return bad('plot');
  const f = land.FERTS[item];
  if (!f) return bad('item');
  if (!Number.isInteger(count) || count < 1) return bad('count');
  const p = farm.plots[plot];
  if (!p.open) return { ok: false, reason: 'locked' };
  // ★5 를 넘는 경험은 아무 데도 안 쓰인다 — 거름만 버리게 두지 않는다.
  if (land.soilStar(p.soilXp) >= land.SOIL_XP.length) return { ok: false, reason: 'soilMax' };

  const used = fertToday(farm, today, plot)[item] ?? 0;
  const room = f.perDay - used;
  if (room < 1) return { ok: false, reason: 'fertCap', item, perDay: f.perDay };
  const n = Math.min(count, room);

  const from = land.soilStar(p.soilXp);
  p.soilXp += f.soil * n;
  if (farm.fert?.day !== today) farm.fert = { day: today, plots: {} };
  farm.fert.plots[plot] = { ...fertToday(farm, today, plot), [item]: used + n };
  return {
    ok: true, item, used: n, soil: f.soil * n, from, to: land.soilStar(p.soilXp), capped: n < count,
  };
}

/**
 * 미스릴 곡괭이의 결 후보 `{ 밭: { 칸: [a, b] } }`. **주인 자신의 조회**에만 싣는다 —
 * 공개 화면에 두면 남도 결을 반쯤 안다.
 */
function candidates(farm) {
  const out = {};
  farm.plots.forEach((p, pi) => {
    if (!p.open) return;
    p.cells.forEach((c, i) => {
      if (c.t !== 'boulder' || c.cracked) return;
      (out[pi] ??= {})[i] = land.candidatesOf(farm.channelId, pi, i, c.grain);
    });
  });
  return out;
}

// ---------------------------------------------------------------- 보기

/** 칸 하나가 화면에 어떻게 보이나. 봇은 이 이름만 보고 이모지를 고른다. */
function cellState(cell, crop, today) {
  if (!cell) return 'locked';
  if (cell.t === 'boulder') return cell.cracked ? 'crack' : 'boulder';
  if (['soil', 'rock', 'weed', 'dead'].includes(cell.t)) return cell.t;
  if (cell.ripeDay) return dayNum(today) - dayNum(cell.ripeDay) >= OVERRIPE_AFTER ? 'over' : 'ripe';
  if (cell.thirst >= WITHER) return 'dry';
  return crop && cell.g / crop.days >= 0.5 ? 'grow' : 'seed';
}

/**
 * 봇에 주는 모양. **셈은 다 끝낸 채로** 준다 — 봇이 규칙을 다시 갖지 않게.
 * 바위의 결 자리는 **빼고** 준다.
 *
 * 밭마다
 *   need     오늘 아직 물을 못 받은 칸 수
 *   thirsty  그 가운데 어제도 못 받은 칸(오늘 못 받으면 시든다)
 *   left     아직 안 익은 칸이 익기까지 남은 물주기 횟수(가장 적은 칸 기준)
 *   swings   바위 칸의 휘두른 횟수 `{ 칸: n }`
 */
function view(farm, today) {
  const level = levelOf(farm);
  return {
    channelId: farm.channelId,
    owner: farm.owner,
    createdAt: farm.createdAt,
    graceUntil: new Date(Date.parse(farm.createdAt) + GRACE_MS).toISOString(),
    today,
    level,
    xp: farm.xp,
    xpFloor: land.LEVEL_XP[level - 1],
    xpNext: land.nextLevelXp(level),
    sign: land.signOf(level),
    nextPlot: level < land.MAX_LEVEL ? land.PLOT_ORDER[level] : null,
    compostBits: farm.compostBits,
    waterBy: farm.water?.day === today ? farm.water.by : [],
    need: thirstyCells(farm, today).length,
    plots: farm.plots.map((p) => {
      const crop = CROP_BY_KEY[p.crop] ?? null;
      const cells = p.open ? p.cells.map((cell) => cellState(cell, crop, today)) : Array(CELLS).fill('locked');
      const growing = p.cells.filter((cell) => cell.t === 'plant' && !cell.ripeDay);
      const dry = growing.filter((cell) => cell.wet !== today);
      const star = land.soilStar(p.soilXp);
      const pi = farm.plots.indexOf(p);
      const rate = p.open ? rateOf(farm, pi) : 1;
      const mods = p.open ? affinity.modsFor(farm, pi) : null;
      const swings = {};
      p.cells.forEach((cell, i) => { if (cell.t === 'boulder') swings[i] = cell.swings; });
      return {
        open: p.open,
        crop: p.crop,
        cells,
        star,
        soilXp: p.soilXp,
        soilNext: star < land.SOIL_XP.length ? land.SOIL_XP[star] : null,
        ripe: cells.filter((s) => s === 'ripe' || s === 'over').length,
        dead: cells.filter((s) => s === 'dead').length,
        growing: growing.length,
        need: dry.length,
        thirsty: dry.filter((cell) => cell.thirst === WITHER - 1).length,
        left: crop && growing.length
          ? Math.min(...growing.map((cell) => Math.max(0, Math.ceil(round((crop.days - cell.g) / rate)))))
          : null,
        swings,
        fert: p.open ? fertToday(farm, today, pi) : {},
        history: p.history ?? [],
        mods: mods && { growth: mods.growth, rate: round(mods.rate), quality: mods.quality, soil: mods.soil, rotation: mods.rotation, notes: mods.notes },
      };
    }),
  };
}

module.exports = {
  PLOTS, CELLS, START_PLOT, WITHER, DEATH, OVERRIPE_AFTER, ROT_AFTER, GRACE_MS, COOLDOWN_DAYS,
  dayNum, keyOf, addDays,
  newFarm, upgrade, levelOf, gainXp, tick, water, plant, harvest, clear, fertilize, candidates, view,
};
