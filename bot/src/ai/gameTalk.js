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
import config from '../config.js';

/**
 * 사람 몫으로 남겨 둘 분당 한도 비율.
 * NPC 턴마다 부르게 되면서 0.4 로는 게임 쪽이 자주 막혀 0.3 으로 낮췄다.
 * 그래도 분당 한도의 30% 는 사람이 /캐입 을 칠 몫으로 남는다.
 */
const RESERVE = 0.3;
/** 한 판에서 NPC 하나가 할 수 있는 말의 최대 수. 폭주 방지용 안전장치다. */
export const MAX_LINES = 40;

/** 게임 상황을 아는 부분. persona 는 게임을 모르므로 여기서 뒤에 붙인다. */
const PLAYING = {
  migel: '큰 것을 노린다. 잘 되면 신나 하고 안 되면 웃어넘긴다. 지고 있어도 기죽지 않는다.',
  matiam: '신중하다. 확실한 쪽을 고르고 무리하지 않는다. 남이 무리하는 걸 재미있어한다.',
};

/**
 * 어미를 못 박는다.
 *
 * 예시만으로는 부족했다. 상황 설명을 평서형 반말("…다시 굴렸다.")로 보내니 모델이
 * 그 말투를 따라가, 미겔이 "채워주지, 하하!" 하고 **마티암의 어미로** 말한 적이 있다.
 * 두 사람이 섞이는 게 가장 눈에 띄는 고장이라 규칙으로 직접 막는다.
 */
const SPEECH = {
  migel: [
    '- **항상 존댓말**이다. "~합니다", "~입니다", "~죠", "~군요", "~인가요", "~습니까" 같은 어미를 쓴다.',
    '- 사람을 부를 때는 이름 뒤에 "씨" 를 붙인다.',
    '- 감탄사와 늘인 모음을 즐긴다. "우와~", "후후", "야압", "~!!!".',
    '- **절대 반말로 말하지 않는다.** "~하지", "~하는군", "하하!" 같은 어미는 쓰지 않는다.',
  ],
  matiam: [
    '- **항상 반말**이다. "~지", "~군", "~나", "~겠어", "~다네" 같은 어미를 쓴다.',
    '- "하하!" 처럼 웃음을 섞는다. 짓궂게 툭 던진다.',
    '- 사람을 부를 때 이름 뒤에 "씨" 를 붙이지 않는다.',
    '- **절대 존댓말로 말하지 않는다.** "~합니다", "~죠" 같은 어미는 쓰지 않는다.',
  ],
};

const RULES = (character) => [
  '',
  '## 내 어미 — 반드시 지킨다',
  ...SPEECH[character],
  '',
  '## 지켜야 할 것',
  '- 한국어로. 한 줄에 한두 문장이면 넉넉하다.',
  '- 혼잣말이 아니다. **같이 하는 사람들에게 말을 걸듯** 한다.',
  '- **판에 있는 사람만 부른다.** 이 자리에 없는 사람 이름을 꺼내지 않는다.',
  '- 이름을 매번 부를 필요는 없다. 부르더라도 **늘 문장 끝에 붙이지 말고** 자리를 바꾼다.',
  '- 방금 그 일을 한 사람은 **나 자신**이다. 남이 한 일처럼 말하거나 남을 칭찬하지 않는다.',
  '- 주어진 상황 설명은 사실을 적어 둔 메모일 뿐이다. **그 말투를 따라 하지 않는다.**',
  '- 매번 다르게 말한다. 시작하는 감탄사, 부르는 말, 문장 길이를 계속 바꾼다.',
  '- 짧게 툭 던져도 되고 신이 나서 늘어놓아도 된다. 길이를 들쭉날쭉하게.',
  '- 점수·눈금·칸 이름을 말해도 되고 안 해도 된다. 하고 싶은 말을 한다.',
  '- 판과 상관없는 말을 섞어도 좋다. 딴소리, 농담, 옆 사람 놀리기, 노래 한 소절.',
  `- "${NAME[character]}:" 같은 화자 이름을 앞에 붙이지 않는다. 바로 대사부터.`,
  '- 행동은 (괄호) 안에 적는다. 나레이션은 하지 않는다.',
  '- 네가 AI이거나 언어모델이라는 사실을 절대 언급하지 않는다.',
];

const systemFor = (character, variant) => [
  voicePromptFor(character, variant),
  '',
  '## 지금 하고 있는 것',
  '친구들과 요트 다이스(주사위 5개로 12칸을 채우는 게임)를 하는 중이다.',
  `게임할 때의 나: ${PLAYING[character]}`,
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

/**
 * 모델이 덧붙이는 군더더기를 걷어낸다.
 *
 * 이름표("미겔:"), 번호("1."), 따옴표는 자주 붙는다. 여기에 더해 `</code>` 같은 HTML
 * 조각이나 코드펜스를 흘릴 때가 있다(실제로 마티암 대사 끝에 `</code>` 가 붙어 나왔다).
 * 태그를 지울 때 `<:이모지:id>` 나 `<@멘션>` 은 남겨야 하므로, 영문자로 시작하는
 * 태그만 지운다.
 */
function clean(text) {
  return String(text || '')
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .replace(/^\s*(미겔|마티암)\s*[::]\s*/, '')
    .replace(/^["“']|["”']$/g, '')
    .trim();
}

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
 * 아까 한 말들. 같은 말을 반복하지 않게 붙인다.
 *
 * 두 줄만 보여 줬더니 세 턴 전 표현으로 되돌아갔다. 여섯 줄까지 보여 주고,
 * 막연히 "반복하지 마라" 가 아니라 **무엇을 바꿔야 하는지**를 짚어 준다.
 */
const recentOf = (said) => (said.length
  ? [
    '',
    '## 이미 한 말 — 되풀이 금지',
    ...said.slice(-6).map((t) => `- ${t}`),
    '',
    '위 표현들은 이미 썼다. **같은 말로 시작하지 말고, 같은 틀을 다시 쓰지 마라.**',
    '시작하는 감탄사, 부르는 말, 문장 구조, 이름을 부르는 자리를 이번엔 다르게 잡는다.',
  ].join('\n')
  : '');

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
