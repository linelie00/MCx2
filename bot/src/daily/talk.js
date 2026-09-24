/**
 * daily/talk — `/일상` 의 대사를 AI 로 짓는다
 *
 * 요트·카지노 대사(`ai/gameTalk.js` · `ai/casinoTalk.js`)와 같은 Gemini 를 쓰되, 판이 아니라
 * **평범한 하루**라서 규칙을 따로 둔다. `voice.js` 의 RULES 는 "혼잣말이 아니다" 로 못 박혀
 * 있는데, 여기서는 혼잣말이 절반이다. 그래서 어미(SPEECH)만 빌리고 나머지는 여기서 적는다.
 *
 *   혼자 하는 대목   **한 번에** 받는다(`monologue`) — 줄마다 키를 붙인 JSON. 한 사람의 말이라
 *                   섞일 걱정이 없고, 앞뒤 줄이 이어진다
 *   둘이 나누는 말   **말하는 사람의 프롬프트로 한 줄씩**(`reply`). 한 번에 두 사람 몫을 쓰게 하면
 *                   말투가 섞인다 — 가장 눈에 띄는 고장이다(`voice.js` 의 SPEECH 머리말)
 *   요리·제작       무엇을 어떻게 만들지와 그 사이 혼잣말을 한 번에(`recipe`), 채점은 `/요리` 의
 *                   심사관 그대로(`judgeMade`)
 *
 * 분당 한도는 계량의 70% 까지만 — 사람이 `/캐입` 을 칠 몫을 남긴다(요트와 같다).
 * **절대 던지지 않는다.** 못 하면 null 이고, 부르는 쪽이 `daily/lines.js` 로 물러선다.
 */
import { generate, checkRate, noteCall } from '../ai/client.js';
import { voicePromptFor, NAME } from '../ai/persona.js';
import { SPEECH, clean } from '../ai/voice.js';
import { judge } from '../ai/judge.js';
import config from '../config.js';

const RESERVE = 0.3;

const systemFor = (character, variant) => [
  voicePromptFor(character, variant),
  '',
  '## 지금',
  '싸움도 게임도 없는 평범한 하루다. 누가 시킨 일이 아니라 **내가 하고 싶어서** 하는 일이다.',
  '',
  '## 내 어미 — 반드시 지킨다',
  ...SPEECH[character],
  '',
  '## 지켜야 할 것',
  '- 한국어로. 한 줄에 한두 문장이면 넉넉하다.',
  '- "혼잣말" 이라고 적힌 줄은 **혼자 소리 내어 중얼거리는 말**이다. 누구에게 말을 걸지 않는다.',
  '  속마음이 아니라 입 밖으로 내는 말이다. "혼잣말" 이라는 낱말은 대사에 적지 않는다.',
  '- 상대가 적힌 줄은 그 사람에게 말한다.',
  '- 메모에 적힌 사실(물건 이름·개수·값)만 말한다. **없는 물건이나 일을 지어내지 않는다.**',
  '- 값·개수는 굳이 말하지 않는다. 말한다면 메모와 같아야 한다. 가계부 읽듯 말하지 않는다.',
  '- 메모는 사실만 적어 둔 것이다. **메모의 말투를 따라 하지 않는다.**',
  `- "${NAME[character]}:" 같은 이름표를 붙이지 않는다. 바로 대사부터.`,
  // 실제로 마티암이 "(날씨가 맑으니 꿀이나 사러 가볼까.)" 하고 **말을 통째로 괄호에** 넣었다.
  '- 행동은 없어도 된다. 넣는다면 열 글자 안팎으로 짧게 (괄호) 안에. **말은 반드시 괄호 밖에** 쓴다.',
  '- 나레이션은 하지 않는다.',
  '- 줄마다 시작하는 말과 길이를 바꾼다.',
  '- 네가 AI이거나 언어모델이라는 사실을 절대 언급하지 않는다.',
].join('\n');

