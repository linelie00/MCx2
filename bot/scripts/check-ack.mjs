/**
 * check-ack — 3초 시한을 넘긴 클릭이 판을 멈추지 않는지
 *
 *   node scripts/check-ack.mjs
 *
 * 디스코드는 인터랙션이 생긴 지 3초 안에 응답이 없으면 그것을 없앤다(10062).
 * 그 자체는 어쩔 수 없다 — **문제는 그 오류가 그 위의 흐름까지 끊는 것**이었다.
 * 수는 이미 적용됐는데 화면이 안 그려지고 드라이버도 안 돌아 판이 굳었다.
 *
 * 여기서 보는 것 둘.
 *
 *   1. `ack` 가 10062 만 삼키고(다른 오류는 그대로 올린다) `false` 를 준다
 *   2. 사망 검사가 **서버를 오래 기다리지 않는다** — 그게 시한을 다 쓴 범인이었다
 */
process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= 'x';
process.env.DISCORD_GUILD_ID ||= 'x';
process.env.GEMINI_API_KEY ||= '';

import assert from 'node:assert/strict';
import { ack, quiet } from '../src/discord/ack.js';

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${name}\n     ${err.message.split('\n').slice(0, 4).join('\n     ')}`);
  }
}

const boom = (code) => Object.assign(new Error(`code ${code}`), { code });

/** 눌린 척하는 인터랙션. `throws` 를 주면 deferUpdate 가 그걸 던진다. */
const click = (throws) => {
  const it = {
    deferred: false,
    replied: false,
    calls: 0,
    async deferUpdate() {
      it.calls += 1;
      if (throws) throw throws;
      it.deferred = true;
    },
  };
  return it;
};

console.log('\nack\n');

await check('멀쩡하면 접수하고 true', async () => {
  const it = click();
  assert.equal(await ack(it, 'x'), true);
  assert.equal(it.deferred, true);
});

await check('사라진 인터랙션(10062)은 삼키고 false', async () => {
  const it = click(boom(10062));
  assert.equal(await ack(it, 'x'), false);
});

await check('다른 오류는 그대로 올린다', async () => {
  // 권한 문제 같은 것을 여기서 삼키면 원인을 찾을 길이 없어진다.
  await assert.rejects(() => ack(click(boom(50013)), 'x'), /50013/);
});

await check('두 번 접수하지 않는다', async () => {
  // 두 번 하면 40060 으로 던진다.
  const it = click();
  it.deferred = true;
  assert.equal(await ack(it, 'x'), true);
  assert.equal(it.calls, 0, 'deferUpdate 를 또 불렀다');
});

await check('quiet 은 사라진 인터랙션만 삼킨다', async () => {
  assert.equal(await quiet(Promise.reject(boom(10062))), null);
  assert.equal(await quiet(Promise.reject(boom(40060))), null);
  await assert.rejects(() => quiet(Promise.reject(boom(50013))), /50013/);
});

console.log('\n사망 검사\n');

await check('서버가 늦으면 기다리지 않고 지나간다', async () => {
  // 사이트가 잠들었다 깨는 상황. 예전에는 여기서 3초를 다 쓰고 클릭이 통째로 날아갔다.
  //
  // **키가 없으면 조회가 그 자리에서 거절돼** 늦는 상황 자체가 안 만들어진다.
  // (alive.js 는 그 실패도 "살아 있음" 으로 치고 지나가므로 검사가 통과해 버린다.)
  // config 는 처음 불러올 때 환경을 읽으므로 여기서 미리 넣는다 — import 는 위로
  // 끌려 올라가지만 이 줄들은 아래의 `await import` 보다 먼저 돈다.
  process.env.BOT_KEY ||= 'x';
  process.env.MIHEARTI_API_BASE ||= 'http://127.0.0.1:9';

  let done = false;
  globalThis.fetch = () => new Promise((r) => {
    setTimeout(() => { done = true; r(new Response('{}', { status: 500 })); }, 5000);
  });

  const { ensureAlive } = await import('../src/casino/alive.js');
  const it = { user: { id: '999999999999999999' }, async reply() { throw new Error('막았다'); } };

  const at = Date.now();
  assert.equal(await ensureAlive(it), true, '멀쩡한 사람을 막았다');
  const took = Date.now() - at;
  assert.ok(took < 1500, `${took}ms 나 기다렸다`);
  assert.equal(done, false, '조회가 끝나기를 기다렸다');
});

console.log(failed ? `\n✗ ${failed}건` : '\n✓ 전부 통과');
process.exit(failed ? 1 : 0);
