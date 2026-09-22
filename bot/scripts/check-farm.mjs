/**
 * check-farm — 농장 작물표·전리품·화면 검사
 *
 *   node scripts/check-farm.mjs
 *
 * 규칙은 서버가 판정한다(server/scripts/check-farm.js 가 본다). 여기서는 봇 쪽이 서버와
 * **어긋나지 않는지**와 화면이 디스코드 한도 안에 드는지만 본다.
 *
 *   1. 서버 작물표의 키가 봇 명부에 있고, **파는 값과 이름이 같다.** 서버는 아이템 값을 몰라
 *      씨앗값을 셈하려고 옮겨 적었다 — 한쪽만 고치면 "수확하면 반드시 남는다" 가 깨진다
 *   2. 서버 전리품 표의 키가 명부에 있다(없으면 계정에 이름 없는 물건이 쌓인다)
 *   3. 격자와 밭 줄이 서버가 주는 모양 그대로 그려진다
 *   4. 심기·개간·바위 창이 5줄 · 줄마다 5개 · customId 100자 안이고, customId 가 겹치지 않는다
 *   5. 서버가 돌려줄 수 있는 사유(`reason`)마다 문장이 있다
 *   6. 봇이 화면에 적으려고 옮겨 적은 수(거름 한도 · 퇴비 비율 · 곡괭이)가 서버와 같다
 *
 * 레포 안에서만 도는 검사라 서버 파일을 직접 읽는다(배포된 봇은 서버 폴더를 모른다).
 */
process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= 'x';
process.env.DISCORD_GUILD_ID ||= 'x';
process.env.GEMINI_API_KEY ||= '';

import { createRequire } from 'node:module';
import { ITEM_BY_KEY } from '../src/casino/items.js';
import { grid, plotLines, cellEmoji, levelLine, nextLine, modsBadge } from '../src/farm/render.js';
import {
  plantPayload, clearPayload, boulderPayload, fertPayload, toolsPayload, bookPayload, swingNote, harvestNote, harvestLine, why,
  cellsOf, maskOf, unlocked, modsLines, PLANT_PAGE,
} from '../src/commands/farm.js';
import { flatShare } from '../src/casino/crafts.js';
import { FARM_CROPS } from '../src/casino/items.js';
import { SHELVES } from '../src/commands/shop.js';

const require = createRequire(import.meta.url);
const { CROPS, publicCrop } = require('../../server/src/farm/crops.js');
const land = require('../../server/src/farm/land.js');
const rules = require('../../server/src/farm/rules.js');
const affinity = require('../../server/src/farm/affinity.js');

let ok = 0; let bad = 0;
const eq = (name, got, want) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { ok += 1; console.log(`  ✓ ${name}`); } else { bad += 1; console.log(`  ✗ ${name}\n     받음: ${JSON.stringify(got)}\n     기대: ${JSON.stringify(want)}`); }
};

// ---------------------------------------------------------------- 1. 작물표

eq('작물 키가 명부에 있다', CROPS.filter((c) => !ITEM_BY_KEY[c.key]).map((c) => c.key), []);
eq('작물은 재료다', CROPS.filter((c) => ITEM_BY_KEY[c.key]?.kind !== '재료').map((c) => c.key), []);
eq('파는 값이 명부와 같다', CROPS.filter((c) => ITEM_BY_KEY[c.key]?.price !== c.price).map((c) => `${c.key} 서버 ${c.price} · 명부 ${ITEM_BY_KEY[c.key]?.price}`), []);
eq('이름이 명부와 같다', CROPS.filter((c) => ITEM_BY_KEY[c.key]?.name !== c.name).map((c) => c.key), []);
eq('팔 수 있다', CROPS.filter((c) => !ITEM_BY_KEY[c.key]?.sell).map((c) => c.key), []);
const crops = CROPS.map(publicCrop);
eq('씨앗값 < 파는 값', crops.filter((c) => !c.seedOnly && !(c.seed >= 1 && c.seed < c.price)).map((c) => c.key), []);
eq('희귀 작물은 씨앗값 0', crops.filter((c) => c.seedOnly && c.seed !== 0).map((c) => c.key), []);
eq('이모지가 있다', crops.filter((c) => !c.emoji).map((c) => c.key), []);
eq('심을 수 있는 작물은 최근에 풀린 것부터', unlocked(crops, 10)[0].lv, 8);
eq('Lv1 이면 Lv1 작물만(희귀 빼고)', unlocked(crops, 1).every((c) => c.lv === 1 && !c.seedOnly), true);
eq('희귀는 주머니에 있을 때만 · 맨 앞', unlocked(crops, 1, { walkingCap: 2 }).map((c) => c.key)[0], 'walkingCap');
eq('주머니가 0 이면 안 보인다', unlocked(crops, 10, { walkingCap: 0 }).some((c) => c.seedOnly), false);

