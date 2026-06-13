/**
 * Express 앱 구성 — 라우트/미들웨어 등록. listen은 server.js가 담당.
 */
const express = require('express');
const cors = require('cors');
const { UPLOADS_DIR } = require('./config/paths');
const galleryRoutes = require('./routes/gallery');
const authRoutes = require('./routes/auth');
const guestbookRoutes = require('./routes/guestbook');
const playlistRoutes = require('./routes/playlist');
const movieRoutes = require('./routes/movie');

const app = express();

// 리버스 프록시(Railway/Caddy 등) 뒤에 둘 때 TRUST_PROXY=1 로 설정하면
// req.ip 가 X-Forwarded-For 의 실제 클라이언트 IP가 된다(방명록 IP 쿨다운 정확도).
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

// CORS: CORS_ORIGIN(쉼표 구분 허용 도메인)이 설정되면 그 목록만 허용,
// 없으면(로컬 개발) 전체 허용. 프로덕션에선 Netlify 도메인을 넣는다.
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : undefined));

// 업로드된 미디어 정적 서빙 (DATA_DIR 볼륨 경로와 동일하게)
app.use('/uploads', express.static(UPLOADS_DIR));

// 인증(오너 확인) / 갤러리 / 방명록 API
app.use('/api/auth', authRoutes);
app.use('/api/gallery', galleryRoutes);
app.use('/api/guestbook', guestbookRoutes);
app.use('/api/playlist', playlistRoutes);
app.use('/api/movie', movieRoutes);

app.get('/', (req, res) => res.send('MIHEARTI API'));

module.exports = app;
