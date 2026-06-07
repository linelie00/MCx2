/**
 * playlist 라우터 — /api/playlist
 * 조회는 공개, 쓰기(재생목록/곡 생성·수정·삭제·정렬)는 오너 전용.
 * '/order'·'/tracks/order' 는 ':id'·':trackId' 보다 먼저 등록한다(갤러리 tags/order 선례).
 */
const express = require('express');
const ctrl = require('../controllers/playlistController');
const { requireOwner } = require('../middleware/requireOwner');

const router = express.Router();

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

module.exports = router;
