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

// 업로드 이미지(/uploads/..)는 서버 상대경로라 절대 URL로 바꾼다. thumbnail(YT)은 절대라 그대로.
const abs = (u) => (u && u.startsWith('/') ? `${API_BASE}${u}` : u);
const withTrack = (t) => (t && t.image ? { ...t, image: abs(t.image) } : t);
const withPlaylist = (p) => ({ ...p, tracks: (p.tracks || []).map(withTrack) });

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
  const list = await asJson(await fetch(API));
  return list.map(withPlaylist);
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
  return withTrack(
    await asJson(
      await fetch(`${API}/${playlistId}/tracks`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ url, note }),
      })
    )
  );
}

export async function updateTrack(playlistId, trackId, patch) {
  return withTrack(
    await asJson(
      await fetch(`${API}/${playlistId}/tracks/${trackId}`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify(patch),
      })
    )
  );
}

// 트랙 LP 이미지 업로드(+크롭). crop = { imageX, imageY, imageZoom }
export async function uploadTrackImage(playlistId, trackId, file, crop = {}) {
  const form = new FormData();
  form.append('file', file);
  if (crop.imageX != null) form.append('imageX', String(crop.imageX));
  if (crop.imageY != null) form.append('imageY', String(crop.imageY));
  if (crop.imageZoom != null) form.append('imageZoom', String(crop.imageZoom));
  return withTrack(
    await asJson(
      await fetch(`${API}/${playlistId}/tracks/${trackId}/image`, {
        method: 'POST',
        headers: { ...authHeaders() },
        body: form,
      })
    )
  );
}

export async function removeTrackImage(playlistId, trackId) {
  return withTrack(
    await asJson(
      await fetch(`${API}/${playlistId}/tracks/${trackId}/image`, {
        method: 'DELETE',
        headers: { ...authHeaders() },
      })
    )
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
  uploadTrackImage,
  removeTrackImage,
  deleteTrack,
  reorderTracks,
};
export default playlistApi;
