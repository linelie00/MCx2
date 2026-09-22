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
import { grid, plotLines, cellEmoji, levelLine, nextLine } from '../src/farm/render.js';
import {
  plantPayload, clearPayload, boulderPayload, fertPayload, toolsPayload, swingNote, why, cellsOf, maskOf, unlocked,
} from '../src/commands/farm.js';
import { SHELVES } from '../src/commands/shop.js';

const require = createRequire(import.meta.url);
const { CROPS, publicCrop } = require('../../server/src/farm/crops.js');
const land = require('../../server/src/farm/land.js');
const rules = require('../../server/src/farm/rules.js');

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
eq('씨앗값 < 파는 값', crops.filter((c) => !(c.seed >= 1 && c.seed < c.price)).map((c) => c.key), []);
eq('이모지가 있다', crops.filter((c) => !c.emoji).map((c) => c.key), []);
eq('심기 셀렉트는 25개까지', unlocked(crops, 10).length, 25);
eq('심기 셀렉트는 최근에 풀린 것부터', unlocked(crops, 10)[0].lv, 5);
eq('Lv1 이면 Lv1 작물만', unlocked(crops, 1).every((c) => c.lv === 1), true);

// ---------------------------------------------------------------- 2. 전리품

const lootKeys = [...new Set([...land.LOOT.normal, ...land.LOOT.perfect].map(([k]) => k).filter((k) => k !== 'ore')), ...land.ORES, 'dandelion'];
eq('전리품 키가 명부에 있다', lootKeys.filter((k) => !ITEM_BY_KEY[k]), []);
eq('전리품은 팔 수 있다', lootKeys.filter((k) => !ITEM_BY_KEY[k]?.sell), []);
eq('거름 키가 명부에 있다', Object.keys(land.FERTS).filter((k) => !ITEM_BY_KEY[k]), []);
eq('곡괭이 재료가 명부에 있다', land.PICKAXES.flatMap((t) => Object.keys(t.items)).filter((k) => k !== 'ore' && !ITEM_BY_KEY[k]), []);
eq('비료는 상점 농사 진열대에 있다', SHELVES.find((sh) => sh.key === 'farm')?.keys, ['fertilizer']);

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

// ---------------------------------------------------------------- 5. 사유

const REASONS = ['none', 'notOwner', 'already', 'noPlants', 'tired', 'locked', 'level', 'otherCrop', 'occupied', 'gold',
  'nothing', 'noRocks', 'notStone', 'taken', 'mine', 'hasFarm', 'cooldown',
  'fertCap', 'soilMax', 'noItem', 'noFarm', 'maxTool', 'toolLevel'];
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
