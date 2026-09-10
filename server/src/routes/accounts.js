/**
 * accounts 라우터 — /api/accounts
 *
 * 전부 봇 전용이다. 조회까지 막는 이유는 굳이 공개할 데가 없어서다 —
 * 사이트에는 골드를 보여주는 화면이 없다.
 *
 * `express.json()` 을 **POST 마다 따로** 붙인다. 이 서버에는 전역 body 파서가 없어서,
 * 빠뜨리면 `req.body` 가 비고 **오류 없이 잔액이 안 바뀐다.**
 */
const express = require('express');
const ctrl = require('../controllers/accountController');
const { requireBot } = require('../middleware/requireBot');

const router = express.Router();

router.get('/', requireBot, ctrl.list);
router.post('/deltas', requireBot, express.json(), ctrl.applyDeltas);
router.post('/claim', requireBot, express.json(), ctrl.claim);
router.post('/title', requireBot, express.json(), ctrl.setTitle);

module.exports = router;
