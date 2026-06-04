/**
 * metaStore — gallery.json 메타데이터 읽기/쓰기
 * 개인 규모이므로 DB 없이 단일 JSON 파일을 동기 입출력한다.
 * shape: { tags: [{id,label}], images: [{id,type,url,poster?,width,height,tags[],createdAt}] }
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../data/gallery.json');

function read() {
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
