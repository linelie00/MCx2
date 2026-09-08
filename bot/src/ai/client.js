/**
 * client — Gemini 호출의 공통 배관
 *
 * /캐입(gemini.js)과 요트 NPC 대사(gameTalk.js)가 같이 쓴다.
 *
 * **사용량 계량이 여기 하나뿐인 것이 핵심이다.** 구글 쪽 한도는 하나인데 기능마다
 * 카운터를 따로 두면 둘이 각자 "아직 여유 있다"고 판단해서 실제 한도를 넘긴다.
 * 그러면 사람이 직접 쓰는 /캐입 이 429 를 맞는다 — 게임이 배경에서 돌다가 사람을
 * 굶기는 셈이다. 계량은 하나로 두고 **정책만** 기능별로 나눈다(checkRate 의 reserve).
 *
 * 여기에는 사용자에게 보여줄 문구를 만들지 않는다. 실패를 어떻게 알릴지는 기능마다
 * 다르다 — /캐입 은 오류를 보여주고, 요트 NPC 는 조용히 말을 안 한다.
 */
import { GoogleGenAI } from '@google/genai';
import config from '../config.js';

/**
 * 안전 필터를 모두 끈다.
 * 마티암은 목이 잘린 재봉사고 세션 내용에 마물·전투가 흔해서 DANGEROUS 계열에
 * 걸릴 여지가 크다. 둘만 쓰는 비공개 봇이라 필터로 얻을 게 없다.
 */
export const SAFETY = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
  'HARM_CATEGORY_CIVIC_INTEGRITY',
].map((category) => ({ category, threshold: 'OFF' }));

let client = null;
export function getClient() {
  if (!config.gemini.apiKey) return null;
  if (!client) client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return client;
}

/**
 * SDK 는 실패를 JSON 문자열째로 던질 때가 많다.
 * 그대로 보여주면 사용자에게는 읽을 수 없는 덩어리라, 안쪽 message 만 꺼낸다.
 */
export function readableError(err) {
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
export async function withRetry(fn, attempts = 3) {
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
export async function listModels() {
  const ai = getClient();
  if (!ai) return [];
  const names = [];
  for await (const m of await ai.models.list()) {
    if (m.supportedActions && !m.supportedActions.includes('generateContent')) continue;
    names.push(String(m.name || '').replace(/^models\//, ''));
  }
  return names.filter((n) => n.includes('flash') || n.includes('pro'));
}

// ---------------------------------------------------------------- 사용량 계량

const minute = { count: 0, resetAt: 0 };
const day = { count: 0, key: '' };

const kstDay = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

/**
 * 지금 호출해도 되는지. 안 되면 사용자에게 보여줄 한국어 사유를 돌려준다.
 *
 * reserve 는 **사람 몫으로 남겨 둘 비율**이다. 0 이면 분당 한도를 다 쓸 수 있고,
 * 0.4 면 60% 까지만 쓴다. 요트 NPC 는 배경에서 도는 것이라 예약분을 두어,
 * 판이 돌아가는 중에도 사람이 /캐입 을 칠 여지를 남긴다.
 */
export function checkRate({ reserve = 0 } = {}) {
  const now = Date.now();
  if (now > minute.resetAt) { minute.count = 0; minute.resetAt = now + 60_000; }

  const cap = Math.max(1, Math.floor(config.gemini.rpm * (1 - reserve)));
  if (minute.count >= cap) {
    return reserve
      ? '사람이 쓸 몫을 남겨 두려고 잠시 쉬는 중이에요.'
      : `지금 1분 한도(${config.gemini.rpm}회)를 다 썼어요. 잠시 뒤에 다시 불러주세요.`;
  }

  const today = kstDay();
  if (day.key !== today) { day.key = today; day.count = 0; }
  if (day.count >= config.gemini.rpd) {
    return `오늘 몫(${config.gemini.rpd}회)을 다 썼어요. 내일 다시 불러주세요.`;
  }

  return null;
}

/** 요청을 보내기 직전에 부른다. 실패해도 호출은 이미 나갔으므로 되돌리지 않는다. */
export function noteCall() {
  minute.count += 1;
  day.count += 1;
}

/**
 * 지금 얼마나 썼는지. 구글의 실제 한도가 아니라 우리가 건 안전장치 기준이다.
 * 분 단위는 시계상의 분이 아니라 첫 호출부터 60초짜리 창이라, 언제 풀리는지도 알려준다.
 */
export function meter() {
  const left = Math.max(0, Math.ceil((minute.resetAt - Date.now()) / 1000));
  return {
    minute: `${minute.count}/${config.gemini.rpm}`,
    minuteResetsIn: minute.count && left ? left : 0,
    day: `${day.count}/${config.gemini.rpd}`,
    model: config.gemini.model,
  };
}

// ---------------------------------------------------------------- 호출

/**
 * 한 번 물어본다. 한도 확인과 집계는 **부르는 쪽이** 한다(정책이 기능마다 달라서다).
 * 실패는 SDK 예외 그대로 던진다 — 한국어로 옮기는 것도 기능마다 다르다.
 */
export async function generate({
  system, contents, temperature = 1.0, maxOutputTokens = 2000,
  model = config.gemini.model, fallback = config.gemini.fallbackModel,
}) {
  const ai = getClient();
  if (!ai) throw new Error('GEMINI_API_KEY 가 설정돼 있지 않아요.');

  const params = {
    model,
    contents,
    config: {
      systemInstruction: system,
      safetySettings: SAFETY,
      temperature,
      // thinking 하는 모델은 사고 토큰도 이 한도에서 깎아 쓴다. 실제로 400 이었을 때
      // gemini-3.5-flash 가 382토큰을 사고에 쓰고 본문은 18자만 내놓은 채 잘렸다.
      maxOutputTokens,
    },
  };

  let res;
  let usedModel = model;
  try {
    res = await withRetry(() => ai.models.generateContent(params));
  } catch (err) {
    // 인기 모델은 통째로 한동안 내려앉기도 한다(재시도로는 못 넘긴다).
    // 그럴 땐 대체 모델로 한 번 더 — 대답을 못 받는 것보단 낫다.
    const overloaded = /503|high demand|overloaded|UNAVAILABLE/i.test(readableError(err));
    if (!overloaded || !fallback || fallback === model) throw err;

    console.warn(`[gemini] ${model} 붐빔 → ${fallback} 로 대체`);
    res = await withRetry(() => ai.models.generateContent({ ...params, model: fallback }), 2);
    usedModel = fallback;
  }

  return {
    text: res.text,
    finishReason: res.candidates?.[0]?.finishReason,
    blockReason: res.promptFeedback?.blockReason,
    usedModel,
  };
}

export default {
  SAFETY, getClient, readableError, withRetry, listModels,
  checkRate, noteCall, meter, generate,
};
