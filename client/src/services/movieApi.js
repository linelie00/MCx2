/**
 * movieApi.js — Movie 데이터 접근 계층 (Express API 연결)
 *
 * 조회는 공개, 추가/삭제는 오너 키(X-Owner-Key) 필요.
 * 서버는 poster/hoverPosterImage를 '/uploads/..' 상대 경로로 돌려주므로 절대 URL로 바꾼다.
 * API에서 온 영화는 __api:true 로 표시해 화면에서 (정적 데모와 구분해) 삭제 버튼을 노출한다.
 */
import { authHeaders } from './ownerAuth';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:8000';
const API = `${API_BASE}/api/movie`;

const abs = (u) => (u && u.startsWith('/') ? `${API_BASE}${u}` : u);
const withAbs = (m) => ({
  ...m,
  poster: abs(m.poster),
  ...(m.hoverPosterImage ? { hoverPosterImage: abs(m.hoverPosterImage) } : {}),
  __api: true,
});

async function asJson(res) {
  if (!res.ok) {
    let msg = '';
    try {
      msg = (await res.json()).error || '';
    } catch (e) {
      /* no body */
    }
    throw new Error(msg || `API ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// 전체 영화 (실패 시 빈 배열 — 화면은 정적 데모로 폴백)
export async function fetchMovies() {
  const list = await asJson(await fetch(API));
  return list.map(withAbs);
}

// 추가 — 포스터(필수)/호버포스터(선택)와 메타를 multipart로 전송
export async function createMovie({ title, director, date, ratings, posterFile, hoverPosterFile }) {
  const form = new FormData();
  form.append('title', title);
  form.append('director', director || '');
  form.append('date', date);
  form.append('ratings', JSON.stringify(ratings || {}));
  form.append('poster', posterFile);
  if (hoverPosterFile) form.append('hoverPoster', hoverPosterFile);
  return withAbs(await asJson(await fetch(API, { method: 'POST', headers: { ...authHeaders() }, body: form })));
}

// 수정 — 메타(제목/감독/날짜/별점·코멘트)와 포스터/호버포스터(선택)를 multipart로 갱신.
// patch 에 들어온 키만 전송한다(보낸 것만 서버에서 변경).
export async function updateMovie(id, patch = {}) {
  const form = new FormData();
  if (patch.title != null) form.append('title', patch.title);
  if (patch.director != null) form.append('director', patch.director);
  if (patch.date != null) form.append('date', patch.date);
  if (patch.ratings != null) form.append('ratings', JSON.stringify(patch.ratings));
  if (patch.posterFile) form.append('poster', patch.posterFile);
  if (patch.hoverPosterFile) form.append('hoverPoster', patch.hoverPosterFile);
  return withAbs(
    await asJson(await fetch(`${API}/${id}`, { method: 'PATCH', headers: { ...authHeaders() }, body: form }))
  );
}

export async function deleteMovie(id) {
  await asJson(await fetch(`${API}/${id}`, { method: 'DELETE', headers: { ...authHeaders() } }));
}

const movieApi = { fetchMovies, createMovie, updateMovie, deleteMovie };
export default movieApi;
