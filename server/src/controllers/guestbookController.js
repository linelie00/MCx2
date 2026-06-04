/**
 * guestbookController — 방명록 로직 + 스팸 방지
 * 작성/조회/챌린지는 공개, 삭제는 오너 전용(라우트에서 requireOwner).
 *
 * 스팸 방지(의존성 없음):
 *  - 허니팟: 보이지 않는 hp 필드가 채워지면 봇으로 보고 조용히 버린다.
 *  - 연속 등록 제한: IP별 쿨다운.
 *  - 산수 캡차: GET /challenge 로 받은 문제의 답을 POST 시 함께 보낸다(1회용·만료).
 */
const crypto = require('crypto');
const store = require('../services/guestbookStore');

const NICK_MAX = 30;
const MSG_MAX = 500;
const COOLDOWN_MS = 30 * 1000; // 같은 IP 30초 1회
const CHALLENGE_TTL = 5 * 60 * 1000; // 캡차 문제 5분 유효

const lastPostByIp = new Map(); // ip -> 마지막 작성시각
const challenges = new Map(); // id -> { answer, expires }

function cleanupChallenges() {
  const now = Date.now();
  for (const [id, c] of challenges) if (c.expires < now) challenges.delete(id);
}

exports.list = (req, res) => {
  res.json(store.read().entries);
};

// 산수 캡차 문제 발급
exports.challenge = (req, res) => {
  cleanupChallenges();
  const a = Math.floor(Math.random() * 8) + 1;
  const b = Math.floor(Math.random() * 8) + 1;
  const id = crypto.randomUUID();
  challenges.set(id, { answer: a + b, expires: Date.now() + CHALLENGE_TTL });
  res.json({ id, question: `${a} + ${b}` });
};

exports.create = (req, res) => {
  // 1) 허니팟 — 채워져 있으면 봇. 저장하지 않고 조용히 성공처럼 응답.
  if (String(req.body.hp || '').trim() !== '') {
    return res.status(201).json({ discarded: true });
  }

  // 2) 연속 등록 제한
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const last = lastPostByIp.get(ip) || 0;
  const elapsed = Date.now() - last;
  if (elapsed < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
    return res.status(429).json({ error: `너무 자주 등록할 수 없어요. ${wait}초 후 다시 시도해 주세요.` });
  }

  // 3) 산수 캡차 검증(1회용)
  const ch = challenges.get(req.body.challengeId);
  if (!ch || ch.expires < Date.now() || Number(req.body.answer) !== ch.answer) {
    challenges.delete(req.body.challengeId);
    return res.status(400).json({ error: '계산 답이 올바르지 않아요. 새 문제로 다시 시도해 주세요.', captcha: true });
  }
  challenges.delete(req.body.challengeId);

  // 4) 내용 검증
  const nick = String(req.body.nick || '').trim();
  const message = String(req.body.message || '').trim();
  if (!nick || !message) return res.status(400).json({ error: '닉네임과 코멘트를 입력해 주세요.' });

  // 5) 저장
  const entry = {
    id: crypto.randomUUID(),
    nick: nick.slice(0, NICK_MAX),
    message: message.slice(0, MSG_MAX),
    createdAt: new Date().toISOString(),
  };
  const data = store.read();
  data.entries.unshift(entry);
  store.write(data);
  lastPostByIp.set(ip, Date.now());
  return res.status(201).json(entry);
};

exports.remove = (req, res) => {
  const data = store.read();
  const before = data.entries.length;
  data.entries = data.entries.filter((e) => e.id !== req.params.id);
  if (data.entries.length === before) return res.status(404).json({ error: 'not found' });
  store.write(data);
  return res.status(204).end();
};
