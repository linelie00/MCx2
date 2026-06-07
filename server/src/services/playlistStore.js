/**
 * playlistStore — playlists.json 읽기/쓰기
 * 개인 규모이므로 DB 없이 단일 JSON 파일을 동기 입출력한다. (metaStore와 동일 패턴)
 * shape: { playlists: [{ id, title, description?, accent?, order, createdAt,
 *           tracks: [{ id, videoId, title, channel, thumbnail, duration, note?, addedAt }] }] }
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../data/playlists.json');
const SEED = path.join(__dirname, '../data/playlists.seed.json');

function read() {
  // 최초 실행(새 클론 등): playlists.json 이 없으면 시드로 초기화
  if (!fs.existsSync(FILE) && fs.existsSync(SEED)) {
    try {
      fs.copyFileSync(SEED, FILE);
    } catch (e) {
      /* 무시: 아래 read에서 빈 데이터로 폴백 */
    }
  }
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    return { playlists: data.playlists || [] };
  } catch (e) {
    return { playlists: [] };
  }
}

function write(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = { read, write };
