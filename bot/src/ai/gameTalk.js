/**
 * gameTalk — 요트 NPC 가 판을 보고 말한다
 *
 * /캐입 과 같은 Gemini 를 쓰지만 정책이 다르다.
 *
 *   프롬프트  세계관·연표를 뺀 말투 위주(3.4KB). 캐입은 7.7KB 다.
 *   쿨다운    없다. 사람이 부른 게 아니라 NPC 차례다.
 *   분당 한도 계량의 70% 까지만 — 배경에서 도는 게임이 사람의 /캐입 을 굶기면 안 된다.
 *   기록      안 남긴다. 그 판에서 한 말 여섯 줄을 얹어 되풀이를 막는다.
 *   실패      **조용히 넘어간다.** 대사가 없을 뿐 판은 계속 돌아야 한다.
 *
 * 그래서 이 파일의 함수는 절대 던지지 않는다. 못 하면 null 이다.
 *
 * NPC 는 매 턴 두 번 말한다 — 굴릴 때 한 번, 칸에 적을 때 한 번. 그런데 호출은
 * **한 번만** 한다(turnLines). 턴 전체를 한 번에 계산해 두고 두 줄을 같이 받는 식이다.
 * 호출을 반으로 줄이는 것도 있지만, 무엇보다 두 줄이 서로 이어진다 —
 * "5를 노려보지" 하고 굴린 다음 "결국 안 나왔군" 하고 적을 수 있다.
 */
import { generate, checkRate, noteCall } from './client.js';
import { voicePromptFor, NAME } from './persona.js';
import { ATTITUDE, RULES, clean, recentOf } from './voice.js';
import config from '../config.js';

/**
 * 사람 몫으로 남겨 둘 분당 한도 비율.
 * NPC 턴마다 부르게 되면서 0.4 로는 게임 쪽이 자주 막혀 0.3 으로 낮췄다.
 * 그래도 분당 한도의 30% 는 사람이 /캐입 을 칠 몫으로 남는다.
 */
const RESERVE = 0.3;
/** 한 판에서 NPC 하나가 할 수 있는 말의 최대 수. 폭주 방지용 안전장치다. */
export const MAX_LINES = 40;

/** 요트에서만 다른 부분. 노는 태도 자체는 voice.js 의 ATTITUDE 가 들고 있다. */
const PLAYING = {
  migel: '- 요트에서는 큰 것을 노린다. 안전한 칸보다 한 방을 본다.',
  matiam: '- 요트에서는 확실한 칸부터 채운다. 보너스를 놓치지 않으려 한다.',
};

const systemFor = (character, variant) => [
  voicePromptFor(character, variant),
  '',
  '## 지금 하고 있는 것',
  '친구들과 요트 다이스(주사위 5개로 12칸을 채우는 게임)를 하는 중이다.',
  '',
  '## 판에서의 나',
  ...ATTITUDE[character],
  PLAYING[character],
  ...RULES(character),
].join('\n');

/**
 * 부팅 시 변형별로 조립해 둔다.
 *
 * 매번 같은 예시를 보여 주면 모델이 그중 한 문장을 틀로 굳혀 버린다. 실제로 미겔이
 * 매 턴 "우와~ 사백씨, 이번엔 …" 으로 시작하고 "이이이래도 되는 겁니까~? …칸에 N점
 * 콩~" 으로 끝내는 판이 나왔다. 부를 때마다 다른 예시 묶음을 보여 준다.
 */
const VARIANTS = 6;
const SYSTEM = {
  migel: Array.from({ length: VARIANTS }, (_, i) => systemFor('migel', i)),
  matiam: Array.from({ length: VARIANTS }, (_, i) => systemFor('matiam', i)),
};
const systemOf = (character, variant) =>
  SYSTEM[character][Math.abs(Math.floor(variant)) % VARIANTS];

/** 한도와 집계. 막히면 사유를 로그에 남기고 false. */
function allowed(character, said) {
  if (!config.gemini.apiKey) return false;
  if (said.length >= MAX_LINES) return false;
  const blocked = checkRate({ reserve: RESERVE });
  if (blocked) {
    console.warn(`[요트] ${NAME[character]} 대사 건너뜀 — ${blocked}`);
    return false;
  }
  noteCall();
  return true;
}

/**
 * 한 줄. 판 시작·종료처럼 한 마디면 되는 자리에 쓴다.
 * 못 하면 null — 절대 던지지 않는다.
 */
export async function line({ character, situation, said = [] }) {
  if (!allowed(character, said)) return null;

  const text = [
    situation,
    recentOf(said),
    // 마지막 줄에서 한 번 더 못을 박는다. 말투 예시가 전부 상대에게 말을 거는 대사라,
    // 규칙을 시스템 프롬프트에만 적어 두면 자기가 한 일을 남이 한 일로 읽는다.
    '\n위는 전부 **내가** 한 일이다. 남이 한 일이 아니다.',
    '내 반응을 한두 문장으로 말해라.',
  ].filter(Boolean).join('\n');

  try {
    const res = await generate({
      system: systemOf(character, said.length),
      contents: [{ role: 'user', parts: [{ text }] }],
      temperature: 1.2,
      maxOutputTokens: 1200,
    });
    return clean(String(res.text || '').split('\n')[0]) || null;
  } catch (err) {
    console.warn(`[요트] ${NAME[character]} 대사 실패:`, err.message?.slice(0, 120));
    return null;
  }
}

/**
 * 한 턴 분량 두 줄. `{ rolling, writing }` 또는 null.
 *
 *   rolling  주사위를 굴리며 — 무엇을 노리는지
 *   writing  칸에 적으며 — 그래서 어떻게 됐는지
 *
 * 한 번에 받는 덕에 두 줄이 이어진다. 따로 부르면 앞에서 뭘 노렸는지 모른 채
 * 뒷줄을 쓰게 되고, 호출도 두 배로 든다.
 */
export async function turnLines({ character, situation, said = [] }) {
  if (!allowed(character, said)) return null;

  const text = [
    situation,
    recentOf(said),
    '\n위는 전부 **내가** 한 일이다. 남이 한 일이 아니다.',
    '',
    '두 줄로 답해라. 번호나 설명을 붙이지 말고 대사만. 줄바꿈은 딱 한 번.',
    '1번째 줄 — 주사위를 굴리는 동안 내가 한 말. 무엇을 노리는지가 드러나게.',
    '2번째 줄 — 칸에 적으면서 내가 한 말. 결과에 대한 반응.',
    '둘 다 나답게. 판 이야기만 할 필요는 없다.',
    '두 줄이 같은 식으로 끝나지 않게 한다. 둘 다 이름을 부르며 끝내지 않는다.',
  ].filter(Boolean).join('\n');

  try {
    const res = await generate({
      system: systemOf(character, said.length),
      contents: [{ role: 'user', parts: [{ text }] }],
      temperature: 1.2,
      maxOutputTokens: 1500,
    });
    const rows = String(res.text || '')
      .split('\n')
      .map(clean)
      .filter(Boolean);
    if (!rows.length) return null;
    // 한 줄만 오면 적을 때 한 말로 친다 — 결과에 대한 반응이 더 중요하다.
    return rows.length === 1
      ? { rolling: null, writing: rows[0] }
      : { rolling: rows[0], writing: rows[1] };
  } catch (err) {
    console.warn(`[요트] ${NAME[character]} 대사 실패:`, err.message?.slice(0, 120));
    return null;
  }
}

export default { line, turnLines, MAX_LINES };
