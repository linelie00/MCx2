/**
 * GalleryModal — 카드 클릭 시 확대 보기
 * 단일 이미지/영상 표시 + 태그 보기·수정 + 삭제.
 * 앨범(items 보유)이면 ‹ › / 키보드 ←→ 로 넘겨 본다. 오버레이/ESC로 닫는다.
 */
import { useCallback, useEffect, useState } from 'react';
import TagInput from './TagInput';
import { downloadUrl } from '../../services/galleryApi';

function GalleryModal({ image, tagLabels = {}, allTags = [], canEdit = false, onCreateTag, onSaveTags, onDelete, onClose }) {
  const [editing, setEditing] = useState(false);
  const [draftTags, setDraftTags] = useState([]);
  const [idx, setIdx] = useState(0);

  const items = Array.isArray(image?.items) ? image.items : null;
  const isAlbum = !!items && items.length > 1;
  const count = items ? items.length : 0;

  const prev = useCallback(() => setIdx((i) => Math.max(0, i - 1)), []);
  const next = useCallback(() => setIdx((i) => Math.min(count - 1, i + 1)), [count]);

  // 키보드: ESC 닫기 / 앨범이면 ←→ 이동(편집 중엔 텍스트 입력 우선)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') return onClose();
      if (editing) return undefined;
      if (isAlbum && e.key === 'ArrowLeft') prev();
      if (isAlbum && e.key === 'ArrowRight') next();
      return undefined;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, editing, isAlbum, prev, next]);

  // 다른 카드로 바뀌면 편집/인덱스 초기화
  useEffect(() => {
    setEditing(false);
    setIdx(0);
    setDraftTags(image ? image.tags : []);
  }, [image]);

  if (!image) return null;

  const current = items ? items[idx] : image;
  const isVideo = current.type === 'video';

  const startEdit = () => {
    setDraftTags(image.tags);
    setEditing(true);
  };
  const saveEdit = async () => {
    await onSaveTags(image, draftTags);
    setEditing(false);
  };

  return (
    <div className="gal-overlay" onClick={onClose}>
      <div className="gal-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="gal-viewer-media">
          {isVideo ? (
            <video className="gal-viewer-img" src={current.url} poster={current.poster} controls autoPlay />
          ) : (
            <img className="gal-viewer-img" src={current.url} alt="" />
          )}

          <a
            className="gal-tool gal-tool--download"
            href={downloadUrl(current.url)}
            download
            aria-label="다운로드"
            title="다운로드"
          >
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3v12" />
              <path d="M7 11l5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
          </a>

          {isAlbum && (
            <>
              <button
                type="button"
                className="gal-nav gal-nav--prev"
                onClick={prev}
                disabled={idx === 0}
                aria-label="이전"
              >
                ‹
              </button>
              <button
                type="button"
                className="gal-nav gal-nav--next"
                onClick={next}
                disabled={idx === count - 1}
                aria-label="다음"
              >
                ›
              </button>
              <span className="gal-viewer-counter">
                {idx + 1} / {count}
              </span>
            </>
          )}
        </div>

        <div className={`gal-viewer-bar${editing ? ' gal-viewer-bar--editing' : ''}`}>
          <div className="gal-viewer-tags">
            {editing ? (
              <TagInput allTags={allTags} value={draftTags} onChange={setDraftTags} onCreate={onCreateTag} />
            ) : image.tags?.length > 0 ? (
              image.tags.map((t) => (
                <span className="gal-card-tag" key={t}>
                  {tagLabels[t] || t}
                </span>
              ))
            ) : (
              <span className="gal-viewer-notags">태그 없음</span>
            )}
          </div>

          <div className="gal-viewer-actions">
            {editing ? (
              <>
                <button type="button" className="gal-btn" onClick={() => setEditing(false)}>
                  취소
                </button>
                <button type="button" className="gal-btn gal-btn--primary" onClick={saveEdit}>
                  저장
                </button>
              </>
            ) : (
              <>
                {canEdit && (
                  <>
                    <button type="button" className="gal-btn" onClick={startEdit}>
                      태그 수정
                    </button>
                    <button type="button" className="gal-btn gal-btn--danger" onClick={() => onDelete(image)}>
                      삭제
                    </button>
                  </>
                )}
                <button type="button" className="gal-btn" onClick={onClose}>
                  닫기
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default GalleryModal;
