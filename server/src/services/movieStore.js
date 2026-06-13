/**
 * movieStore — movies.json 읽기/쓰기 (playlistStore와 동일 패턴)
 * 개인 규모이므로 DB 없이 단일 JSON 파일을 동기 입출력한다.
 * shape: { movies: [{ id, title, director, date, poster, hoverPosterImage?,
 *           accent, ratings: { migel:{stars,comment}, matiam:{stars,comment} }, createdAt }] }
 */
const fs = require('fs');
const path = require('path');
const { LIVE_DIR } = require('../config/paths');

const FILE = path.join(LIVE_DIR, 'movies.json'); // 라이브(볼륨 가능)
const SEED = path.join(__dirname, '../data/movies.seed.json'); // 시드(레포)

function read() {
  // 최초 실행: movies.json 이 없으면 시드로 초기화
  if (!fs.existsSync(FILE) && fs.existsSync(SEED)) {
    try {
      fs.copyFileSync(SEED, FILE);
    } catch (e) {
      /* 무시: 아래에서 빈 데이터로 폴백 */
    }
  }
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    return { movies: data.movies || [] };
  } catch (e) {
    return { movies: [] };
  }
}

function write(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = { read, write };
