/**
 * guestbookApi — 방명록 API 접근
 * 조회/작성은 공개, 삭제는 오너 키 필요.
 */
import { authHeaders } from './ownerAuth';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:8000';
const API = `${API_BASE}/api/guestbook`;

async function asJson(res) {
  if (!res.ok) {
    let msg = '';
    let captcha = false;
    try {
      const body = await res.json();
      msg = body.error || '';
      captcha = !!body.captcha;
    } catch (e) {
      /* no body */
    }
    const err = new Error(msg || `API ${res.status}`);
    err.captcha = captcha; // 캡차 오류면 새 문제로 갱신하라는 신호
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export async function fetchEntries() {
  return asJson(await fetch(API));
}

export async function fetchChallenge() {
  return asJson(await fetch(`${API}/challenge`));
}

export async function addEntry({ nick, message, hp, challengeId, answer }) {
  return asJson(
    await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nick, message, hp, challengeId, answer }),
    })
  );
}

export async function deleteEntry(id) {
  await asJson(await fetch(`${API}/${id}`, { method: 'DELETE', headers: { ...authHeaders() } }));
}
