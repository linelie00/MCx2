/**
 * galleryApi.js — 갤러리 데이터 접근 계층 (Express API 연결)
 *
 * 서버는 url/poster를 '/uploads/..' 상대 경로로 돌려준다. 프론트(:3000)와 서버(:8000)가
 * 다른 출처이므로 절대 URL로 바꿔 <img src>/<video src>가 동작하게 한다.
 * 저장소를 바꿔도 이 파일의 계약만 유지하면 컴포넌트는 그대로다.
 */
const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:8000';
const API = `${API_BASE}/api/gallery`;

// 상대 경로(/uploads/..)를 절대 URL로
const abs = (u) => (u && u.startsWith('/') ? `${API_BASE}${u}` : u);
const withAbsUrls = (img) => ({
  ...img,
  url: abs(img.url),
  ...(img.poster ? { poster: abs(img.poster) } : {}),
});

async function asJson(res) {
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`);
  return res.status === 204 ? null : res.json();
}

export async function fetchImages({ tag } = {}) {
  const qs = tag ? `?tag=${encodeURIComponent(tag)}` : '';
  const list = await asJson(await fetch(`${API}/images${qs}`));
  return list.map(withAbsUrls);
}

export async function fetchTags() {
  return asJson(await fetch(`${API}/tags`));
}

// 업로드 — 실제 File을 multipart로 전송(치수/타입/poster는 서버가 처리)
export async function uploadImage({ file, tags = [] }) {
  const form = new FormData();
  form.append('file', file);
  form.append('tags', JSON.stringify(tags));
  const created = await asJson(await fetch(`${API}/images`, { method: 'POST', body: form }));
  return withAbsUrls(created);
}

export async function deleteImage(id) {
  await asJson(await fetch(`${API}/images/${id}`, { method: 'DELETE' }));
}

export async function updateImageTags(id, nextTags) {
  const updated = await asJson(
    await fetch(`${API}/images/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: nextTags }),
    })
  );
  return withAbsUrls(updated);
}

export async function createTag(label) {
  return asJson(
    await fetch(`${API}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    })
  );
}

export async function deleteTag(id) {
  await asJson(await fetch(`${API}/tags/${id}`, { method: 'DELETE' }));
}

const galleryApi = {
  fetchImages,
  fetchTags,
  uploadImage,
  deleteImage,
  updateImageTags,
  createTag,
  deleteTag,
};
export default galleryApi;
