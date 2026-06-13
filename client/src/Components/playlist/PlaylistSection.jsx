/**
 * PlaylistSection — 테마 하나(=재생목록 한 권). 제목/설명 + 곡 목록.
 * accent는 캐릭터 색(없으면 기본 양피지 톤). 오너면 곡 추가/수정/삭제/정렬 컨트롤이 보인다.
 *
 * isActive(=이 재생목록의 곡이 재생 중)이면 "지금 재생 중" 모드로 바뀐다:
 * 흰 배경 대신 현재 곡 LP 이미지를 블러 배경으로, 좌측에 큰 회전 LP + NOW PLAYING,
 * 우측에 트랙 목록을 배치한다.
 */
import TrackRow from './TrackRow';
import { usePlayback } from '../../contexts/PlaybackContext';

function PlaylistSection({
  playlist,
  accentColor,
  currentTrackId,
  canEdit,
  isActive,
  activeTrack,
  isPlaying,
  onPlayTrack,
  onShufflePlay,
  onAddTrack,
  onEditPlaylist,
  onDeletePlaylist,
  onMovePlaylist,
  isFirst,
  isLast,
  onEditTrack,
  onDeleteTrack,
  onMoveTrack,
}) {
  const { tracks = [] } = playlist;
  const style = accentColor ? { '--pl-accent': accentColor } : undefined;
  const { hasPrev, hasNext, prev, next, togglePlay } = usePlayback();

  // 액티브 모드 LP 아트(업로드 이미지 크롭 적용 > 썸네일 > 기본 음반)
  const artUrl = activeTrack ? activeTrack.image || activeTrack.thumbnail || null : null;
  const cropped = !!(activeTrack && activeTrack.image);
  const lpArtStyle = artUrl
    ? {
        backgroundImage: `url("${artUrl}")`,
        ...(cropped
          ? {
              backgroundPosition: `${activeTrack.imageX ?? 50}% ${activeTrack.imageY ?? 50}%`,
              transform: `scale(${activeTrack.imageZoom ?? 1})`,
              transformOrigin: `${activeTrack.imageX ?? 50}% ${activeTrack.imageY ?? 50}%`,
            }
          : {}),
      }
    : undefined;

  return (
    <section className={`pl-section${isActive ? ' is-active' : ''}`} style={style}>
      {isActive && artUrl ? (
        <div className="pl-section-bg" style={{ backgroundImage: `url("${artUrl}")` }} aria-hidden="true" />
      ) : null}

      {isActive ? (
        <div className="pl-section-lp">
          <div
            className={`pl-lp pl-lp--np${isPlaying ? ' is-spinning' : ''}${artUrl ? '' : ' is-empty'}`}
            aria-hidden="true"
          >
            {artUrl && <div className="pl-lp-art" style={lpArtStyle} />}
            <span className="pl-lp-hole" />
          </div>
          <div className="pl-nowplaying-label">NOW PLAYING</div>
          {activeTrack ? (
            <div className="pl-nowplaying-title" title={activeTrack.title}>
              {activeTrack.title}
            </div>
          ) : null}
          {activeTrack && activeTrack.channel ? <div className="pl-nowplaying-channel">{activeTrack.channel}</div> : null}

          <div className="pl-np-controls">
            <button type="button" className="pl-npbtn" onClick={prev} disabled={!hasPrev} aria-label="이전 곡">
              ‹‹
            </button>
            <button type="button" className="pl-npbtn pl-npbtn--play" onClick={togglePlay} aria-label="재생/일시정지">
              {isPlaying ? '❚❚' : '▶'}
            </button>
            <button type="button" className="pl-npbtn" onClick={next} disabled={!hasNext} aria-label="다음 곡">
              ››
            </button>
          </div>
        </div>
      ) : null}

      <div className="pl-section-main">
        <header className="pl-section-head">
          <div className="pl-section-titles">
            <h3 className="pl-section-title">{playlist.title}</h3>
            {playlist.description ? <p className="pl-section-desc">{playlist.description}</p> : null}
            <span className="pl-section-count">{tracks.length}곡</span>
          </div>

          <div className="pl-section-right">
            {tracks.length > 0 && (
              <button type="button" className="pl-shuffle-play" onClick={onShufflePlay} title="이 재생목록을 셔플로 재생">
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
                onEdit={() => onEditTrack(track)}
                onDelete={() => onDeleteTrack(track)}
                onMoveUp={() => onMoveTrack(i, -1)}
                onMoveDown={() => onMoveTrack(i, 1)}
                isFirst={i === 0}
                isLast={i === tracks.length - 1}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

export default PlaylistSection;
