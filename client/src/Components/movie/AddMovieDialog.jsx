/**
 * MovieFormDialog(AddMovieDialog) — 영화 추가/수정 모달 (오너 전용)
 * 포스터/호버포스터 + 제목·감독·본 날짜 + 오너 2명의 별점/코멘트를 입력한다.
 *
 * - initial 없음 → 추가 모드(포스터 필수).
 * - initial 있음 → 수정 모드(기존 값 프리필, 포스터는 바꿀 때만 교체).
 * 제출 시 multipart 페이로드를 부모로 넘기고(onSubmit), 성공하면 부모가 목록에 반영한다.
 */
import { useEffect, useMemo, useState } from 'react';
import { movieOwners } from '../../Data/movies';
import StarRating from './StarRating';

const today = () => new Date().toISOString().slice(0, 10);

function FilePick({ label, file, existingUrl, onPick, required }) {
  const blobUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => blobUrl && URL.revokeObjectURL(blobUrl), [blobUrl]);
  const shown = blobUrl || existingUrl;
  return (
    <label className="amd-filepick">
      <span className="amd-label">
        {label}
        {required && <em className="amd-req"> *</em>}
      </span>
      <span className="amd-filebox">
        {shown ? (
          <img className="amd-filethumb" src={shown} alt="" />
        ) : (
          <span className="amd-fileph">클릭하여 선택</span>
        )}
      </span>
      <input
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => e.target.files[0] && onPick(e.target.files[0])}
      />
    </label>
  );
}

const ratingsFrom = (initial) => ({
  migel: { stars: initial?.ratings?.migel?.stars ?? 4, comment: initial?.ratings?.migel?.comment ?? '' },
  matiam: { stars: initial?.ratings?.matiam?.stars ?? 4, comment: initial?.ratings?.matiam?.comment ?? '' },
});

function AddMovieDialog({ onSubmit, onClose, takenDates = [], initial = null }) {
  const isEdit = !!initial;
  const [title, setTitle] = useState(initial?.title || '');
  const [director, setDirector] = useState(initial?.director || '');
  const [date, setDate] = useState(initial?.date || today());
  const [posterFile, setPosterFile] = useState(null);
  const [hoverFile, setHoverFile] = useState(null);
  const [ratings, setRatings] = useState(() => ratingsFrom(initial));
  const [busy, setBusy] = useState(false);

  const setRating = (who, patch) => setRatings((r) => ({ ...r, [who]: { ...r[who], ...patch } }));

  const dateTaken = takenDates.includes(date);
  // 수정 모드에선 포스터가 이미 있으므로 새 파일 없이도 저장 가능
  const hasPoster = isEdit ? true : !!posterFile;
  const canSave = hasPoster && title.trim() && date && !dateTaken && !busy;

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const payload = { title: title.trim(), director: director.trim(), date, ratings };
      if (posterFile) payload.posterFile = posterFile;
      if (hoverFile) payload.hoverPosterFile = hoverFile;
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setBusy(false);
      alert(`${isEdit ? '저장' : '추가'} 실패: ${err.message}`);
    }
  };

  return (
    <div className="amd-overlay" onClick={onClose}>
      <div className="amd-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="amd-title">{isEdit ? '영화 수정' : '영화 추가'}</h3>

        <div className="amd-posters">
          <FilePick
            label={isEdit ? '포스터 (바꾸려면 클릭)' : '포스터'}
            file={posterFile}
            existingUrl={initial?.poster}
            onPick={setPosterFile}
            required={!isEdit}
          />
          <FilePick
            label="호버 포스터 (선택)"
            file={hoverFile}
            existingUrl={initial?.hoverPosterImage}
            onPick={setHoverFile}
          />
        </div>

        <div className="amd-field">
          <span className="amd-label">영화명 <em className="amd-req">*</em></span>
          <input className="amd-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예) 등대지기의 밤" />
        </div>

        <div className="amd-row">
          <div className="amd-field">
            <span className="amd-label">감독</span>
            <input className="amd-input" value={director} onChange={(e) => setDirector(e.target.value)} placeholder="감독명" />
          </div>
          <div className="amd-field">
            <span className="amd-label">본 날짜 <em className="amd-req">*</em></span>
            <input className="amd-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        {dateTaken && <p className="amd-warn">그 날짜에는 이미 등록된 영화가 있어요. (날짜당 1편)</p>}

        <div className="amd-ratings">
          {['migel', 'matiam'].map((who) => (
            <div className="amd-rating" key={who}>
              <div className="amd-rating-head">
                <span className="amd-who" style={{ color: movieOwners[who].color }}>{movieOwners[who].label}</span>
                <StarRating value={ratings[who].stars} color={movieOwners[who].color} />
              </div>
              <input
                type="range"
                min="0"
                max="5"
                step="0.5"
                value={ratings[who].stars}
                onChange={(e) => setRating(who, { stars: Number(e.target.value) })}
                className="amd-range"
              />
              <textarea
                className="amd-textarea"
                rows={2}
                value={ratings[who].comment}
                onChange={(e) => setRating(who, { comment: e.target.value })}
                placeholder={`${movieOwners[who].label}의 한 줄 코멘트`}
              />
            </div>
          ))}
        </div>

        <div className="amd-actions">
          <button type="button" className="amd-btn" onClick={onClose}>취소</button>
          <button type="button" className="amd-btn amd-btn--primary" onClick={handleSave} disabled={!canSave}>
            {busy ? (isEdit ? '저장 중…' : '추가 중…') : (isEdit ? '저장' : '추가')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddMovieDialog;
