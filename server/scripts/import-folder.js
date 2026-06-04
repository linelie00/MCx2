/**
 * import-folder.js — 로컬 폴더 일괄 임포트 (일회성 도구)
 *
 * 사용법:  npm run import -- "<소스폴더경로>"
 *   예)   npm run import -- "C:\\Users\\me\\갤러리이미지"
 *
 * 규칙:
 *   - 소스폴더의 최상위 폴더 = 태그 1개 (id=slug, label=폴더명)
 *   - 그 폴더 아래(하위 폴더 포함) 모든 미디어를 재귀 수집해 해당 태그 부여(평탄화)
 *   - 이미지/영상만 처리, 그 외 확장자는 스킵
 *   - uploads/ 로 복사(uuid 파일명) + 치수 측정 + (영상) poster 생성
 *   - 기존 gallery.json 에 이어붙임(append-only). 재실행 시 중복되니 1회만 실행.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const metaStore = require('../src/services/metaStore');
const storage = require('../src/services/storageService');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v']);

const slug = (label) =>
  label.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w가-힣-]/g, '') || `tag-${Date.now()}`;

// 폴더명 → 태그 id. 같은 label의 기존 태그가 있으면 그 id를 재사용(중복 라벨 방지).
// 예) 시드 'migel'(label '미겔')이 있으면 폴더 '미겔'은 새 태그를 만들지 않고 'migel'에 붙는다.
function resolveTagId(data, name) {
  const label = name.trim();
  const existing = data.tags.find((t) => t.label === label);
  if (existing) return existing.id;
  const id = slug(label);
  if (!data.tags.some((t) => t.id === id)) data.tags.push({ id, label });
  return id;
}

// dir 아래의 모든 파일 경로를 재귀로 모은다.
function walkFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

async function importOne(file, tagId, data) {
  const ext = path.extname(file).toLowerCase();
  const isImg = IMAGE_EXT.has(ext);
  const isVid = VIDEO_EXT.has(ext);
  if (!isImg && !isVid) return 'skip';

  const id = crypto.randomUUID();
  const destName = `${id}${ext}`;
  const destPath = path.join(storage.UPLOADS_DIR, destName);
  fs.copyFileSync(file, destPath);

  try {
    let media;
    if (isVid) {
      const { width, height } = await storage.probeVideo(destPath);
      const posterName = `${id}_poster.jpg`;
      try {
        await storage.makePoster(destPath, posterName);
        media = { type: 'video', poster: `/uploads/${posterName}`, width, height };
      } catch (e) {
        media = { type: 'video', width, height };
      }
    } else {
      const { width, height } = storage.measureImage(destPath);
      media = { type: 'image', width, height };
    }

    data.images.push({
      id,
      type: media.type,
      url: `/uploads/${destName}`,
      ...(media.poster ? { poster: media.poster } : {}),
      width: media.width,
      height: media.height,
      tags: [tagId],
      createdAt: new Date().toISOString(),
    });
    return 'added';
  } catch (e) {
    fs.unlinkSync(destPath); // 실패 시 복사 롤백
    console.warn(`  ! 실패: ${file} — ${e.message}`);
    return 'fail';
  }
}

async function run() {
  const src = process.argv[2];
  if (!src) {
    console.error('사용법: npm run import -- "<소스폴더경로>"');
    process.exit(1);
  }
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    console.error(`폴더를 찾을 수 없습니다: ${src}`);
    process.exit(1);
  }

  const data = metaStore.read();
  const topDirs = fs.readdirSync(src, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (topDirs.length === 0) console.warn('경고: 최상위 폴더가 없습니다. (폴더=태그 구조여야 합니다)');

  let added = 0;
  let skipped = 0;
  let failed = 0;

  for (const d of topDirs) {
    const tagId = resolveTagId(data, d.name);

    const files = walkFiles(path.join(src, d.name));
    console.log(`[${d.name}] (#${tagId}) 파일 ${files.length}개 처리…`);
    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop
      const r = await importOne(file, tagId, data);
      if (r === 'added') added += 1;
      else if (r === 'skip') skipped += 1;
      else failed += 1;
      if (added && added % 25 === 0) console.log(`  … ${added}개 임포트됨`);
    }
  }

  metaStore.write(data);
  console.log(`\n완료. 추가=${added}, 스킵=${skipped}, 실패=${failed}, 총 이미지=${data.images.length}`);
}

run();
