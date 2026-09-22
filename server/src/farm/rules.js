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
 * 몇 번 다시 셈해도 같다. 날씨(`weather.js`, 4a)도 날짜 해시다 — 비 · 서리 · 폭풍이 같은 칸에
 * 같게 걸린다. **오늘 비**도 조회할 때 셈한다(`wet=오늘` 로 적으므로 두 번 셈해도 같다).
 *
 * **설비**(4b, `equip.js`)는 농장 문서에 적는다 — `farm.equip` 과 밭마다 `cover`(덮개) · `stakes`(지지대).
 * 스프링클러도 하루치 셈 안에서 돈다. 정해진 규칙이라 몇 번 셈해도 같다.
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
 *       regrows  재수확으로 다시 자란 횟수 — 재수확으로 거둔 칸은 농장 경험치가 절반이다(3c)
 *   { t: 'dead', why: 'dry' | 'rot' }               죽음. 치우면 빈 흙
 *   { t: 'canopy' }                                 나무 그늘(4c) — 나무가 있는 밭의 둘레 여덟 칸. 못 심는다
 *
 * **과수**(4c, `crop.tree`)는 밭 가운데 칸(`TREE_CELL`) 하나에 사는 작물이다 — 물 · 시듦 · 재수확은
 * 그 칸 하나로 센다. 한 번 거둔 나무(`regrows`)는 **제철이 아니면 휴면**이다(`dormant`) — 물이
 * 필요 없고, 목마르지 않고, 자라지 않는다. 익은 채 두면 열매만 떨어지고 나무는 산다.
 *
 * **뽑기**(4c, `clear` 의 `uproot`)는 자라는 작물을 거두지 않고 없앤다 — 씨앗값은 안 돌려준다.
 */
const {
  CROPS, CROP_BY_KEY, seedPrice, gradeOf, YIELD, TREE_YIELD, starKey, giantKey,
} = require('./crops');
const land = require('./land');
const affinity = require('./affinity');
const quality = require('./quality');
const weather = require('./weather');
const { EQUIP_BY_KEY, emptyEquip } = require('./equip');
const orders = require('./orders');

/** 밭 수, 한 밭의 칸 수. 둘 다 3×3 이고 키패드 배치다(1 2 3 / 4 5 6 / 7 8 9). */
const PLOTS = 9;
const CELLS = 9;
/** 처음부터 열려 있는 밭 — 키패드 5번(가운데)의 index. */
const START_PLOT = land.PLOT_ORDER[0];

/** thirst 가 이만큼이면 🍂 시듦, 이만큼이면 💀. 물 욕심 작물(`thirsty`, 3c)은 하루씩 빠르다. */
const WITHER = 2;
const DEATH = 4;
/** 나무는 더 오래 버틴다(4c) — 사흘에 시들고 이레에 죽는다. */
const TREE_WITHER = 3;
const TREE_DEATH = 7;
const witherAt = (crop) => {
  if (crop?.tree) return TREE_WITHER;
  return crop?.thirsty ? WITHER - 1 : WITHER;
};
const deathAt = (crop) => {
  if (crop?.tree) return TREE_DEATH;
  return crop?.thirsty ? DEATH - 1 : DEATH;
};
/** 나무가 서는 칸 — 밭 가운데(키패드 5). */
const TREE_CELL = 4;
/** 한 번 거둔 나무가 제철이 아닌 날 — 휴면(4c). */
const dormant = (crop, cell, day) => Boolean(crop?.tree && cell.regrows && !cell.ripeDay && !weather.inSeason(crop, day));
/** 그날 물이 필요한(자라는) 칸 — 익었거나 휴면이면 아니다. */
const growingCell = (crop, cell, day) => cell.t === 'plant' && !cell.ripeDay && !dormant(crop, cell, day);
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
    equip: emptyEquip(),    // 설비(4b) — 밭마다 사는 덮개·지지대는 `plots[].cover · stakes`
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
  if (!farm.equip || typeof farm.equip !== 'object') farm.equip = emptyEquip();   // 4b
  for (const p of farm.plots) {
    if (!Number.isFinite(p.soilXp)) p.soilXp = 0;
    if (!Array.isArray(p.history)) p.history = [];     // 3a — 다 거두고 비운 작물 계열
    if (!Number.isFinite(p.streak)) p.streak = 0;      // 3a — 비우지 않고 이어 거둔 칸 수
    if (!Array.isArray(p.cells)) p.cells = [];
    // 2a 버그로 작물에 묶인 밭 — 작물 칸이 없는데 `crop` 이 남아 있으면 푼다
    if (p.crop && p.cells.length && !holdsCrop(p)) freePlot(p);
    for (const c of p.cells) {
      if (c.t === 'plant' && c.wet === undefined) c.wet = farm.water.day ?? null;
    }
  }
  // 레벨표를 낮춰(4a) 레벨만 오르고 밭이 안 열린 농장 — 그 레벨까지의 밭을 연다. 조회도 이 길을
  // 지나므로 돌 자리는 **해시로** 정한다(몇 번 셈해도 같은 밭).
  land.PLOT_ORDER.slice(0, levelOf(farm)).forEach((pi) => {
    if (farm.plots[pi].open) return;
    let n = 0;
    farm.plots[pi] = land.makePlot(() => land.hashRand(farm.channelId, 'plot', pi, n++));
  });
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
  const crops = CROPS.filter((c) => !c.seedOnly && c.lv > from && c.lv <= to).map((c) => c.key);
  return { from, to, opened, crops };
}

