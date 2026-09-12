/**
 * check-showdown — 올인으로 끝난 판을 어떻게 보여 주는가
 *
 *   node scripts/check-showdown.mjs
 *
 * 규칙 쪽은 더 둘 사람이 없으면 남은 보드를 한 번에 깔고 쇼다운으로 간다 — 그게 옳다.
 * 칩이 더 움직일 데가 없으니 물어볼 것이 없기 때문이다. 대신 **화면만** 되감아서
 * 패를 깐 다음 플랍·턴·리버를 한 장씩 보여 준다(`commands/holdem.js` 의 `runout`).
 *
 * 여기서 잡으려는 것은 셋.
 *
 *   1. 규칙은 그대로인가 — 보드 다섯 장, 쇼다운
 *   2. 순서 — **패 공개 → 플랍 → 턴 → 리버**
 *   3. 다음 핸드가 패를 다시 덮는가 (안 덮으면 남의 패가 깔린 채로 시작한다)
 */
process.env.DISCORD_TOKEN ||= 'x';
process.env.DISCORD_CLIENT_ID ||= 'x';
process.env.DISCORD_GUILD_ID ||= 'x';

const { runout } = await import('../src/commands/holdem.js');
const state = await import('../src/holdem/state.js');
const { boardEmbed, shownBoard } = await import('../src/holdem/render.js');

let ok = 0; let bad = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok += 1; console.log(`  ✓ ${name}`); }
  else { bad += 1; console.log(`  ✗ ${name}\n     받음 ${JSON.stringify(got)} / 기대 ${JSON.stringify(want)}`); }
};

const ME = '100000000000000001';
const said = [];
const room = {
  id: 'c1',
  async send(payload) {
    said.push(payload);
    return {
      id: `m${said.length}`,
      channel: room,
      payload,
      async edit(next) { this.payload = { ...this.payload, ...next }; },
      async delete() {},
    };
  },
};

function table(channelId) {
  const game = state.create({ channelId, homeChannelId: channelId, guildId: 'g', starterId: ME });
  state.addSeat(game, state.humanSeat({ id: ME, username: '사백', globalName: '사백' }, '사백'));
  state.addSeat(game, state.npcSeat('migel'));
  for (const s of game.seats) s.buyIn = 500;
  state.start(game, Object.fromEntries(game.seats.map((s) => [s.id, 500])));
  return game;
}

console.log('\n올인 — 한 장씩 깐다');
const game = table('c1');
game.message = await room.send({ content: '판' });
for (let i = 0; i < 8 && game.phase !== 'showdown'; i += 1) {
  const legal = state.actionsFor(game);
  state.act(game, legal.has('allin') ? 'allin' : legal.has('call') ? 'call' : 'check', 0);
}
eq('규칙은 그대로 — 보드 다섯에 쇼다운', [game.phase, game.board.length], ['showdown', 5]);

said.length = 0;
await runout(game);
const texts = said.map((p) => p.content || p.embeds?.[0]?.data?.description || '').filter(Boolean);
eq('패부터 깔고 플랍·턴·리버 순서',
  texts.map((t) => (/패를 깠습니다/.test(t) ? '공개'
    : /플랍/.test(t) ? '플랍' : /턴/.test(t) ? '턴' : /리버/.test(t) ? '리버' : '?')),
  ['공개', '플랍', '턴', '리버']);

const opened = said[0]?.embeds?.[0]?.data?.description ?? '';
eq('깔 때는 보드가 아직 없다', /보드는 아직 없습니다/.test(opened), true);
eq('둘의 패가 다 보인다', ['사백', '미겔'].every((n) => opened.includes(n)), true);
eq('다 깔고 나면 자르기를 푼다', [game.boardShown, shownBoard(game).length], [null, 5]);

console.log('\n다음 핸드');
state.settle(game);
for (const s of game.seats) s.gold = 500;      // 둘 다 살아남아 다음 핸드가 열리게
state.nextHand(game);
eq('다시 덮는다', [game.revealed, game.boardShown, game.boardSeen], [false, null, 0]);
eq('화면에도 남의 패가 없다', /패를 깠습니다/.test(boardEmbed(game).data.description), false);

console.log('\n접어서 끝난 판');
const folded = table('c2');
folded.message = await room.send({ content: '판2' });
while (!['showdown', 'settled'].includes(folded.phase)) {
  const legal = state.actionsFor(folded);
  state.act(folded, legal.has('fold') ? 'fold' : 'check', 0);
}
said.length = 0;
await runout(folded);
eq('깔 것도 보여 줄 것도 없다', [said.length, folded.revealed], [0, false]);

console.log(`\n${bad ? '✗' : '✓'} ${ok + bad}건 중 통과 ${ok} · 실패 ${bad}`);
process.exit(bad ? 1 : 0);
