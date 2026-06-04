/**
 * UploadDialog — 이미지/영상 추가 모달
 * 파일 선택 → 미리보기 → 태그 지정 → 실제 File을 서버로 전송(FormData).
 * 원본 치수·타입·영상 poster는 서버가 처리한다.
 */
import { useEffect, useState } from 'react';
import TagInput from './TagInput';

function UploadDialog({ allTags, onCreateTag, onSubmit, onClose }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [tags, setTags] = useState([]);
  const [busy, setBusy] = useState(false);

  const isVideo = file && file.type.startsWith('video/');

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  const canSave = file && !busy;

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      await onSubmit({ file, tags });
      onClose();
    } catch (err) {
      setBusy(false);
      alert(`업로드 실패: ${err.message}`);
    }
  };

  return (
    <div className="gal-overlay" onClick={onClose}>
      <div className="gal-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="gal-dialog-title">이미지 / 영상 추가</h3>

        <label className="gal-filepick">
          {!preview ? (
            <span className="gal-filepick-placeholder">클릭하여 파일 선택</span>
          ) : isVideo ? (
            <video className="gal-filepick-preview" src={preview} controls />
          ) : (
            <img className="gal-filepick-preview" src={preview} alt="미리보기" />
          )}
          <input type="file" accept="image/*,video/*" onChange={handleFile} hidden />
        </label>

        {file && <p className="gal-dialog-meta">{file.name}</p>}

        <TagInput allTags={allTags} value={tags} onChange={setTags} onCreate={onCreateTag} />

        <div className="gal-dialog-actions">
          <button type="button" className="gal-btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="gal-btn gal-btn--primary" onClick={handleSave} disabled={!canSave}>
            {busy ? '업로드 중…' : '추가'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default UploadDialog;
