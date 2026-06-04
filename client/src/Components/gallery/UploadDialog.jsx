/**
 * UploadDialog — 이미지 추가 모달
 * 파일 선택 → 미리보기 + 원본 치수 측정(naturalWidth/Height) → 태그 지정 → 저장.
 * UI 단계: 선택 파일을 blob URL로 저장한다(서버 연결 시 multipart 업로드로 교체).
 */
import { useEffect, useState } from 'react';
import TagInput from './TagInput';

function UploadDialog({ allTags, onCreateTag, onSubmit, onClose }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [dims, setDims] = useState(null);
  const [tags, setTags] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setDims(null);
    }
  };

  const handleImgLoad = (e) => {
    setDims({ width: e.target.naturalWidth, height: e.target.naturalHeight });
  };

  const canSave = file && dims && !busy;

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    // blob URL은 모달 unmount 시 revoke되므로, 저장용으로 새 URL을 만든다.
    const persistUrl = URL.createObjectURL(file);
    await onSubmit({ url: persistUrl, width: dims.width, height: dims.height, tags });
    setBusy(false);
    onClose();
  };

  return (
    <div className="gal-overlay" onClick={onClose}>
      <div className="gal-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="gal-dialog-title">이미지 추가</h3>

        <label className="gal-filepick">
          {preview ? (
            <img className="gal-filepick-preview" src={preview} alt="미리보기" onLoad={handleImgLoad} />
          ) : (
            <span className="gal-filepick-placeholder">클릭하여 이미지 선택</span>
          )}
          <input type="file" accept="image/*" onChange={handleFile} hidden />
        </label>

        {dims && (
          <p className="gal-dialog-meta">
            {dims.width} × {dims.height}px
          </p>
        )}

        <TagInput allTags={allTags} value={tags} onChange={setTags} onCreate={onCreateTag} />

        <div className="gal-dialog-actions">
          <button type="button" className="gal-btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="gal-btn gal-btn--primary" onClick={handleSave} disabled={!canSave}>
            {busy ? '저장 중…' : '추가'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default UploadDialog;
