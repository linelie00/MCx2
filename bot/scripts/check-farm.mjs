/**
 * check-farm — 농장 작물표·화면 검사
 *
 *   node scripts/check-farm.mjs
 *
 * 규칙은 서버가 판정한다(server/scripts/check-farm.js 가 본다). 여기서는 봇 쪽이 서버와
 * **어긋나지 않는지**와 화면이 디스코드 한도 안에 드는지만 본다.
 *
 *   1. 서버 작물표의 키가 봇 명부에 있고, **파는 값과 이름이 같다.** 서버는 아이템 값을 몰라
 *      씨앗값을 셈하려고 옮겨 적었다 — 한쪽만 고치면 "수확하면 반드시 남는다" 가 깨진다
 *   2. 격자와 밭 줄이 서버가 주는 모양 그대로 그려진다
 *   3. 심기 창이 5줄 · 줄마다 5개 · customId 100자 안이고, customId 가 겹치지 않는다
 *   4. 서버가 돌려줄 수 있는 사유(`reason`)마다 문장이 있다
 *
 * 레포 안에서만 도는 검사라 서버 파일을 직접 읽는다(배포된 봇은 서버 폴더를 모른다).
 */
process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= 'x';
process.env.DISCORD_GUILD_ID ||= 'x';
process.env.GEMINI_API_KEY ||= '';

import { createRequire } from 'node:module';
import { ITEM_BY_KEY } from '../src/casino/items.js';
import { grid, plotLines, cellEmoji } from '../src/farm/render.js';
import { plantPayload, why, cellsOf, maskOf } from '../src/commands/farm.js';

const require = createRequire(import.meta.url);
const { CROPS, publicCrop } = require('../../server/src/farm/crops.js');
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

// ---------------------------------------------------------------- 2. 화면

const D = '2026-09-01';
const farm = rules.newFarm({ channelId: '2000001', guildId: '3000001', owner: '1000001', today: D, now: `${D}T00:00:00.000Z` });
rules.plant(farm, D, { plot: 4, cells: [0, 1, 2], crop: 'carrot' });
rules.plant(farm, D, { plot: 4, cells: [3], crop: 'carrot' });
rules.water(farm, D, '1000002');
const v = rules.view(farm, D);

const g = grid(v, crops).split('\n');
eq('격자는 3줄 × 3 + 빈 줄 2', g.length, 11);
eq('잠긴 밭 줄', g[0], '🔒🔒🔒 │ 🔒🔒🔒 │ 🔒🔒🔒');
eq('가운데 밭 첫 줄', g[4], '🔒🔒🔒 │ 🌱🌱🌱 │ 🔒🔒🔒');
eq('가운데 밭 둘째 줄', g[5], '🔒🔒🔒 │ 🌱🟫🟫 │ 🔒🔒🔒');
eq('밭 줄', plotLines(v, crops), '**5번 밭** 🥕 당근 · 자라는 중 4 (물 2번 더)');
eq('익은 칸은 작물 그림', cellEmoji('ripe', crops, 'carrot'), '🥕');
eq('과숙도 작물 그림', cellEmoji('over', crops, 'cucumber'), '🥒');
eq('빈 밭 줄', plotLines(rules.view(rules.newFarm({ channelId: '1', guildId: '1', owner: '1', today: D, now: `${D}T00:00:00.000Z` }), D), crops), '**5번 밭** — _비어 있어요. `/농장 심기`_');

// ---------------------------------------------------------------- 3. 심기 창

eq('칸 ↔ 비트', cellsOf(maskOf([0, 4, 8])), [0, 4, 8]);

const OWNER = '123456789012345678';
const CH = '987654321098765432';
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

const empty = rules.view(rules.newFarm({ channelId: CH, guildId: '1', owner: OWNER, today: D, now: `${D}T00:00:00.000Z` }), D);
const first = limits('작물 안 고름', plantPayload({ ch: CH, plot: null, crop: null, mask: 0, owner: OWNER, farm: empty, crops }));
eq('작물 안 골랐으면 칸이 막혀 있다', first[1].components.every((c) => c.disabled), true);
eq('작물 셀렉트가 맨 위', first[0].components[0].type, 3);

const picked = plantPayload({ ch: CH, plot: 4, crop: 'radish', mask: maskOf([0, 1, 2]), owner: OWNER, farm: empty, crops });
const rows = limits('무 세 칸', picked);
const go = rows.at(-1).components.find((c) => c.custom_id.startsWith('farm:pg:'));
eq('심기 버튼에 씨앗값', go.label, `심기 · ${crops.find((c) => c.key === 'radish').seed * 3}골드`);
eq('고른 칸은 초록', rows[1].components.map((c) => c.style), [3, 3, 3]);

const fixed = limits('작물 있는 밭', plantPayload({ ch: CH, plot: 4, crop: 'potato', mask: maskOf([0, 3, 8]), owner: OWNER, farm: v, crops }));
eq('작물이 있는 밭은 셀렉트가 없다', fixed[0].components[0].type, 2);
eq('밭 작물로 묶인다', fixed.at(-1).components.find((c) => c.custom_id.startsWith('farm:pg:')).custom_id.split(':')[4], 'carrot');
eq('심긴 칸은 고른 것에서 빠진다', Number(fixed.at(-1).components[0].custom_id.split(':')[5]), maskOf([8]));
eq('심긴 칸 버튼은 막혀 있다', fixed[0].components.map((c) => c.disabled), [true, true, true]);

// ---------------------------------------------------------------- 4. 사유

const REASONS = ['none', 'notOwner', 'already', 'locked', 'otherCrop', 'occupied', 'gold', 'nothing', 'taken', 'mine', 'hasFarm', 'cooldown'];
eq('사유마다 문장이 있다', REASONS.filter((r) => why({ reason: r, owner: '1', by: '1', crop: 'carrot', need: 1, gold: 0, channelId: '1', until: D }, crops).startsWith('하지 못했어요')), []);

console.log(`\n${bad ? '✗' : '✓'} ${ok + bad}건 중 통과 ${ok} · 실패 ${bad}`);
process.exit(bad ? 1 : 0);
