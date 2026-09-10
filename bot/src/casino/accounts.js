/**
 * accounts — 계정 하나를 어떻게 가리키고 어떻게 부를지
 *
 * 칩·칭호·아이템은 **계정 id 하나**로 묶인다. 사람은 디스코드 유저 id, NPC 는
 * `npc:migel` / `npc:matiam`. 게임의 자리 id 와 같은 규약이라(blackjack/holdem 의
 * `humanSeat`·`npcSeat`) 판에서 쓰던 id 를 그대로 계정 키로 쓸 수 있다.
 *
 * `/프로필`·`/출첵`, 그리고 나중의 `/아이템 양도`·`/상호작용` 이 여기를 같이 쓴다.
 *
 * **겨울과 미겔은 다른 지갑이다.** 사이트 오너인 사람은 화면에 **겨울**로 뜨고
 * NPC 미겔은 **미겔**로 뜬다 — 같은 사람이 둘을 다 쓰지만 계정은 별개다. 이름이
 * 겹치면 어느 지갑을 보고 있는지 알 수가 없으므로 표기를 여기서 한 번에 정한다.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OWNER_META, ownerFor } from '../owners.js';
import { THEME_COLOR } from '../embeds.js';

/**
 * 미겔·마티암 초상화. **웹훅이 아바타로 굽는 그 파일과 같은 것**을 쓴다
 * (`discord/webhook.js`) — 판에서 말할 때의 얼굴과 프로필의 얼굴이 달라지면 안 된다.
 *
 * URL 이 아니라 로컬 파일이다. 사이트 초상화는 번들 해시가 붙어 빌드마다 이름이
 * 바뀌어서 URL 로 걸 수가 없다. 임베드에는 첨부로 올리고 `attachment://` 로 가리킨다.
 */
const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');
const npcFace = (character) => {
  const file = path.join(ASSETS, `${character}.png`);
  return fs.existsSync(file) ? { file, name: `${character}.png` } : null;
};

/** NPC 계정 id. 게임의 `npcSeat` 이 만드는 것과 같은 모양이어야 한다. */
export const NPC_ID = { migel: 'npc:migel', matiam: 'npc:matiam' };

export const isNpcId = (id) => typeof id === 'string' && id.startsWith('npc:');

/** `npc:migel` → `migel`. 사람 id 면 null. */
export const characterOf = (id) => (isNpcId(id) ? id.slice(4) : null);

/** 슬래시 명령의 선택지. `/프로필`·나중의 양도가 같이 쓴다. */
export const NPC_CHOICES = [
  { name: '미겔', value: NPC_ID.migel },
  { name: '마티암', value: NPC_ID.matiam },
];

/**
 * 그 계정을 화면에 어떻게 적을지. `{ id, name, color, npc, avatar, avatarFile }`
 *
 * `avatar` 는 임베드에 그대로 넣을 값이다. 사람은 디스코드 CDN 주소, 미겔·마티암은
 * `attachment://…` — 그 경우 `avatarFile` 을 같이 첨부해야 그림이 뜬다.
 */
export function displayOf(id, { user = null, member = null } = {}) {
  const character = characterOf(id);
  if (character) {
    const meta = OWNER_META[character];
    // NPC 라고 붙여 준다. 사람 계정(겨울/사백)과 헷갈리면 안 된다.
    const face = npcFace(character);
    return {
      id,
      name: `${meta?.character ?? character} (NPC)`,
      color: meta?.color ?? THEME_COLOR,
      npc: true,
      avatar: face ? `attachment://${face.name}` : null,
      avatarFile: face,
    };
  }

  const owner = ownerFor(id);
  const meta = owner ? OWNER_META[owner] : null;
  return {
    id,
    name: meta ? meta.label : (member?.displayName || user?.globalName || user?.username || '누군가'),
    color: meta ? meta.color : THEME_COLOR,
    npc: false,
    avatar: user?.displayAvatarURL?.({ size: 256 }) ?? null,
    avatarFile: null,          // 사람은 디스코드 CDN 에 이미 있다
  };
}

/**
 * 명령의 대상을 정한다. `{ id, name, color, npc, self }` 또는 `{ error }`.
 *
 * 사람은 유저 옵션으로, NPC 는 선택지로 받는다. 하나로 합칠 수가 없다 — 길드 멤버를
 * 자동완성으로 뒤지려면 GuildMembers 인텐트가 필요한데 봇은 Guilds 만 켜고 있다.
 */
export function resolveTarget(interaction, { userOption = '사람', npcOption = '캐릭터' } = {}) {
  const picked = interaction.options.getUser(userOption);
  const npc = interaction.options.getString(npcOption);

  if (picked && npc) return { error: '사람과 캐릭터 중 하나만 골라 주세요.' };
  if (npc) {
    if (!characterOf(npc) || !OWNER_META[characterOf(npc)]) return { error: '모르는 캐릭터예요.' };
    return { ...displayOf(npc), self: false };
  }

  const target = picked ?? interaction.user;
  const member = picked
    ? interaction.options.getMember(userOption)
    : interaction.member;
  if (target.bot) return { error: '봇은 카지노 계정이 없어요.' };
  return { ...displayOf(target.id, { user: target, member }), self: target.id === interaction.user.id };
}

export default { NPC_ID, NPC_CHOICES, isNpcId, characterOf, displayOf, resolveTarget };
