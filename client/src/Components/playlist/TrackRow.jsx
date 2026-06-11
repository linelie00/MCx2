/**
 * TrackRow — 재생목록 안의 한 곡(장부 한 줄 느낌)
 * 클릭하면 재생. 오너면 메모/삭제/순서이동 컨트롤이 보인다.
 */
import { fmtDuration } from './playlistUtils';

function TrackRow({
  track,
  index,
  isCurrent,
  canEdit,
  onPlay,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}) {
  return (
    <li className={`pl-track${isCurrent ? ' is-current' : ''}`}>
      <button type="button" className="pl-track-main" onClick={onPlay}>
        <span className="pl-track-index">{isCurrent ? '♪' : index}</span>
        {track.thumbnail ? (
          <img className="pl-track-thumb" src={track.thumbnail} alt="" loading="lazy" />
        ) : (
          <span className="pl-track-thumb pl-track-thumb--empty" />
        )}
        <span className="pl-track-info">
          <span className="pl-track-title">{track.title}</span>
          <span className="pl-track-channel">{track.channel}</span>
          {track.note ? <span className="pl-track-note">{track.note}</span> : null}
        </span>
        <span className="pl-track-dur">{fmtDuration(track.duration)}</span>
      </button>

      {canEdit && (
        <div className="pl-track-actions">
          <button type="button" className="pl-iconbtn" onClick={onMoveUp} disabled={isFirst} title="위로">
            ▲
          </button>
          <button type="button" className="pl-iconbtn" onClick={onMoveDown} disabled={isLast} title="아래로">
            ▼
          </button>
          <button type="button" className="pl-iconbtn" onClick={onEdit} title="곡 편집 (메모 · LP 이미지)">
            ✎
          </button>
          <button type="button" className="pl-iconbtn pl-iconbtn--danger" onClick={onDelete} title="삭제">
            ×
          </button>
        </div>
      )}
    </li>
  );
}

export default TrackRow;
