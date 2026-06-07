/**
 * PlaybackContext — 앱 전역 음악 재생 상태
 * 플레이어를 라우트 위(레이아웃)에 두고 이 컨텍스트로 제어하면,
 * 페이지를 이동해도 재생이 끊기지 않는다.
 *
 * 큐는 재생을 시작한 재생목록의 곡 배열을 **스냅샷**으로 들고 있으므로,
 * 다른 페이지로 가거나 목록을 편집해도 현재 재생은 그대로 유지된다.
 */
import { createContext, useContext, useMemo, useState } from 'react';

const PlaybackContext = createContext(null);

// 재생 순서 만들기. 셔플이면 현재 곡(first)을 맨 앞에 두고 나머지를 섞는다.
function buildOrder(n, first, shuffleOn) {
  if (!shuffleOn) return Array.from({ length: n }, (_, i) => i);
  const rest = [];
  for (let i = 0; i < n; i += 1) if (i !== first) rest.push(i);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [first, ...rest];
}

export function PlaybackProvider({ children }) {
  const [queue, setQueue] = useState(null); // { playlistId, title, tracks, order, pos }
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off'); // 'off' | 'all' | 'one'

  const value = useMemo(() => {
    const currentTrack = queue ? queue.tracks[queue.order[queue.pos]] : null;
    const len = queue ? queue.order.length : 0;

    const playPlaylist = (playlist, trackIndex) => {
      const tracks = playlist.tracks || [];
      if (!tracks.length) return;
      const order = buildOrder(tracks.length, trackIndex, shuffle);
      setQueue({ playlistId: playlist.id, title: playlist.title, tracks, order, pos: order.indexOf(trackIndex) });
    };

    // 하이브리드 진입점: 셔플 ON + 랜덤 첫 곡으로 그 목록을 시작.
    const shufflePlayPlaylist = (playlist) => {
      const tracks = playlist.tracks || [];
      if (!tracks.length) return;
      setShuffle(true);
      const first = Math.floor(Math.random() * tracks.length);
      setQueue({ playlistId: playlist.id, title: playlist.title, tracks, order: buildOrder(tracks.length, first, true), pos: 0 });
    };

    // 한 칸 이동(범위를 벗어나면 repeat='all'일 때만 순환, 아니면 정지).
    const advance = (dir) =>
      setQueue((q) => {
        if (!q) return q;
        const n = q.order.length;
        let np = q.pos + dir;
        if (np < 0 || np >= n) {
          if (repeat === 'all') np = (np + n) % n;
          else return q;
        }
        return { ...q, pos: np };
      });

    const toggleShuffle = () => {
      const ns = !shuffle;
      setShuffle(ns);
      setQueue((q) => {
        if (!q) return q;
        const cur = q.order[q.pos];
        const order = buildOrder(q.tracks.length, cur, ns);
        return { ...q, order, pos: order.indexOf(cur) };
      });
    };

    return {
      currentTrack,
      playlistId: queue ? queue.playlistId : null,
      shuffle,
      repeat,
      hasPrev: !!queue && (queue.pos > 0 || repeat === 'all'),
      hasNext: !!queue && (queue.pos < len - 1 || repeat === 'all'),
      playPlaylist,
      shufflePlayPlaylist,
      next: () => advance(1),
      prev: () => advance(-1),
      handleEnded: () => advance(1), // repeat='one'은 플레이어가 곡 자체를 다시 재생
      toggleShuffle,
      cycleRepeat: () => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')),
      stop: () => setQueue(null),
    };
  }, [queue, shuffle, repeat]);

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export const usePlayback = () => useContext(PlaybackContext);
