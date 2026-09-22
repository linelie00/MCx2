/**
 * rules — 농장 규칙 (순수 함수)
 *
 * 파일도 시간도 모른다. 오늘 날짜(`YYYY-MM-DD`, KST)는 부르는 쪽이 준다. 그래서
 * `scripts/check-farm.js` 가 날짜를 마음대로 넘기며 검사할 수 있다.
 *
 * **받은 농장을 제자리에서 고친다.** 컨트롤러는 저장된 것을 `structuredClone` 해서 넘기고,
 * 규칙이 거절하면 사본을 버린다 — 반쪽만 고친 농장이 저장될 길이 없다.
 *
 * 크론이 없다. 모든 요청이 맨 먼저 `tick` 으로 **밀린 날을 몰아서** 셈한다(docs/FARM.md §14).
 * 물을 준 기록은 **마지막 날 하나**(`water.day`)면 된다. 물주기도 `tick` 을 먼저 돌리므로,
 * 아직 안 센 날들 가운데 물을 준 날은 많아야 그 하루뿐이다.
 *
 * 1단계(MVP)의 셈에는 **무작위가 없다.** 몇 번을 다시 셈해도 같아서, 조회(`GET`)는 셈만 하고
 * 쓰지 않는다.
 *
 * 칸의 모양
 *   { t: 'soil' }                                  빈 흙
 *   { t: 'plant', g, thirst, scar, ripeDay, planted } 자라는 작물
 *       g        쌓인 성장. 작물의 `days` 가 되면 다 자란다
 *       thirst   연달아 물을 못 받은 날수
 *       scar     한 번이라도 시들었나 (2단계의 품질·거대 작물이 읽는다)
 *       ripeDay  다 자란 날. 있으면 더는 물이 필요 없고, 대신 과숙·썩음을 센다
 *   { t: 'dead', why: 'dry' | 'rot' }               죽음. 치우면 빈 흙
 */
const { CROP_BY_KEY, seedPrice } = require('./crops');

/** 밭 수, 한 밭의 칸 수. 둘 다 3×3 이고 키패드 배치다(1 2 3 / 4 5 6 / 7 8 9). */
const PLOTS = 9;
const CELLS = 9;
/** 처음부터 열려 있는 밭 — 키패드 5번(가운데)의 index. */
const START_PLOT = 4;

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

// ---------------------------------------------------------------- 날짜

const DAY_MS = 24 * 60 * 60 * 1000;
/** `YYYY-MM-DD` → 1970-01-01 부터 센 날수. 시간대가 끼지 않게 UTC 자정으로 센다. */
const dayNum = (key) => {
  const [y, m, d] = String(key).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};
const keyOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const addDays = (key, n) => keyOf(dayNum(key) + n);

// ---------------------------------------------------------------- 만들기

const soil = () => ({ t: 'soil' });

/** 새 농장. 가운데 밭 하나만 열려 있고, 그 밭은 전부 빈 흙이다(돌은 2단계). */
function newFarm({ channelId, guildId, owner, today, now }) {
  return {
    channelId,
    guildId,
    owner,
    createdAt: now,
    // 등록한 날은 아직 안 센 날이다. 어제까지 센 것으로 두면 오늘부터 셈이 시작된다.
    lastTickDay: addDays(today, -1),
    water: { day: null, by: null },
    plots: Array.from({ length: PLOTS }, (_, i) => ({
      open: i === START_PLOT,
      crop: null,
      // 잠긴 밭은 칸이 없다. 열릴 때(2단계) 돌과 함께 만든다.
      cells: i === START_PLOT ? Array.from({ length: CELLS }, soil) : [],
    })),
  };
}

// ---------------------------------------------------------------- 하루치

/**
 * 밀린 날을 몰아서 센다 — `lastTickDay` 다음 날부터 **어제까지.** 오늘은 아직 안 끝났다.
 *
 * 하루마다, 자라는 칸은
 *   - 다 자랐으면: 과숙을 세다가 `ROT_AFTER` 째 되는 날 썩는다. 물은 안 본다
 *   - 그날 물을 못 받았으면: thirst +1, `DEATH` 면 죽는다
 * 물을 받은 날의 성장은 **물을 준 순간** 이미 더했다(`water`). 여기서 또 더하지 않는다.
 */
