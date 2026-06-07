/**
 * playlistApi.js — 플레이리스트 데이터 접근 계층 (Express API 연결)
 *
 * 조회는 공개, 쓰기(재생목록/곡 생성·수정·삭제·정렬)는 오너 키(X-Owner-Key) 필요.
 * 곡 메타(제목/채널/썸네일/길이)는 서버가 추가 시 한 번 조회해 캐싱하므로
 * 여기서는 저장된 값을 그대로 받는다.
 */
import { authHeaders } from './ownerAuth';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:8000';
const API = `${API_BASE}/api/playlist`;

async function asJson(res) {
  if (!res.ok) {
    let msg = '';
    try {
      const body = await res.json();
      msg = body.error || '';
    } catch (e) {
      /* no body */
    }
    throw new Error(msg || `API ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

const jsonHeaders = () => ({ 'Content-Type': 'application/json', ...authHeaders() });

export async function fetchPlaylists() {
  return asJson(await fetch(API));
}

// 곡 이름 검색(오너 전용). 결과: [{ videoId, title, channel, thumbnail }]
export async function searchTracks(q) {
  return asJson(await fetch(`${API}/search?q=${encodeURIComponent(q)}`, { headers: { ...authHeaders() } }));
}

export async function createPlaylist({ title, description = '', accent = null }) {
  return asJson(
    await fetch(API, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ title, description, accent }) })
  );
}

export async function updatePlaylist(id, patch) {
  return asJson(
    await fetch(`${API}/${id}`, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(patch) })
  );
}

export async function deletePlaylist(id) {
  await asJson(await fetch(`${API}/${id}`, { method: 'DELETE', headers: { ...authHeaders() } }));
}

export async function reorderPlaylists(ids) {
  return asJson(
    await fetch(`${API}/order`, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify({ ids }) })
  );
}

export async function addTrack(playlistId, { url, note = '' }) {
  return asJson(
    await fetch(`${API}/${playlistId}/tracks`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ url, note }),
    })
  );
}

export async function updateTrack(playlistId, trackId, patch) {
  return asJson(
    await fetch(`${API}/${playlistId}/tracks/${trackId}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify(patch),
    })
  );
}

export async function deleteTrack(playlistId, trackId) {
  await asJson(
    await fetch(`${API}/${playlistId}/tracks/${trackId}`, { method: 'DELETE', headers: { ...authHeaders() } })
  );
}

export async function reorderTracks(playlistId, ids) {
  return asJson(
    await fetch(`${API}/${playlistId}/tracks/order`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ ids }),
    })
  );
}

const playlistApi = {
  fetchPlaylists,
  searchTracks,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  reorderPlaylists,
  addTrack,
  updateTrack,
  deleteTrack,
  reorderTracks,
};
export default playlistApi;