/**
 * 그 밭에서 그날 물 한 번에 쌓이는 성장 — 토질 배율 × 잡초 × 궁합·연작(`affinity.js`)
 * × 제철·날씨(`weather.growthOf` — 흐림 ×0.9, 제철이 아니면 ×0.7, 용의 고추·쌀·월광초).
 */
function rateOf(farm, pi, day) {
  const plot = farm.plots[pi];
  const speed = land.SOIL_SPEED[land.soilStar(plot.soilXp) - 1];
  const weed = plot.cells.some((c) => c.t === 'weed') ? land.WEED_SLOW : 1;
  const sky = day ? weather.growthOf(CROP_BY_KEY[plot.crop], day) : 1;
  return speed * weed * (affinity.modsFor(farm, pi)?.rate ?? 1) * sky;
}

/**
 * 그날 한 칸에 물을 준다 — 사람이 주든 비가 주든 같은 셈. 시든 칸은 살아나고(`scar`),
 * 그날치 성장이 붙는다. 다 자라면 `ripeDay`. 되살렸는지(`revived`) · 익었는지(`ripened`) 를 준다.
 */
function wetCell(farm, pi, cell, day) {
  const crop = CROP_BY_KEY[farm.plots[pi].crop];
  let revived = false;
  if (cell.thirst >= witherAt(crop)) { revived = true; cell.scar = true; }
  cell.thirst = 0;
  cell.wet = day;
  cell.g = round(cell.g + rateOf(farm, pi, day));
  const ripened = cell.g >= crop.days;
  if (ripened) cell.ripeDay = day;
  return { revived, ripened };
}

/** 그날 아직 물을 안 받은 자라는 칸 전부에 물을 준다. 준 칸 수. 몇 번 불러도 같다. */
function wetAll(farm, day) {
  let n = 0;
  farm.plots.forEach((p, pi) => {
    const crop = CROP_BY_KEY[p.crop];
    if (!p.open || !crop) return;
    for (const cell of p.cells) {
      if (growingCell(crop, cell, day) && cell.wet !== day) { wetCell(farm, pi, cell, day); n += 1; }
    }
  });
  return n;
}

/** 비(폭우)가 그날 물을 준다. */
function rainOn(farm, day) {
  if (weather.weatherOf(day).water) wetAll(farm, day);
}

/**
 * 스프링클러(4b) — **한 주에 한 번**, 그 주에 처음으로 물을 못 받은 칸이 남은 날에 그 칸들에
 * 물을 준다. 하루가 끝난 날(`tick`)에만 돈다 — 오늘은 아직 사람이 줄 수 있다. 산 날(`since`)
 * 부터만. 그날 날씨대로 자라고, 물주기 경험치는 없다(사람이 준 물이 아니다).
 */
