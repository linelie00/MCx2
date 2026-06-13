/**
 * MovieCalendar — 월간 캘린더. 날짜당 영화 1편.
 * 영화가 등록된 날짜는 칸 전체가 포스터로 채워지고, 날짜 숫자는 그 위에 작게 표시된다.
 * 영화가 있는 날짜를 클릭하면 onSelect(movie)로 티켓 모달을 연다.
 */
import { useMemo, useState } from 'react';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

function MovieCalendar({ moviesByDate = {}, initialMonth, onSelect, canEdit = false, onEdit }) {
  // initialMonth: 'YYYY-MM' (없으면 가장 최근 영화가 있는 달, 그것도 없으면 오늘)
  const [cursor, setCursor] = useState(() => {
    if (initialMonth) {
      const [y, m] = initialMonth.split('-').map(Number);
      return { year: y, month: m - 1 };
    }
    const dates = Object.keys(moviesByDate).sort();
    const base = dates.length ? dates[dates.length - 1] : null;
    const d = base ? new Date(base) : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const { year, month } = cursor;

  const cells = useMemo(() => {
    const first = new Date(year, month, 1).getDay(); // 시작 요일
    const days = new Date(year, month + 1, 0).getDate(); // 말일
    const arr = [];
    for (let i = 0; i < first; i += 1) arr.push(null); // 앞 빈칸
    for (let d = 1; d <= days; d += 1) arr.push(d);
    while (arr.length % 7 !== 0) arr.push(null); // 뒤 빈칸
    return arr;
  }, [year, month]);

  const move = (dir) => {
    setCursor(({ year: y, month: m }) => {
      const nm = m + dir;
      if (nm < 0) return { year: y - 1, month: 11 };
      if (nm > 11) return { year: y + 1, month: 0 };
      return { year: y, month: nm };
    });
  };

  return (
    <div className="mv-cal">
      <div className="mv-cal__head">
        <button type="button" className="mv-cal__nav" onClick={() => move(-1)} aria-label="이전 달">‹</button>
        <h3 className="mv-cal__title">
          {year}<span className="mv-cal__month">.{pad(month + 1)}</span>
        </h3>
        <button type="button" className="mv-cal__nav" onClick={() => move(1)} aria-label="다음 달">›</button>
      </div>

      <div className="mv-cal__weekdays">
        {WEEK.map((w) => (
          <span key={w} className="mv-cal__weekday">{w}</span>
        ))}
      </div>

      <div className="mv-cal__grid">
        {cells.map((d, idx) => {
          if (d === null) return <div key={`e-${idx}`} className="mv-cal__cell mv-cal__cell--empty" />;
          const movie = moviesByDate[keyOf(year, month, d)];
          if (!movie) {
            return (
              <div key={d} className="mv-cal__cell">
                <span className="mv-cal__date">{d}</span>
              </div>
            );
          }
          return (
            <div
              key={d}
              className="mv-cal__cell mv-cal__cell--movie"
              role="button"
              tabIndex={0}
              onClick={() => onSelect(movie)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(movie);
                }
              }}
              title={movie.title}
            >
              <img className="mv-cal__poster" src={movie.poster} alt={`${movie.title} 포스터`} loading="lazy" />
              {movie.hoverPosterImage && (
                <img
                  className="mv-cal__poster mv-cal__poster--hover"
                  src={movie.hoverPosterImage}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                />
              )}
              <span className="mv-cal__date mv-cal__date--on">{d}</span>
              {canEdit && movie.__api && (
                <button
                  type="button"
                  className="mv-cal__edit"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(movie);
                  }}
                  aria-label={`${movie.title} 편집`}
                >
                  편집
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MovieCalendar;
