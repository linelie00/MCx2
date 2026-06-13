/**
 * TicketModal — 캘린더에서 영화가 있는 날짜를 클릭하면 열리는 모달.
 * 일반 카드가 아니라 영화 티켓(절취선·바코드 장식) 형태로 정보를 보여준다.
 * 마우스를 올리면 커서 위치에 따라 rotateX/rotateY(perspective)로 살짝 3D로 기운다.
 *
 * 오너(canEdit)는 별점·코멘트를 수정해 저장할 수 있고(canDelete면 삭제도),
 * 수정/삭제 버튼은 티켓 바깥 위쪽에 두고 호버할 때만 나타난다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { movieOwners } from '../../Data/movies';
import StarRating from './StarRating';

const MAX_TILT = 8; // deg — 과하지 않게
const OWNER_KEYS = ['migel', 'matiam'];

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const week = ['일', '월', '화', '수', '목', '금', '토'];
  const day = new Date(y, m - 1, d).getDay();
  return `${y}. ${String(m).padStart(2, '0')}. ${String(d).padStart(2, '0')} (${week[day]})`;
}

// movie.ratings 를 편집 가능한 형태로 정규화(없는 오너는 기본값)
const draftFrom = (movie) =>
  OWNER_KEYS.reduce((acc, k) => {
    const r = (movie.ratings && movie.ratings[k]) || {};
    acc[k] = { stars: Number(r.stars) || 0, comment: r.comment || '' };
    return acc;
  }, {});

function TicketModal({ movie, onClose, canDelete = false, onDelete, canEdit = false, onSave }) {
  const ticketRef = useRef(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, active: false });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftFrom(movie));
  const [busy, setBusy] = useState(false);

  // 영화가 바뀌면 편집 상태/초안 리셋
  useEffect(() => {
    setEditing(false);
    setDraft(draftFrom(movie));
  }, [movie]);

  // ESC 닫기
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleMove = useCallback((e) => {
    const el = ticketRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5; // -0.5..0.5
    const py = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ rx: -py * 2 * MAX_TILT, ry: px * 2 * MAX_TILT, active: true });
  }, []);

  const handleLeave = useCallback(() => setTilt({ rx: 0, ry: 0, active: false }), []);

  const setDraftField = (who, patch) => setDraft((d) => ({ ...d, [who]: { ...d[who], ...patch } }));

  const handleSave = async () => {
    setBusy(true);
    try {
      await onSave(movie.id, { ratings: draft });
      setEditing(false);
    } catch (err) {
      alert(`저장 실패: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!movie) return null;

  return (
    <div className="mv-modal" role="dialog" aria-modal="true" aria-label={`${movie.title} 티켓`} onClick={onClose}>
      <div className="mv-ticket-wrap" onClick={(e) => e.stopPropagation()}>
        {/* 티켓 바깥 위쪽 — 호버 시에만 나타나는 수정/삭제 */}
        {(canEdit || canDelete) && !editing && (
          <div className="mv-ticket-tools">
            {canEdit && (
              <button type="button" className="mv-ticket__tool" onClick={() => setEditing(true)}>
                별점·코멘트 수정
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className="mv-ticket__tool mv-ticket__tool--danger"
                onClick={() => onDelete && onDelete(movie)}
              >
                삭제
              </button>
            )}
          </div>
        )}

        <div
          className={`mv-ticket${tilt.active ? ' is-tilting' : ''}`}
          ref={ticketRef}
          style={{
            transform: `perspective(1100px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
          }}
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
        >
          <button type="button" className="mv-ticket__close" onClick={onClose} aria-label="닫기">
            ×
          </button>

          {/* 본권 */}
          <div className="mv-ticket__main">
            <div className="mv-ticket__poster">
              <img src={movie.poster} alt={`${movie.title} 포스터`} />
            </div>
            <div className="mv-ticket__info">
              <p className="mv-ticket__brand">MIHEARTI MOVIE NIGHT</p>
              <h3 className="mv-ticket__title">{movie.title}</h3>
              <p className="mv-ticket__meta">감독 · {movie.director}</p>
              <p className="mv-ticket__meta">관람일 · {formatDate(movie.date)}</p>

              <div className="mv-ticket__ratings">
                {OWNER_KEYS.map((key) => {
                  const o = movieOwners[key];
                  const r = movie.ratings[key] || { stars: 0, comment: '' };
                  if (editing) {
                    const d = draft[key];
                    return (
                      <div className="mv-ticket__rating" key={key}>
                        <div className="mv-ticket__rating-head">
                          <span className="mv-ticket__who" style={{ color: o.color }}>{o.label}</span>
                          <StarRating value={d.stars} color={o.color} />
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="5"
                          step="0.5"
                          value={d.stars}
                          onChange={(e) => setDraftField(key, { stars: Number(e.target.value) })}
                          className="mv-ticket__range"
                        />
                        <textarea
                          className="mv-ticket__edit-comment"
                          rows={2}
                          value={d.comment}
                          onChange={(e) => setDraftField(key, { comment: e.target.value })}
                          placeholder={`${o.label}의 한 줄 코멘트`}
                        />
                      </div>
                    );
                  }
                  return (
                    <div className="mv-ticket__rating" key={key}>
                      <div className="mv-ticket__rating-head">
                        <span className="mv-ticket__who" style={{ color: o.color }}>{o.label}</span>
                        <StarRating value={r.stars} color={o.color} />
                      </div>
                      {r.comment && <p className="mv-ticket__comment">“{r.comment}”</p>}
                    </div>
                  );
                })}
              </div>

              {editing && (
                <div className="mv-ticket__edit-actions">
                  <button
                    type="button"
                    className="mv-ticket__tool"
                    onClick={() => { setEditing(false); setDraft(draftFrom(movie)); }}
                    disabled={busy}
                  >
                    취소
                  </button>
                  <button type="button" className="mv-ticket__tool mv-ticket__tool--save" onClick={handleSave} disabled={busy}>
                    {busy ? '저장 중…' : '저장'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 절취선 */}
          <div className="mv-ticket__perf" aria-hidden="true">
            <span className="mv-ticket__notch mv-ticket__notch--top" />
            <span className="mv-ticket__notch mv-ticket__notch--bottom" />
          </div>

          {/* 부권(스텁) — 바코드 */}
          <div className="mv-ticket__stub">
            <span className="mv-ticket__stub-label">ADMIT&nbsp;TWO</span>
            <div className="mv-ticket__barcode" aria-hidden="true" />
            <span className="mv-ticket__serial">No. {movie.id.replace(/[^0-9a-z]/gi, '').slice(-6).toUpperCase()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TicketModal;
