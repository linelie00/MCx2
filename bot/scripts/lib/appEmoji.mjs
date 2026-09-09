/**
 * appEmoji — 만든 그림을 **애플리케이션 이모지**로 올린다
 *
 * 서버 이모지가 아니라 앱 이모지를 쓰는 이유가 셋이다.
 *
 *   - 앱당 2000개. 서버는 무료 50칸이라 카드 53장이 아예 안 들어간다.
 *   - 서버 슬롯을 안 먹는다. 사람이 쓰려고 올려 둔 이모지를 밀어내지 않는다.
 *   - 어느 서버에서나 쓸 수 있고 USE_EXTERNAL_EMOJIS 권한도 필요 없다.
 *
 * discord.js 를 안 쓰고 REST 를 직접 부른다. 스크립트 하나 돌리자고 게이트웨이에
 * 접속할 이유가 없다. DISCORD_TOKEN 만 있으면 된다.
 */
const API = 'https://discord.com/api/v10';

async function api(pathname, init = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/**
 * `{ name, png }` 목록을 올린다.
 *
 * 이름이 같은 것이 이미 있으면 건너뛴다 — 그림을 손봤을 때만 force 로 갈아 끼운다.
 * 디스코드가 이모지 생성에 거는 레이트리밋이 빡빡해서 한 장마다 쉬어 간다.
 */
export async function upload(items, { force = false, what = '이모지' } = {}) {
  const app = await api('/applications/@me');
  const existing = (await api(`/applications/${app.id}/emojis`)).items ?? [];
  const byName = new Map(existing.map((e) => [e.name, e]));
  console.log(`앱 이모지 ${existing.length}/2000 개가 이미 있습니다.\n`);

  const todo = items.filter((it) => force || !byName.has(it.name));
  const skipped = items.length - todo.length;

  let made = 0;
  for (const item of todo) {
    const old = byName.get(item.name);
    if (old) await api(`/applications/${app.id}/emojis/${old.id}`, { method: 'DELETE' });

    await api(`/applications/${app.id}/emojis`, {
      method: 'POST',
      body: JSON.stringify({
        name: item.name,
        image: `data:image/png;base64,${item.png.toString('base64')}`,
      }),
    });
    made += 1;
    process.stdout.write(`\r  올리는 중 ${made}/${todo.length}  (${item.name})   `);
    await new Promise((r) => { setTimeout(r, 350); });
  }

  console.log(`\n\n${what} 올림 ${made}개${skipped ? ` · 이미 있어서 건너뜀 ${skipped}개` : ''}.`);
  if (skipped) console.log('다시 올리려면 --force 를 붙이세요.');
  console.log('봇을 재시작하면 부팅할 때 찾아서 씁니다.');
}

export default { upload };
