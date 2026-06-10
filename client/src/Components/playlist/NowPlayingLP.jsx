/**
 * NowPlayingLP — 재생목록 상단의 "지금 재생 중" 회전 LP.
 * PlaybackContext의 현재 곡/재생상태를 읽어, 재생 중이면 LP가 회전한다.
 * 아트 우선순위: 업로드 이미지(크롭 적용) > 유튜브 썸네일 > 기본 음반(CSS).
 * (오디오/컨트롤은 하단 플레이어가 담당하고, 여기는 시각 표현만 한다.)
 */
import { usePlayback } from '../../contexts/PlaybackContext';

function NowPlayingLP() {
  const { currentTrack: track, isPlaying } = usePlayback();
  if (!track) return null;

  const artUrl = track.image || track.thumbnail || null;
  const cropped = !!track.image;
  const artStyle = artUrl
    ? {
        backgroundImage: `url("${artUrl}")`,
        ...(cropped
          ? {
              backgroundPosition: `${track.imageX ?? 50}% ${track.imageY ?? 50}%`,
              transform: `scale(${track.imageZoom ?? 1})`,
              transformOrigin: `${track.imageX ?? 50}% ${track.imageY ?? 50}%`,
            }
          : {}),
      }
    : undefined;

  return (
    <div className="pl-nowplaying">
      <div className={`pl-lp pl-lp--np${isPlaying ? ' is-spinning' : ''}${artUrl ? '' : ' is-empty'}`} aria-hidden="true">
        {artUrl && <div className="pl-lp-art" style={artStyle} />}
        <span className="pl-lp-hole" />
      </div>
      <div className="pl-nowplaying-meta">
        <div className="pl-nowplaying-label">NOW PLAYING</div>
        <div className="pl-nowplaying-title" title={track.title}>
          {track.title}
        </div>
        {track.channel ? <div className="pl-nowplaying-channel">{track.channel}</div> : null}
      </div>
    </div>
  );
}

export default NowPlayingLP;
