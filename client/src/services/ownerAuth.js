/**
 * ownerAuth — 오너 쓰기 권한(패스코드) 클라이언트 저장/검증
 * 키는 localStorage에만 보관(오너가 입력한 뒤). 쓰기 요청에 X-Owner-Key 헤더로 첨부한다.
 */
const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:8000';
const KEY_STORAGE = 'mihearti_owner_key';
const OWNER_STORAGE = 'mihearti_owner';

export const getKey = () => localStorage.getItem(KEY_STORAGE) || '';
export const getOwner = () => localStorage.getItem(OWNER_STORAGE) || null;

// 쓰기 요청에 붙일 헤더 (키 없으면 빈 객체)
export const authHeaders = () => {
  const k = getKey();
  return k ? { 'X-Owner-Key': k } : {};
};

// 패스코드 검증 → 유효하면 어느 오너인지 반환, 아니면 throw
export async function verify(key) {
  const res = await fetch(`${API_BASE}/api/auth/me`, { headers: { 'X-Owner-Key': key } });
  if (!res.ok) throw new Error('invalid passcode');
  const data = await res.json();
  return data.owner;
}

export function store(key, owner) {
  localStorage.setItem(KEY_STORAGE, key);
  localStorage.setItem(OWNER_STORAGE, owner);
}

export function clear() {
  localStorage.removeItem(KEY_STORAGE);
  localStorage.removeItem(OWNER_STORAGE);
}
