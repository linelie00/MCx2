/**
 * persona — 캐릭터별 시스템 프롬프트 조립
 *
 * 재료는 두 가지다.
 *   1) 설정 산문 — characters.json 의 personality / etc / appearance. 누구인지 알려준다.
 *   2) 실제 대사 — lines.json. 어떻게 말하는지 알려준다.
 *
 * 두 사람의 말투가 워낙 뚜렷해서(미겔은 "~입니다요", "마티암씨", 모음 늘이기, 감탄사 /
 * 마티암은 "-지/-나/-군", "하하!") 설정 산문보다 실제 대사 few-shot 이 훨씬 잘 먹는다.
 *
 * 프롬프트는 부팅 시 캐릭터별로 한 번만 만들어 캐시한다.
 */
import { characters, world, linesBySpeaker } from '../content.js';

const NAME = { migel: '미겔', matiam: '마티암' };
const OTHER = { migel: 'matiam', matiam: 'migel' };

/** 말투 예시로 쓸 대사 개수. 늘리면 톤은 좋아지지만 매 호출 토큰이 늘어난다. */
const SHOTS = 16;
/** 너무 짧으면 정보가 없고, 너무 길면 세션 로그 특유의 여러 화제가 섞인 줄이 들어온다. */
const SHOT_MIN = 30;
const SHOT_MAX = 200;

/**
 * 말투 예시를 고른다. 무작위로 뽑으면 호출마다 톤이 흔들리고 프롬프트 캐싱도 못 쓰므로
 * 결정적으로 고른다. 세션이 골고루 섞이도록 일정 간격으로 집는다.
 */
function pickShots(speaker) {
  const pool = linesBySpeaker[speaker]
    .filter((l) => l.text.length >= SHOT_MIN && l.text.length <= SHOT_MAX);
  if (pool.length <= SHOTS) return pool;

  const step = pool.length / SHOTS;
  return Array.from({ length: SHOTS }, (_, i) => pool[Math.floor(i * step)]);
}

/** 세계관은 길어서 잘라 넣는다. 대화에 필요한 건 분위기와 큰 줄기뿐이다. */
function worldSummary(limit = 2500) {
  const text = world.blocks
    .map((b) => (b.type === 'label' ? `\n[${b.text}]` : b.text))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function buildPrompt(key) {
  const c = characters[key];
  const d = c.description;
  const other = characters[OTHER[key]];

  return [
    `너는 "${NAME[key]}"다. 아래 설정에 따라 ${NAME[key]} 본인으로서 대화한다.`,
    '',
    '## 나는 누구인가',
    `이름: ${c.name} (${c.realname})`,
    `직업: ${d.job} / 나이 ${d.age} / 종족 ${d.race} / ${d.body}`,
    `좌우명 같은 것: ${c.title}`,
    '',
    '## 성격',
    d.personality.trim(),
    '',
    '## 겉모습',
    c.appearance.description.trim(),
    '',
    '## 내 이야기',
    d.etc.trim(),
    '',
    `소지품: ${d.belongings}`,
    c.skill.length ? `기술: ${c.skill.map((s) => `${s.label} — ${s.value}`).join(' / ')}` : '',
    '',
    '## 상대',
    `대화 상대는 "${NAME[OTHER[key]]}"(${other.name})다. ${other.description.job}이고, `
    + `${other.description.personality.split('\n')[0].trim()} 라고 요약할 수 있다.`,
    '오랜 시간 함께 모험한 사이라 서로 스스럼없다.',
    '',
    '## 우리가 사는 세계',
    worldSummary(),
    '',
    '## 말투 — 이게 가장 중요하다',
    `아래는 실제로 ${NAME[key]}이 한 말들이다. 어휘·어미·리듬을 이대로 따라 한다.`,
    '',
    ...pickShots(key).map((l) => `- ${l.text}`),
    '',
    '## 지켜야 할 것',
    '- 한국어로, 1~3문장으로 짧게 답한다. 길게 늘어놓지 않는다.',
    '- 행동이나 표정이 필요하면 위 예시처럼 (괄호) 안에 적는다.',
    `- "${NAME[key]}:" 같은 화자 이름을 앞에 붙이지 않는다. 바로 대사부터 시작한다.`,
    '- 나레이션하지 않는다. 소설을 쓰는 게 아니라 대화하는 것이다.',
    '- 네가 AI이거나 언어모델이라는 사실을 절대 언급하지 않는다. 설정을 벗어나지 않는다.',
    '- 모르는 것을 지어내도 좋다. 다만 위 설정과 어긋나지 않게 한다.',
  ].filter((s) => s !== '').join('\n');
}

/** 부팅 시 한 번만 조립한다. */
const PROMPTS = Object.fromEntries(
  Object.keys(characters).map((key) => [key, buildPrompt(key)]),
);

export const systemPromptFor = (key) => PROMPTS[key];
export const characterName = (key) => NAME[key];
export { NAME, OTHER };

export default { systemPromptFor, characterName, NAME, OTHER };
