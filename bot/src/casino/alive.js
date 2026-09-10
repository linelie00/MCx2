/**
 * alive — 쓰러진 사람은 아무것도 못 한다
 *
 * 체력이 0 이면 사망이다. **저장하지 않는다** — `hp <= 0` 으로 계산해 낸다.
 * 플래그를 따로 두면 `hp: 0 · dead: false` 같은 어긋난 짝이 생기고 어느 쪽이 맞는지
 * 알 길이 없다. 칭호를 저장 안 하는 것과 같은 이유다.
 *
 * **중앙에서 막되 HTTP 는 캐시로 막는다.** 인터랙션마다 계정을 읽으면 3초 시한을
 * 갉아먹고, 무엇보다 `/아이템 정보`·`/홀덤 족보` 처럼 **일부러 HTTP 를 안 쳐서 즉답하는**
 * 명령이 느려진다. 두 사람이 쓰는 봇에서 30초 묵은 "살아 있음" 은 아무 해가 없다.
 *
 * **이건 편의지 불변식이 아니다.** 실제로 값을 쓰는 자리(`/아이템 사용`·던전 시작)는
 * 자기가 읽은 계정으로 한 번 더 봐야 한다.
 */
import { MessageFlags } from 'discord.js';
import { getAccounts } from '../api.js';
import { base } from '../embeds.js';
import { MAX_HP } from './items.js';

/** 살아 있는지 캐시해 두는 시간. */
const TTL = 30_000;

const seen = new Map();          // id → { at, dead }

/** 그 계정이 쓰러졌는지. 계정을 이미 읽었으면 이걸 그냥 쓴다. */
export const isDead = (account) => Number(account?.hp ?? MAX_HP) <= 0;

/**
 * 값을 쓴 쪽이 부른다. 다음 조회가 서버를 다시 보게 한다 — 부활의 영약을 마시고도
 * 30초 동안 죽은 사람 취급을 받으면 안 된다.
 */
export const forget = (id) => { seen.delete(id); };

/** 캐시에 넣어 둔다. 이미 계정을 읽은 자리가 공짜로 채워 준다. */
export function remember(id, account) {
  seen.set(id, { at: Date.now(), dead: isDead(account) });
}

async function deadNow(id) {
  const hit = seen.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.dead;
  try {
    const { accounts } = await getAccounts([id]);
    const dead = isDead(accounts?.[id]);
    seen.set(id, { at: Date.now(), dead });
    return dead;
  } catch {
    // 계정을 못 읽었다고 멀쩡한 사람을 막지는 않는다. 사이트가 죽으면 판이 안 열리는
    // 것으로 이미 충분히 막힌다(wallet.load 가 던진다).
    return false;
  }
}

export const deadEmbed = () => base({
  title: '💀 쓰러져 있어요',
  description: '체력이 0 이라 아무것도 할 수 없어요.\n'
    + '**부활의 영약**을 마시면 일어납니다 — `/상점` 에서 살 수 있어요.',
  color: 0x6b5b5b,
});

/**
 * 쓰러졌으면 거절하고 `false`. 살아 있으면 `true`.
 *
 * 아직 응답을 안 잡은 인터랙션에만 쓴다 — 거절이 `reply` 라서.
 */
export async function ensureAlive(interaction) {
  if (!(await deadNow(interaction.user.id))) return true;
  await interaction.reply({ embeds: [deadEmbed()], flags: MessageFlags.Ephemeral });
  return false;
}

export default { isDead, ensureAlive, deadEmbed, remember, forget };
