/**
 * check-load — 모든 명령이 실제로 링크되는지
 *
 *   node scripts/check-load.mjs
 *
 * **`node --check` 로는 안 잡히는 것이 있다.** 없는 이름을 import 하면 구문은 멀쩡하고
 * 모듈을 **불러올 때** 터진다 — 그리고 그건 봇이 부팅하다 죽는다는 뜻이다.
 * `npm run register` 가 우연히 잡아 주긴 하지만 그건 토큰이 있어야 돌고, 명령 이름을
 * 안 바꾼 배포에는 아무도 안 돌린다.
 *
 * 여기서는 토큰 없이 **불러오기만** 한다. 내보내기 모양(data·execute·componentPrefix)도
 * 같이 본다 — 셋 중 하나가 어긋나면 그 명령만 조용히 빠진다(loadCommands 가 건너뛴다).
 */
import { loadCommands } from '../src/loadCommands.js';

process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= 'x';
process.env.DISCORD_GUILD_ID ||= 'x';
process.env.GEMINI_API_KEY ||= '';

let bad = 0;
const fail = (msg) => { bad += 1; console.log(`  ✗ ${msg}`); };

let commands;
try {
  commands = await loadCommands();
} catch (err) {
  // 없는 이름을 import 하면 여기서 터진다. 그대로 두면 스택만 쏟아지므로 무엇이
  // 문제인지 한 줄로 적어 준다 — 봇이 부팅하다 죽는 것과 **똑같은** 오류다.
  console.log(`\n✗ 명령을 못 불러왔어요 — 이대로면 봇이 부팅하다 죽습니다.\n  ${err.message}\n`);
  process.exit(1);
}

console.log(`\n명령 ${commands.size}개를 불러왔어요`);
console.log(`  ${[...commands.keys()].sort().map((n) => `/${n}`).join(' ')}\n`);

for (const [name, cmd] of commands) {
  if (typeof cmd.data?.toJSON !== 'function') fail(`/${name}: data 가 SlashCommandBuilder 가 아니다`);
  if (typeof cmd.execute !== 'function') fail(`/${name}: execute 가 없다`);

  // 버튼을 쓰는 명령은 둘이 짝이어야 한다. 하나만 있으면 라우터가 못 찾거나,
  // 찾아도 부를 것이 없다.
  const hasPrefix = Boolean(cmd.componentPrefix);
  const hasHandler = typeof cmd.component === 'function';
  if (hasPrefix !== hasHandler) {
    fail(`/${name}: componentPrefix 와 component 가 짝이 아니다 (${hasPrefix} / ${hasHandler})`);
  }

  // 자동완성을 켠 옵션이 있으면 핸들러도 있어야 한다.
  const json = cmd.data.toJSON();
  const wantsAuto = JSON.stringify(json).includes('"autocomplete":true');
  if (wantsAuto && typeof cmd.autocomplete !== 'function') {
    fail(`/${name}: 자동완성 옵션이 있는데 autocomplete 핸들러가 없다`);
  }
}

// customId 접두사가 겹치면 나중에 등록된 쪽이 앞의 것을 덮어쓴다(index.js 의 맵).
const prefixes = [...commands.values()].map((c) => c.componentPrefix).filter(Boolean);
const twice = prefixes.filter((p, i) => prefixes.indexOf(p) !== i);
if (twice.length) fail(`componentPrefix 가 겹친다: ${[...new Set(twice)].join(', ')}`);

console.log(bad ? `✗ ${bad}건` : '✓ 전부 통과');
process.exit(bad ? 1 : 0);
