/**
 * gallery 라우터 — /api/gallery/*
 */
const express = require('express');
const multer = require('multer');
const ctrl = require('../controllers/galleryController');
const storage = require('../services/storageService');

const router = express.Router();

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, storage.UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, storage.makeFilename(file)),
});
const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 영상 대비 500MB
});

router.get('/images', ctrl.listImages);
router.post('/images', upload.single('file'), ctrl.createImage);
router.delete('/images/:id', ctrl.deleteImage);
router.patch('/images/:id', express.json(), ctrl.updateImageTags);

router.get('/tags', ctrl.listTags);
router.post('/tags', express.json(), ctrl.createTag);
router.delete('/tags/:id', ctrl.deleteTag);

module.exports = router;
