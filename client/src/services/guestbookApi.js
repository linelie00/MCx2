/**
 * guestbookApi — 방명록 API 접근
 * 조회/작성은 공개, 삭제는 오너 키 필요.
 */
import { authHeaders } from './ownerAuth';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:8000';
const API = `${API_BASE}/api/guestbook`;

async function asJson(res) {
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.status === 204 ? null : res.json();
}

export async function fetchEntries() {
  return asJson(await fetch(API));
}

export async function addEntry({ nick, message }) {
  return asJson(
    await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nick, message }),
    })
  );
}

export async function deleteEntry(id) {
  await asJson(await fetch(`${API}/${id}`, { method: 'DELETE', headers: { ...authHeaders() } }));
}
