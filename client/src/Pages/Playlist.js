/**
 * Playlist — /playlist
 * 오너가 자유롭게 만든 테마별 재생목록을 감상하는 음악 기록 보관소.
 * 곡 클릭 시 하단 플레이어(YouTube IFrame)로 재생하고, 끝나면 다음 곡으로 이어진다.
 * 곡 메타(제목/채널/썸네일/길이)는 서버가 추가 시 캐싱하므로 로드 시 추가 API 호출은 없다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import '../Styles/Playlist.css';
import * as playlistApi from '../services/playlistApi';
import { useOwner } from '../contexts/OwnerContext';
import { characterColors } from '../Data/constants/colors';
import PlaylistSection from '../Components/playlist/PlaylistSection';
import MusicPlayer from '../Components/playlist/MusicPlayer';
import PlaylistDialog from '../Components/playlist/PlaylistDialog';
import AddTrackDialog from '../Components/playlist/AddTrackDialog';

const accentColor = (accent) => (accent && characterColors[accent] ? characterColors[accent].primary : null);

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

function Playlist() {
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(null); // { playlistId, order:[trackIndex...], pos }
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off'); // 'off' | 'all' | 'one'
  const [plDialog, setPlDialog] = useState(null); // null | { mode:'create' } | { mode:'edit', playlist }
  const [addTrackFor, setAddTrackFor] = useState(null); // playlist | null

  const { isOwner, ownerLabel, unlock, lock } = useOwner();

  const handleLockToggle = useCallback(async () => {
    if (isOwner) {
      lock();
      return;
    }
    const key = window.prompt('관리자 패스코드를 입력하세요');
    if (!key) return;
    try {
      await unlock(key.trim());
    } catch (e) {
      window.alert('패스코드가 올바르지 않습니다.');
    }
  }, [isOwner, unlock, lock]);

  useEffect(() => {
    let alive = true;
    playlistApi
      .fetchPlaylists()
      .then((data) => {
        if (alive) setPlaylists(data);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 재생 중인 곡 도출
  const playingList = useMemo(
    () => (playing ? playlists.find((p) => p.id === playing.playlistId) : null),
    [playing, playlists]
  );
  const currentIndex = playing ? playing.order[playing.pos] : -1;
  const currentTrack = playingList ? playingList.tracks[currentIndex] : null;
  const orderLen = playing ? playing.order.length : 0;
  const hasPrev = !!playing && (playing.pos > 0 || repeat === 'all');
  const hasNext = !!playing && (playing.pos < orderLen - 1 || repeat === 'all');

  // 재생 대상이 사라지면(삭제 등) 플레이어를 닫는다.
  useEffect(() => {
    if (playing && !currentTrack) setPlaying(null);
  }, [playing, currentTrack]);

  const playTrack = (playlistId, trackIndex) => {
    const list = playlists.find((p) => p.id === playlistId);
    if (!list) return;
    const order = buildOrder(list.tracks.length, trackIndex, shuffle);
    setPlaying({ playlistId, order, pos: order.indexOf(trackIndex) });
  };

  // 하이브리드 진입점: 이 재생목록을 셔플 ON + 랜덤 첫 곡으로 시작(바 토글과 같은 전역 상태).
  const shufflePlay = (playlistId) => {
    const list = playlists.find((p) => p.id === playlistId);
    if (!list || list.tracks.length === 0) return;
    setShuffle(true);
    const first = Math.floor(Math.random() * list.tracks.length);
    setPlaying({ playlistId, order: buildOrder(list.tracks.length, first, true), pos: 0 });
  };

  // 한 칸 이동(범위를 벗어나면 repeat='all'일 때만 순환, 아니면 정지).
  const advance = (dir) => {
    setPlaying((p) => {
      if (!p) return p;
      const len = p.order.length;
      let np = p.pos + dir;
      if (np < 0 || np >= len) {
        if (repeat === 'all') np = (np + len) % len;
        else return p;
      }
      return { ...p, pos: np };
    });
  };
  const goNext = () => advance(1);
  const goPrev = () => advance(-1);
  const onEnded = () => advance(1); // repeat='one'은 MusicPlayer가 곡 자체를 다시 재생

  const toggleShuffle = () => {
    const ns = !shuffle;
    setShuffle(ns);
    setPlaying((p) => {
      if (!p) return p;
      const list = playlists.find((x) => x.id === p.playlistId);
      if (!list) return p;
      const cur = p.order[p.pos];
      const order = buildOrder(list.tracks.length, cur, ns);
      return { playlistId: p.playlistId, order, pos: order.indexOf(cur) };
    });
  };
  const cycleRepeat = () => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'));

  // ----- 오너: 재생목록 -----
  const handleCreatePlaylist = useCallback(async (payload) => {
    const created = await playlistApi.createPlaylist(payload);
    setPlaylists((prev) => [...prev, created]);
  }, []);

  const handleUpdatePlaylist = useCallback(
    async (id, patch) => {
      const updated = await playlistApi.updatePlaylist(id, patch);
      // 서버는 tracks 포함 전체를 돌려주므로 그대로 교체
      setPlaylists((prev) => prev.map((p) => (p.id === id ? updated : p)));
    },
    []
  );

  const handleDeletePlaylist = useCallback(async (playlist) => {
    if (!window.confirm(`‘${playlist.title}’ 재생목록을 삭제할까요?`)) return;
    await playlistApi.deletePlaylist(playlist.id);
    setPlaylists((prev) => prev.filter((p) => p.id !== playlist.id));
  }, []);

  const movePlaylist = useCallback(async (index, dir) => {
    setPlaylists((prev) => {
      const next = prev.slice();
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      playlistApi.reorderPlaylists(next.map((p) => p.id)).catch(() => {});
      return next;
    });
  }, []);

  // ----- 오너: 곡 -----
  const handleAddTrack = useCallback(
    async (payload) => {
      const playlistId = addTrackFor.id;
      const track = await playlistApi.addTrack(playlistId, payload);
      setPlaylists((prev) =>
        prev.map((p) => (p.id === playlistId ? { ...p, tracks: [...p.tracks, track] } : p))
      );
    },
    [addTrackFor]
  );

  const handleEditNote = useCallback(async (playlistId, track) => {
    const note = window.prompt('이 곡의 메모', track.note || '');
    if (note === null) return;
    const updated = await playlistApi.updateTrack(playlistId, track.id, { note });
    setPlaylists((prev) =>
      prev.map((p) =>
        p.id === playlistId ? { ...p, tracks: p.tracks.map((t) => (t.id === track.id ? updated : t)) } : p
      )
    );
  }, []);

  const handleDeleteTrack = useCallback(async (playlistId, track) => {
    if (!window.confirm('이 곡을 삭제할까요?')) return;
    await playlistApi.deleteTrack(playlistId, track.id);
    setPlaylists((prev) =>
      prev.map((p) => (p.id === playlistId ? { ...p, tracks: p.tracks.filter((t) => t.id !== track.id) } : p))
    );
  }, []);

  const moveTrack = useCallback(async (playlistId, index, dir) => {
    setPlaylists((prev) =>
      prev.map((p) => {
        if (p.id !== playlistId) return p;
        const tracks = p.tracks.slice();
        const j = index + dir;
        if (j < 0 || j >= tracks.length) return p;
        [tracks[index], tracks[j]] = [tracks[j], tracks[index]];
        playlistApi.reorderTracks(playlistId, tracks.map((t) => t.id)).catch(() => {});
        return { ...p, tracks };
      })
    );
  }, []);

  return (
    <div className={`playlist${currentTrack ? ' has-player' : ''}`}>
      <header className="pl-head">
        <h2 className="pl-title">Playlist</h2>
        <div className="pl-head-actions">
          {isOwner && (
            <button type="button" className="pl-btn pl-btn--primary" onClick={() => setPlDialog({ mode: 'create' })}>
              + 재생목록
            </button>
          )}
          <button
            type="button"
            className={`gal-login${isOwner ? ' is-owner' : ''}`}
            onClick={handleLockToggle}
            title={isOwner ? `${ownerLabel} · 로그아웃` : '관리자 로그인'}
          >
            {isOwner ? `${ownerLabel} · 로그아웃` : '관리자 로그인'}
          </button>
        </div>
      </header>

      {loading ? (
        <p className="pl-empty">불러오는 중…</p>
      ) : playlists.length === 0 ? (
        <p className="pl-empty">
          {isOwner ? '“+ 재생목록”으로 첫 재생목록을 만들어보세요.' : '아직 재생목록이 없어요.'}
        </p>
      ) : (
        <div className="pl-list">
          {playlists.map((playlist, i) => (
            <PlaylistSection
              key={playlist.id}
              playlist={playlist}
              accentColor={accentColor(playlist.accent)}
              currentTrackId={playingList && playingList.id === playlist.id ? currentTrack?.id : null}
              canEdit={isOwner}
              onPlayTrack={(index) => playTrack(playlist.id, index)}
              onShufflePlay={() => shufflePlay(playlist.id)}
              onAddTrack={() => setAddTrackFor(playlist)}
              onEditPlaylist={() => setPlDialog({ mode: 'edit', playlist })}
              onDeletePlaylist={() => handleDeletePlaylist(playlist)}
              onMovePlaylist={{ up: () => movePlaylist(i, -1), down: () => movePlaylist(i, 1) }}
              isFirst={i === 0}
              isLast={i === playlists.length - 1}
              onEditNote={(track) => handleEditNote(playlist.id, track)}
              onDeleteTrack={(track) => handleDeleteTrack(playlist.id, track)}
              onMoveTrack={(index, dir) => moveTrack(playlist.id, index, dir)}
            />
          ))}
        </div>
      )}

      {currentTrack && (
        <MusicPlayer
          track={currentTrack}
          hasPrev={hasPrev}
          hasNext={hasNext}
          shuffle={shuffle}
          repeat={repeat}
          onPrev={goPrev}
          onNext={goNext}
          onEnded={onEnded}
          onToggleShuffle={toggleShuffle}
          onCycleRepeat={cycleRepeat}
          onClose={() => setPlaying(null)}
        />
      )}

      {plDialog && (
        <PlaylistDialog
          initial={plDialog.mode === 'edit' ? plDialog.playlist : null}
          onSubmit={(payload) =>
            plDialog.mode === 'edit'
              ? handleUpdatePlaylist(plDialog.playlist.id, payload)
              : handleCreatePlaylist(payload)
          }
          onClose={() => setPlDialog(null)}
        />
      )}

      {addTrackFor && (
        <AddTrackDialog
          playlistTitle={addTrackFor.title}
          onSubmit={handleAddTrack}
          onClose={() => setAddTrackFor(null)}
        />
      )}
    </div>
  );
}

export default Playlist;
