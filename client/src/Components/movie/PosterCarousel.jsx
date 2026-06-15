/**
 * PosterCarousel — 최근 본 영화 포스터를 영화 예매 앱처럼 가로로 배치하고
 * 자동으로 천천히 돌면서 가운데 한 장이 포커싱되는 캐러셀.
 *
 * - 가운데(active) 포스터: 크고 밝게.  주변: 작고 어둡게.
 * - 자동 회전: 일정 간격으로 active 이동(호버 시 일시정지).
 * - 호버 오버레이: 영화명/감독/오너 2명 별점·코멘트.
 * - hoverPosterImage 가 있으면 호버 시 포스터 이미지가 바뀐다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { movieOwners } from '../../Data/movies';
import StarRating from './StarRating';

const AUTO_MS = 3500;

function PosterCarousel({ movies = [], onOpen }) {
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(null); // 호버 중인 카드 index
  const timer = useRef(null);
  const n = movies.length;

  const go = useCallback((i) => setActive(((i % n) + n) % n), [n]);

  // 자동 회전 (호버 시 멈춤)
  useEffect(() => {
    if (n <= 1 || hovered !== null) return undefined;
    timer.current = setInterval(() => setActive((p) => (p + 1) % n), AUTO_MS);
    return () => clearInterval(timer.current);
  }, [n, hovered]);

  if (!n) return null;

  return (
    <div className="mv-carousel" aria-roledescription="carousel">
      <div className="mv-carousel__stage">
        {movies.map((m, i) => {
          // active 기준 최단 거리 offset (-..0..+), 원형
          let offset = i - active;
          if (offset > n / 2) offset -= n;
          if (offset < -n / 2) offset += n;
          const isActive = offset === 0;
          const isHover = hovered === i;
          const img = isHover && m.hoverPosterImage ? m.hoverPosterImage : m.poster;

          return (
            <article
              key={m.id}
              className={`mv-poster${isActive ? ' is-active' : ''}`}
              style={{
                '--offset': offset,
                '--abs': Math.abs(offset),
                zIndex: 100 - Math.abs(offset),
              }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
              onClick={() => (isActive ? onOpen && onOpen(m) : go(i))}
              aria-hidden={Math.abs(offset) > 2}
            >
              <div className="mv-poster__frame">
                <img className="mv-poster__img" src={img} alt={`${m.title} 포스터`} loading="lazy" />
                <div className="mv-poster__shade" />

                <div className="mv-poster__overlay">
                  <h3 className="mv-poster__title">{m.title}</h3>
                  <p className="mv-poster__director">감독 · {m.director}</p>
                  <div className="mv-poster__ratings">
                    {['migel', 'matiam'].map((key) => {
                      const r = m.ratings[key];
                      const o = movieOwners[key];
                      return (
                        <div className="mv-rating" key={key}>
                          <span className="mv-rating__who" style={{ color: o.color }}>
                            {o.label}
                          </span>
                          <StarRating value={r.stars} color={o.color} />
                          <p className="mv-rating__comment">“{r.comment}”</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="mv-carousel__dots" role="tablist">
        {movies.map((m, i) => (
          <button
            key={m.id}
            type="button"
            className={`mv-dot${i === active ? ' is-on' : ''}`}
            onClick={() => go(i)}
            aria-label={`${m.title}로 이동`}
            aria-selected={i === active}
          />
        ))}
      </div>
    </div>
  );
}

export default PosterCarousel;
