/**
 * GalleryGrid — react-masonry-css 기반 메이슨리 + 무한 스크롤
 * 부모가 넘긴 items(이미 셔플/필터된 전체 목록)를 visibleCount 만큼만 노출하고,
 * 하단 sentinel이 보이면 onLoadMore로 더 노출한다.
 */
import { useEffect, useRef } from 'react';
import Masonry from 'react-masonry-css';
import GalleryCard from './GalleryCard';

const breakpointCols = { default: 4, 1023: 3, 767: 2, 374: 1 };

function GalleryGrid({ items, tagLabels, hasMore, onLoadMore, onOpen }) {
  const sentinelRef = useRef(null);

  useEffect(() => {
    if (!hasMore) return undefined;
    const el = sentinelRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) onLoadMore();
      },
      { rootMargin: '600px 0px' } // 바닥에 닿기 전에 미리 로드
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, onLoadMore]);

  if (items.length === 0) {
    return <p className="gal-empty">이 태그에 해당하는 이미지가 없습니다.</p>;
  }

  return (
    <>
      <Masonry breakpointCols={breakpointCols} className="gal-masonry" columnClassName="gal-masonry-col">
        {items.map((img) => (
          <GalleryCard key={img.id} image={img} tagLabels={tagLabels} onOpen={onOpen} />
        ))}
      </Masonry>
      {hasMore && <div ref={sentinelRef} className="gal-sentinel" aria-hidden="true" />}
    </>
  );
}

export default GalleryGrid;
