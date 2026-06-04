/**
 * UploadDialog — 이미지/영상 추가 모달 (다중 선택)
 * 여러 파일을 한 번에 올릴 수 있고, 2장 이상이면 "한 앨범으로 묶기" 토글로
 * 앨범(1카드) / 개별(각 카드)을 선택한다. 치수·타입·영상 poster는 서버가 처리.
 */
import { useEffect, useMemo, useState } from 'react';
import TagInput from './TagInput';

function UploadDialog({ allTags, onCreateTag, onSubmit, onClose }) {
  const [files, setFiles] = useState([]);
  const [tags, setTags] = useState([]);
  const [group, setGroup] = useState(false);
  const [busy, setBusy] = useState(false);

  // 파일별 미리보기 URL
  const previews = useMemo(
    () => files.map((f) => ({ name: f.name, url: URL.createObjectURL(f), isVideo: f.type.startsWith('video/') })),
    [files]
  );
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  const handleFiles = (e) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length) setFiles(picked);
  };

  const multiple = files.length > 1;
  const canSave = files.length >= 1 && !busy;

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      await onSubmit({ files, tags, group: group && multiple });
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
          {previews.length === 0 ? (
            <span className="gal-filepick-placeholder">클릭하여 파일 선택 (여러 개 가능)</span>
          ) : (
            <div className="gal-filepick-grid">
              {previews.map((p) =>
                p.isVideo ? (
                  <video className="gal-filepick-thumb" src={p.url} key={p.url} muted />
                ) : (
                  <img className="gal-filepick-thumb" src={p.url} alt="" key={p.url} />
                )
              )}
            </div>
          )}
          <input type="file" accept="image/*,video/*" multiple onChange={handleFiles} hidden />
        </label>

        {files.length > 0 && <p className="gal-dialog-meta">{files.length}개 선택됨</p>}

        {multiple && (
          <label className="gal-group-toggle">
            <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} />
            <span>여러 장을 한 앨범으로 묶기</span>
            <span className="gal-group-hint">{group ? '앨범 1개로 추가' : '각각 따로 추가'}</span>
          </label>
        )}

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
