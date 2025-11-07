import '../Styles/App.css';
import NavigationBar from '../Components/NavigationBar';
import { Outlet } from 'react-router-dom';

const NavigateLayout = () => {
    return (
        <div>
            <NavigationBar />
            <div className="content">
                <Outlet />
            </div>
        </div>
    );
}

export default NavigateLayout;