/**
 * GlobalPlayer — 레이아웃에 상주하는 전역 플레이어.
 * 라우트 위에 mount되어 페이지 전환에도 언마운트되지 않으므로 재생이 유지된다.
 * /playlist 에서는 full(하단 바), 그 외 페이지에서는 mini(우하단 작은 카드)로 표시.
 */
import { useLocation } from 'react-router-dom';
import { usePlayback } from '../../contexts/PlaybackContext';
import MusicPlayer from './MusicPlayer';

function GlobalPlayer() {
  const { currentTrack } = usePlayback();
  const { pathname } = useLocation();
  if (!currentTrack) return null;
  return <MusicPlayer variant={pathname === '/playlist' ? 'full' : 'mini'} />;
}

export default GlobalPlayer;
