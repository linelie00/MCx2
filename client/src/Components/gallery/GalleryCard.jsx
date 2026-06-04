/**
 * GalleryCard — 메이슨리 카드 한 장
 * width/height로 aspect-ratio 박스를 잡아 이미지 로드 전에도 자리를 확보(레이아웃 밀림 방지).
 * 영상(type:'video')은 그리드에선 poster + ▶ 배지만 보여주고 재생은 모달에서 한다.
 */
import { cardRatio } from './galleryLayout';

function GalleryCard({ image, tagLabels = {}, onOpen }) {
  const isVideo = image.type === 'video';
  const thumb = isVideo ? image.poster || image.url : image.url;
  const albumCount = Array.isArray(image.items) ? image.items.length : 0;

  return (
    <button
      type="button"
      className="gal-card"
      style={{ aspectRatio: `1 / ${cardRatio(image)}` }}
      onClick={() => onOpen(image)}
    >
      <img className="gal-card-img" src={thumb} alt="" loading="lazy" />

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
