/**
 * GalleryGrid — 높이 균형 메이슨리 + 무한 스크롤
 *
 * react-masonry-css는 카드를 컬럼에 순서대로(라운드로빈) 넣어 높이를 고려하지 않는다.
 * 그래서 긴 이미지가 한 컬럼만 길게 만들고 다른 컬럼은 빈 채로 남는다.
 * 여기서는 저장된 width/height로 각 카드의 상대 높이를 알 수 있으므로,
 * 다음 카드를 "현재 가장 짧은 컬럼"에 넣어 컬럼들을 고르게 채운다.
 * (그리디 분배라 항목을 뒤에 덧붙여도 앞 배치가 바뀌지 않아 깜빡임이 없다.)
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import GalleryCard from './GalleryCard';
import { cardRatio } from './galleryLayout';

// 화면 폭 → 컬럼 수 (기존 breakpoints와 동일)
function colCountFor(w) {
  if (w <= 374) return 1;
  if (w <= 767) return 2;
  if (w <= 1023) return 3;
  return 4;
}

function useColumnCount() {
  const [n, setN] = useState(() => (typeof window === 'undefined' ? 4 : colCountFor(window.innerWidth)));
  useEffect(() => {
    const onResize = () => setN(colCountFor(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return n;
}

const CARD_GAP = 16; // .gal-card margin-bottom 과 동일

function GalleryGrid({ items, tagLabels, hasMore, onLoadMore, onOpen }) {
  const sentinelRef = useRef(null);
  const masonryRef = useRef(null);
  const colCount = useColumnCount();
  const [colWidth, setColWidth] = useState(0);

  // 컬럼 폭 실측(간격을 비율로 환산해 균형 계산에 반영). 첫 페인트 전에 측정.
  useLayoutEffect(() => {
    const el = masonryRef.current;
    if (!el) return undefined;
    const measure = () => setColWidth(el.clientWidth / colCount);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [colCount]);

  // 가장 짧은 컬럼에 카드를 배치(높이 균형). 카드 높이에 간격을 더해
  // '카드 수가 많은 컬럼이 실제로는 더 길어지는' 누적 오차를 보정한다.
  const columns = useMemo(() => {
    const gapUnits = colWidth ? CARD_GAP / colWidth : 0.07; // 간격을 컬럼폭 대비 비율로
    const cols = Array.from({ length: colCount }, () => ({ items: [], h: 0 }));
    for (const img of items) {
      const h = cardRatio(img) + gapUnits;
      let target = cols[0];
      for (const c of cols) if (c.h < target.h) target = c;
      target.items.push(img);
      target.h += h;
    }
    return cols.map((c) => c.items);
  }, [items, colCount, colWidth]);

  useEffect(() => {
    if (!hasMore) return undefined;
    const el = sentinelRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) onLoadMore();
      },
      { rootMargin: '800px 0px' } // 바닥에 닿기 전에 미리 로드
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, onLoadMore, items.length]);

  if (items.length === 0) {
    return <p className="gal-empty">이 태그에 해당하는 이미지가 없습니다.</p>;
  }

  return (
    <>
      <div className="gal-masonry" ref={masonryRef}>
        {columns.map((col, ci) => (
          // eslint-disable-next-line react/no-array-index-key
          <div className="gal-masonry-col" key={ci}>
            {col.map((img) => (
              <GalleryCard key={img.id} image={img} tagLabels={tagLabels} onOpen={onOpen} />
            ))}
          </div>
        ))}
      </div>
      {hasMore && <div ref={sentinelRef} className="gal-sentinel" aria-hidden="true" />}
    </>
  );
}

export default GalleryGrid;
