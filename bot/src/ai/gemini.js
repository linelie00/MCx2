/**
 * gemini — 캐입 핑퐁의 모델 호출과 대화 상태
 *
 * 무료 티어를 쓰므로 한도를 넘기지 않게 자체 가드를 둔다. 실제 한도는 지역·계정·과금
 * 연결 여부에 따라 달라서 문서 숫자를 믿기 어렵다. AI Studio 대시보드에서 확인하고
 * GEMINI_RPM / GEMINI_RPD 로 조정한다.
 *
 * 대화 기록은 메모리에만 둔다. 봇이 재시작되면 사라지지만, 서버의 JSON 스토어를
 * 오염시키지 않는 편이 낫고 둘이 쓰는 봇에서 그 손해는 크지 않다.
 */
import { GoogleGenAI } from '@google/genai';
import config from '../config.js';
import { systemPromptFor, NAME } from './persona.js';

const HISTORY_TURNS = 12;              // user/model 합쳐 12개 = 6번 주고받기
const HISTORY_TTL = 30 * 60 * 1000;    // 30분 지나면 맥락을 버린다
const USER_COOLDOWN = 5 * 1000;

/**
 * 안전 필터를 모두 끈다.
 * 마티암은 목이 잘린 재봉사고 세션 내용에 마물·전투가 흔해서 DANGEROUS 계열에
 * 걸릴 여지가 크다. 둘만 쓰는 비공개 봇이라 필터로 얻을 게 없다.
 */
const SAFETY = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
  'HARM_CATEGORY_CIVIC_INTEGRITY',
].map((category) => ({ category, threshold: 'OFF' }));

let client = null;
function getClient() {
  if (!config.gemini.apiKey) return null;
  if (!client) client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return client;
}

// ---------------------------------------------------------------- 사용량 가드

const minute = { count: 0, resetAt: 0 };
const day = { count: 0, key: '' };
const lastCallByUser = new Map();

const kstDay = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

/** 호출해도 되는지 본다. 안 되면 사용자에게 보여줄 한국어 사유를 돌려준다. */
function checkQuota(userId) {
  const now = Date.now();

  const last = lastCallByUser.get(userId) || 0;
  if (now - last < USER_COOLDOWN) {
    return `조금만 천천히요. ${Math.ceil((USER_COOLDOWN - (now - last)) / 1000)}초 뒤에 다시 불러주세요.`;
  }

  if (now > minute.resetAt) { minute.count = 0; minute.resetAt = now + 60_000; }
  if (minute.count >= config.gemini.rpm) {
    return `지금 1분 한도(${config.gemini.rpm}회)를 다 썼어요. 잠시 뒤에 다시 불러주세요.`;
  }

  const today = kstDay();
  if (day.key !== today) { day.key = today; day.count = 0; }
  if (day.count >= config.gemini.rpd) {
    return `오늘 몫(${config.gemini.rpd}회)을 다 썼어요. 내일 다시 불러주세요.`;
  }

  return null;
}

function noteCall(userId) {
  minute.count += 1;
  day.count += 1;
  lastCallByUser.set(userId, Date.now());
}

/**
 * 지금 얼마나 썼는지. 구글의 실제 한도가 아니라 우리가 건 안전장치 기준이다.
 * 분 단위는 시계상의 분이 아니라 첫 호출부터 60초짜리 창이라, 언제 풀리는지도 알려준다.
 */
export const usage = () => {
  const left = Math.max(0, Math.ceil((minute.resetAt - Date.now()) / 1000));
  return {
    minute: `${minute.count}/${config.gemini.rpm}`,
    minuteResetsIn: minute.count && left ? left : 0,
    day: `${day.count}/${config.gemini.rpd}`,
    model: config.gemini.model,
  };
};

// ---------------------------------------------------------------- 대화 상태

const sessions = new Map();   // `${channelId}:${character}` → { history, lastAt }

const keyOf = (channelId, character) => `${channelId}:${character}`;

