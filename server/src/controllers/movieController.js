/**
 * movieController — Movie API 로직 (MIHEARTI MOVIE NIGHT)
 * 메타데이터는 movieStore(movies.json), 포스터 파일은 multer가 uploads/ 에 저장.
 * 조회는 공개, 쓰기는 오너 전용(라우트에서 requireOwner).
 *
 * movie shape:
 *   { id, title, director, date, poster, hoverPosterImage?, accent,
 *     ratings: { migel:{stars,comment}, matiam:{stars,comment} }, createdAt }
 */
const crypto = require('crypto');
const store = require('../services/movieStore');
const storage = require('../services/storageService');

const TITLE_MAX = 80;
const DIRECTOR_MAX = 80;
const COMMENT_MAX = 300;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const now = () => new Date().toISOString();

// 별점 0~5, 0.5 단위로 정리
const clampStars = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(5, Math.max(0, Math.round(n * 2) / 2));
};
const cleanComment = (v) => String(v || '').trim().slice(0, COMMENT_MAX);

// ratings 입력(JSON 문자열 or 객체)을 { migel:{stars,comment}, matiam:{stars,comment} } 로 정규화
function parseRatings(raw) {
  let r = raw;
  if (typeof raw === 'string') {
    try {
      r = JSON.parse(raw);
    } catch (e) {
      r = {};
    }
  }
  r = r || {};
  const one = (o) => ({ stars: clampStars(o && o.stars), comment: cleanComment(o && o.comment) });
  return { migel: one(r.migel), matiam: one(r.matiam) };
}

// 업로드된 파일들 정리(검증 실패/충돌 시 롤백)
function cleanupFiles(files) {
  for (const f of files) storage.removeFiles({ url: `/uploads/${f.filename}` });
}

// 공개 — 전체 영화. 최신 추가가 앞.
exports.list = (req, res) => {
  res.json(store.read().movies);
};

// 추가 — multipart: title, director, date, accent, ratings(JSON) + poster(필수), hoverPoster(선택)
exports.create = (req, res) => {
  const filesByField = req.files || {};
  const posterFile = (filesByField.poster || [])[0];
  const hoverFile = (filesByField.hoverPoster || [])[0];
  const allFiles = [...(filesByField.poster || []), ...(filesByField.hoverPoster || [])];

  const fail = (status, error) => {
    cleanupFiles(allFiles);
    return res.status(status).json({ error });
  };

  const title = String(req.body.title || '').trim();
  const director = String(req.body.director || '').trim();
  const date = String(req.body.date || '').trim();

  if (!posterFile) return fail(400, '포스터 이미지를 선택해 주세요.');
  if (!title) return fail(400, '영화 제목을 입력해 주세요.');
  if (!DATE_RE.test(date)) return fail(400, '본 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.');

  const data = store.read();
  // 날짜당 1편 — 이미 등록된 날짜면 충돌
  if (data.movies.some((m) => m.date === date)) {
    return fail(409, '그 날짜에는 이미 등록된 영화가 있어요. (날짜당 1편)');
  }

  const movie = {
    id: crypto.randomUUID(),
    title: title.slice(0, TITLE_MAX),
    director: director.slice(0, DIRECTOR_MAX),
    date,
    poster: `/uploads/${posterFile.filename}`,
    ...(hoverFile ? { hoverPosterImage: `/uploads/${hoverFile.filename}` } : {}),
    ratings: parseRatings(req.body.ratings),
    createdAt: now(),
  };

  data.movies.unshift(movie);
  store.write(data);
  return res.status(201).json(movie);
};

// 수정 — 메타(제목/감독/날짜/별점·코멘트) + 포스터/호버포스터(선택, 보낸 경우만 교체).
// 멀티파트로 받으며, 보낸 필드/파일만 갱신한다.
exports.update = (req, res) => {
  const filesByField = req.files || {};
  const posterFile = (filesByField.poster || [])[0];
  const hoverFile = (filesByField.hoverPoster || [])[0];
  const allFiles = [...(filesByField.poster || []), ...(filesByField.hoverPoster || [])];

  const fail = (status, error) => {
    cleanupFiles(allFiles); // 검증 실패 시 방금 올라온 파일 정리
    return res.status(status).json({ error });
  };

  const data = store.read();
  const movie = data.movies.find((m) => m.id === req.params.id);
  if (!movie) return fail(404, 'not found');

  if (req.body.title != null) {
    const t = String(req.body.title).trim();
    if (!t) return fail(400, '영화 제목을 입력해 주세요.');
    movie.title = t.slice(0, TITLE_MAX);
  }
  if (req.body.director != null) movie.director = String(req.body.director).trim().slice(0, DIRECTOR_MAX);
  if (req.body.date != null) {
    const d = String(req.body.date).trim();
    if (!DATE_RE.test(d)) return fail(400, '본 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.');
    if (data.movies.some((m) => m.id !== movie.id && m.date === d)) {
      return fail(409, '그 날짜에는 이미 등록된 영화가 있어요. (날짜당 1편)');
    }
    movie.date = d;
  }
  if (req.body.ratings != null) movie.ratings = parseRatings(req.body.ratings);

  // 포스터 교체 — 기존 파일은 정리하고 새 경로로 바꾼다.
  if (posterFile) {
    if (movie.poster) storage.removeFiles({ url: movie.poster });
    movie.poster = `/uploads/${posterFile.filename}`;
  }
  if (hoverFile) {
    if (movie.hoverPosterImage) storage.removeFiles({ url: movie.hoverPosterImage });
    movie.hoverPosterImage = `/uploads/${hoverFile.filename}`;
  }

  store.write(data);
  return res.json(movie);
};

// 삭제 — 메타 제거 + 업로드 포스터 파일 정리
exports.remove = (req, res) => {
  const data = store.read();
  const movie = data.movies.find((m) => m.id === req.params.id);
  if (!movie) return res.status(404).json({ error: 'not found' });
  storage.removeFiles({ url: movie.poster });
  if (movie.hoverPosterImage) storage.removeFiles({ url: movie.hoverPosterImage });
  data.movies = data.movies.filter((m) => m.id !== req.params.id);
  store.write(data);
  return res.status(204).end();
};
