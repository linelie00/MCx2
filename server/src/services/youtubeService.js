/**
 * youtubeService — YouTube Data API v3 래퍼
 * 곡 추가 시 1회만 호출해 메타(제목/채널/썸네일/길이)를 가져와 캐싱한다.
 * API 키는 서버 .env(YOUTUBE_API_KEY) 전용 — 클라이언트로 절대 노출하지 않는다.
 * 재생(임베드)은 IFrame Player API라 키가 필요 없으므로, 키가 없어도 곡 추가만 실패한다.
 */

const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

/** 유튜브 제목/채널명에 섞인 기본 HTML 엔티티를 사람이 읽는 문자로 되돌린다. */
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * 유튜브 URL 또는 11자리 ID에서 videoId를 추출한다.
 * 지원: watch?v=, youtu.be/, /embed/, /shorts/, 순수 ID
 */
function extractVideoId(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  // 순수 11자리 ID (영문/숫자/-/_)
  if (/^[\w-]{11}$/.test(raw)) return raw;

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }

    if (host.endsWith('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      // /embed/ID, /shorts/ID, /v/ID
      const m = url.pathname.match(/\/(?:embed|shorts|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch (e) {
    /* URL 파싱 실패 → 아래 폴백 */
  }

  // 폴백: 문자열 내 11자리 토큰 추출 시도
  const m = raw.match(/[\w-]{11}/);
  return m ? m[0] : null;
}

/** ISO8601 기간(PT1H2M3S) → 초 */
function parseDuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 0;
  const [, h, min, s] = m;
  return Number(h || 0) * 3600 + Number(min || 0) * 60 + Number(s || 0);
}

/** 썸네일 후보 중 적당한 해상도 하나를 고른다. */
function pickThumbnail(thumbs = {}) {
  return (
    (thumbs.medium && thumbs.medium.url) ||
    (thumbs.high && thumbs.high.url) ||
    (thumbs.default && thumbs.default.url) ||
    ''
  );
}

/**
 * videoId로 메타데이터를 조회한다.
 * 반환: { videoId, title, channel, thumbnail, duration(초) }
 * 키 미설정/비공개/없는 영상은 명확한 에러를 throw 한다.
 */
async function fetchVideoMeta(videoId) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    const err = new Error('YOUTUBE_API_KEY가 설정되지 않았습니다. 서버 .env를 확인해 주세요.');
    err.status = 503;
    throw err;
  }

  const params = new URLSearchParams({
    part: 'snippet,contentDetails',
    id: videoId,
    key,
  });

  const res = await fetch(`${VIDEOS_URL}?${params.toString()}`);
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body.error && body.error.message ? body.error.message : '';
    } catch (e) {
      /* no body */
    }
    const err = new Error(`YouTube API 오류 (${res.status}). ${detail}`.trim());
    err.status = 502;
    throw err;
  }

  const data = await res.json();
  const item = data.items && data.items[0];
  if (!item) {
    const err = new Error('영상을 찾을 수 없습니다(비공개/삭제/잘못된 링크).');
    err.status = 404;
    throw err;
  }

  return {
    videoId,
    title: decodeEntities(item.snippet.title),
    channel: decodeEntities(item.snippet.channelTitle),
    thumbnail: pickThumbnail(item.snippet.thumbnails),
    duration: parseDuration(item.contentDetails.duration),
  };
}

/**
 * 곡 이름 등으로 영상을 검색한다(search.list, 호출당 100 units).
 * 반환: [{ videoId, title, channel, thumbnail }] — 길이는 추가 시 videos.list로 채워진다.
 */
async function searchVideos(query, max = 8) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    const err = new Error('YOUTUBE_API_KEY가 설정되지 않았습니다. 서버 .env를 확인해 주세요.');
    err.status = 503;
    throw err;
  }

  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: String(max),
    key,
  });

  const res = await fetch(`${SEARCH_URL}?${params.toString()}`);
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body.error && body.error.message ? body.error.message : '';
    } catch (e) {
      /* no body */
    }
    const err = new Error(`YouTube API 오류 (${res.status}). ${detail}`.trim());
    err.status = 502;
    throw err;
  }

  const data = await res.json();
  return (data.items || [])
    .filter((it) => it.id && it.id.videoId)
    .map((it) => ({
      videoId: it.id.videoId,
      title: decodeEntities(it.snippet.title),
      channel: decodeEntities(it.snippet.channelTitle),
      thumbnail: pickThumbnail(it.snippet.thumbnails),
    }));
}

module.exports = { extractVideoId, parseDuration, fetchVideoMeta, searchVideos };