function tick(farm, today) {
  const end = dayNum(today) - 1;
  for (let d = dayNum(farm.lastTickDay) + 1; d <= end; d += 1) {
    const watered = farm.water?.day === keyOf(d);
    for (const plot of farm.plots) {
      plot.cells.forEach((cell, i) => {
        if (cell.t !== 'plant') return;
        if (cell.ripeDay) {
          // 이날이 끝나면 다 자란 지 (d − R + 1)일. 그게 ROT_AFTER 가 되는 밤에 썩는다.
          if (d - dayNum(cell.ripeDay) + 1 >= ROT_AFTER) plot.cells[i] = { t: 'dead', why: 'rot' };
          return;
        }
        if (watered) return;
        cell.thirst += 1;
        if (cell.thirst >= DEATH) plot.cells[i] = { t: 'dead', why: 'dry' };
      });
    }
  }
  if (end > dayNum(farm.lastTickDay)) farm.lastTickDay = keyOf(end);
  return farm;
}

// ---------------------------------------------------------------- 물

/**
 * 오늘의 물. 농장 전체에 한 번. **누구나** 줄 수 있다.
 *
 * 그 자리에서 오늘치 성장(+1)을 더한다 — 준 즉시 🌱 이 🌿 로 바뀌는 것이 보여야 재미있다.
 * 시든 칸도 살아난다. 대신 `scar` 가 남는다.
 */
function water(farm, today, userId) {
  if (farm.water?.day === today) return { ok: false, reason: 'already', by: farm.water.by };
  farm.water = { day: today, by: userId };

  let grew = 0; let revived = 0; let ripened = 0;
  for (const plot of farm.plots) {
    const crop = CROP_BY_KEY[plot.crop];
    for (const cell of plot.cells) {
      if (cell.t !== 'plant' || cell.ripeDay || !crop) continue;
      if (cell.thirst >= WITHER) { revived += 1; cell.scar = true; }
      cell.thirst = 0;
      cell.g += 1;
      grew += 1;
      if (cell.g >= crop.days) { cell.ripeDay = today; ripened += 1; }
    }
  }
  return { ok: true, grew, revived, ripened };
}

// ---------------------------------------------------------------- 심기

/** 모양이 틀린 입력. 컨트롤러가 400 으로 돌려준다(상태가 아니라 호출이 틀린 것). */
const bad = (reason) => ({ ok: false, reason, bad: true });

/**
 * 심는다. `cells` 는 밭 안의 칸 index 배열(0~8).
 *
 * 한 밭에는 **작물 한 종류.** 이미 다른 작물이 있는 밭에는 못 심는다.
 * 오늘 이미 물을 줬으면 새로 심은 칸도 오늘치를 받는다 — 젖은 흙에 심은 셈이다.
 *
 * 골드는 여기서 안 본다. 씨앗값(`cost`)만 셈해 돌려주고, 컨트롤러가 계정과 맞춘다.
 */
function plant(farm, today, { plot, cells, crop }) {
  if (!Number.isInteger(plot) || plot < 0 || plot >= PLOTS) return bad('plot');
  const c = CROP_BY_KEY[crop];
  if (!c) return bad('crop');
  if (!Array.isArray(cells) || !cells.length || cells.length > CELLS
    || !cells.every((i) => Number.isInteger(i) && i >= 0 && i < CELLS)
    || new Set(cells).size !== cells.length) return bad('cells');

  const p = farm.plots[plot];
  if (!p.open) return { ok: false, reason: 'locked' };
  if (p.crop && p.crop !== crop) return { ok: false, reason: 'otherCrop', crop: p.crop };
  if (cells.some((i) => p.cells[i].t !== 'soil')) return { ok: false, reason: 'occupied' };

  const wet = farm.water?.day === today;
  for (const i of cells) {
    p.cells[i] = { t: 'plant', g: wet ? 1 : 0, thirst: 0, scar: false, ripeDay: null, planted: today };
    if (p.cells[i].g >= c.days) p.cells[i].ripeDay = today;
  }
  p.crop = crop;
  return { ok: true, cost: seedPrice(c) * cells.length, count: cells.length, crop };
}

// ---------------------------------------------------------------- 수확

