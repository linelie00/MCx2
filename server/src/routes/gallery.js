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
const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 영상 대비 500MB
});

// 읽기 / 다운로드 — 공개
router.get('/images', ctrl.listImages);
router.get('/download/:name', ctrl.downloadFile);
router.get('/tags', ctrl.listTags);

// 쓰기 — 오너만 (requireOwner)
router.post('/images', requireOwner, upload.array('files', 100), ctrl.createImages);
router.delete('/images/:id', requireOwner, ctrl.deleteImage);
router.patch('/images/:id', requireOwner, express.json(), ctrl.updateImageTags);
router.post('/tags', requireOwner, express.json(), ctrl.createTag);
router.patch('/tags/order', requireOwner, express.json(), ctrl.reorderTags); // ':id'보다 먼저
router.patch('/tags/:id', requireOwner, express.json(), ctrl.renameTag);
router.delete('/tags/:id', requireOwner, ctrl.deleteTag);

module.exports = router;
