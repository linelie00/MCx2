/**
 * metaStore — gallery.json 메타데이터 읽기/쓰기
 * 개인 규모이므로 DB 없이 단일 JSON 파일을 동기 입출력한다.
 * shape: { tags: [{id,label}], images: [{id,type,url,poster?,width,height,tags[],createdAt}] }
 */
const fs = require('fs');
const path = require('path');
const { LIVE_DIR } = require('../config/paths');

const FILE = path.join(LIVE_DIR, 'gallery.json'); // 라이브(볼륨 가능)
const SEED = path.join(__dirname, '../data/gallery.seed.json'); // 시드(레포)

function read() {
  // 최초 실행(새 클론 등): gallery.json 이 없으면 시드로 초기화
  if (!fs.existsSync(FILE) && fs.existsSync(SEED)) {
    try {
      fs.copyFileSync(SEED, FILE);
    } catch (e) {
      /* 무시: 아래 read에서 빈 데이터로 폴백 */
    }
  }
  try {
    const raw = fs.readFileSync(FILE, 'utf-8');
    const data = JSON.parse(raw);
    return { tags: data.tags || [], images: data.images || [] };
  } catch (e) {
    return { tags: [], images: [] };
  }
}

function write(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = { read, write };
