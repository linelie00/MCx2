/**
 * gemini — 캐입 핑퐁의 모델 호출과 대화 상태
 *
 * 모델 호출·재시도·사용량 계량은 client.js 가 한다(요트 NPC 대사와 공유한다).
 * 여기 남은 것은 **캐입만의 정책**이다.
 *
 *   - 사람당 5초 쿨다운 (사람이 직접 치는 명령이라 연타를 막는다)
 *   - 채널 × 캐릭터별 대화 기록
 *   - 실패를 한국어 한 줄로 옮겨 사용자에게 보여주기
 *
 * 대화 기록은 메모리에만 둔다. 봇이 재시작되면 사라지지만, 서버의 JSON 스토어를
 * 오염시키지 않는 편이 낫고 둘이 쓰는 봇에서 그 손해는 크지 않다.
 */
import config from '../config.js';
import { systemPromptFor, NAME } from './persona.js';
import {
  generate, checkRate, noteCall, meter, readableError, listModels,
} from './client.js';

const HISTORY_TURNS = 12;              // user/model 합쳐 12개 = 6번 주고받기
const HISTORY_TTL = 30 * 60 * 1000;    // 30분 지나면 맥락을 버린다
const USER_COOLDOWN = 5 * 1000;

// ---------------------------------------------------------------- 사용량 가드

const lastCallByUser = new Map();

/** 호출해도 되는지 본다. 안 되면 사용자에게 보여줄 한국어 사유를 돌려준다. */
function checkQuota(userId) {
  const now = Date.now();
  const last = lastCallByUser.get(userId) || 0;
  if (now - last < USER_COOLDOWN) {
    return `조금만 천천히요. ${Math.ceil((USER_COOLDOWN - (now - last)) / 1000)}초 뒤에 다시 불러주세요.`;
  }
  // 사람이 직접 부른 것이므로 예약분 없이 분당 한도를 다 쓸 수 있다.
  return checkRate();
}

export const usage = () => meter();

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

/** SDK 예외를 사용자에게 보여줄 한국어 한 줄로 옮긴다. */
async function toKorean(err) {
  const msg = readableError(err);
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(msg)) {
    return '무료 한도를 넘었어요. 잠시 뒤에 다시 불러주세요.';
  }
  if (/API key|401|403|PERMISSION/i.test(msg)) {
    return 'Gemini 키가 거절당했어요. GEMINI_API_KEY 를 확인해 주세요.';
  }
  if (/503|high demand|overloaded|UNAVAILABLE/i.test(msg)) {
    return `${config.gemini.model} 도 ${config.gemini.fallbackModel} 도 지금 붐벼요.\n`
      + '잠시 뒤에 다시 불러주세요.';
  }
  if (/not found|404/i.test(msg)) {
    // 모델 id 는 구글이 자주 갈아치운다. 추측하게 두지 말고 쓸 수 있는 것을 보여준다.
    const usable = await listModels().catch(() => []);
    return `모델 "${config.gemini.model}" 을 찾을 수 없어요.`
      + (usable.length ? `\nGEMINI_MODEL 에 쓸 수 있는 것: ${usable.slice(0, 8).join(', ')}` : '');
  }
  return `대답을 받지 못했어요. (${msg.slice(0, 150)})`;
}

/**
 * 캐릭터로서 한 번 답한다.
 * 실패는 GeminiError 로 던지고, 메시지는 그대로 사용자에게 보여줄 한국어다.
 */
export async function speak({ character, channelId, userId, text }) {
  if (!config.gemini.apiKey) throw new GeminiError('GEMINI_API_KEY 가 설정돼 있지 않아요.');
  if (!config.gemini.model) throw new GeminiError('GEMINI_MODEL 이 설정돼 있지 않아요.');

  const blocked = checkQuota(userId);
  if (blocked) throw new GeminiError(blocked);

  const history = getHistory(channelId, character);

  let res;
  try {
    noteCall();                             // 실패해도 호출은 이미 나갔으므로 먼저 센다
    lastCallByUser.set(userId, Date.now());
    res = await generate({
      system: systemPromptFor(character),
      contents: [...history, { role: 'user', parts: [{ text }] }],
      temperature: 1.0,
      maxOutputTokens: 2000,
    });
  } catch (err) {
    throw new GeminiError(await toKorean(err));
  }

  const reply = cleanReply(res.text);

  // 대체 모델이 답했으면 말투가 조금 다를 수 있으니 밝혀 둔다.
  const note = res.usedModel === config.gemini.model ? '' : `\n_(${res.usedModel} 으로 답했어요)_`;

  // 토큰 한도에 걸려 문장 중간에서 끊긴 경우. 그대로 내보내면 왜 끊겼는지 알 수 없다.
  if (reply && res.finishReason === 'MAX_TOKENS') {
    pushHistory(channelId, character, text, reply);
    return `${reply}…\n_(말이 길어져서 여기서 끊겼어요)_`;
  }

  if (!reply) {
    // 안전 필터를 다 껐어도 막힐 때가 있다. 왜 비었는지 알려준다.
    const reason = res.blockReason || res.finishReason;
    throw new GeminiError(
      `${NAME[character]}이(가) 아무 말도 하지 않았어요.${reason ? ` (${reason})` : ''}`,
    );
  }

  pushHistory(channelId, character, text, reply);
  return reply + note;
}

export default { speak, resetSession, usage, GeminiError };