function getHistory(channelId, character) {
  const s = sessions.get(keyOf(channelId, character));
  if (!s) return [];
  if (Date.now() - s.lastAt > HISTORY_TTL) {
    sessions.delete(keyOf(channelId, character));
    return [];
  }
  return s.history;
}

function pushHistory(channelId, character, userText, modelText) {
  const history = getHistory(channelId, character).concat([
    { role: 'user', parts: [{ text: userText }] },
    { role: 'model', parts: [{ text: modelText }] },
  ]);
  sessions.set(keyOf(channelId, character), {
    history: history.slice(-HISTORY_TURNS),
    lastAt: Date.now(),
  });
}

/** 대화를 지운다. 지운 게 있었는지 돌려준다. */
export function resetSession(channelId, character) {
  if (character) return sessions.delete(keyOf(channelId, character));
  let any = false;
  for (const key of [...sessions.keys()]) {
    if (key.startsWith(`${channelId}:`)) { sessions.delete(key); any = true; }
  }
  return any;
}

// ---------------------------------------------------------------- 호출

/** 모델이 "미겔:" 같은 접두사를 붙이는 경우가 있어 걷어낸다. */
function cleanReply(text) {
  return String(text || '')
    .replace(/^\s*(미겔|마티암)\s*[::]\s*/, '')
    .trim();
}

export class GeminiError extends Error {}

/**
 * SDK 는 실패를 JSON 문자열째로 던질 때가 많다.
 * 그대로 보여주면 사용자에게는 읽을 수 없는 덩어리라, 안쪽 message 만 꺼낸다.
 */
function readableError(err) {
  const raw = String(err?.message || err || '');
  const at = raw.indexOf('{');
  if (at >= 0) {
    try {
      const body = JSON.parse(raw.slice(at));
      return body?.error?.message || raw;
    } catch { /* JSON 이 아니면 원문 그대로 */ }
  }
  return raw;
}

/**
 * 일시적 실패는 다시 해 본다.
 *
 * 무료 티어의 인기 모델은 503("This model is currently experiencing high demand")을
 * 자주 낸다. 몇 초 뒤면 되는 경우가 대부분이라, 사용자에게 다시 치라고 하기보다
 * 여기서 조용히 재시도하는 편이 낫다. 한도 초과(429)는 재시도해도 소용없으므로 제외한다.
 */
async function withRetry(fn, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = readableError(err);
      const transient = /503|high demand|overloaded|UNAVAILABLE|500|internal/i.test(msg)
        && !/quota|RESOURCE_EXHAUSTED|429/i.test(msg);
      if (!transient || i === attempts - 1) throw err;
      await new Promise((r) => { setTimeout(r, 1200 * (i + 1)); });
    }
  }
  throw last;
}

