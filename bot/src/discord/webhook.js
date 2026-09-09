/**
 * webhook — 캐릭터 이름과 얼굴로 말하기
 *
 * 웹훅으로 보내면 봇이 아니라 미겔·마티암 본인이 말하는 것처럼 보인다.
 * /캐입 과 요트 NPC 대사가 같이 쓴다.
 *
 * 웹훅의 avatarURL 은 URL 을 요구하는데 사이트 초상화는 번들 해시가 붙어 빌드마다
 * 파일명이 바뀐다. 그래서 URL 로 거는 대신 **웹훅을 만들 때 이미지를 아바타로 구워
 * 넣는다**(createWebhook 은 로컬 파일을 받는다). 외부 호스팅이 전혀 필요 없다.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NAME } from '../ai/persona.js';
import { trunc } from '../embeds.js';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

/**
 * 웹훅에 띄울 이름. **페르소나가 없는 화자도 여기 들어온다.**
 *
 * 카지노 딜러 `npc` 는 미겔이 손님 자리에 앉았을 때만 나오는 진행 역할이라 성격도 말투도
 * 없다. 그래서 `persona.js` 의 `NAME`(= Gemini 프롬프트를 만드는 캐릭터 명단)이 아니라
 * 여기서 이름을 붙인다. `characters.json` 에 넣으면 부팅 때 persona 가 그 캐릭터의
 * 프롬프트를 만들다 터지고, `owners.js` 에 넣으면 `/영화` 선택지로 샌다.
 *
 * 아바타는 `assets/<key>.png` 를 웹훅 만들 때 한 번 구워 넣는다 — `assets/npc.png`.
 */
const DISPLAY = { ...NAME, npc: 'npc' };

/**
 * 채널 × 캐릭터마다 웹훅 하나. 한 번 만들면 재사용한다.
 * 봇이 재시작하면 캐시는 비지만, 채널에 이미 있는 웹훅을 찾아 쓰므로 새로 만들지 않는다.
 */
const cache = new Map();

/**
 * 스레드에는 웹훅을 만들 수 없고 fetchWebhooks 도 던진다. 부모 채널에 만들어 두고
 * 보낼 때 threadId 를 붙이는 게 정석이다. (이걸 안 해서 /캐입 은 스레드에서 못 썼다.)
 */
const parentOf = (channel) => (channel.isThread?.() ? (channel.parent ?? channel) : channel);

export async function getWebhook(channel, character) {
  const host = parentOf(channel);
  const cacheKey = `${host.id}:${character}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const wanted = DISPLAY[character] ?? character;
  const existing = await host.fetchWebhooks();
  let hook = existing.find((w) => w.name === wanted && w.owner?.id === host.client.user.id);

  if (!hook) {
    const avatar = path.join(ASSETS, `${character}.png`);
    hook = await host.createWebhook({
      name: wanted,
      // 초상화가 없으면 아바타 없이라도 만든다. 이름만으로도 누가 말하는지는 보인다.
      ...(fs.existsSync(avatar) ? { avatar } : {}),
      reason: '캐릭터로 말하기',
    });
  }

  cache.set(cacheKey, hook);
  return hook;
}

/** 그 캐릭터로 한 줄 보낸다. 실패는 그대로 던진다 — 어떻게 물러설지는 부르는 쪽이 정한다. */
export async function sayAs(channel, character, content) {
  const hook = await getWebhook(channel, character);
  return hook.send({
    content: trunc(content, 2000),
    // 부모 채널의 웹훅으로 스레드 안에 보내려면 이게 필요하다.
    ...(channel.isThread?.() && channel.parent ? { threadId: channel.id } : {}),
  });
}

/**
 * 그 캐릭터로 한 줄 보내되, 웹훅이 막히면 일반 메시지로라도 보낸다.
 *
 * 웹훅 관리 권한이 없는 채널에서는 대사가 통째로 사라져 기능이 죽은 것처럼 보인다.
 * 부르는 쪽마다 이 대비책을 따로 쓰고 있어서(캐입·요트) 여기로 모은다.
 * 둘 다 실패해도 던지지 않는다 — 대사는 있으면 좋은 것이지 판을 막을 이유가 아니다.
 */
export async function sayAsOrPlain(channel, character, content, label = '봇') {
  try {
    return await sayAs(channel, character, content);
  } catch (err) {
    console.warn(`[${label}] 웹훅 실패, 일반 메시지로 대체:`, err.message);
    // 여러 줄짜리 대사는 이름 다음에서 줄을 바꾼다. 한 줄로 붙이면 둘째 줄부터
    // 누가 말하는지 안 보인다.
    const gap = content.includes('\n') ? '\n' : ' ';
    return channel
      .send({ content: `**${DISPLAY[character] ?? character}**${gap}${trunc(content, 1900)}` })
      .catch((e) => {
        console.warn(`[${label}] 대사 전송 실패:`, e.message);
        return null;
      });
  }
}

export default { getWebhook, sayAs, sayAsOrPlain };
