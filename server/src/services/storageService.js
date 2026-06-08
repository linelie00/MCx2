/**
 * storageService — 로컬 파일 저장소 (추후 R2/Supabase 등으로 교체하는 지점)
 *
 * 업로드 파일은 multer가 이미 uploads/ 에 저장한 상태로 들어온다.
 * 여기서는 원본 치수를 측정하고, 영상은 ffmpeg로 poster(첫 프레임)를 생성한다.
 * 반환 url/poster 는 '/uploads/...' 상대 경로 — 프론트가 API 베이스를 붙인다.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const imageSizeLib = require('image-size');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const { UPLOADS_DIR } = require('../config/paths');

const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/quicktime': '.mov' };

// multer filename 콜백용 — id 기반 파일명을 만든다(확장자 보존).
function makeFilename(file) {
  const ext = path.extname(file.originalname) || MIME_EXT[file.mimetype] || '';
  return `${crypto.randomUUID()}${ext}`;
}

// image-size v1(함수)·v2(named export) 모두 대응
function measureImage(filePath) {
  const buf = fs.readFileSync(filePath);
  const fn = imageSizeLib.imageSize || imageSizeLib.default || imageSizeLib;
  const dim = fn(buf);
  return { width: dim.width, height: dim.height };
}

function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const s = (data.streams || []).find((st) => st.width && st.height) || {};
      resolve({ width: s.width || 1280, height: s.height || 720 });
    });
  });
}

function makePoster(filePath, posterName) {
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .on('end', () => resolve())
      .on('error', reject)
      .screenshots({ timestamps: ['00:00:00.5'], filename: posterName, folder: UPLOADS_DIR, size: '?x720' });
  });
}

// multer 저장 직후 처리 — 치수 측정 + (영상) poster 생성
async function processSaved(file, id) {
  const filePath = path.join(UPLOADS_DIR, file.filename);
  const url = `/uploads/${file.filename}`;

  if ((file.mimetype || '').startsWith('video/')) {
    const { width, height } = await probeVideo(filePath);
    const posterName = `${id}_poster.jpg`;
    try {
      await makePoster(filePath, posterName);
      return { type: 'video', url, poster: `/uploads/${posterName}`, width, height };
    } catch (e) {
      return { type: 'video', url, width, height };
    }
  }

  const { width, height } = measureImage(filePath);
  return { type: 'image', url, width, height };
}

function removeFiles(image) {
  const names = new Set();
  const add = (u) => u && names.add(path.basename(u));
  add(image.url);
  add(image.poster);
  // 앨범이면 묶인 모든 항목의 파일/포스터까지 제거
  if (Array.isArray(image.items)) {
    for (const it of image.items) {
      add(it.url);
      add(it.poster);
    }
  }
  for (const name of names) {
    fs.promises.unlink(path.join(UPLOADS_DIR, name)).catch(() => {});
  }
}

module.exports = { UPLOADS_DIR, makeFilename, processSaved, removeFiles, measureImage, probeVideo, makePoster };
