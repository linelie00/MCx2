/**
 * movie 라우터 — /api/movie
 * 조회는 공개, 추가/삭제는 오너 전용. 포스터/호버포스터는 멀티파트로 함께 업로드한다.
 */
const express = require('express');
const multer = require('multer');
const ctrl = require('../controllers/movieController');
const storage = require('../services/storageService');
const { requireOwner } = require('../middleware/requireOwner');

const router = express.Router();

const IMG_MAX_MB = Number(process.env.MAX_IMAGE_MB) || 20;
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, storage.UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, storage.makeFilename(file)),
  }),
  limits: { fileSize: IMG_MAX_MB * 1024 * 1024 },
});
// 포스터(필수) + 호버포스터(선택) 두 필드를 받는다.
function handleUpload(req, res, next) {
  upload.fields([
    { name: 'poster', maxCount: 1 },
    { name: 'hoverPoster', maxCount: 1 },
  ])(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `이미지가 너무 큽니다. 최대 ${IMG_MAX_MB}MB까지 가능합니다.` });
    }
    return res.status(400).json({ error: `업로드 오류: ${err.message}` });
  });
}

// 조회 — 공개
router.get('/', ctrl.list);

// 쓰기 — 오너
router.post('/', requireOwner, handleUpload, ctrl.create);
router.patch('/:id', requireOwner, handleUpload, ctrl.update); // 멀티파트(포스터 교체 가능)
router.delete('/:id', requireOwner, ctrl.remove);

module.exports = router;