// ---------------------------------------------------------------- 2. 전리품

const lootKeys = [...new Set([...land.LOOT.normal, ...land.LOOT.perfect].map(([k]) => k).filter((k) => k !== 'ore' && k !== 'seed')), ...land.ORES, 'dandelion'];
eq('희귀 씨앗은 작물표의 희귀 작물', land.RARE_SEEDS.filter((k) => !crops.find((c) => c.key === k)?.seedOnly), []);
eq('전리품 키가 명부에 있다', lootKeys.filter((k) => !ITEM_BY_KEY[k]), []);
eq('전리품은 팔 수 있다', lootKeys.filter((k) => !ITEM_BY_KEY[k]?.sell), []);
eq('거름 키가 명부에 있다', Object.keys(land.FERTS).filter((k) => !ITEM_BY_KEY[k]), []);
eq('곡괭이 재료가 명부에 있다', land.PICKAXES.flatMap((t) => Object.keys(t.items)).filter((k) => k !== 'ore' && !ITEM_BY_KEY[k]), []);
eq('비료·귀마개는 상점 농사 진열대에 있다', SHELVES.find((sh) => sh.key === 'farm')?.keys, ['fertilizer', 'earPlug']);

// ---------------------------------------------------------------- 3. 화면

const D = '2026-09-01';
const OWNER = '123456789012345678';
const CH = '987654321098765432';
const farm = rules.newFarm({ channelId: CH, guildId: '3000001', owner: OWNER, today: D, now: `${D}T00:00:00.000Z` });
// 가운데 밭을 알려진 모양으로 — 돌 · 바위 · 금 간 바위 · 잡초 · 빈 흙 넷 · 심은 칸 하나
farm.plots[4].cells = [
  { t: 'rock' }, { t: 'boulder', grain: 2, swings: 1, cracked: false }, { t: 'boulder', grain: 3, swings: 3, cracked: true },
  { t: 'weed' }, { t: 'soil' }, { t: 'soil' }, { t: 'soil' }, { t: 'soil' }, { t: 'soil' },
];
rules.plant(farm, D, { plot: 4, cells: [4], crop: 'carrot' });
rules.water(farm, D, '1000002');
const v = rules.view(farm, D);

const g = grid(v, crops).split('\n');
eq('격자는 3줄 × 3 + 빈 줄 2', g.length, 11);
eq('잠긴 밭 줄', g[0], '🔒🔒🔒 │ 🔒🔒🔒 │ 🔒🔒🔒');
eq('가운데 밭 첫 줄 — 돌 · 바위 · 금 간 바위', g[4], '🔒🔒🔒 │ 🪨⛰️⛰️ │ 🔒🔒🔒');
eq('가운데 밭 둘째 줄 — 잡초 · 새싹 · 흙', g[5], '🔒🔒🔒 │ 🌼🌱🟫 │ 🔒🔒🔒');
// 잡초가 있어 성장이 ×0.95 — 당근(3)은 물 한 번 뒤 2.05 가 남아 세 번이 더 든다.
eq('밭 줄', plotLines(v, crops), '**5번 밭** ★☆☆☆☆ 🥕 당근 · 자라는 중 1 (물 3번 더) · ⛏️ 돌 3 · 🌼 1');
// 이웃이 준 첫 물도 농장 경험치 +2
eq('레벨 줄', levelLine(v), '**Lv.1** `▰▱▱▱▱▱▱▱` 10% · 2 / 20');
eq('다음 레벨 줄', nextLine(v, crops).startsWith('🔓 _다음 Lv.2 — 2번 밭 · 새 작물 양파'), true);
eq('익은 칸은 작물 그림', cellEmoji('ripe', crops, 'carrot'), '🥕');