function sprinkle(farm, day) {
  const sp = farm.equip?.sprinkler;
  if (!sp || day < sp.since || sp.week === weather.weekOf(day)) return;
  if (wetAll(farm, day)) { sp.week = weather.weekOf(day); sp.last = day; }
}

/** 오늘 물 한 포기에 드는 체력 — 폭염이면 2, 빗물통(4b)이 있으면 1. */
const hpCostOf = (farm, day) => (farm.equip?.rainBarrel ? 1 : weather.hpCost(day));

const loseSoil = (plot, n) => { plot.soilXp = Math.max(0, (plot.soilXp ?? 0) - n); };

/**
 * 밭에 그 작물이 **남아 있나** — 자라는 칸이나 죽은 칸(치우기 전)이 하나라도 있으면 그렇다.
 * 돌·바위·잡초·빈 흙만 남았으면 작물은 끝난 것이다. "전부 빈 흙" 으로 보면 돌 하나 때문에
 * 다 거둔 밭이 작물에 묶여 다른 것을 못 심는다(2a 의 버그 — simulate-farm 이 잡았다).
 */
const holdsCrop = (plot) => plot.cells.some((c) => c.t === 'plant' || c.t === 'dead');

/** 작물이 끝난 밭을 푼다 — 작물을 비우고, 나무 그늘(4c)은 빈 흙으로. */
function freePlot(plot) {
  plot.crop = null;
  plot.streak = 0;
  plot.cells = plot.cells.map((c) => (c.t === 'canopy' ? soil() : c));
}

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
    const sky = weather.weatherOf(key);
    orders.ensureRequests(farm, key, levelOf(farm));  // 개인 의뢰(5a) — 못 들른 날에도 하루 한 건
    rainOn(farm, key);                               // 비 — 체력 없이 물을 준 날
    sprinkle(farm, key);                             // 스프링클러 — 그 주 처음 못 받은 날
    farm.plots.forEach((plot, pi) => {
      if (!plot.open) return;
      const crop = CROP_BY_KEY[plot.crop];
      plot.cells.forEach((cell, i) => {
        if (cell.t === 'soil') {
          if (land.hashRand(farm.channelId, key, pi, i) < land.WEED_CHANCE) plot.cells[i] = { t: 'weed' };
          return;
        }
        if (cell.t !== 'plant') return;
        if (cell.ripeDay && crop?.tree) {
          // 나무(4c) — 오래 두면 열매만 떨어진다. 나무는 살아서 다음 열매를 맺는다(휴면일 수도 있다).
          if (d - dayNum(cell.ripeDay) + 1 >= ROT_AFTER) {
            Object.assign(cell, {
              g: round(crop.days - crop.regrow), thirst: 0, ripeDay: null, regrows: (cell.regrows ?? 0) + 1, wet: null,
            });
          }
          return;
        }
        if (dormant(crop, cell, key)) return;              // 휴면 — 목마르지도, 서리도 안 탄다
        if (cell.ripeDay) {
          // 도망(3c) — 익은 날 밤까지 안 거두면 같은 밭 빈 흙으로 옮겨 가 이튿날 하루 더 익어 있다.
          // 옮길 자리는 해시로 — 몇 번을 다시 셈해도 같은 칸으로 간다. 빈 흙이 없으면 사라진다.
          if (crop?.flee && d === dayNum(cell.ripeDay)) {
            const room = plot.cells.map((c, j) => (c.t === 'soil' ? j : -1)).filter((j) => j >= 0);
            plot.cells[i] = soil();
            if (room.length) {
              const to = room[Math.floor(land.hashRand(farm.channelId, key, pi, i, 'flee') * room.length)];
              plot.cells[to] = { ...cell, ripeDay: keyOf(d + 1), fled: (cell.fled ?? 0) + 1 };
            }
            return;
          }
          // 이날이 끝나면 다 자란 지 (d − R + 1)일. 그게 ROT_AFTER 가 되는 밤에 썩는다.
          if (d - dayNum(cell.ripeDay) + 1 >= ROT_AFTER) {
            plot.cells[i] = { t: 'dead', why: 'rot' };
            loseSoil(plot, land.DEATH_SOIL);
          }
          return;
        }
        if (cell.wet !== key) cell.thirst += 1;
        // 서리 — 제철이 아닌 칸이 한 단계 상한다(4b 덮개가 막는다)
        if (sky.key === 'frost' && !weather.inSeason(crop, key) && !plot.cover) cell.thirst += 1;
        // 폭풍 — 키 큰 작물 칸의 30% 가 쓰러져 시든다(4b 지지대가 막는다)
        if (sky.key === 'storm' && crop?.tall && !crop.tree && !plot.stakes && land.hashRand(farm.channelId, key, pi, i, 'storm') < weather.STORM_FALL) {
          cell.thirst = Math.max(cell.thirst, witherAt(crop));
          cell.scar = true;
        }
        if (cell.thirst >= deathAt(crop)) {
          plot.cells[i] = { t: 'dead', why: 'dry' };
          loseSoil(plot, land.DEATH_SOIL);
        }
      });
    });
  }
  if (end > dayNum(farm.lastTickDay)) farm.lastTickDay = keyOf(end);
  rainOn(farm, today);                               // 오늘 비도 — wet=오늘 이라 몇 번 셈해도 같다
  orders.ensureRequests(farm, today, levelOf(farm));   // 개인 의뢰(5a) — 오늘 것은 해시라 몇 번 셈해도 같다
  return farm;
}

