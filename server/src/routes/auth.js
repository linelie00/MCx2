/**
 * auth 라우터 — /api/auth
 * 잠금 해제 시 패스코드 유효성 확인용. 유효하면 어느 오너인지 반환.
 */
const express = require('express');
const { requireOwner } = require('../middleware/requireOwner');

const router = express.Router();

router.get('/me', requireOwner, (req, res) => {
  res.json({ owner: req.owner });
});

module.exports = router;
