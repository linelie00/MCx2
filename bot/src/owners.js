/**
 * owners — 디스코드 유저 ↔ 사이트 오너 매핑
 *
 * 사이트의 인증은 계정이 아니라 패스코드 두 개뿐이다(server/src/middleware/requireOwner.js).
 * 그래서 "누가 썼는지"는 서버가 모른다 — 봇이 디스코드 유저 ID로 직접 판단한다.
 *
 * 라벨이 맥락마다 다르다는 점에 주의:
 *   - 영화 화면은 겨울/사백 (client/src/Data/movies.js)
 *   - 캐릭터는 미겔/마티암
 * 두 체계를 여기 한곳에 모아 둔다.
 */
import config from './config.js';

export const OWNER_META = {
  migel: { label: '겨울', character: '미겔', color: 0x768461 },
  matiam: { label: '사백', character: '마티암', color: 0x737b7f },
};

export const OWNERS = ['migel', 'matiam'];

/** 디스코드 유저 ID → 'migel' | 'matiam' | null */
export function ownerFor(discordUserId) {
  if (discordUserId && discordUserId === config.users.migel) return 'migel';
  if (discordUserId && discordUserId === config.users.matiam) return 'matiam';
  return null;
}

/** 상대 캐릭터. 캐입에서 봇이 맡을 배역의 기본값으로 쓴다. */
export function counterpart(owner) {
  return owner === 'migel' ? 'matiam' : 'migel';
}

/** 오너의 사이트 패스코드. 없으면 null. */
export function keyFor(owner) {
  return config.api.keys[owner] || null;
}

export default { OWNER_META, OWNERS, ownerFor, counterpart, keyFor };