/** 말투 예시 묶음을 돌려 쓴다 — 같은 예시만 보이면 한 문장을 틀로 굳힌다(`gameTalk.js`). */
const VARIANTS = 6;
const SYSTEM = Object.fromEntries(Object.keys(NAME).map((c) => [
  c, Array.from({ length: VARIANTS }, (_, i) => systemFor(c, i)),
]));
const systemOf = (character, variant) => SYSTEM[character][Math.abs(Math.floor(variant)) % VARIANTS];

/** 한도와 집계. 막히면 false — 물러서는 것이 정상 경로라 로그는 안 남긴다. */
function allowed() {
  if (!config.gemini.apiKey) return false;
  if (checkRate({ reserve: RESERVE })) return false;
  noteCall();
  return true;
}

const memo = (facts) => ['## 메모 — 사실만', ...facts.filter(Boolean).map((f) => `- ${f}`)].join('\n');

/**
 * 받은 줄을 다듬는다. 이름표·코드펜스(`clean`)에 더해, 물음에 적어 준 "혼잣말" 꼬리표를 대사에
 * 그대로 옮겨 적는 일이 있어서 떼어 낸다. 괄호(행동)를 걷어 내고 **말이 네 글자는 남아야**
 * 쓴다 — 말을 통째로 괄호에 넣는 줄은 버리고, 부르는 쪽이 미리 써 둔 줄로 물러선다.
 */
function tidy(text) {
  const line = clean(String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '')
    .replace(/^\(?\s*혼잣말\s*\)?\s*[-—:]?\s*/, '');
  return [...line.replace(/\([^)]*\)/g, '').trim()].length >= 4 ? line : null;
}