// ---------------------------------------------------------------- 4. 창

eq('칸 ↔ 비트', cellsOf(maskOf([0, 4, 8])), [0, 4, 8]);

function limits(name, payload) {
  const rows = payload.components.map((r) => r.toJSON());
  const ids = rows.flatMap((r) => r.components.map((c) => c.custom_id));
  eq(`${name} — 5줄 이하`, rows.length <= 5, true);
  eq(`${name} — 줄마다 5개 이하`, rows.every((r) => r.components.length <= 5), true);
  eq(`${name} — customId 100자 이하`, ids.filter((id) => id.length > 100), []);
  eq(`${name} — customId 가 안 겹친다`, new Set(ids).size, ids.length);
  eq(`${name} — 주인 id 가 맨 뒤`, ids.every((id) => id.endsWith(`:${OWNER}`)), true);
  return rows;
}

// 심기
const fixed = limits('작물 있는 밭 심기', plantPayload({ ch: CH, plot: 4, crop: 'potato', mask: maskOf([0, 4, 5]), owner: OWNER, farm: v, crops }));
eq('작물이 있는 밭은 셀렉트가 없다', fixed[0].components[0].type, 2);
eq('밭 작물로 묶인다', fixed.at(-1).components.find((c) => c.custom_id.startsWith('farm:pg:')).custom_id.split(':')[4], 'carrot');
eq('빈 흙만 고른 것에 남는다', Number(fixed.at(-1).components[0].custom_id.split(':')[5]), maskOf([5]));
eq('돌·잡초 칸은 심기 창에서 막혀 있다', [fixed[0].components[0].disabled, fixed[1].components[0].disabled], [true, true]);

const empty = rules.view(rules.newFarm({ channelId: CH, guildId: '1', owner: OWNER, today: D, now: `${D}T00:00:00.000Z` }), D);
const lockedCrop = plantPayload({ ch: CH, plot: 4, crop: 'tomato', mask: 0, owner: OWNER, farm: empty, crops });
limits('레벨 모자란 작물', lockedCrop);
eq('레벨이 모자란 작물은 고른 것으로 안 친다', lockedCrop.components.at(-1).toJSON().components.find((c) => c.custom_id.startsWith('farm:pg:')).custom_id.split(':')[4], '-');

// 개간
const st = { left: 5, max: 5 };
const cl = limits('개간 창', clearPayload({ ch: CH, plot: 4, owner: OWNER, farm: v, stamina: st, crops }));
eq('돌 · 바위 · 금 간 바위 버튼', cl[0].components.map((c) => c.custom_id.split(':')[1]), ['cr', 'cb', 'cb']);
eq('잡초는 누르면 뽑는다', cl[1].components[0].custom_id.split(':')[1], 'cr');
eq('작물 칸은 막혀 있다', cl[1].components[1].disabled, true);
eq('돌 모두 버튼에 기력', cl.at(-1).components[0].label, '돌 모두 치우기 · 기력 1');
const tired = clearPayload({ ch: CH, plot: 4, owner: OWNER, farm: v, stamina: { left: 0, max: 5 }, crops });
eq('기력이 없으면 돌·바위가 막힌다 (잡초는 된다)', tired.components[0].toJSON().components.map((c) => c.disabled).concat(tired.components[1].toJSON().components[0].disabled ?? false), [true, true, true, false]);

