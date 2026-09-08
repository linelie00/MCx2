import { Suspense } from 'react';
import '../Styles/App.css';
import '../Styles/Playlist.css';
import NavigationBar from '../Components/NavigationBar';
import { Outlet } from 'react-router-dom';
import GlobalPlayer from '../Components/playlist/GlobalPlayer';

/**
 * Suspense 는 반드시 <Outlet /> 만 감싼다.
 * 레이아웃 전체를 감싸면 코드 분할된 페이지를 불러오는 동안 GlobalPlayer 가
 * 언마운트되어 재생 중이던 음악이 끊긴다(PlaybackContext 상주 조건).
 */
const NavigateLayout = () => {
    return (
        <div>
            <NavigationBar />
            <div className="content">
                <Suspense fallback={<div className="route-fallback" />}>
                    <Outlet />
                </Suspense>
            </div>
            <GlobalPlayer />
        </div>
    );
}

export default NavigateLayout;
