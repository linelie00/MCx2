/**
 * guestbookStore — 방명록 JSON 저장소
 * shape: { entries: [{ id, nick, message, createdAt }] }
 */
const fs = require('fs');
const path = require('path');
const { LIVE_DIR } = require('../config/paths');

const FILE = path.join(LIVE_DIR, 'guestbook.json');

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    return { entries: data.entries || [] };
  } catch (e) {
    return { entries: [] };
  }
}

function write(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = { read, write };