// 바위
const bo = limits('바위 창', boulderPayload({ ch: CH, plot: 4, cell: 1, owner: OWNER, farm: v, stamina: st, crops }));
eq('결 자리 다섯', bo[0].components.map((c) => c.label), ['1', '2', '3', '4', '5']);
eq('휘두른 만큼 기회가 준다', boulderPayload({ ch: CH, plot: 4, cell: 1, owner: OWNER, farm: v, stamina: st, crops }).embeds[0].toJSON().description.includes('남은 기회 **2**'), true);
eq('금 간 바위는 어디를 쳐도', boulderPayload({ ch: CH, plot: 4, cell: 2, owner: OWNER, farm: v, stamina: st, crops }).embeds[0].toJSON().description.includes('어디를 쳐도'), true);
eq('바위가 아니면 개간 창으로', boulderPayload({ ch: CH, plot: 4, cell: 5, owner: OWNER, farm: v, stamina: st, crops }).embeds[0].toJSON().title, '⛏️ 개간 — 5번 밭');
eq('결 자리가 화면에 안 샌다', JSON.stringify(v).includes('grain'), false);

// 결과 문구
eq('빗나감 문구', swingNote({ kind: 'boulder', broke: false, hint: { dir: 'left', near: true }, cracked: false }, crops), '💨 빗나갔어요 — 결이 **왼쪽**으로 느껴져요 · **바로 옆**이에요!');
eq('완벽 문구', swingNote({ kind: 'boulder', broke: true, perfect: true, loot: { oldCoin: 1 } }, crops), '✨ **완벽하게** 쪼갰어요! · 🎁 옛 동전 ×1');
eq('돌 모두 문구', swingNote({ kind: 'rocks', cleared: 2, left: 1, loot: {} }, crops), '🪨 돌 **2개**를 치웠어요 (기력이 모자라 1개는 남겼어요)');

// 곡괭이 힌트
eq('거리 문구(철 곡괭이)', swingNote({ kind: 'boulder', broke: false, hint: { dir: 'right', near: false, dist: 3 }, cracked: false }, crops), '💨 빗나갔어요 — 결이 **오른쪽**으로 느껴져요 · 결까지 **3칸**');
const mith = boulderPayload({ ch: CH, plot: 4, cell: 1, owner: OWNER, farm: v, stamina: st, crops, me: { pickaxe: 'mithril', candidates: { 4: { 1: [2, 4] } } } });
limits('미스릴 바위 창', mith);
eq('미스릴 후보 두 자리는 초록', mith.components[0].toJSON().components.map((c) => c.style), [4, 3, 4, 3, 4]);
eq('미스릴 문구', mith.embeds[0].toJSON().description.includes('결은 **2번** 또는 **4번**'), true);
eq('개간 창에 곡괭이 이름', clearPayload({ ch: CH, plot: 4, owner: OWNER, farm: v, stamina: st, crops, me: { pickaxe: 'iron' } }).embeds[0].toJSON().description.startsWith('⛏️ 오늘 개간 기력 **5** / 5 · ⛏️ 철 곡괭이'), true);

// 거름 창
const fp = fertPayload({ ch: CH, plot: 4, owner: OWNER, farm: { ...v, plots: v.plots.map((p, i) => (i === 4 ? { ...p, fert: { fertilizer: 1, compost: 1 } } : p)) }, items: { fertilizer: 3, compost: 5 } });
const fr = limits('거름 창', fp);
eq('비료는 오늘 다 넣었으면 막힌다', fr[0].components[0].disabled, true);
eq('퇴비는 남은 한도만큼 한꺼번에', fr[0].components[2].label, '퇴비 2개 넣기');
const fp0 = fertPayload({ ch: CH, plot: 4, owner: OWNER, farm: v, items: {} });
eq('거름이 없으면 전부 막힌다', fp0.components[0].toJSON().components.slice(0, 3).map((c) => c.disabled), [true, true, true]);