/**
 * 다 자란 칸을 거두고 죽은 칸을 치운다. `plot` 을 안 주면 열린 밭 전부.
 *
 * MVP 는 칸마다 **1개, 보통 품질.** 재수확 작물은 칸이 남아 `regrow` 일 뒤에 다시 익는다.
 * 밭이 전부 빈 흙이 되면 작물 칸을 비운다 — 다른 작물을 심을 수 있게.
 */
function harvest(farm, today, { plot = null } = {}) {
  if (plot !== null && (!Number.isInteger(plot) || plot < 0 || plot >= PLOTS)) return bad('plot');
  const targets = plot === null ? farm.plots.filter((p) => p.open) : [farm.plots[plot]];
  if (plot !== null && !targets[0].open) return { ok: false, reason: 'locked' };

  const items = {};
  let harvested = 0; let cleared = 0;
  for (const p of targets) {
    const crop = CROP_BY_KEY[p.crop];
    p.cells.forEach((cell, i) => {
      if (cell.t === 'dead') { p.cells[i] = soil(); cleared += 1; return; }
      if (cell.t !== 'plant' || !cell.ripeDay || !crop) return;
      items[crop.key] = (items[crop.key] ?? 0) + 1;
      harvested += 1;
      if (crop.regrow) {
        // 새 한 철이다. 시든 흔적도 지운다.
        Object.assign(cell, { g: crop.days - crop.regrow, thirst: 0, scar: false, ripeDay: null });
      } else {
        p.cells[i] = soil();
      }
    });
    if (p.cells.every((cell) => cell.t === 'soil')) p.crop = null;
  }
  if (!harvested && !cleared) return { ok: false, reason: 'nothing' };
  return { ok: true, items, harvested, cleared };
}

// ---------------------------------------------------------------- 보기

/** 칸 하나가 화면에 어떻게 보이나. 봇은 이 이름만 보고 이모지를 고른다. */
function cellState(cell, crop, today) {
  if (!cell) return 'locked';
  if (cell.t === 'soil') return 'soil';
  if (cell.t === 'dead') return 'dead';
  if (cell.ripeDay) return dayNum(today) - dayNum(cell.ripeDay) >= OVERRIPE_AFTER ? 'over' : 'ripe';
  if (cell.thirst >= WITHER) return 'dry';
  return crop && cell.g / crop.days >= 0.5 ? 'grow' : 'seed';
}

/**
 * 봇에 주는 모양. **셈은 다 끝낸 채로** 준다 — 봇이 규칙을 다시 갖지 않게.
 *
 *   left   아직 안 익은 칸이 익기까지 남은 물주기 횟수(가장 적은 칸 기준)
 *   thirsty 어제 물을 못 받은 칸 수(오늘도 못 받으면 시든다)
 */
function view(farm, today) {
  return {
    channelId: farm.channelId,
    owner: farm.owner,
    createdAt: farm.createdAt,
    graceUntil: new Date(Date.parse(farm.createdAt) + GRACE_MS).toISOString(),
    today,
    watered: farm.water?.day === today,
    waterBy: farm.water?.day === today ? farm.water.by : null,
    plots: farm.plots.map((p) => {
      const crop = CROP_BY_KEY[p.crop] ?? null;
      const cells = p.open ? p.cells.map((cell) => cellState(cell, crop, today)) : Array(CELLS).fill('locked');
      const growing = p.cells.filter((cell) => cell.t === 'plant' && !cell.ripeDay);
      return {
        open: p.open,
        crop: p.crop,
        cells,
        ripe: cells.filter((s) => s === 'ripe' || s === 'over').length,
        dead: cells.filter((s) => s === 'dead').length,
        growing: growing.length,
        thirsty: growing.filter((cell) => cell.thirst === WITHER - 1).length,
        left: crop && growing.length ? Math.min(...growing.map((cell) => Math.max(0, Math.ceil(crop.days - cell.g)))) : null,
      };
    }),
  };
}

module.exports = {
  PLOTS, CELLS, START_PLOT, WITHER, DEATH, OVERRIPE_AFTER, ROT_AFTER, GRACE_MS, COOLDOWN_DAYS,
  dayNum, keyOf, addDays,
  newFarm, tick, water, plant, harvest, view,
};
