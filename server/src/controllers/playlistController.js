/**
 * playlistController — 플레이리스트 API 로직
 * 메타데이터는 playlistStore(playlists.json)가 담당.
 * 조회는 공개, 쓰기는 오너 전용(라우트에서 requireOwner).
 * 곡 추가 시에만 youtubeService로 Data API v3를 1회 호출해 메타를 캐싱한다.
 */
const crypto = require('crypto');
const store = require('../services/playlistStore');
const storage = require('../services/storageService');
const youtube = require('../services/youtubeService');

const TITLE_MAX = 60;
const DESC_MAX = 300;
const NOTE_MAX = 300;
// 강조색 id (migel/matiam은 기존 데이터 하위호환용으로 유지)
const ACCENTS = ['green', 'blue', 'gray', 'red', 'brown', 'gold', 'teal', 'purple', 'migel', 'matiam'];

const now = () => new Date().toISOString();
const cleanAccent = (v) => (ACCENTS.includes(v) ? v : null);
const findList = (data, id) => data.playlists.find((p) => p.id === id);
const findTrack = (list, tid) => list.tracks.find((t) => t.id === tid);

// 크롭 값 정리: 위치 0~100(%), 줌 1~5(배). 잘못된 값이면 기본값.
const clampPct = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : d;
};
const clampZoom = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : d;
};

// 공개 — 전체 재생목록(캐싱 트랙 포함). Data API 호출 없음.
exports.list = (req, res) => {
  const data = store.read();
  const ordered = [...data.playlists].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  res.json(ordered);
};

// 곡 이름 검색(오너 전용 — search.list는 100 units라 할당량 보호).
exports.searchTracks = async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '검색어를 입력해 주세요.' });
  try {
    const results = await youtube.searchVideos(q);
    return res.json(results);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || '검색에 실패했어요.' });
  }
};

exports.createPlaylist = (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: '제목을 입력해 주세요.' });
  const data = store.read();
  const list = {
    id: crypto.randomUUID(),
    title: title.slice(0, TITLE_MAX),
    description: String(req.body.description || '').trim().slice(0, DESC_MAX),
    accent: cleanAccent(req.body.accent),
    order: data.playlists.length,
    createdAt: now(),
    tracks: [],
  };
  data.playlists.push(list);
  store.write(data);
  return res.status(201).json(list);
};

exports.updatePlaylist = (req, res) => {
  const data = store.read();
  const list = findList(data, req.params.id);
  if (!list) return res.status(404).json({ error: 'not found' });
  if (req.body.title != null) {
    const title = String(req.body.title).trim();
    if (!title) return res.status(400).json({ error: '제목을 입력해 주세요.' });
    list.title = title.slice(0, TITLE_MAX);
  }
  if (req.body.description != null) list.description = String(req.body.description).trim().slice(0, DESC_MAX);
  if (req.body.accent !== undefined) list.accent = cleanAccent(req.body.accent);
  store.write(data);
  return res.json(list);
};

exports.deletePlaylist = (req, res) => {
  const data = store.read();
  const before = data.playlists.length;
  data.playlists = data.playlists.filter((p) => p.id !== req.params.id);
  if (data.playlists.length === before) return res.status(404).json({ error: 'not found' });
  data.playlists.forEach((p, i) => { p.order = i; });
  store.write(data);
  return res.status(204).end();
};

// 재생목록 순서 변경 — ids 배열 순서대로 재정렬(누락분은 뒤에 보존).
exports.reorderPlaylists = (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const data = store.read();
  const byId = new Map(data.playlists.map((p) => [p.id, p]));
  const ordered = [];
  for (const id of ids) {
    if (byId.has(id)) { ordered.push(byId.get(id)); byId.delete(id); }
  }
  for (const p of byId.values()) ordered.push(p);
  ordered.forEach((p, i) => { p.order = i; });
  data.playlists = ordered;
  store.write(data);
  return res.json(data.playlists);
};