// 곡괭이 창
const tools = { pickaxes: land.PICKAXES, tool: 'wood', level: 6 };
const tp = toolsPayload({ owner: OWNER, tools, account: { gold: 500, items: { ironLump: 2 } } });
limits('곡괭이 창', tp);
eq('조건이 되면 바꿀 수 있다', tp.components[0].toJSON().components[0].disabled, false);
eq('레벨이 모자라면 막힌다', toolsPayload({ owner: OWNER, tools: { ...tools, level: 5 }, account: { gold: 500, items: { ironLump: 2 } } }).components[0].toJSON().components[0].disabled, true);
eq('원석은 섞어서 센다', toolsPayload({ owner: OWNER, tools: { ...tools, tool: 'iron', level: 9 }, account: { gold: 1000, items: { oreRed: 2, oreBlue: 1 } } }).components[0].toJSON().components[0].disabled, false);
eq('미스릴이면 버튼이 없다', toolsPayload({ owner: OWNER, tools: { ...tools, tool: 'mithril' }, account: {} }).components.length, 0);

// 궁합(3a)
eq('궁합 없음', modsBadge({ rate: 1, rotation: null }), '');
eq('궁합 좋음', modsBadge({ rate: 1.2, rotation: null }), '🤝 +20%');
eq('연작', modsBadge({ rate: 0.85, rotation: 'same' }), '⚔️ −15% 연작');
eq('윤작(성장은 그대로)', modsBadge({ rate: 1, rotation: 'varied' }), '🤝 윤작');
{
  const f = rules.newFarm({ channelId: CH, guildId: '1', owner: OWNER, today: D, now: `${D}T00:00:00.000Z` });
  f.plots[4].cells = f.plots[4].cells.map(() => ({ t: 'soil' }));
  f.plots[1] = { open: true, crop: 'onion', soilXp: 0, history: [], streak: 0, cells: Array.from({ length: 9 }, () => ({ t: 'plant', g: 0, thirst: 0, scar: false, ripeDay: null, planted: D, wet: null })) };
  rules.plant(f, D, { plot: 4, cells: [0], crop: 'carrot' });
  const vv = rules.view(f, D);
  eq('밭 줄에 궁합', plotLines(vv, crops).split('\n').find((l) => l.startsWith('**5번 밭**')).includes('🥕 당근 🤝 +10%'), true);
  const all = Object.fromEntries(crops.map((c) => [c.key, affinity.modsFor({ ...f, plots: f.plots.map((p, i) => (i === 4 ? { ...p, crop: null } : p)) }, 4, c.key)]).filter(([, m]) => m));
  const pp = plantPayload({ ch: CH, plot: 4, crop: null, mask: 0, owner: OWNER, farm: rules.view({ ...f, plots: f.plots.map((p, i) => (i === 4 ? { ...p, crop: null, cells: p.cells.map(() => ({ t: 'soil' })) } : p)) }, D), crops, preview: { all, mods: null } });
  const carrotOpt = pp.components[0].toJSON().components[0].options.find((o) => o.value === 'carrot');
  eq('셀렉트 줄에 궁합', carrotOpt.description.startsWith('🤝 +10% · '), true);
  eq('궁합 문구 줄', modsLines(affinity.modsFor(f, 4)), ['🤝 파속 이웃 +10% · 벌레를 쫓는다 (2번)']);
  const withNotes = plantPayload({ ch: CH, plot: 4, crop: 'carrot', mask: 0, owner: OWNER, farm: vv, crops, preview: { all, mods: vv.plots[4].mods } });
  eq('고른 작물의 궁합이 창에 적힌다', withNotes.embeds[0].toJSON().description.includes('🤝 파속 이웃 +10%'), true);
  eq('미리보기가 없어도 창은 열린다', plantPayload({ ch: CH, plot: 4, crop: null, mask: 0, owner: OWNER, farm: vv, crops }).components.length > 0, true);
}

