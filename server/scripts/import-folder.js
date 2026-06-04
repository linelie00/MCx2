/**
 * import-folder.js — 로컬 폴더 일괄 임포트 (일회성 도구)
 *
 * 사용법:  npm run import -- "<소스폴더경로>"
 *   예)   npm run import -- "C:\\Users\\me\\갤러리이미지"
 *
 * 규칙:
 *   - 소스폴더의 최상위 폴더 = 태그 1개 (id=slug, label=폴더명)
 *   - 그 안의 "하위 폴더" = 앨범 1개 → 폴더 안 파일을 묶어 한 카드로(첫 파일=대표),
 *     모달에서 넘겨 본다. 하위 폴더는 더 깊어도 그 안 모든 파일을 한 앨범으로 평탄화.
 *   - 최상위 폴더에 직접 놓인 파일 = 개별 이미지
 *   - 파일은 이름순 정렬, 이미지/영상만 처리(그 외 확장자 스킵)
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
function resolveTagId(data, name) {
  const label = name.trim();
  const existing = data.tags.find((t) => t.label === label);
  if (existing) return existing.id;
  const id = slug(label);
  if (!data.tags.some((t) => t.id === id)) data.tags.push({ id, label });
  return id;
}

const kindOf = (file) => {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
};
// 이름순(자연 정렬: 01,02,10 …)
const byName = (a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' });

const listDirs = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
const listFilesDirect = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(dir, e.name));
function walkFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

const stats = { cards: 0, files: 0, skipped: 0, failed: 0 };

// 파일 1개 → uploads 복사 + 측정(+poster). 성공 시 media 객체, 실패 시 null.
async function processFile(file) {
  const ext = path.extname(file).toLowerCase();
  const id = crypto.randomUUID();
  const destName = `${id}${ext}`;
  const destPath = path.join(storage.UPLOADS_DIR, destName);
  fs.copyFileSync(file, destPath);
  try {
    if (kindOf(file) === 'video') {
      const { width, height } = await storage.probeVideo(destPath);
      const posterName = `${id}_poster.jpg`;
      try {
        await storage.makePoster(destPath, posterName);
        return { type: 'video', url: `/uploads/${destName}`, poster: `/uploads/${posterName}`, width, height };
      } catch (e) {
        return { type: 'video', url: `/uploads/${destName}`, width, height };
      }
    }
    const { width, height } = storage.measureImage(destPath);
    return { type: 'image', url: `/uploads/${destName}`, width, height };
  } catch (e) {
    fs.unlinkSync(destPath);
    console.warn(`  ! 실패: ${file} — ${e.message}`);
    return null;
  }
}

// 여러 파일 → media 배열
async function processMany(files) {
  const items = [];
  for (const f of files) {
    // eslint-disable-next-line no-await-in-loop
    const m = await processFile(f);
    if (m) {
      items.push(m);
      stats.files += 1;
    } else stats.failed += 1;
  }
  return items;
}

function pushAlbum(data, items, tagId) {
  const cover = items[0];
  data.images.push({
    id: crypto.randomUUID(),
    type: cover.type,
    url: cover.url,
    ...(cover.poster ? { poster: cover.poster } : {}),
    width: cover.width,
    height: cover.height,
    items,
    tags: [tagId],
    createdAt: new Date().toISOString(),
  });
  stats.cards += 1;
}

function pushSingle(data, media, tagId) {
  data.images.push({
    id: crypto.randomUUID(),
    type: media.type,
    url: media.url,
    ...(media.poster ? { poster: media.poster } : {}),
    width: media.width,
    height: media.height,
    tags: [tagId],
    createdAt: new Date().toISOString(),
  });
  stats.cards += 1;
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
  const topDirs = listDirs(src);
  if (topDirs.length === 0) console.warn('경고: 최상위 폴더가 없습니다. (폴더=태그 구조여야 합니다)');

  for (const top of topDirs) {
    const tagId = resolveTagId(data, path.basename(top));
    console.log(`[${path.basename(top)}] (#${tagId})`);

    // 1) 하위 폴더 = 앨범
    for (const sub of listDirs(top)) {
      const files = walkFiles(sub).filter((f) => kindOf(f));
      stats.skipped += walkFiles(sub).length - files.length;
      files.sort(byName);
      if (files.length === 0) continue;
      // eslint-disable-next-line no-await-in-loop
      const items = await processMany(files);
      if (items.length > 0) {
        pushAlbum(data, items, tagId);
        console.log(`  · 앨범 '${path.basename(sub)}' (${items.length}장)`);
      }
    }

    // 2) 최상위 폴더에 직접 놓인 파일 = 개별
    const direct = listFilesDirect(top).sort(byName);
    for (const f of direct) {
      if (!kindOf(f)) {
        stats.skipped += 1;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const m = await processFile(f);
      if (m) {
        pushSingle(data, m, tagId);
        stats.files += 1;
      } else stats.failed += 1;
    }
  }

  metaStore.write(data);
  console.log(
    `\n완료. 카드=${stats.cards}, 처리한 파일=${stats.files}, 스킵=${stats.skipped}, 실패=${stats.failed}, 총 카드=${data.images.length}`
  );
}

run();