// 곡 추가 — { url, note } → videoId 추출 → Data API 메타 조회 → 저장.
exports.addTrack = async (req, res) => {
  const data = store.read();
  const list = findList(data, req.params.id);
  if (!list) return res.status(404).json({ error: 'not found' });

  const videoId = youtube.extractVideoId(req.body.url);
  if (!videoId) return res.status(400).json({ error: '유효한 유튜브 링크나 영상 ID가 아니에요.' });

  try {
    const meta = await youtube.fetchVideoMeta(videoId);
    const track = {
      id: crypto.randomUUID(),
      ...meta,
      note: String(req.body.note || '').trim().slice(0, NOTE_MAX),
      addedAt: now(),
    };
    list.tracks.push(track);
    store.write(data);
    return res.status(201).json(track);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || '곡 정보를 가져오지 못했어요.' });
  }
};

exports.updateTrack = (req, res) => {
  const data = store.read();
  const list = findList(data, req.params.id);
  if (!list) return res.status(404).json({ error: 'not found' });
  const track = findTrack(list, req.params.trackId);
  if (!track) return res.status(404).json({ error: 'not found' });
  if (req.body.note != null) track.note = String(req.body.note).trim().slice(0, NOTE_MAX);
  // 크롭 재조정(재업로드 없이): 이미지가 있을 때만 의미가 있다.
  if (req.body.imageX != null) track.imageX = clampPct(req.body.imageX, track.imageX ?? 50);
  if (req.body.imageY != null) track.imageY = clampPct(req.body.imageY, track.imageY ?? 50);
  if (req.body.imageZoom != null) track.imageZoom = clampZoom(req.body.imageZoom, track.imageZoom ?? 1);
  store.write(data);
  return res.json(track);
};

// 트랙 LP 이미지 업로드(+크롭). 기존 이미지가 있으면 파일을 정리하고 교체한다.
exports.setTrackImage = (req, res) => {
  const data = store.read();
  const list = findList(data, req.params.id);
  if (!list) return res.status(404).json({ error: 'not found' });
  const track = findTrack(list, req.params.trackId);
  if (!track) return res.status(404).json({ error: 'not found' });
  if (!req.file) return res.status(400).json({ error: '이미지 파일이 필요해요.' });

  if (track.image) storage.removeFiles({ url: track.image });
  track.image = `/uploads/${req.file.filename}`;
  track.imageX = clampPct(req.body.imageX, 50);
  track.imageY = clampPct(req.body.imageY, 50);
  track.imageZoom = clampZoom(req.body.imageZoom, 1);
  store.write(data);
  return res.status(201).json(track);
};

// 트랙 LP 이미지 제거(파일 + 크롭 필드).
exports.removeTrackImage = (req, res) => {
  const data = store.read();
  const list = findList(data, req.params.id);
  if (!list) return res.status(404).json({ error: 'not found' });
  const track = findTrack(list, req.params.trackId);
  if (!track) return res.status(404).json({ error: 'not found' });
  if (track.image) storage.removeFiles({ url: track.image });
  delete track.image;
  delete track.imageX;
  delete track.imageY;
  delete track.imageZoom;
  store.write(data);
  return res.json(track);
};

exports.deleteTrack = (req, res) => {
  const data = store.read();
  const list = findList(data, req.params.id);
  if (!list) return res.status(404).json({ error: 'not found' });
  const target = findTrack(list, req.params.trackId);
  if (!target) return res.status(404).json({ error: 'not found' });
  if (target.image) storage.removeFiles({ url: target.image }); // 업로드 이미지 정리
  list.tracks = list.tracks.filter((t) => t.id !== req.params.trackId);
  store.write(data);
  return res.status(204).end();
};

// 트랙 순서 변경 — ids 배열 순서대로 재정렬(누락분은 뒤에 보존).
exports.reorderTracks = (req, res) => {
  const data = store.read();
  const list = findList(data, req.params.id);
  if (!list) return res.status(404).json({ error: 'not found' });
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const byId = new Map(list.tracks.map((t) => [t.id, t]));
  const ordered = [];
  for (const id of ids) {
    if (byId.has(id)) { ordered.push(byId.get(id)); byId.delete(id); }
  }
  for (const t of byId.values()) ordered.push(t);
  list.tracks = ordered;
  store.write(data);
  return res.json(list.tracks);
};
