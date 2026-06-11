/**
 * playlist 라우터 — /api/playlist
 * 조회는 공개, 쓰기(재생목록/곡 생성·수정·삭제·정렬)는 오너 전용.
 * '/order'·'/tracks/order' 는 ':id'·':trackId' 보다 먼저 등록한다(갤러리 tags/order 선례).
 */
const express = require('express');
const multer = require('multer');
const ctrl = require('../controllers/playlistController');
const storage = require('../services/storageService');
const { requireOwner } = require('../middleware/requireOwner');

const router = express.Router();

// 트랙 LP 이미지 업로드용 (갤러리와 같은 저장소/볼륨 재사용)
const IMG_MAX_MB = Number(process.env.MAX_IMAGE_MB) || 20;
const uploadImage = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, storage.UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, storage.makeFilename(file)),
  }),
  limits: { fileSize: IMG_MAX_MB * 1024 * 1024 },
});
function handleImage(req, res, next) {
  uploadImage.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `이미지가 너무 큽니다. 최대 ${IMG_MAX_MB}MB까지 가능합니다.` });
    }
    return res.status(400).json({ error: `업로드 오류: ${err.message}` });
  });
}

// 조회 — 공개
router.get('/', ctrl.list);

// 곡 검색 — 오너(할당량 보호). ':id' 류 라우트보다 먼저 둔다.
router.get('/search', requireOwner, ctrl.searchTracks);

// 재생목록 쓰기 — 오너
router.post('/', requireOwner, express.json(), ctrl.createPlaylist);
router.patch('/order', requireOwner, express.json(), ctrl.reorderPlaylists); // ':id'보다 먼저
router.patch('/:id', requireOwner, express.json(), ctrl.updatePlaylist);
router.delete('/:id', requireOwner, ctrl.deletePlaylist);

// 트랙 쓰기 — 오너
router.post('/:id/tracks', requireOwner, express.json(), ctrl.addTrack);
router.patch('/:id/tracks/order', requireOwner, express.json(), ctrl.reorderTracks); // ':trackId'보다 먼저
router.patch('/:id/tracks/:trackId', requireOwner, express.json(), ctrl.updateTrack);
router.delete('/:id/tracks/:trackId', requireOwner, ctrl.deleteTrack);

// 트랙 LP 이미지 (멀티파트 업로드 / 삭제)
router.post('/:id/tracks/:trackId/image', requireOwner, handleImage, ctrl.setTrackImage);
router.delete('/:id/tracks/:trackId/image', requireOwner, ctrl.removeTrackImage);

module.exports = router;
