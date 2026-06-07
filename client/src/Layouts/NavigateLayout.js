import '../Styles/App.css';
import '../Styles/Playlist.css';
import NavigationBar from '../Components/NavigationBar';
import { Outlet } from 'react-router-dom';
import GlobalPlayer from '../Components/playlist/GlobalPlayer';

const NavigateLayout = () => {
    return (
        <div>
            <NavigationBar />
            <div className="content">
                <Outlet />
            </div>
            <GlobalPlayer />
        </div>
    );
}

export default NavigateLayout;