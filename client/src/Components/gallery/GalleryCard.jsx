/**
 * GalleryCard — 메이슨리 카드 한 장
 * width/height로 aspect-ratio 박스를 잡아 이미지 로드 전에도 자리를 확보(레이아웃 밀림 방지).
 * 이미지는 IntersectionObserver로 "뷰포트에 가까워질 때만" 로드한다.
 *  → 메이슨리가 컬럼 단위로 DOM에 쌓여도, 화면에 보이는 모든 컬럼의 이미지가
 *    (보이는 것 우선) 거의 동시에 채워진다. 멀리 있는 이미지는 경쟁하지 않는다.
 * 영상(type:'video')은 그리드에선 poster + ▶ 배지만 보여주고 재생은 모달에서 한다.
 */
import { useEffect, useRef, useState } from 'react';
import { cardRatio } from './galleryLayout';

function GalleryCard({ image, tagLabels = {}, onOpen }) {
  const isVideo = image.type === 'video';
  const thumb = isVideo ? image.poster || image.url : image.url;
  const albumCount = Array.isArray(image.items) ? image.items.length : 0;

  const ref = useRef(null);
  const [near, setNear] = useState(false); // 뷰포트 근처에 들어왔는가
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (near) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px 0px' } // 화면에 닿기 약간 전부터 로드
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  return (
    <button
      type="button"
      ref={ref}
      className={`gal-card${loaded ? ' is-loaded' : ''}`}
      style={{ aspectRatio: `1 / ${cardRatio(image)}` }}
      onClick={() => onOpen(image)}
    >
      {near && (
        <img
          className="gal-card-img"
          src={thumb}
          alt=""
          decoding="async"
          onLoad={() => setLoaded(true)}
        />
      )}

      {isVideo && (
        <span className="gal-card-play" aria-hidden="true">
          ▶
        </span>
      )}

      {albumCount > 1 && (
        <span className="gal-card-count" aria-label={`${albumCount}장 앨범`}>
          ▣ {albumCount}
        </span>
      )}

      {image.tags?.length > 0 && (
        <span className="gal-card-tags">
          {image.tags.map((t) => (
            <span className="gal-card-tag" key={t}>
              {tagLabels[t] || t}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

export default GalleryCard;