// 3c — 쪽 넘김 · 주머니 · 비명 · 씨앗
{
  const big = { ...rules.view(rules.newFarm({ channelId: CH, guildId: '1', owner: OWNER, today: D, now: `${D}T00:00:00.000Z` }), D), level: 8 };
  big.plots[4].cells = big.plots[4].cells.map(() => 'soil');
  const p0 = plantPayload({ ch: CH, plot: 4, crop: null, mask: 0, owner: OWNER, farm: big, crops });
  const sel = p0.components[0].toJSON().components[0];
  limits('쪽이 둘인 심기 창', p0);
  eq('셀렉트는 25칸 안(작물 24 + 다른 작물)', [sel.options.length <= 25, sel.options.at(-1).value.startsWith('__page:')], [true, true]);
  eq('다른 작물 쪽', sel.options.at(-1).label, `▶ 다른 작물 (1/${Math.ceil(unlocked(crops, 8).length / PLANT_PAGE)}쪽)`);
  const p1 = plantPayload({ ch: CH, plot: 4, crop: null, mask: 0, owner: OWNER, farm: big, crops, page: 1 });
  const keys1 = p1.components[0].toJSON().components[0].options.map((o) => o.value);
  eq('둘째 쪽엔 첫 쪽 작물이 없다', keys1.filter((k) => sel.options.some((o) => o.value === k) && !k.startsWith('__')), []);
  const low = unlocked(crops, 8).at(-1).key;
  const pLow = plantPayload({ ch: CH, plot: 4, crop: low, mask: 0, owner: OWNER, farm: big, crops });
  eq('고른 작물이 있는 쪽을 연다', pLow.components[0].toJSON().components[0].options.some((o) => o.value === low && o.default), true);

  const pr = plantPayload({ ch: CH, plot: 4, crop: 'screamRoot', mask: maskOf([0, 1]), owner: OWNER, farm: big, crops, pouch: { screamRoot: 3 } });
  const d = pr.embeds[0].toJSON().description;
  eq('주머니가 보인다', d.includes('🎒 주머니 비명 뿌리 ×3'), true);
  eq('희귀 규칙 안내', d.includes('📜 비명'), true);
  eq('희귀 심기 버튼은 주머니 씨앗 수', pr.components.at(-1).toJSON().components.find((c) => c.custom_id.startsWith('farm:pg:')).label, '심기 · 🎒 2개');
  eq('주머니가 없으면 희귀는 못 고른다', plantPayload({ ch: CH, plot: 4, crop: 'screamRoot', mask: 0, owner: OWNER, farm: big, crops }).components.at(-1).toJSON().components.find((c) => c.custom_id.startsWith('farm:pg:')).custom_id.split(':')[4], '-');
  const rice = plantPayload({ ch: CH, plot: 4, crop: 'rice', mask: 0, owner: OWNER, farm: big, crops }).embeds[0].toJSON().description;
  eq('쌀 — 물 욕심 안내', rice.includes('📜 물 욕심'), true);

  eq('비명 — 귀마개로 막음', harvestNote('1', { harvested: 1, items: { screamRoot: 1 }, screams: 1, plugs: 1, hpLost: 0, hp: 90 }, crops).includes('귀마개 1개로 막았어요'), true);
  eq('비명 — 체력', harvestNote('1', { harvested: 1, items: { screamRoot: 1 }, screams: 1, plugs: 0, hpLost: 5, hp: 85 }, crops).includes('체력 −5 (남은 체력 85)'), true);
  eq('퍼짐 문구', harvestNote('1', { harvested: 1, items: { mint: 1 }, spread: 1 }, crops).includes('🍀 박하가 1포기 번졌어요'), true);
  eq('씨앗을 주웠다', swingNote({ kind: 'boulder', broke: true, perfect: false, loot: {}, seeds: { walkingCap: 1 } }, crops).includes('🎒 **도망가는 버섯갓 씨앗**'), true);
}

