/**
 * GalleryModal — 카드 클릭 시 확대 보기
 * 이미지/영상 표시 + 태그 보기·수정 + 삭제. 오버레이/ESC로 닫는다.
 */
import { useEffect, useState } from 'react';
import TagInput from './TagInput';

function GalleryModal({ image, tagLabels = {}, allTags = [], onCreateTag, onSaveTags, onDelete, onClose }) {
  const [editing, setEditing] = useState(false);
  const [draftTags, setDraftTags] = useState([]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 다른 이미지로 바뀌면 편집 상태 초기화
  useEffect(() => {
    setEditing(false);
    setDraftTags(image ? image.tags : []);
  }, [image]);

  if (!image) return null;
  const isVideo = image.type === 'video';

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
        {isVideo ? (
          <video className="gal-viewer-img" src={image.url} poster={image.poster} controls autoPlay />
        ) : (
          <img className="gal-viewer-img" src={image.url} alt="" />
        )}

        <div className="gal-viewer-bar">
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
                <button type="button" className="gal-btn" onClick={startEdit}>
                  태그 수정
                </button>
                <button type="button" className="gal-btn gal-btn--danger" onClick={() => onDelete(image)}>
                  삭제
                </button>
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