// ---------------------------------------------------------------- 물

/** 오늘 물이 필요한 칸 — `[밭, 칸]`. 시든 칸부터, 그다음 목마른 칸, 그다음 밭이 열린 순서. */
function thirstyCells(farm, today, plot = null) {
  const out = [];
  land.PLOT_ORDER.forEach((pi, order) => {
    if (plot !== null && pi !== plot) return;
    const p = farm.plots[pi];
    const crop = CROP_BY_KEY[p.crop];
    if (!p.open || !crop) return;
    p.cells.forEach((cell, i) => {
      if (growingCell(crop, cell, today) && cell.wet !== today) out.push({ pi, i, order, thirst: cell.thirst });
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
  if (weather.weatherOf(today).water) return { ok: false, reason: 'rain', weather: weather.weatherOf(today).key };
  const need = thirstyCells(farm, today, plot);
  if (!need.length) {
    const any = farm.plots.some((p) => p.cells.some((c) => growingCell(CROP_BY_KEY[p.crop], c, today)));
    return { ok: false, reason: any ? 'already' : 'noPlants', by: farm.water?.day === today ? farm.water.by : [] };
  }
  if (budget < 1) return { ok: false, reason: 'tired', need: need.length };

  let revived = 0; let ripened = 0;
  const given = need.slice(0, budget);
  for (const { pi, i } of given) {
    const w = wetCell(farm, pi, farm.plots[pi].cells[i], today);
    if (w.revived) revived += 1;
    if (w.ripened) ripened += 1;
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
 * 희귀 작물(`seedOnly`)은 레벨을 안 보고, 골드 대신 **주머니 씨앗**을 칸마다 하나 쓴다 —
 * 가진 씨앗(`pouch`)보다 많이 심지 못한다. 쓴 수는 `seeds` 로 돌려준다.
 */
function plant(farm, today, { plot, cells, crop }, { pouch = 0 } = {}) {
  if (badPlot(plot)) return bad('plot');
  const c = CROP_BY_KEY[crop];
  if (!c) return bad('crop');
  if (!Array.isArray(cells) || !cells.length || cells.length > CELLS
    || !cells.every((i) => Number.isInteger(i) && i >= 0 && i < CELLS)
    || new Set(cells).size !== cells.length) return bad('cells');

  const p = farm.plots[plot];
  if (!p.open) return { ok: false, reason: 'locked' };
  if (!c.seedOnly && c.lv > levelOf(farm)) return { ok: false, reason: 'level', need: c.lv, crop };
  if (c.seedOnly && pouch < cells.length) return { ok: false, reason: 'noSeed', crop, have: pouch, need: cells.length };
  if (p.crop && p.crop !== crop) return { ok: false, reason: 'otherCrop', crop: p.crop };
  if (c.tree) {
    // 나무(4c) — 밭 하나를 통째로. 아홉 칸이 다 빈 흙이어야 하고, 묘목값은 밭에 한 번.
    if (p.crop) return { ok: false, reason: 'otherCrop', crop: p.crop };
    if (p.cells.some((x) => x.t !== 'soil')) return { ok: false, reason: 'needClear', crop };
    p.cells = p.cells.map((_, i) => (i === TREE_CELL
      ? { t: 'plant', g: 0, thirst: 0, scar: false, ripeDay: null, planted: today, wet: null }
      : { t: 'canopy' }));
    p.crop = crop;
    p.streak = 0;
    return { ok: true, cost: seedPrice(c), count: 1, crop, seeds: 0, tree: true };
  }
  if (cells.some((i) => p.cells[i].t !== 'soil')) return { ok: false, reason: 'occupied' };

  for (const i of cells) {
    p.cells[i] = {
      t: 'plant', g: 0, thirst: 0, scar: false, ripeDay: null, planted: today, wet: null,
    };
  }
  if (p.crop !== crop) p.streak = 0;
  p.crop = crop;
  return {
    ok: true, cost: seedPrice(c) * cells.length, count: cells.length, crop, seeds: c.seedOnly ? cells.length : 0,
  };
}

// ---------------------------------------------------------------- 수확

/**
 * 다 자란 칸을 거두고, 죽은 칸과 잡초를 치운다. `plot` 을 안 주면 열린 밭 전부.
 *
 * 칸마다 **토질 ★ 과 작물 등급**으로 1~3개(§4). 품질은 칸마다 굴린다(`quality.js`, 3b) — ★ 이면
 * `당근S1` 처럼 변형 키로 준다. 품질 경험치는 없다(`quality.STAR_XP` — simulate-farm 으로 0).
 * **거대 작물**(3b): 아홉 칸이 다 익고 한 번도 안 시든 거대 작물 밭은 확률로 대왕 작물 하나가 된다.
 * 실패하면 그 밭 품질 +10.
 * 재수확 작물은 칸이 남아 `regrow` 일 뒤에 다시 익는다.
 * 작물 칸이 하나도 안 남으면(돌·잡초는 남아도) 밭의 작물을 비운다 — 다른 것을 심을 수 있게.
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
  let harvested = 0; let cleared = 0; let weeds = 0; let xp = 0; let screams = 0; let spread = 0;
  const grades = {};            // 작물마다 칸 품질 분포 `[보통, ★, ★★, ★★★]` — 도감·문구
  const giants = [];            // 대왕 작물 `{ crop, plot }`
  const level = levelOf(farm);
  for (const p of targets) {
    const pi = farm.plots.indexOf(p);
    const crop = CROP_BY_KEY[p.crop];
    const star = land.soilStar(p.soilXp);
    const [lo, hi] = crop ? (crop.tree ? TREE_YIELD : YIELD[gradeOf(crop)])[star - 1] : [0, 0];
    // 궁합은 **거두기 전** 밭 모양으로 셈한다 — 거두다 이웃이 비면 값이 흔들린다.
    const mods = crop ? affinity.modsFor(farm, pi) : null;
    let here = 0; let again = 0; let bonus = 0;

    // 거대 작물 — 아홉 칸이 하나로
    if (quality.giantReady(p, crop, level)) {
      if (rand() < quality.giantChance(star)) {
        add(giantKey(crop.key), 1);
        giants.push({ crop: crop.key, plot: pi });
        p.cells = p.cells.map(soil);
        here = 9;
        xp += land.XP.giant;
      } else {
        bonus = quality.GIANT_MISS;        // 아깝게 못 합쳐졌다 — 그 밭 품질 +10
      }
    }

    p.cells.forEach((cell, i) => {
      if (cell.t === 'dead') { p.cells[i] = soil(); cleared += 1; farm.compostBits += 1; return; }
      if (cell.t === 'weed') { p.cells[i] = soil(); weeds += 1; farm.compostBits += 1; add('dandelion', 1); return; }
      if (cell.t !== 'plant' || !cell.ripeDay || !crop) return;
      const n = land.between(rand, lo, hi);
      const overripe = dayNum(today) - dayNum(cell.ripeDay) >= OVERRIPE_AFTER;
      const roll = () => quality.rollQuality({
        crop, soilStar: star, cell, mods, overripe, bonus, season: weather.qualityOf(crop, today, { drain: farm.equip?.drain }), rand,
      });
      if (crop.tree) {
        // 나무(4c) — 열매마다 품질을 굴린다(도감도 열매마다). 경험치 · 토질은 **밭 한 판(아홉 칸)**
        // 을 거둔 것으로 센다 — 열매 수로 세면 열매가 많은 나무가 레벨을 끌어올린다.
        for (let k = 0; k < n; k += 1) {
          const q = roll();
          add(starKey(crop.key, q.star), 1);
          (grades[crop.key] ??= [0, 0, 0, 0])[q.star] += 1;
        }
        here += CELLS;
        if (cell.regrows) again += CELLS;
      } else {
        const q = roll();
        add(starKey(crop.key, q.star), n);
        (grades[crop.key] ??= [0, 0, 0, 0])[q.star] += 1;
        xp += quality.STAR_XP[q.star];
        here += 1;
        if (cell.regrows) again += 1;
      }
      if (crop.regrow) {
        // 새 한 철이다. 시든 흔적도 지운다.
        Object.assign(cell, {
          g: round(crop.days - crop.regrow), thirst: 0, scar: false, ripeDay: null, regrows: (cell.regrows ?? 0) + 1,
        });
      } else {
        p.cells[i] = soil();
      }
    });
    // 퍼짐(3c) — 거둔 밭의 빈 흙 한 칸에 한 포기가 저절로 번진다. 씨앗값은 없다.
    if (here && crop.spread) {
      const room = p.cells.map((c, j) => (c.t === 'soil' ? j : -1)).filter((j) => j >= 0);
      if (room.length) {
        p.cells[room[Math.floor(rand() * room.length)]] = {
          t: 'plant', g: 0, thirst: 0, scar: false, ripeDay: null, planted: today, wet: null,
        };
        spread += 1;
      }
    }
    // 비명(3c) — 밭을 한 번 거둘 때마다 한 번. 귀마개·체력은 컨트롤러가 계정에서 셈한다.
    if (here && crop.scream) screams += 1;
    if (here) {
      const base = here + (crop.family === 'legume' ? land.LEGUME_SOIL : 0);
      p.soilXp += Math.round(base * (mods?.soil ?? 1));
      if (!crop.regrow) p.streak = (p.streak ?? 0) + here;
      // 처음 거둔 칸은 1, 재수확으로 거둔 칸은 절반
      xp += (here - again) * land.XP.harvest + again * land.XP.regrow;
      if (!farm.grown.includes(crop.key)) { farm.grown.push(crop.key); xp += land.XP.firstCrop; }
      harvested += here;
    }
    if (p.crop && !holdsCrop(p)) {
      if (crop && !crop.perennial) p.history = [...(p.history ?? []), crop.family].slice(-3);
      freePlot(p);
    }
  }
  if (!harvested && !cleared && !weeds) return { ok: false, reason: 'nothing' };
  const levelUp = gainXp(farm, xp, rand);
  const compost = takeCompost(farm);
  if (compost) add('compost', compost);
  return {
    ok: true, items, harvested, cleared, weeds, xp, levelUp, compost, screams, spread, grades, giants,
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
 * 돌려주는 `used` 만큼 컨트롤러가 기력을 깎고, `fossils`·`found` 만큼 화석·희귀 씨앗 상한을 쓴다.
 * 희귀 씨앗은 `loot` 이 아니라 `seeds` 로 온다 — 계정 아이템이 아니라 주머니로 간다.
 * `tool` 은 곡괭이(`land.PICKAXES`). 철부터는 빗나간 힌트에 거리(`dist`)가 붙는다.
 *
 * **뽑기**(4c) `{ plot, cell, uproot: 'cell' | 'plot' }` — 작물을 거두지 않고 없앤다. 기력은 안 든다.
 * `cell` 은 그 칸만, `plot` 은 그 밭의 작물 칸 전부(죽은 칸 포함). 나무는 어느 쪽이든 **밭 전체**다.
 * 씨앗값은 돌려주지 않고, 퇴비 조각도 없다(싼 씨앗을 뽑아 퇴비를 찍어 내지 못하게).
 * 윤작 기록(`history`)에도 안 적는다 — 거둔 것이 아니다.
 */
function clear(farm, today, {
  plot, cell = null, pos = null, all = false, uproot = null,
}, {
  rand = Math.random, stamina = 0, fossilLeft = 0, seedLeft = 0, tool = 'wood',
} = {}) {
  if (badPlot(plot)) return bad('plot');
  const p = farm.plots[plot];
  if (!p.open) return { ok: false, reason: 'locked' };

  const loot = {};
  const seeds = {};
  let fossils = 0; let found = 0;
  const roll = (table) => {
    const key = land.rollLoot(table, rand, { fossilLeft: fossilLeft - fossils, seedLeft: seedLeft - found });
    if (key === 'oddFossil') fossils += 1;
    if (key.startsWith('seed:')) {
      const crop = key.slice(5);
      seeds[crop] = (seeds[crop] ?? 0) + 1;
      found += 1;
      return;
    }
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
      ok: true, loot, seeds, found, fossils, levelUp, compost, ...extra, xp,
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

  if (uproot !== null) {
    if (uproot !== 'cell' && uproot !== 'plot') return bad('uproot');
    const crop = CROP_BY_KEY[p.crop];
    const isCrop = (x) => x.t === 'plant' || x.t === 'dead';
    if (!isCrop(c) && !(crop?.tree && c.t === 'canopy')) return { ok: false, reason: 'notPlant' };
    const whole = uproot === 'plot' || crop?.tree;
    let removed = 0;
    p.cells.forEach((x, i) => {
      if ((whole || i === cell) && isCrop(x)) { p.cells[i] = soil(); removed += 1; }
    });
    const freed = !holdsCrop(p);
    const was = p.crop;
    if (freed) freePlot(p);
    return {
      ok: true, kind: 'uproot', used: 0, removed, crop: was, freed, tree: Boolean(crop?.tree), loot: {}, seeds: {}, found: 0, fossils: 0, xp: 0, levelUp: null, compost: 0,
    };
  }

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

// ---------------------------------------------------------------- 설비 (4b)

/**
 * 설비를 산다 — `{ key, plots? }`. 값(`cost`)은 컨트롤러가 계정에서 뺀다 — 모자라면 이 사본을 버린다.
 *   농장 전체  이미 있으면 `owned`
 *   밭마다     `plots` 가운데 **열려 있고 아직 없는 밭**에만. 하나도 없으면 `noPlot` · `owned`
 * 레벨이 모자라면 `equipLevel`.
 */
function buyEquip(farm, today, { key, plots = null }) {
  const e = EQUIP_BY_KEY[key];
  if (!e) return bad('equip');
  if (levelOf(farm) < e.lv) return { ok: false, reason: 'equipLevel', key, need: e.lv };
  if (e.per === 'farm') {
    if (farm.equip[key]) return { ok: false, reason: 'owned', key };
    farm.equip[key] = key === 'sprinkler' ? { since: today, week: null, last: null } : true;
    return { ok: true, key, plots: [], cost: e.gold };
  }
  if (!Array.isArray(plots) || !plots.length || plots.some(badPlot) || new Set(plots).size !== plots.length) return bad('plots');
  const open = plots.filter((pi) => farm.plots[pi].open);
  if (!open.length) return { ok: false, reason: 'noPlot', key };
  const fresh = open.filter((pi) => !farm.plots[pi][key]);
  if (!fresh.length) return { ok: false, reason: 'owned', key };
  for (const pi of fresh) farm.plots[pi][key] = true;
  return { ok: true, key, plots: fresh, cost: e.gold * fresh.length };
}

/** 설비 개수 — 농장 전체 하나씩 + 밭마다 산 것. 폐농 확인 창이 적는다. */
const equipCount = (farm) => ['rainBarrel', 'drain', 'sprinkler'].filter((k) => farm.equip?.[k]).length
  + farm.plots.reduce((n, p) => n + (p.cover ? 1 : 0) + (p.stakes ? 1 : 0), 0);

/**
 * 내일 날씨에 설비 없이 다칠 밭 — 서리면 덮개 없이 제철 아닌 작물이 자라는 밭, 폭풍이면 지지대
 * 없이 키 큰 작물이 자라는 밭. 없으면 `null`. 농장 화면의 경고 줄이 읽는다.
 */
function riskOf(farm, today) {
  const day = addDays(today, 1);
  const sky = weather.weatherOf(day).key;
  if (sky !== 'frost' && sky !== 'storm') return null;
  const plots = [];
  farm.plots.forEach((p, pi) => {
    const crop = CROP_BY_KEY[p.crop];
    if (!p.open || !crop || !p.cells.some((c) => growingCell(crop, c, day))) return;
    if (sky === 'frost' && !p.cover && !weather.inSeason(crop, day)) plots.push(pi);
    if (sky === 'storm' && !p.stakes && crop.tall && !crop.tree) plots.push(pi);
  });
  return plots.length ? { weather: sky, plots } : null;
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
  if (['soil', 'rock', 'weed', 'dead', 'canopy'].includes(cell.t)) return cell.t;
  if (dormant(crop, cell, today)) return 'dormant';
  if (cell.ripeDay) return dayNum(today) - dayNum(cell.ripeDay) >= OVERRIPE_AFTER ? 'over' : 'ripe';
  if (cell.thirst >= witherAt(crop)) return 'dry';
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
    xp: Math.floor(farm.xp),     // 재수확 경험치가 절반이라 소수가 생긴다 — 화면엔 내림
    xpFloor: land.LEVEL_XP[level - 1],
    xpNext: land.nextLevelXp(level),
    sign: land.signOf(level),
    nextPlot: level < land.MAX_LEVEL ? land.PLOT_ORDER[level] : null,
    compostBits: farm.compostBits,
    waterBy: farm.water?.day === today ? farm.water.by : [],
    need: thirstyCells(farm, today).length,
    sky: weather.forecast(today),
    hpCost: hpCostOf(farm, today),
    equip: {
      rainBarrel: !!farm.equip?.rainBarrel,
      drain: !!farm.equip?.drain,
      sprinkler: farm.equip?.sprinkler
        ? { ready: farm.equip.sprinkler.week !== weather.weekOf(today), last: farm.equip.sprinkler.last ?? null }
        : null,
    },
    equipCount: equipCount(farm),
    requests: farm.requests ?? [],
    risk: riskOf(farm, today),
    plots: farm.plots.map((p) => {
      const crop = CROP_BY_KEY[p.crop] ?? null;
      const cells = p.open ? p.cells.map((cell) => cellState(cell, crop, today)) : Array(CELLS).fill('locked');
      const growing = p.cells.filter((cell) => growingCell(crop, cell, today));
      const dry = growing.filter((cell) => cell.wet !== today);
      const star = land.soilStar(p.soilXp);
      const pi = farm.plots.indexOf(p);
      const rate = p.open ? rateOf(farm, pi, today) : 1;
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
        thirsty: dry.filter((cell) => cell.thirst === witherAt(crop) - 1).length,
        left: crop && growing.length
          ? Math.min(...growing.map((cell) => Math.max(0, Math.ceil(round((crop.days - cell.g) / rate)))))
          : null,
        swings,
        fert: p.open ? fertToday(farm, today, pi) : {},
        history: p.history ?? [],
        tree: crop?.tree && p.open
          ? { dormant: p.cells.some((cell) => cell.t === 'plant' && dormant(crop, cell, today)), fruited: p.cells.some((cell) => cell.regrows) }
          : null,
        cover: !!p.cover,
        stakes: !!p.stakes,
        inSeason: crop ? weather.inSeason(crop, today) : null,
        mods: mods && { growth: mods.growth, rate: round(mods.rate), quality: mods.quality, soil: mods.soil, rotation: mods.rotation, notes: mods.notes },
      };
    }),
  };
}

module.exports = {
  PLOTS, CELLS, START_PLOT, WITHER, DEATH, TREE_CELL, TREE_WITHER, TREE_DEATH, OVERRIPE_AFTER, ROT_AFTER, GRACE_MS, COOLDOWN_DAYS,
  dayNum, keyOf, addDays,
  newFarm, upgrade, levelOf, gainXp, tick, water, plant, harvest, clear, fertilize, candidates, view,
  buyEquip, equipCount, hpCostOf,
};