// 3b — 품질 · 대왕 · 도감
eq('봇의 작물 명부 = 서버 작물표', FARM_CROPS, CROPS.map((c) => c.key));
eq('수확 문구 — ★ 변형은 원래 작물로 묶는다', harvestLine({ carrot: 2, carrotS1: 2, carrotS2: 1, dandelion: 1 }, crops), '당근 ×5 (★×2 · ★★×1) · 민들레 ×1');
eq('수확 문구 — 대왕 작물은 앞에', harvestLine({ giantRadish: 1, lettuceS3: 2 }, crops), '🏆 **대왕 무** · 상추 ×2 (★★★×2)');
eq('요리 가짓수 — 당근과 당근★ 은 한 가지', flatShare(['carrot', 'carrotS1', 'carrotS3']), flatShare(['carrot']));
eq('요리 가짓수 — 다른 작물은 두 가지', flatShare(['carrot', 'potatoS1']) > flatShare(['carrot']), true);
{
  const bp = bookPayload({ who: OWNER, book: { carrot: { n: 12, best: 2, giant: 0 }, radish: { n: 18, best: 3, giant: 1 } }, crops });
  const e = bp.embeds[0].toJSON();
  eq('도감 수집률', e.title, `📖 농장 도감 — 2 / ${crops.length} (${Math.round(200 / crops.length)}%)`);
  eq('도감 줄', [e.description.includes('🥕 **당근** · 12포기 · 최고 ★★'), e.description.includes('⚪ **무** · 18포기 · 최고 ★★★ · 🏆×1')], [true, true]);
  eq('안 키운 것은 ❔', e.description.includes('❔ _??? (Lv.1)_'), true);
  eq('희귀는 이름을 숨긴다', e.description.includes('❔ _희귀 ???_'), true);
  eq('도감은 임베드 한도 안', e.description.length < 4096, true);
}

// ---------------------------------------------------------------- 5. 사유

const REASONS = ['none', 'notOwner', 'already', 'noPlants', 'tired', 'locked', 'level', 'otherCrop', 'occupied', 'gold',
  'nothing', 'noRocks', 'notStone', 'taken', 'mine', 'hasFarm', 'cooldown',
  'fertCap', 'soilMax', 'noItem', 'noFarm', 'maxTool', 'toolLevel', 'noSeed'];
const sample = { owner: '1', by: ['1'], crop: 'carrot', need: 1, gold: 0, channelId: '1', until: D, hp: 1, item: 'compost', have: 0, perDay: 3 };
eq('사유마다 문장이 있다', REASONS.filter((r) => why({ ...sample, reason: r }, crops).startsWith('하지 못했어요')), []);
eq('체력 부족과 기력 부족은 다른 말', why({ reason: 'tired', hp: 1 }, crops) !== why({ reason: 'tired', stamina: st }, crops), true);

// ---------------------------------------------------------------- 6. 옮겨 적은 수

const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/commands/farm.js', import.meta.url), 'utf-8'));
const num = (re) => Number(src.match(re)?.[1]);
eq('거름 한도·토질이 서버와 같다', [
  num(/fertilizer: \{[^}]*soil: (\d+)/), num(/fertilizer: \{[^}]*perDay: (\d+)/),
  num(/compost: \{[^}]*soil: (\d+)/), num(/compost: \{[^}]*perDay: (\d+)/),
], [land.FERTS.fertilizer.soil, land.FERTS.fertilizer.perDay, land.FERTS.compost.soil, land.FERTS.compost.perDay]);
eq('퇴비 비율이 서버와 같다', num(/const COMPOST_CROPS = (\d+)/), land.COMPOST_CROPS);
eq('바위 기회·결 자리가 서버와 같다', [num(/const MAX_SWINGS = (\d+)/), num(/const GRAIN_SPOTS = (\d+)/)], [land.MAX_SWINGS, land.GRAIN_SPOTS]);
eq('곡괭이 효과 문구가 다 있다', land.PICKAXES.filter((t) => !src.includes(`${t.key}: '`)).map((t) => t.key), []);

console.log(`\n${bad ? '✗' : '✓'} ${ok + bad}건 중 통과 ${ok} · 실패 ${bad}`);
process.exit(bad ? 1 : 0);
