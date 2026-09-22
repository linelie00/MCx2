/**
 * farms 라우터 — /api/farms
 *
 * 채널 농장(docs/FARM.md). 전부 봇 전용이다. `express.json()` 은 POST 마다 따로 붙인다 —
 * 이 서버에는 전역 body 파서가 없다(routes/accounts.js 머리말).
 *
 * `/crops` · `/by-owner/:userId` · `/tools/:userId` 를 `/:channelId` 보다 **먼저** 둔다. 뒤에 두면
 * `crops` 가 채널 id 로 읽힌다.
 */
const express = require('express');
const ctrl = require('../controllers/farmController');
const { requireBot } = require('../middleware/requireBot');

const router = express.Router();

router.get('/crops', requireBot, ctrl.crops);
router.get('/by-owner/:userId', requireBot, ctrl.byOwner);
router.get('/tools/:userId', requireBot, ctrl.tools);
router.get('/:channelId', requireBot, ctrl.get);
router.post('/register', requireBot, express.json(), ctrl.register);
router.post('/abandon', requireBot, express.json(), ctrl.abandon);
router.post('/water', requireBot, express.json(), ctrl.water);
router.post('/plant', requireBot, express.json(), ctrl.plant);
router.post('/harvest', requireBot, express.json(), ctrl.harvest);
router.post('/clear', requireBot, express.json(), ctrl.clear);
router.post('/fertilize', requireBot, express.json(), ctrl.fertilize);
router.post('/compost', requireBot, express.json(), ctrl.compost);
router.post('/pickaxe', requireBot, express.json(), ctrl.pickaxe);

module.exports = router;
