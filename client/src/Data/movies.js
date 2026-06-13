/**
 * movies.js — MIHEARTI MOVIE NIGHT 영화 메타
 *
 * 영화 목록은 서버 API(/api/movie)에서 가져온다. 이 파일에는 화면 전역에서 쓰는
 * 오너 메타와, API 응답 형태를 다루는 헬퍼만 남긴다.
 *
 * movie shape (API 응답):
 *   id               고유 id (string)
 *   title            영화명
 *   director         감독명
 *   date             본 날짜 'YYYY-MM-DD' (캘린더/최근순 정렬 기준, 날짜당 1편)
 *   poster           포스터 이미지 URL
 *   hoverPosterImage 선택. 두 번째 포스터. 있으면 호버 시 이미지가 바뀐다.
 *   ratings          오너 2명의 별점(0~5, 0.5 단위)과 한 줄 코멘트
 *     migel  / matiam → { stars, comment }
 */

// 오너 메타 (별점/코멘트 표시에 사용)
export const movieOwners = {
  migel: { label: '겨울', color: '#90a96b' },
  matiam: { label: '사백', color: '#859daa' },
};

// 정적 데모 데이터는 제거됨 — 영화는 모두 API에서 불러온다.
export const movies = [];

/** 최근 본 영화 N개. date 내림차순. */
export function getRecentMovies(list = movies, limit = 5) {
  return [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, limit);
}

/** 'YYYY-MM-DD' → movie. 캘린더 날짜 칸 채우기에 사용. */
export function getMoviesByDate(list = movies) {
  return list.reduce((map, m) => {
    map[m.date] = m;
    return map;
  }, {});
}

export default movies;
