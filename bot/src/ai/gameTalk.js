/**
 * gameTalk — 요트 NPC 가 판을 보고 한 줄 던진다
 *
 * /캐입 과 같은 Gemini 를 쓰지만 정책이 다르다.
 *
 *   프롬프트  세계관 6KB 를 뺀 말투 위주(1.3KB). 한 판에 열 번 넘게 부르니까.
 *   쿨다운    없다. 사람이 부른 게 아니라 NPC 차례다.
 *   분당 한도 계량의 60% 까지만 — 배경에서 도는 게임이 사람의 /캐입 을 굶기면 안 된다.
 *   기록      안 남긴다. 그 판에서 한 말 두어 줄만 그때그때 얹어 반복을 막는다.
 *   실패      **조용히 넘어간다.** 대사가 없을 뿐 판은 계속 돌아야 한다.
 *
 * 그래서 이 파일의 함수는 절대 던지지 않는다. 못 하면 null 이다.
 */
import { generate, checkRate, noteCall } from './client.js';
import { voicePromptFor, NAME } from './persona.js';
import config from '../config.js';

/** 사람 몫으로 남겨 둘 분당 한도 비율. */
const RESERVE = 0.4;
/** 한 판에서 NPC 하나가 할 수 있는 말의 최대 수. */
export const MAX_LINES = 8;
/** 이 점수 미만인 순간에는 입을 다문다. 매 턴 떠들면 성격이 아니라 소음이 된다. */
export const SPEAK_THRESHOLD = 55;

/** 게임 상황을 아는 부분. persona 는 게임을 모르므로 여기서 뒤에 붙인다. */
const PLAYING = {
  migel: '큰 것을 노린다. 잘 되면 신나 하고 안 되면 웃어넘긴다. 지고 있어도 기죽지 않는다.',
  matiam: '신중하다. 확실한 쪽을 고르고 무리하지 않는다. 남이 무리하는 걸 재미있어한다.',
};

const systemFor = (character) => [
  voicePromptFor(character),
  '',
  '## 지금 하고 있는 것',
  '친구들과 요트 다이스(주사위 5개로 12칸을 채우는 게임)를 하는 중이다.',
  `게임할 때의 나: ${PLAYING[character]}`,
  '',
  '## 지켜야 할 것',
  '- 한국어로 **한 문장**만. 40자 안팎으로 짧게.',
  '- 방금 그 일을 한 사람은 **나 자신**이다. 남이 한 일처럼 말하거나 남을 칭찬하지 않는다.',
  '- 방금 일어난 일에 대한 반응이다. 규칙 설명이나 훈수는 하지 않는다.',
  '- 점수를 그대로 읊지 않는다. 판에 이미 적혀 있다.',
  `- "${NAME[character]}:" 같은 화자 이름을 앞에 붙이지 않는다. 바로 대사부터.`,
  '- 짧은 행동은 (괄호) 안에 적어도 좋다. 나레이션은 하지 않는다.',
  '- 네가 AI이거나 언어모델이라는 사실을 절대 언급하지 않는다.',
].join('\n');

/** 부팅 시 한 번만 조립한다. */
const SYSTEM = {
  migel: systemFor('migel'),
  matiam: systemFor('matiam'),
};

/** 모델이 이름표나 따옴표를 붙이는 경우가 있어 걷어낸다. */
function clean(text) {
  return String(text || '')
    .replace(/^\s*(미겔|마티암)\s*[::]\s*/, '')
    .replace(/^["“']|["”']$/g, '')
    .split('\n')[0]          // 여러 줄로 오면 첫 줄만
    .trim();
}

/**
 * 한 줄 만들어 온다. 못 하면 null — 절대 던지지 않는다.
 *
 * said 는 그 NPC 가 이 판에서 이미 한 말들이다. 기록을 따로 안 들고 있으므로,
 * 마지막 두 줄만 프롬프트에 얹어 같은 말을 반복하지 않게 한다.
 */
export async function line({ character, situation, said = [] }) {
  if (!config.gemini.apiKey) return null;
  if (said.length >= MAX_LINES) return null;

  const blocked = checkRate({ reserve: RESERVE });
  if (blocked) {
    console.warn(`[요트] ${NAME[character]} 대사 건너뜀 — ${blocked}`);
    return null;
  }

  // 마지막 줄에서 한 번 더 못을 박는다. 말투 예시가 전부 상대에게 말을 거는 대사라,
  // 규칙을 시스템 프롬프트에만 적어 두면 모델이 **자기가 한 일을 남이 한 일로 읽고**
  // 상대를 칭찬하거나 훈수한다. 실제로 미겔이 자기가 낸 야찌를 두고 마티암을 칭찬했다.
  const recent = said.slice(-2);
  const text = [
    situation,
    recent.length ? `\n아까 내가 한 말: ${recent.map((t) => `"${t}"`).join(' / ')}` : '',
    '\n위는 전부 **내가** 한 일이다. 남이 한 일이 아니다.',
    '내가 방금 한 일에 대한 내 반응을 한 문장으로 말해라.',
  ].filter(Boolean).join('\n');

  try {
    noteCall();
    const res = await generate({
      system: SYSTEM[character],
      contents: [{ role: 'user', parts: [{ text }] }],
      temperature: 1.15,
      // 한 문장이면 충분하지만 thinking 하는 모델은 사고 토큰도 여기서 깎아 쓴다.
      // 400 으로 뒀다가 사고에 다 쓰고 본문이 잘린 적이 있어서 넉넉히 준다.
      maxOutputTokens: 1200,
    });
    return clean(res.text) || null;
  } catch (err) {
    // 대사는 있으면 좋은 것이지 판을 막을 이유가 아니다.
    console.warn(`[요트] ${NAME[character]} 대사 실패:`, err.message?.slice(0, 120));
    return null;
  }
}

export default { line, MAX_LINES, SPEAK_THRESHOLD };