/** 대화를 지원하는 모델 이름만 추린다. 설정이 틀렸을 때 안내에 쓴다. */
async function listModels(ai) {
  const names = [];
  for await (const m of await ai.models.list()) {
    if (m.supportedActions && !m.supportedActions.includes('generateContent')) continue;
    names.push(String(m.name || '').replace(/^models\//, ''));
  }
  return names.filter((n) => n.includes('flash') || n.includes('pro'));
}

/**
 * 캐릭터로서 한 번 답한다.
 * 실패는 GeminiError 로 던지고, 메시지는 그대로 사용자에게 보여줄 한국어다.
 */
export async function speak({ character, channelId, userId, text }) {
  const ai = getClient();
  if (!ai) throw new GeminiError('GEMINI_API_KEY 가 설정돼 있지 않아요.');
  if (!config.gemini.model) throw new GeminiError('GEMINI_MODEL 이 설정돼 있지 않아요.');

  const blocked = checkQuota(userId);
  if (blocked) throw new GeminiError(blocked);

  const history = getHistory(channelId, character);
  const contents = [...history, { role: 'user', parts: [{ text }] }];

  const params = {
    model: config.gemini.model,
    contents,
    config: {
      systemInstruction: systemPromptFor(character),
      safetySettings: SAFETY,
      temperature: 1.0,
      // thinking 하는 모델은 사고 토큰도 이 한도에서 깎아 쓴다. 실제로 400 이었을 때
      // gemini-3.5-flash 가 382토큰을 사고에 쓰고 본문은 18자만 내놓은 채 잘렸다.
      // 본문 자체는 긴 답도 200토큰을 안 넘으므로(프롬프트가 1~3문장을 요구한다),
      // 사고 몫까지 넉넉히 얹는다. 안 쓰면 청구도 안 된다.
      maxOutputTokens: 2000,
    },
  };

  let res;
  let usedModel = config.gemini.model;
  try {
    noteCall(userId);   // 실패해도 호출은 이미 나갔으므로 먼저 센다
    try {
      res = await withRetry(() => ai.models.generateContent(params));
    } catch (err) {
      // 인기 모델은 통째로 한동안 내려앉기도 한다(재시도로는 못 넘긴다).
      // 그럴 땐 대체 모델로 한 번 더 시도한다 — 대답을 못 받는 것보단 낫다.
      const overloaded = /503|high demand|overloaded|UNAVAILABLE/i.test(readableError(err));
      const fallback = config.gemini.fallbackModel;
      if (!overloaded || !fallback || fallback === config.gemini.model) throw err;

      console.warn(`[gemini] ${config.gemini.model} 붐빔 → ${fallback} 로 대체`);
      res = await withRetry(() => ai.models.generateContent({ ...params, model: fallback }), 2);
      usedModel = fallback;
    }
  } catch (err) {
    const msg = readableError(err);
    if (/quota|RESOURCE_EXHAUSTED|429/i.test(msg)) {
      throw new GeminiError('무료 한도를 넘었어요. 잠시 뒤에 다시 불러주세요.');
    }
    if (/API key|401|403|PERMISSION/i.test(msg)) {
      throw new GeminiError('Gemini 키가 거절당했어요. GEMINI_API_KEY 를 확인해 주세요.');
    }
    if (/503|high demand|overloaded|UNAVAILABLE/i.test(msg)) {
      throw new GeminiError(
        `${config.gemini.model} 도 ${config.gemini.fallbackModel} 도 지금 붐벼요.\n`
        + '잠시 뒤에 다시 불러주세요.',
      );
    }
    if (/not found|404/i.test(msg)) {
      // 모델 id 는 구글이 자주 갈아치운다. 추측하게 두지 말고 쓸 수 있는 것을 보여준다.
      const usable = await listModels(ai).catch(() => []);
      throw new GeminiError(
        `모델 "${config.gemini.model}" 을 찾을 수 없어요.`
        + (usable.length ? `\nGEMINI_MODEL 에 쓸 수 있는 것: ${usable.slice(0, 8).join(', ')}` : ''),
      );
    }
    throw new GeminiError(`대답을 받지 못했어요. (${msg.slice(0, 150)})`);
  }

  const finish = res.candidates?.[0]?.finishReason;
  const reply = cleanReply(res.text);

  // 토큰 한도에 걸려 문장 중간에서 끊긴 경우. 그대로 내보내면 왜 끊겼는지 알 수 없다.
  // 대체 모델이 답했으면 말투가 조금 다를 수 있으니 밝혀 둔다.
  const note = usedModel === config.gemini.model ? '' : `\n_(${usedModel} 으로 답했어요)_`;

  if (reply && finish === 'MAX_TOKENS') {
    pushHistory(channelId, character, text, reply);
    return `${reply}…\n_(말이 길어져서 여기서 끊겼어요)_`;
  }

  if (!reply) {
    // 안전 필터를 다 껐어도 막힐 때가 있다. 왜 비었는지 알려준다.
    const reason = res.promptFeedback?.blockReason || finish;
    throw new GeminiError(
      `${NAME[character]}이(가) 아무 말도 하지 않았어요.${reason ? ` (${reason})` : ''}`,
    );
  }

  pushHistory(channelId, character, text, reply);
  return reply + note;
}

export default { speak, resetSession, usage, GeminiError };
