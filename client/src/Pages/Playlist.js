/**
 * Playlist — /playlist
 * 오너가 자유롭게 만든 테마별 재생목록을 감상하는 음악 기록 보관소.
 * 곡 클릭 시 하단 플레이어(YouTube IFrame)로 재생하고, 끝나면 다음 곡으로 이어진다.
 * 곡 메타(제목/채널/썸네일/길이)는 서버가 추가 시 캐싱하므로 로드 시 추가 API 호출은 없다.
 */
import { useCallback, useEffect, useState } from 'react';
import '../Styles/Playlist.css';
import * as playlistApi from '../services/playlistApi';
import { useOwner } from '../contexts/OwnerContext';
import { usePlayback } from '../contexts/PlaybackContext';
import { characterColors } from '../Data/constants/colors';
import PlaylistSection from '../Components/playlist/PlaylistSection';
import PlaylistDialog from '../Components/playlist/PlaylistDialog';
import AddTrackDialog from '../Components/playlist/AddTrackDialog';

const accentColor = (accent) => (accent && characterColors[accent] ? characterColors[accent].primary : null);

function Playlist() {
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [plDialog, setPlDialog] = useState(null); // null | { mode:'create' } | { mode:'edit', playlist }
  const [addTrackFor, setAddTrackFor] = useState(null); // playlist | null

  const { isOwner, ownerLabel, unlock, lock } = useOwner();
  const playback = usePlayback();

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

  const handleDeletePlaylist = useCallback(
    async (playlist) => {
      if (!window.confirm(`‘${playlist.title}’ 재생목록을 삭제할까요?`)) return;
      await playlistApi.deletePlaylist(playlist.id);
      setPlaylists((prev) => prev.filter((p) => p.id !== playlist.id));
      if (playback.playlistId === playlist.id) playback.stop();
    },
    [playback]
  );

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
    <div className={`playlist${playback.currentTrack ? ' has-player' : ''}`}>
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
              currentTrackId={
                playback.playlistId === playlist.id && playback.currentTrack ? playback.currentTrack.id : null
              }
              canEdit={isOwner}
              onPlayTrack={(index) => playback.playPlaylist(playlist, index)}
              onShufflePlay={() => playback.shufflePlayPlaylist(playlist)}
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
