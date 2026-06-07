/**
 * PlaylistDialog — 재생목록 생성/편집 (오너 전용)
 * 제목(필수) + 설명(선택) + accent 캐릭터 색(선택).
 */
import { useState } from 'react';

const ACCENTS = [
  { value: '', label: '없음' },
  { value: 'migel', label: '미겔' },
  { value: 'matiam', label: '마티암' },
];

function PlaylistDialog({ initial, onSubmit, onClose }) {
  const editing = !!initial;
  const [title, setTitle] = useState(initial?.title || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [accent, setAccent] = useState(initial?.accent || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit({ title: title.trim(), description: description.trim(), accent: accent || null });
      onClose();
    } catch (err) {
      setError(err.message || '저장에 실패했어요.');
      setBusy(false);
    }
  };

  return (
    <div className="gal-overlay pl-overlay" onClick={onClose}>
      <form className="pl-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3 className="pl-dialog-title">{editing ? '재생목록 편집' : '새 재생목록'}</h3>

        <label className="pl-field">
          <span className="pl-field-label">제목</span>
          <input
            className="pl-field-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예) 둘의 테마"
            maxLength={60}
            autoFocus
          />
        </label>

        <label className="pl-field">
          <span className="pl-field-label">설명 (선택)</span>
          <input
            className="pl-field-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="짧은 소개"
            maxLength={300}
          />
        </label>

        <label className="pl-field">
          <span className="pl-field-label">캐릭터 색 (선택)</span>
          <select className="pl-field-input" value={accent} onChange={(e) => setAccent(e.target.value)}>
            {ACCENTS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>

        {error ? <p className="pl-dialog-error">{error}</p> : null}

        <div className="pl-dialog-actions">
          <button type="button" className="pl-btn" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="pl-btn pl-btn--primary" disabled={!title.trim() || busy}>
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default PlaylistDialog;
