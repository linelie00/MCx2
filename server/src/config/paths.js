/**
 * paths — 데이터/업로드 저장 경로 (영구 볼륨 대응)
 *
 * DATA_DIR 환경변수가 설정되면 그 아래에 **라이브 데이터(JSON)** 와 **uploads/** 를 둔다
 * (Railway 등 관리형 호스트의 영구 볼륨 마운트 경로, 예: /data).
 * 미설정 시(로컬 개발) 기존 경로(server/src/data, server/uploads)를 그대로 쓴다.
 *
 * 시드(*.seed.json)는 레포에 커밋돼 있으므로 각 store가 항상 레포 경로에서 직접 읽는다.
 */
const fs = require('fs');
const path = require('path');

const LIVE_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '../data');
const UPLOADS_DIR = process.env.DATA_DIR ? path.join(LIVE_DIR, 'uploads') : path.join(__dirname, '../../uploads');

fs.mkdirSync(LIVE_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

module.exports = { LIVE_DIR, UPLOADS_DIR };
