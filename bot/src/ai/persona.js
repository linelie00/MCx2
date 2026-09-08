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
import { characters, world, lines, linesBySpeaker } from '../content.js';

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
function pickShots(speaker, n = SHOTS, mark = null) {
  const long = linesBySpeaker[speaker]
    .filter((l) => l.text.length >= SHOT_MIN && l.text.length <= SHOT_MAX);
  // 표지가 있는 줄만 추리되, 너무 적게 남으면 원래 풀로 돌아간다.
  const marked = mark ? long.filter((l) => mark.test(l.text)) : long;
  const pool = marked.length >= n * 2 ? marked : long;
  if (pool.length <= n) return pool;

  const step = pool.length / n;
  return Array.from({ length: n }, (_, i) => pool[Math.floor(i * step)]);
}

/** 세계관 전문. 6KB 남짓이라 통째로 넣어도 부담이 크지 않고, 잘라 넣으면 뒷부분 맥락이 사라진다. */
function worldSummary(limit = 6000) {
  const text = world.blocks
    .map((b) => (b.type === 'label' ? `\n[${b.text}]` : b.text))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

/**
 * 지금까지 겪은 일의 연표.
 *
 * 이게 없으면 모델이 설정에 적힌 과거 일화(염소에게 소매를 뜯긴 일 같은)를 방금 있었던
 * 일처럼 말한다. 세션 제목과 장면 라벨에 실제 날짜(03.22 ~ 04.13)가 들어 있으므로
 * 그대로 시간 축으로 쓴다.
 */
function timeline() {
  const bySession = new Map();
  for (const l of lines) {
    if (!bySession.has(l.sessionId)) {
      bySession.set(l.sessionId, { title: l.session, labels: new Set() });
    }
    if (l.scene) bySession.get(l.sessionId).labels.add(l.scene);
  }
  return [...bySession.values()].map((s, i) => {
    const when = [...s.labels][0]?.match(/^\s*(\d{2}\.\s*\d{2})/)?.[1]?.replace(/\s/g, '');
    return `${i + 1}. ${s.title}${when ? ` (${when})` : ''}`;
  });
}

/** 연표의 마지막 시점 — "지금"이 언제인지 알려주는 데 쓴다. */
function lastPoint() {
  const t = timeline();
  return t[t.length - 1]?.replace(/^\d+\.\s*/, '') || '';
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
    '## 지금 내 겉모습',
    '(생김새는 지금 그대로다. 다만 그렇게 된 사연은 대부분 오래전 일이다.)',
    c.appearance.description.trim(),
    '',
    '## 캐릭터 시트 — 모험을 시작하기 한참 전의 나',
    '아래는 **아주 오래된 배경 설정**이다. 아래 연표(모험)가 시작되기도 전의 일들이다.',
    '예를 들어 염소에게 소매를 뜯긴 일은 방금 있었던 사고가 아니라 오래전 일화다.',
    '여기 적힌 사건은 "옛날에 이런 일이 있었지" 하고 회상할 때만 꺼낸다.',
    '지금 막 일어난 일처럼 말하거나, 그 일이 진행 중인 것처럼 말하지 않는다.',
    '',
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
    '## 함께 겪은 모험 (시간순, 전부 끝난 일)',
    '위 캐릭터 시트의 일들이 있고 한참 뒤에, 아래 모험이 있었다.',
    '',
    ...timeline(),
    '',
    `**지금은 "${lastPoint()}" 까지 다 끝난 뒤다.** 우리는 이 일들을 함께 겪고 난 사이다.`,
    '지난 일을 물으면 회상하듯 답한다. 아직 안 일어난 일을 이미 일어난 것처럼 말하지 않는다.',
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
    '- **시제를 지킨다.** 캐릭터 시트의 일화는 아주 오래전, 연표의 사건은 최근에 끝난 일이다.',
    '  어느 쪽도 지금 벌어지는 중이 아니다. 묻지 않았는데 옛일을 지금 일처럼 꺼내지 않는다.',
  ].filter((s) => s !== '').join('\n');
}

/**
 * 말투만 담은 짧은 프롬프트.
 *
 * 캐입용 프롬프트는 세계관 전문(6KB)과 연표까지 들고 있는데, 요트 한 판에서는 대사를
 * 열 번 넘게 부른다. 매번 6KB 를 얹을 이유가 없다. 누구인지와 **어떻게 말하는지**만
 * 남기면 2KB 안쪽으로 줄어든다.
 *
 * 말투 예시는 그대로 둔다. 미겔·마티암처럼 들리게 하는 건 결국 이 부분이다.
 * 무엇을 하고 있는 상황인지는 부르는 쪽이 뒤에 붙인다 — 이 함수는 게임을 모른다.
 */
const VOICE_SHOTS = 8;

/**
 * 그 사람다운 어미가 실제로 들어 있는 줄만 고르기 위한 표지.
 *
 * 8줄로 줄이면 하필 밋밋한 줄만 뽑힐 수 있다. 실제로 요트에서 미겔이 "채워주지, 하하!"
 * 라고 마티암의 어미로 말한 적이 있다. 예시가 흐리면 두 사람이 섞인다.
 * (조건에 맞는 줄이 미겔 78 / 마티암 73 이라 8줄을 고르기에 넉넉하다.)
 */
const VOICE_MARKS = {
  migel: /니다|니까|습니|죠|군요|는데요|해요|입니다/,
  matiam: /(군|지|나|네|겠어|다네)[.!?~…]|하하/,
};

function buildVoice(key) {
  const c = characters[key];
  const d = c.description;

  return [
    `너는 "${NAME[key]}"이다. ${NAME[key]} 본인으로서 말한다.`,
    '',
    '## 나는 누구인가',
    `${c.name} · ${d.job} · 나이 ${d.age} · ${d.race}`,
    `좌우명 같은 것: ${c.title}`,
    '',
    '## 성격',
    d.personality.trim(),
    '',
    '## 말투 — 이게 가장 중요하다',
    `아래는 실제로 ${NAME[key]}이 한 말들이다. 어휘·어미·리듬을 이대로 따라 한다.`,
    '',
    ...pickShots(key, VOICE_SHOTS, VOICE_MARKS[key]).map((l) => `- ${l.text}`),
  ].join('\n');
}

/** 부팅 시 한 번만 조립한다. */
const PROMPTS = Object.fromEntries(
  Object.keys(characters).map((key) => [key, buildPrompt(key)]),
);
const VOICES = Object.fromEntries(
  Object.keys(characters).map((key) => [key, buildVoice(key)]),
);

export const systemPromptFor = (key) => PROMPTS[key];
export const voicePromptFor = (key) => VOICES[key];
export const characterName = (key) => NAME[key];
export { NAME, OTHER };

export default { systemPromptFor, voicePromptFor, characterName, NAME, OTHER };
