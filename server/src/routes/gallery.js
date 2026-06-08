/**
 * gallery 라우터 — /api/gallery/*
 */
const express = require('express');
const multer = require('multer');
const ctrl = require('../controllers/galleryController');
const storage = require('../services/storageService');
const { requireOwner } = require('../middleware/requireOwner');

const router = express.Router();

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, storage.UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, storage.makeFilename(file)),
});
// 파일당 최대 용량(MB). MAX_UPLOAD_MB 로 조절 가능(기본 500).
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 500;
const upload = multer({
  storage: diskStorage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

// 업로드 미들웨어 — multer 에러(용량 초과 등)를 일반 500/HTML이 아닌 명확한 JSON으로 돌려준다.
function handleUpload(req, res, next) {
  upload.array('files', 100)(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `파일이 너무 큽니다. 최대 ${MAX_UPLOAD_MB}MB까지 가능합니다.` });
    }
    return res.status(400).json({ error: `업로드 오류: ${err.message}` });
  });
}

// 읽기 / 다운로드 — 공개
router.get('/images', ctrl.listImages);
router.get('/download/:name', ctrl.downloadFile);
router.get('/tags', ctrl.listTags);

// 쓰기 — 오너만 (requireOwner)
router.post('/images', requireOwner, handleUpload, ctrl.createImages);
router.delete('/images/:id', requireOwner, ctrl.deleteImage);
router.patch('/images/:id', requireOwner, express.json(), ctrl.updateImageTags);
router.post('/tags', requireOwner, express.json(), ctrl.createTag);
router.patch('/tags/order', requireOwner, express.json(), ctrl.reorderTags); // ':id'보다 먼저
router.patch('/tags/:id', requireOwner, express.json(), ctrl.renameTag);
router.delete('/tags/:id', requireOwner, ctrl.deleteTag);

module.exports = router;
