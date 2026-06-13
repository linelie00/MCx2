/**
 * StarRating — 0~5 별점(0.5 단위) 표시 전용 컴포넌트.
 * 빈 별 위에 채워진 별을 너비로 잘라 겹쳐 반 칸까지 표현한다.
 * 채움 너비(%)는 '별 5개'만 감싼 box 기준이라 숫자 영역에 밀리지 않는다.
 * color 로 채워진 별 색을 받는다(오너 색).
 */

function StarRating({ value = 0, color = '#e6c46a' }) {
  const pct = (Math.max(0, Math.min(5, value)) / 5) * 100;
  return (
    <span className="mv-stars" role="img" aria-label={`별점 ${value} / 5`}>
      <span className="mv-stars__box">
        <span className="mv-stars__empty">★★★★★</span>
        <span className="mv-stars__fill" style={{ width: `${pct}%`, color }}>
          ★★★★★
        </span>
      </span>
      <span className="mv-stars__num">{value.toFixed(1)}</span>
    </span>
  );
}

export default StarRating;
