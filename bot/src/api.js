/**
 * api — 미하티 사이트 API 클라이언트
 *
 * 봇은 server 의 JSON 스토어를 절대 직접 읽거나 쓰지 않는다. 그 스토어들은 파일 전체를
 * 통째로 덮어쓰는 방식이라 락이 없고, 두 프로세스가 같이 쓰면 갱신이 유실된다.
 * 반드시 HTTP 를 거친다.
 *
 * 인증은 헤더 X-Owner-Key 하나뿐이다(server/src/middleware/requireOwner.js).
 * 조회는 대부분 인증이 필요 없다.
 */
import config from './config.js';
import { keyFor } from './owners.js';
import { cached } from './cache.js';

const BASE = config.api.base;

/** 서버는 /uploads/x.jpg 처럼 상대경로를 준다. 디스코드가 렌더하려면 절대 URL 이어야 한다. */
export const abs = (url) => (url && url.startsWith('/') ? `${BASE}${url}` : url);

/** 상태코드를 사람이 읽을 수 있는 한국어로. 사용자에게 그대로 보여줄 문장이다. */
function messageFor(status, body) {
  if (body?.error) return body.error;          // 서버가 이미 한국어로 준다
  if (status === 401) return '오너 권한이 필요한 작업이에요.';
  if (status === 404) return '찾을 수 없어요.';
  if (status === 409) return '이미 등록된 항목이에요.';
  if (status === 413) return '파일이 너무 커요.';
  if (status === 502 || status === 503) return '사이트 서버가 지금 응답하지 않아요.';
  return `사이트 요청이 실패했어요. (${status})`;
}

export class ApiError extends Error {
  constructor(status, body) {
    super(messageFor(status, body));
    this.status = status;
    this.body = body;
  }
}

/**
 * 공통 요청. owner 를 주면 그 사람의 패스코드를 헤더에 싣는다.
 * body 가 FormData 면 Content-Type 을 직접 정하지 않는다 — undici 가 boundary 를 붙인다.
 */
async function request(path, { method = 'GET', owner = null, json, form } = {}) {
  const headers = {};

  if (owner) {
    const key = keyFor(owner);
    if (!key) throw new ApiError(401, { error: `${owner} 패스코드가 봇에 설정돼 있지 않아요.` });
    headers['X-Owner-Key'] = key;
  }

  let body;
  if (form) {
    body = form;
  } else if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }

  // fetch 자체가 실패하면(DNS·연결 거부·주소 오류) 원인을 감추지 말고 그대로 올린다.
  // "사이트에 연결하지 못했어요" 로 뭉뚱그리면 설정 실수를 찾는 데 한참 걸린다.
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body });
  } catch (err) {
    throw new ApiError(0, { error: `사이트에 연결하지 못했어요. (${BASE} — ${err.cause?.code || err.message})` });
  }

  if (!res.ok) {
    let parsed = null;
    try { parsed = await res.json(); } catch { /* 본문이 없을 수 있다 */ }
    throw new ApiError(res.status, parsed);
  }
  return res.status === 204 ? null : res.json();
}

// ---------------------------------------------------------------- 갤러리

const GALLERY_TTL = 10 * 60 * 1000;

/** 전체 이미지. 태그 필터는 서버에도 있지만, 캐시를 살리려고 받아와서 로컬에서 거른다. */
export const getImages = () =>
  cached('gallery:images', GALLERY_TTL, () => request('/api/gallery/images'));

export const getTags = () =>
  cached('gallery:tags', GALLERY_TTL, () => request('/api/gallery/tags'));

// ---------------------------------------------------------------- 영화 / 플레이리스트
// (다음 단계에서 채운다. 조회는 인증이 필요 없다.)

export const getMovies = () => cached('movies', 60 * 1000, () => request('/api/movie'));
export const getPlaylists = () => cached('playlists', 60 * 1000, () => request('/api/playlist'));

// ---------------------------------------------------------------- 자가진단

/**
 * 부팅 시 오너 키가 실제로 통하는지 확인한다.
 * 첫 쓰기가 401 로 실패하는 대신 배포 로그 첫 줄에서 드러나게 하는 것이 목적이다.
 * 실패해도 죽이지는 않는다 — 조회 기능은 키 없이도 동작해야 한다.
 */
export async function checkOwnerKeys() {
  for (const owner of ['migel', 'matiam']) {
    if (!keyFor(owner)) {
      console.warn(`[api] ${owner} 패스코드 미설정 — 그 사람 이름으로는 쓰기가 안 됩니다.`);
      continue;
    }
    try {
      const me = await request('/api/auth/me', { owner });
      const ok = me?.owner === owner;
      console.log(`[api] 오너 키 확인: ${owner} ${ok ? '✔' : `✖ (서버는 ${me?.owner} 라고 응답)`}`);
    } catch (err) {
      console.warn(`[api] 오너 키 확인 실패: ${owner} — ${err.message}`);
    }
  }
}

export default { abs, ApiError, getImages, getTags, getMovies, getPlaylists, checkOwnerKeys };
