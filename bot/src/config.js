/**
 * config — 환경변수 읽기와 검증
 *
 * 없으면 봇이 아예 못 뜨는 값만 필수로 본다. 나머지(Gemini, 쿠키 등)는 해당 기능이
 * 실제로 불릴 때 없으면 그 명령만 실패시킨다 — 키 하나 때문에 봇 전체가 죽으면 곤란하다.
 */
import 'dotenv/config';

const req = (name) => {
  const v = (process.env[name] || '').trim();
  if (!v) {
    console.error(`[config] 필수 환경변수가 비어 있습니다: ${name}`);
    console.error('         bot/.env.example 을 참고해 .env 를 채우세요.');
    process.exit(1);
  }
  return v;
};

const opt = (name, fallback = '') => (process.env[name] || '').trim() || fallback;

/**
 * API 주소를 손질한다.
 * - 끝 슬래시를 뗀다. 안 그러면 경로를 조립할 때 // 가 된다.
 * - 스킴이 없으면 https:// 를 붙인다. Railway 대시보드가 도메인을 스킴 없이 보여줘서
 *   그대로 붙여넣기 쉬운데, 그러면 fetch 가 URL 파싱 단계에서 터진다.
 */
function normalizeBase(raw) {
  const trimmed = raw.replace(/\/+$/, '');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    // origin 이 아니라 href 를 쓴다 — 나중에 하위 경로에 올릴 일이 있어도 살아남는다.
    return new URL(withScheme).href.replace(/\/+$/, '');
  } catch {
    console.error(`[config] MIHEARTI_API_BASE 가 올바른 주소가 아닙니다: ${raw}`);
    process.exit(1);
  }
}
const num = (name, fallback) => {
  const n = Number(opt(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  discord: {
    token: req('DISCORD_TOKEN'),
    clientId: req('DISCORD_CLIENT_ID'),
    guildId: req('DISCORD_GUILD_ID'),
  },

  // 디스코드 유저 ID ↔ 오너. 비워두면 그 사람은 쓰기 명령을 못 쓴다(읽기는 가능).
  users: {
    migel: opt('DISCORD_USER_MIGEL'),
    matiam: opt('DISCORD_USER_MATIAM'),
  },

  api: {
    base: normalizeBase(opt('MIHEARTI_API_BASE', 'http://localhost:8000')),
    keys: {
      migel: opt('OWNER_MIGEL_KEY'),
      matiam: opt('OWNER_MATIAM_KEY'),
    },
  },

  gemini: {
    apiKey: opt('GEMINI_API_KEY'),
    // 번호가 붙은 id(gemini-2.5-flash-lite 등)는 조용히 사라진다. 실제로 그렇게 404 를
    // 맞아서 별칭으로 바꿨다. -latest 별칭은 구글이 알아서 최신을 가리키므로 안 깨진다.
    // 그래도 환경변수로 덮을 수 있게 두고, 404 가 나면 쓸 수 있는 목록을 보여준다.
    model: opt('GEMINI_MODEL', 'gemini-flash-lite-latest'),
    // 지정한 모델이 붐빌 때(503) 대신 써 볼 모델. 무료 티어의 인기 모델은 통째로
    // 몇 십 분씩 내려앉기도 해서, 재시도만으로는 못 넘긴다.
    fallbackModel: opt('GEMINI_MODEL_FALLBACK', 'gemini-flash-lite-latest'),
    rpm: num('GEMINI_RPM', 8),
    rpd: num('GEMINI_RPD', 300),
  },

  voice: {
    idleSec: num('VOICE_IDLE_SEC', 300),
    ytdlpExtraArgs: opt('YTDLP_EXTRA_ARGS'),
    cookiesB64: opt('YT_COOKIES_B64'),
  },
};

export default config;
