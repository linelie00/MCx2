/**
 * MusicPlayer — 하단 고정 플레이어 (YouTube IFrame Player API)
 * 현재 트랙을 임베드로 재생하고, 곡이 끝나면 onEnded로 다음 곡을 부모에게 알린다.
 * 재생은 키가 필요 없다(임베드). 콜백은 ref로 최신값을 유지해 플레이어를 재생성하지 않는다.
 * 진행 바: 0.4초마다 재생 위치를 폴링해 표시하고, 클릭/드래그로 seekTo 한다.
 */
import { useEffect, useRef, useState } from 'react';
import useYouTubeIframeApi from './useYouTubeIframeApi';
import { fmtDuration } from './playlistUtils';

function MusicPlayer({
  track,
  hasPrev,
  hasNext,
  shuffle,
  repeat,
  onPrev,
  onNext,
  onEnded,
  onToggleShuffle,
  onCycleRepeat,
  onClose,
}) {
  const YT = useYouTubeIframeApi();
  const holderRef = useRef(null);
  const playerRef = useRef(null);
  const createdId = useRef(null);
  const trackRef = useRef(track);
  const cbRef = useRef({});
  const barRef = useRef(null);
  const scrubRef = useRef(false);
  const [playing, setPlaying] = useState(true);
  const [prog, setProg] = useState({ played: 0, duration: track.duration || 0 });

  trackRef.current = track;
  cbRef.current = { onEnded, onNext, repeat };

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
          if (e.data === YT.PlayerState.ENDED) {
            if (cbRef.current.repeat === 'one') {
              const p = playerRef.current;
              if (p) {
                p.seekTo(0, true);
                p.playVideo();
              }
            } else {
              cbRef.current.onEnded();
            }
          } else if (e.data === YT.PlayerState.PLAYING) setPlaying(true);
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
    setProg({ played: 0, duration: track.duration || 0 });
    const p = playerRef.current;
    if (!p || !p.loadVideoById) return;
    if (createdId.current === track.videoId) {
      createdId.current = null;
      return;
    }
    p.loadVideoById(track.videoId);
    setPlaying(true);
  }, [track.videoId, track.duration]);

  // 재생 위치 폴링(드래그 중에는 건너뜀).
  useEffect(() => {
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p || !p.getCurrentTime || scrubRef.current) return;
      const d = (p.getDuration && p.getDuration()) || trackRef.current.duration || 0;
      const c = p.getCurrentTime() || 0;
      setProg({ played: c, duration: d });
    }, 400);
    return () => clearInterval(id);
  }, []);

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    if (playing) p.pauseVideo();
    else p.playVideo();
  };

  const duration = prog.duration || track.duration || 0;
  const pct = duration ? Math.min(100, (prog.played / duration) * 100) : 0;

  const ratioFromClientX = (clientX) => {
    const el = barRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };
  const seekToRatio = (ratio) => {
    const p = playerRef.current;
    const d = (p && p.getDuration && p.getDuration()) || duration;
    if (p && p.seekTo && d) p.seekTo(ratio * d, true);
    setProg((prev) => ({ played: ratio * (d || prev.duration), duration: d || prev.duration }));
  };
  const onBarPointerDown = (e) => {
    e.preventDefault();
    if (!duration) return;
    scrubRef.current = true;
    seekToRatio(ratioFromClientX(e.clientX));
    const move = (ev) => {
      if (scrubRef.current) seekToRatio(ratioFromClientX(ev.clientX));
    };
    const up = (ev) => {
      seekToRatio(ratioFromClientX(ev.clientX));
      scrubRef.current = false;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  return (
    <div className="pl-player">
      <div
        className="pl-seek"
        ref={barRef}
        onPointerDown={onBarPointerDown}
        role="slider"
        aria-label="재생 위치"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(prog.played)}
        tabIndex={0}
      >
        <div className="pl-seek-fill" style={{ width: `${pct}%` }} />
        <div className="pl-seek-handle" style={{ left: `${pct}%` }} />
      </div>

      <div className="pl-player-row">
        <div className="pl-player-video">
          <div ref={holderRef} />
        </div>

        <div className="pl-player-meta">
          <div className="pl-player-title" title={track.title}>
            {track.title}
          </div>
          <div className="pl-player-sub">
            <span className="pl-player-time">
              {fmtDuration(prog.played)} / {fmtDuration(duration)}
            </span>
            {track.channel ? <span className="pl-player-channel"> · {track.channel}</span> : null}
          </div>
        </div>

        <div className="pl-player-controls">
          <button
            type="button"
            className={`pl-pbtn pl-pbtn--mode${shuffle ? ' is-active' : ''}`}
            onClick={onToggleShuffle}
            aria-pressed={shuffle}
            title={shuffle ? '셔플 끄기' : '셔플'}
          >
            ⇄
          </button>
          <button type="button" className="pl-pbtn" onClick={onPrev} disabled={!hasPrev} aria-label="이전 곡">
            ‹‹
          </button>
          <button type="button" className="pl-pbtn pl-pbtn--play" onClick={togglePlay} aria-label="재생/일시정지">
            {playing ? '❚❚' : '▶'}
          </button>
          <button type="button" className="pl-pbtn" onClick={onNext} disabled={!hasNext} aria-label="다음 곡">
            ››
          </button>
          <button
            type="button"
            className={`pl-pbtn pl-pbtn--mode${repeat !== 'off' ? ' is-active' : ''}`}
            onClick={onCycleRepeat}
            title={repeat === 'one' ? '한 곡 반복' : repeat === 'all' ? '전체 반복' : '반복 없음'}
          >
            {repeat === 'one' ? '↻1' : '↻'}
          </button>
        </div>

        <button type="button" className="pl-player-close" onClick={onClose} aria-label="플레이어 닫기">
          ×
        </button>
      </div>
    </div>
  );
}

export default MusicPlayer;
