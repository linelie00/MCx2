/**
 * guestbook 라우터 — /api/guestbook
 * GET: 공개 / POST: 공개(방문자 작성) / DELETE: 오너 전용(모더레이션)
 */
const express = require('express');
const ctrl = require('../controllers/guestbookController');
const { requireOwner } = require('../middleware/requireOwner');

const router = express.Router();

router.get('/', ctrl.list);
router.post('/', express.json(), ctrl.create);
router.delete('/:id', requireOwner, ctrl.remove);

module.exports = router;