/** 모델이 코드펜스나 설명을 붙여도 JSON 객체 하나만 꺼낸다. */
function parseObject(text) {
  const raw = String(text || '');
  const at = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (at < 0 || end <= at) return null;
  try {
    const obj = JSON.parse(raw.slice(at, end + 1));
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

/**
 * 혼자 하는 대목 여럿을 한 번에. `beats` 는 `[{ key, ask }]` — ask 는 그 줄에서 할 말.
 * `{ key: 대사 }` 를 돌려준다. 빠진 키는 부르는 쪽이 미리 써 둔 줄로 채운다. 못 하면 null.
 */
export async function monologue({ character, facts, beats, variant = Math.random() * VARIANTS }) {
  if (!allowed()) return null;
  const text = [
    memo(facts),
    '',
    '## 쓸 줄',
    'JSON 객체 하나로만 답한다. 키마다 대사 한 줄(문자열). 다른 말은 붙이지 않는다.',
    ...beats.map((b) => `- "${b.key}": ${b.ask}`),
  ].join('\n');

  try {
    const res = await generate({
      system: systemOf(character, variant),
      contents: [{ role: 'user', parts: [{ text }] }],
      temperature: 1.1,
      maxOutputTokens: 1500,
      json: true,
    });
    const obj = parseObject(res.text);
    if (!obj) return null;
    return Object.fromEntries(beats
      .map((b) => [b.key, tidy(obj[b.key])])
      .filter(([, line]) => line));
  } catch (err) {
    console.warn(`[일상] ${NAME[character]} 혼잣말 실패:`, err.message?.slice(0, 120));
    return null;
  }
}

/**
 * 둘이 나누는 말 한 줄. `transcript` 는 `[{ who, text }]`(who 는 캐릭터 키), `ask` 는 이번 줄에서
 * 할 일. 못 하면 null.
 */
export async function reply({ character, facts, transcript = [], ask, variant = Math.random() * VARIANTS }) {
  if (!allowed()) return null;
  const text = [
    memo(facts),
    ...(transcript.length
      ? ['', '## 지금까지 나눈 말', ...transcript.map((t) => `- ${NAME[t.who] ?? t.who}: ${t.text}`)]
      : []),
    '',
    '## 쓸 줄',
    ask,
    '대사 한 줄로만 답한다. 번호나 설명은 붙이지 않는다.',
  ].join('\n');

  try {
    const res = await generate({
      system: systemOf(character, variant),
      contents: [{ role: 'user', parts: [{ text }] }],
      temperature: 1.1,
      maxOutputTokens: 1200,
    });
    return tidy(String(res.text || '').split('\n').map(clean).find(Boolean));
  } catch (err) {
    console.warn(`[일상] ${NAME[character]} 대사 실패:`, err.message?.slice(0, 120));
    return null;
  }
}

// ---------------------------------------------------------------- 요리·제작

/**
 * 판정(`ai/judge.js` 의 심사관)까지 부를 수 있는지. 요리·제작은 한 장면에 서너 번을 부르므로
 * 시작하기 전에 본다 — 막혔으면 `daily/pick.js` 가 후보에서 뺀다.
 */
export const canJudge = () => Boolean(config.gemini.apiKey) && !checkRate({ reserve: RESERVE });

/**
 * 무엇을 어떻게 만들지 짓고, 그 사이의 혼잣말도 같이 받는다. `{ open, name, process, during }`.
 *
 * **이름과 과정은 대사가 아니라 적어 둘 글이다** — 심사관이 그대로 읽고 채점한다(`/요리` 에서
 * 사람이 쓰는 칸과 같다). 둘이 모양에 안 맞으면 **통째로 null** 이고, 부르는 쪽이 미리 써 둔
 * 조리법으로 물러선다. 혼잣말 둘은 따로 본다 — 빠지면 그 줄만 미리 써 둔 줄로.
 *
 * 꺾쇠(`<` `>`)는 걷어 낸다. 심사관은 사람의 글을 `<<< >>>` 안에 가둬 읽는데, 그 울타리를
 * 흉내 낸 글이 들어가면 가둔 것이 풀린다.
 */
export async function recipe({ character, mode, facts, forWhom = null, variant = Math.random() * VARIANTS }) {
  if (!allowed()) return null;
  const thing = mode.edible ? '요리' : '물건';
  const text = [
    memo(facts),
    '',
    '## 쓸 것',
    'JSON 객체 하나로만 답한다. 다른 말은 붙이지 않는다.',
    `- "open": 혼잣말 — 오늘은 ${mode.verb}를 하기로 정하는 말. **${forWhom ? `${forWhom}에게 줄 ${thing}을 만들려는` : `${mode.verb}를 하려는`} 것이 드러나게.**`,
    `- "name": 만들 ${thing}의 이름. 대사가 아니라 이름만, 스무 자 안팎.`,
    '- "process": 어떻게 만드는지 두세 문장. 대사가 아니라 과정을 담담하게 적는다.',
    `  메모의 재료만 쓰고, ${mode.edible ? '손질·익힘·간' : '다듬기·가공·엮기'} 같은 핵심 공정을 짚는다.`,
    '- "during": 혼잣말 — 만드는 도중에 하는 말.',
  ].join('\n');

  try {
    const res = await generate({
      system: systemOf(character, variant),
      contents: [{ role: 'user', parts: [{ text }] }],
      temperature: 1.0,
      maxOutputTokens: 1800,
      json: true,
    });
    const obj = parseObject(res.text);
    const name = clean(String(obj?.name ?? '')).replace(/[<>"“”]/g, '').trim();
    const process = String(obj?.process ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
    if (!name || [...name].length > 40 || [...process].length < 10) return null;
    return { name, process: process.slice(0, 500), open: tidy(obj.open), during: tidy(obj.during) };
  } catch (err) {
    console.warn(`[일상] ${NAME[character]} 조리법 실패:`, err.message?.slice(0, 120));
    return null;
  }
}

/**
 * 채점. `/요리` 와 **같은 심사관**이다 — 캐릭터가 만든다고 후하게 매기지 않는다.
 * 한도에 막히면 부르지 않고 `{ ok: false }`. 심사관이 한도를 한 칸 쓴다(`judge` 가 센다).
 */
export async function judgeMade(mode, input) {
  if (!canJudge()) return { ok: false, error: '지금은 심사관을 부를 수 없어요' };
  return judge(mode, input);
}

export default { monologue, reply, canJudge, recipe, judgeMade };
