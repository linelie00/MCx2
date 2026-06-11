/**
 * TrackEditDialog — 곡 편집 (오너 전용): 메모 + LP 이미지(업로드/크롭/삭제)
 * 이미지는 원형 미리보기에서 드래그(위치)·슬라이더(확대)로 보일 영역을 정한다.
 * 미리보기(.pl-lp-art)는 플레이어 LP와 같은 렌더라 보이는 그대로 저장된다.
 * 저장 payload = { note, file(File|null), removeImage, crop:{imageX,imageY,imageZoom} }
 */
import { useEffect, useMemo, useRef, useState } from 'react';

function TrackEditDialog({ track, onSave, onClose }) {
  const [note, setNote] = useState(track.note || '');
  const [file, setFile] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [crop, setCrop] = useState({ x: track.imageX ?? 50, y: track.imageY ?? 50, zoom: track.imageZoom ?? 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const viewRef = useRef(null);

  const objUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (objUrl) URL.revokeObjectURL(objUrl);
    },
    [objUrl]
  );
  const previewUrl = removeImage ? null : objUrl || track.image || null;

  const pickFile = (e) => {
    const f = (e.target.files || [])[0];
    if (!f) return;
    setFile(f);
    setRemoveImage(false);
    setCrop({ x: 50, y: 50, zoom: 1 }); // 새 이미지는 크롭 초기화
    setError('');
  };

  const clearImage = () => {
    setFile(null);
    setRemoveImage(!!track.image); // 저장돼 있던 이미지만 삭제 대상
  };

  // 드래그: 사진이 손가락을 따라가도록 위치%를 반대로 움직인다.
  const onPointerDown = (e) => {
    if (!previewUrl) return;
    e.preventDefault();
    const el = viewRef.current;
    const size = el ? el.getBoundingClientRect().width : 1;
    const sx = e.clientX;
    const sy = e.clientY;
    const start = { ...crop };
    const move = (ev) => {
      const nx = Math.min(100, Math.max(0, start.x - ((ev.clientX - sx) / size) * 100));
      const ny = Math.min(100, Math.max(0, start.y - ((ev.clientY - sy) / size) * 100));
      setCrop((c) => ({ ...c, x: nx, y: ny }));
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  const artStyle = previewUrl
    ? {
        backgroundImage: `url("${previewUrl}")`,
        backgroundPosition: `${crop.x}% ${crop.y}%`,
        transform: `scale(${crop.zoom})`,
        transformOrigin: `${crop.x}% ${crop.y}%`,
      }
    : undefined;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave({
        note: note.trim(),
        file,
        removeImage: removeImage && !file,
        crop: { imageX: Math.round(crop.x), imageY: Math.round(crop.y), imageZoom: crop.zoom },
      });
      onClose();
    } catch (err) {
      setError(err.message || '저장에 실패했어요.');
      setBusy(false);
    }
  };

  return (
    <div className="gal-overlay pl-overlay" onClick={onClose}>
      <div className="pl-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="pl-dialog-title">곡 편집</h3>
        <p className="pl-dialog-sub">{track.title}</p>

        <label className="pl-field">
          <span className="pl-field-label">메모 (선택)</span>
          <input
            className="pl-field-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="이 곡에 대한 한마디"
            maxLength={300}
          />
        </label>

        <span className="pl-field-label">LP 이미지 (선택)</span>
        <div className="pl-crop">
          <div className="pl-cropview" ref={viewRef} onPointerDown={onPointerDown}>
            {previewUrl ? <div className="pl-lp-art" style={artStyle} /> : <span className="pl-crop-empty">이미지 없음</span>}
            <span className="pl-crop-ring" aria-hidden="true" />
          </div>
          {previewUrl ? <p className="pl-crop-hint">드래그로 위치 · 슬라이더로 확대</p> : null}
        </div>

        {previewUrl ? (
          <label className="pl-crop-zoom">
            <span>확대</span>
            <input
              type="range"
              min="1"
              max="3"
              step="0.01"
              value={crop.zoom}
              onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) }))}
            />
          </label>
        ) : null}

        <div className="pl-img-actions">
          <label className="pl-btn pl-filebtn">
            {previewUrl ? '이미지 교체' : '이미지 선택'}
            <input type="file" accept="image/*" hidden onChange={pickFile} />
          </label>
          {previewUrl ? (
            <button type="button" className="pl-btn pl-btn--danger" onClick={clearImage}>
              이미지 삭제
            </button>
          ) : null}
        </div>

        {error ? <p className="pl-dialog-error">{error}</p> : null}

        <div className="pl-dialog-actions">
          <button type="button" className="pl-btn" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button type="button" className="pl-btn pl-btn--primary" onClick={save} disabled={busy}>
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TrackEditDialog;
