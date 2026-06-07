/**
 * MusicPlayer — 하단 고정 플레이어 (YouTube IFrame Player API)
 * 현재 트랙을 임베드로 재생하고, 곡이 끝나면 onEnded로 다음 곡을 부모에게 알린다.
 * 재생은 키가 필요 없다(임베드). 콜백은 ref로 최신값을 유지해 플레이어를 재생성하지 않는다.
 */
import { useEffect, useRef, useState } from 'react';
import useYouTubeIframeApi from './useYouTubeIframeApi';
import { fmtDuration } from './playlistUtils';

function MusicPlayer({ track, hasPrev, hasNext, onPrev, onNext, onEnded, onClose }) {
  const YT = useYouTubeIframeApi();
  const holderRef = useRef(null);
  const playerRef = useRef(null);
  const createdId = useRef(null);
  const trackRef = useRef(track);
  const cbRef = useRef({});
  const [playing, setPlaying] = useState(true);

  trackRef.current = track;
  cbRef.current = { onEnded, onNext };

  // API가 준비되면 플레이어를 한 번 생성(이후 곡 교체는 loadVideoById로).
  useEffect(() => {
    if (!YT || !holderRef.current) return undefined;
    const player = new YT.Player(holderRef.current, {
      width: '100%',
      height: '100%',
      videoId: trackRef.current.videoId,
      playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 },
      events: {
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.ENDED) cbRef.current.onEnded();
          else if (e.data === YT.PlayerState.PLAYING) setPlaying(true);
          else if (e.data === YT.PlayerState.PAUSED) setPlaying(false);
        },
      },
    });
    playerRef.current = player;
    createdId.current = trackRef.current.videoId;
    return () => {
      try {
        player.destroy();
      } catch (e) {
        /* 이미 파괴됨 */
      }
      playerRef.current = null;
      createdId.current = null;
    };
  }, [YT]);

  // 트랙이 바뀌면 영상 교체(최초 생성분은 1회 건너뜀).
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !p.loadVideoById) return;
    if (createdId.current === track.videoId) {
      createdId.current = null;
      return;
    }
    p.loadVideoById(track.videoId);
    setPlaying(true);
  }, [track.videoId]);

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    if (playing) p.pauseVideo();
    else p.playVideo();
  };

  return (
    <div className="pl-player">
      <div className="pl-player-video">
        <div ref={holderRef} />
      </div>

      <div className="pl-player-meta">
        <div className="pl-player-title" title={track.title}>
          {track.title}
        </div>
        <div className="pl-player-sub">
          {track.channel}
          {track.duration ? ` · ${fmtDuration(track.duration)}` : ''}
        </div>
      </div>

      <div className="pl-player-controls">
        <button type="button" className="pl-pbtn" onClick={onPrev} disabled={!hasPrev} aria-label="이전 곡">
          ‹‹
        </button>
        <button type="button" className="pl-pbtn pl-pbtn--play" onClick={togglePlay} aria-label="재생/일시정지">
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" className="pl-pbtn" onClick={onNext} disabled={!hasNext} aria-label="다음 곡">
          ››
        </button>
      </div>

      <button type="button" className="pl-player-close" onClick={onClose} aria-label="플레이어 닫기">
        ×
      </button>
    </div>
  );
}

export default MusicPlayer;
