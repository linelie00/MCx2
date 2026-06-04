/**
 * guestbookController — 방명록 로직
 * 작성/조회는 공개, 삭제는 오너 전용(라우트에서 requireOwner).
 */
const crypto = require('crypto');
const store = require('../services/guestbookStore');

const NICK_MAX = 30;
const MSG_MAX = 500;

exports.list = (req, res) => {
  res.json(store.read().entries);
};

exports.create = (req, res) => {
  const nick = String(req.body.nick || '').trim();
  const message = String(req.body.message || '').trim();
  if (!nick || !message) return res.status(400).json({ error: 'nick and message are required' });

  const entry = {
    id: crypto.randomUUID(),
    nick: nick.slice(0, NICK_MAX),
    message: message.slice(0, MSG_MAX),
    createdAt: new Date().toISOString(),
  };
  const data = store.read();
  data.entries.unshift(entry); // 최신이 위로
  store.write(data);
  res.status(201).json(entry);
};

exports.remove = (req, res) => {
  const data = store.read();
  const before = data.entries.length;
  data.entries = data.entries.filter((e) => e.id !== req.params.id);
  if (data.entries.length === before) return res.status(404).json({ error: 'not found' });
  store.write(data);
  res.status(204).end();
};
