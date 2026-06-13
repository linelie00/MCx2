/**
 * MusicPlayer — 전역 플레이어 UI (YouTube IFrame Player API)
 * 재생 상태는 PlaybackContext에서 받아오고, 레이아웃에 상주해 페이지 전환에도 유지된다.
 * variant: 'full'(=/playlist 하단 바) | 'mini'(=그 외 페이지 우하단 작은 카드).
 * 같은 컴포넌트 인스턴스가 유지되므로(variant만 바뀜) iframe과 재생이 끊기지 않는다.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useYouTubeIframeApi from './useYouTubeIframeApi';
import { usePlayback } from '../../contexts/PlaybackContext';
import { fmtDuration } from './playlistUtils';

function MusicPlayer({ variant = 'full' }) {
  const {
    currentTrack: track,
    hasPrev,
    hasNext,
    shuffle,
    repeat,
    prev,
    next,
    handleEnded,
    toggleShuffle,
    cycleRepeat,
    stop,
    setPlaying: setCtxPlaying,
    setPlayerControl,
  } = usePlayback();
  const navigate = useNavigate();
  const YT = useYouTubeIframeApi();
  const holderRef = useRef(null);
  const playerRef = useRef(null);
  const createdId = useRef(null);
  const trackRef = useRef(track);
  const cbRef = useRef({});
  const barRef = useRef(null);
  const scrubRef = useRef(false);
  const [playing, setPlaying] = useState(true);
  const [prog, setProg] = useState({ played: 0, duration: track ? track.duration || 0 : 0 });

  trackRef.current = track;
  cbRef.current = { handleEnded, repeat };

  const videoId = track ? track.videoId : null;

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
              cbRef.current.handleEnded();
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
    setProg({ played: 0, duration: (track && track.duration) || 0 });
    const p = playerRef.current;
    if (!p || !p.loadVideoById || !videoId) return;
    if (createdId.current === videoId) {
      createdId.current = null;
      return;
    }
    p.loadVideoById(videoId);
    setPlaying(true);
  }, [videoId, track]);

  // 재생 위치 폴링(드래그 중에는 건너뜀).
  useEffect(() => {
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p || !p.getCurrentTime || scrubRef.current) return;
      const d = (p.getDuration && p.getDuration()) || (trackRef.current && trackRef.current.duration) || 0;
      const c = p.getCurrentTime() || 0;
      setProg({ played: c, duration: d });
    }, 400);
    return () => clearInterval(id);
  }, []);

  // 재생 상태를 컨텍스트에 공유(상단 "지금 재생 중" LP 회전용)
  useEffect(() => {
    setCtxPlaying(playing);
  }, [playing, setCtxPlaying]);

  // 재생/일시정지 제어를 컨텍스트에 등록(액티브 섹션 컨트롤이 호출). 실제 플레이어 상태로 토글.
  useEffect(() => {
    setPlayerControl({
      toggle: () => {
        const p = playerRef.current;
        if (!p || !p.getPlayerState) return;
        if (p.getPlayerState() === 1) p.pauseVideo(); // 1 = 재생 중
        else p.playVideo();
      },
    });
    return () => setPlayerControl(null);
  }, [setPlayerControl]);

  if (!track) return null;

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
    setProg((cur) => ({ played: ratio * (d || cur.duration), duration: d || cur.duration }));
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

  const isMini = variant === 'mini';
  const openPlaylist = () => navigate('/playlist');

  return (
    <div className={`pl-player pl-player--${variant}`}>
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

        <div
          className={`pl-player-meta${isMini ? ' is-clickable' : ''}`}
          onClick={isMini ? openPlaylist : undefined}
          title={isMini ? '플레이리스트로 이동' : undefined}
        >
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
            onClick={toggleShuffle}
            aria-pressed={shuffle}
            title={shuffle ? '셔플 끄기' : '셔플'}
          >
            ⇄
          </button>
          <button type="button" className="pl-pbtn pl-pbtn--prev" onClick={prev} disabled={!hasPrev} aria-label="이전 곡">
            ‹‹
          </button>
          <button type="button" className="pl-pbtn pl-pbtn--play" onClick={togglePlay} aria-label="재생/일시정지">
            {playing ? '❚❚' : '▶'}
          </button>
          <button type="button" className="pl-pbtn pl-pbtn--next" onClick={next} disabled={!hasNext} aria-label="다음 곡">
            ››
          </button>
          <button
            type="button"
            className={`pl-pbtn pl-pbtn--mode${repeat !== 'off' ? ' is-active' : ''}`}
            onClick={cycleRepeat}
            title={repeat === 'one' ? '한 곡 반복' : repeat === 'all' ? '전체 반복' : '반복 없음'}
          >
            {repeat === 'one' ? '↻1' : '↻'}
          </button>
        </div>

        <button type="button" className="pl-player-close" onClick={stop} aria-label="플레이어 닫기">
          ×
        </button>
      </div>
    </div>
  );
}

export default MusicPlayer;
