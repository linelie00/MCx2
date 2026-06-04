/**
 * Express 앱 구성 — 라우트/미들웨어 등록. listen은 server.js가 담당.
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const galleryRoutes = require('./routes/gallery');

const app = express();

app.use(cors());

// 업로드된 미디어 정적 서빙
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// 갤러리 API
app.use('/api/gallery', galleryRoutes);

app.get('/', (req, res) => res.send('MIHEARTI API'));

module.exports = app;
