/**
 * PlaylistSection — 테마 하나(=재생목록 한 권). 제목/설명 + 곡 목록.
 * accent는 캐릭터 색(없으면 기본 양피지 톤). 오너면 곡 추가/수정/삭제/정렬 컨트롤이 보인다.
 */
import TrackRow from './TrackRow';

function PlaylistSection({
  playlist,
  accentColor,
  currentTrackId,
  canEdit,
  onPlayTrack,
  onShufflePlay,
  onAddTrack,
  onEditPlaylist,
  onDeletePlaylist,
  onMovePlaylist,
  isFirst,
  isLast,
  onEditNote,
  onDeleteTrack,
  onMoveTrack,
}) {
  const { tracks = [] } = playlist;
  const style = accentColor ? { '--pl-accent': accentColor } : undefined;

  return (
    <section className="pl-section" style={style}>
      <header className="pl-section-head">
        <div className="pl-section-titles">
          <h3 className="pl-section-title">{playlist.title}</h3>
          {playlist.description ? <p className="pl-section-desc">{playlist.description}</p> : null}
          <span className="pl-section-count">{tracks.length}곡</span>
        </div>

        <div className="pl-section-right">
          {tracks.length > 0 && (
            <button
              type="button"
              className="pl-shuffle-play"
              onClick={onShufflePlay}
              title="이 재생목록을 셔플로 재생"
            >
              ⇄ 셔플 재생
            </button>
          )}

          {canEdit && (
            <div className="pl-section-actions">
              <button type="button" className="pl-iconbtn" onClick={onMovePlaylist.up} disabled={isFirst} title="위로">
                ▲
              </button>
              <button type="button" className="pl-iconbtn" onClick={onMovePlaylist.down} disabled={isLast} title="아래로">
                ▼
              </button>
              <button type="button" className="pl-btn" onClick={onEditPlaylist}>
                편집
              </button>
              <button type="button" className="pl-btn pl-btn--danger" onClick={onDeletePlaylist}>
                삭제
              </button>
              <button type="button" className="pl-btn pl-btn--primary" onClick={onAddTrack}>
                + 곡 추가
              </button>
            </div>
          )}
        </div>
      </header>

      {tracks.length === 0 ? (
        <p className="pl-section-empty">{canEdit ? '아직 곡이 없어요. “+ 곡 추가”로 채워보세요.' : '아직 곡이 없어요.'}</p>
      ) : (
        <ol className="pl-tracks">
          {tracks.map((track, i) => (
            <TrackRow
              key={track.id}
              track={track}
              index={i + 1}
              isCurrent={track.id === currentTrackId}
              canEdit={canEdit}
              onPlay={() => onPlayTrack(i)}
              onEditNote={() => onEditNote(track)}
              onDelete={() => onDeleteTrack(track)}
              onMoveUp={() => onMoveTrack(i, -1)}
              onMoveDown={() => onMoveTrack(i, 1)}
              isFirst={i === 0}
              isLast={i === tracks.length - 1}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

export default PlaylistSection;
