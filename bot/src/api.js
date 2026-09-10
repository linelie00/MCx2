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
import { cached, invalidate } from './cache.js';

const BASE = config.api.base;

/** 서버는 /uploads/x.jpg 처럼 상대경로를 준다. 디스코드가 렌더하려면 절대 URL 이어야 한다. */
export const abs = (url) => (url && url.startsWith('/') ? `${BASE}${url}` : url);

/** 상태코드를 사람이 읽을 수 있는 한국어로. 사용자에게 그대로 보여줄 문장이다. */
function messageFor(status, body) {
  // 401 만은 서버 문구("owner authorization required")를 쓰지 않는다. 영어인 데다
  // 원인(봇에 넣은 패스코드가 서버 값과 다름)을 알려주지 못한다.
  if (status === 401) {
    return '패스코드가 사이트와 달라요. 봇의 OWNER_*_KEY 가 server 서비스의 값과 같은지 확인해 주세요.';
  }
  if (body?.error) return body.error;          // 나머지는 서버가 이미 한국어로 준다
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
async function request(path, {
  method = 'GET', owner = null, bot = false, json, form,
} = {}) {
  const headers = {};

  if (owner) {
    const key = keyFor(owner);
    if (!key) throw new ApiError(401, { error: `${owner} 패스코드가 봇에 설정돼 있지 않아요.` });
    headers['X-Owner-Key'] = key;
  }

  if (bot) {
    if (!config.api.botKey) throw new ApiError(401, { error: '봇 키(BOT_KEY)가 설정돼 있지 않아요.' });
    headers['X-Bot-Key'] = config.api.botKey;
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

/**
 * 이미지·영상 업로드. 서버가 multipart 만 받는다.
 *
 * form 은 호출부에서 파일까지 채워 넘긴다 — 파일을 어디서 가져오는지(디스코드 첨부)는
 * API 계층이 알 필요가 없다.
 *
 * group 이 true 이고 파일이 2개 이상이면 앨범 한 덩어리로 묶이고, 아니면 파일마다
 * 항목이 하나씩 생긴다. 응답은 항상 배열이다.
 */
export async function uploadImages({ owner, form, tags = [], group = false }) {
  form.append('tags', JSON.stringify(tags.slice(0, 10)));  // 서버도 10개로 자른다
  form.append('group', group ? 'true' : 'false');

  const created = await request('/api/gallery/images', { method: 'POST', owner, form });
  invalidate('gallery:');
  return created;
}

// ---------------------------------------------------------------- 영화

export const getMovies = () => cached('movies', 60 * 1000, () => request('/api/movie'));

/**
 * 오너 한 사람의 별점·한줄평을 고친다.
 *
 * 반드시 읽기-병합-쓰기여야 한다. 서버는 ratings 를 받으면 두 사람 것을 통째로
 * 갈아치우기 때문에(movieController.js:127), 한 사람 것만 보내면 상대방 평점이
 * 0점·빈 코멘트로 날아간다.
 *
 * 그리고 이 라우트에는 express.json() 이 없고 multer 만 걸려 있다. 평점만 고치는
 * 경우에도 반드시 multipart 로 보내야 하고, JSON 을 보내면 req.body 가 비어
 * 아무 일도 일어나지 않는다.
 */
export async function updateMovieRating({ owner, movieId, stars, comment }) {
  const movies = await getMovies();
  const movie = movies.find((m) => m.id === movieId);
  if (!movie) throw new ApiError(404, { error: '그 영화를 찾을 수 없어요.' });

  const one = (r) => ({ stars: Number(r?.stars) || 0, comment: r?.comment ?? '' });
  const ratings = {
    migel: one(movie.ratings?.migel),
    matiam: one(movie.ratings?.matiam),
  };
  ratings[owner] = { stars, comment };

  const form = new FormData();
  form.append('ratings', JSON.stringify(ratings));

  const updated = await request(`/api/movie/${movieId}`, { method: 'PATCH', owner, form });
  invalidate('movies'); // 방금 바꿨으니 캐시가 낡았다
  return updated;
}

/**
 * 영화 등록. poster 는 필수이고, 파일은 호출부가 form 에 미리 담아 넘긴다.
 *
 * date 는 하루 한 편이라 겹치면 서버가 409 를 준다(그 문구를 그대로 보여주면 된다).
 * ratings 는 넘긴 사람 쪽만 채워 보낸다 — 새 영화라 상대방 것은 어차피 비어 있다.
 */
export async function createMovie({ owner, form, title, director, date, ratings }) {
  form.append('title', title);
  form.append('director', director || '');
  form.append('date', date);
  if (ratings) form.append('ratings', JSON.stringify(ratings));

  const movie = await request('/api/movie', { method: 'POST', owner, form });
  invalidate('movies');
  return movie;
}

// ---------------------------------------------------------------- 플레이리스트

export const getPlaylists = () => cached('playlists', 60 * 1000, () => request('/api/playlist'));

/**
 * 곡 추가. 유튜브 메타데이터(제목·채널·길이·썸네일)는 서버가 직접 조회해 채운다.
 * 그래서 봇에는 YouTube API 키가 필요 없다.
 *
 * 이 라우트들은 갤러리·영화와 달리 express.json() 이 걸려 있어 JSON 으로 보낸다.
 */
export async function addTrack({ owner, playlistId, url, note }) {
  const track = await request(`/api/playlist/${playlistId}/tracks`, {
    method: 'POST', owner, json: { url, note: note || '' },
  });
  invalidate('playlists');
  return track;
}

export async function deleteTrack({ owner, playlistId, trackId }) {
  await request(`/api/playlist/${playlistId}/tracks/${trackId}`, { method: 'DELETE', owner });
  invalidate('playlists');
}

export async function createPlaylist({ owner, title, description, accent }) {
  const playlist = await request('/api/playlist', {
    method: 'POST', owner, json: { title, description: description || '', accent: accent || null },
  });
  invalidate('playlists');
  return playlist;
}

/** 보낸 필드만 바뀐다. 안 건드릴 값은 아예 넣지 않는다. */
export async function updatePlaylist({ owner, playlistId, patch }) {
  const playlist = await request(`/api/playlist/${playlistId}`, {
    method: 'PATCH', owner, json: patch,
  });
  invalidate('playlists');
  return playlist;
}

// ---------------------------------------------------------------- 카지노 계정

/**
 * 칩·칭호·아이템. 넷 다 **캐시를 쓰지 않는다.**
 *
 * 다른 조회는 60초쯤 묵은 값이어도 그만이지만, 잔액은 방금 정산한 값을 봐야 한다.
 * 캐시된 잔액으로 판을 열면 그 차이가 다음 커밋에 그대로 얹혀 **칩이 복제된다.**
 */
export const getAccounts = (ids) =>
  request(`/api/accounts?ids=${encodeURIComponent(ids.join(','))}`, { bot: true });

/**
 * 정산·급여. **잔액이 아니라 증감**을 보낸다 — 락이 없는 스토어에서 안전한 유일한 방식이다.
 *
 * `bump` 는 전적 카운터(`{ id: { hands: 1, won: 1 } }`). 이것도 더하기라 같은 길을 탄다.
 */
export const postAccountDeltas = (deltas, bump) =>
  request('/api/accounts/deltas', { method: 'POST', bot: true, json: { deltas, bump } });

/** 달고 있을 칭호의 키를 바꾼다. `null` 이면 벗는다. */
export const setTitle = (id, title) =>
  request('/api/accounts/title', { method: 'POST', bot: true, json: { id, title } });

/** 출첵. 하루 한 번, 모자라면 채워 준다. 못 받는 것도 오류가 아니라 답이다. */
export const claimDaily = (id) =>
  request('/api/accounts/claim', { method: 'POST', bot: true, json: { id } });

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

/**
 * 부팅 시 봇 키가 통하는지 확인한다.
 *
 * 오너 키와 같은 이유다 — 첫 판이 "잔액을 못 읽었어요" 로 거절되는 대신 **배포 로그**
 * 첫 줄에서 드러나게 한다. 여기가 막혀 있으면 카지노 게임이 통째로 안 열리므로,
 * 오너 키보다 오히려 더 일찍 알아야 한다.
 */
export async function checkBotKey() {
  if (!config.api.botKey) {
    console.warn('[api] BOT_KEY 미설정 — 칩을 못 읽어 카지노 판이 안 열립니다.');
    return;
  }
  try {
    await getAccounts(['npc:migel']);
    console.log('[api] 봇 키 확인: ✔');
  } catch (err) {
    console.warn(`[api] 봇 키 확인 실패 — 카지노 판이 안 열립니다: ${err.message}`);
  }
}

export default {
  abs, ApiError, getImages, getTags, getMovies, updateMovieRating, getPlaylists, checkOwnerKeys,
  getAccounts, postAccountDeltas, claimDaily, setTitle, checkBotKey,
};
