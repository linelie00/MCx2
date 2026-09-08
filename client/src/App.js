// Theme & Global Styles (먼저 로드)
import './Styles/theme.css';
import './Styles/global.css';

// Font & Component Styles
import './Assets/Font/Font.css';
import './Styles/App.css';

import { lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { OwnerProvider } from './contexts/OwnerContext';
import { PlaybackProvider } from './contexts/PlaybackContext';
import NavigateLayout from './Layouts/NavigateLayout';
import ScrollToTop from "./Components/ScrollToTop";
// 첫 화면(Home)과 가벼운 정적 페이지는 즉시 로드해 초기 렌더를 지연시키지 않는다.
import HomePage from './Pages/Home';
import World from './Pages/World';
import CharacterHub from './Pages/CharacterHub';
import CharacterPanel from './Pages/CharacterPanel';

// 무겁거나 진입 빈도가 낮은 페이지는 분리 로드한다.
// 특히 Story 는 Data/stories.js(350KB)를 통째로 안고 있어 홈 진입 시 함께 받을 이유가 없다.
const Story = lazy(() => import('./Pages/Story'));
const Gallery = lazy(() => import('./Pages/Gallery'));
const Playlist = lazy(() => import('./Pages/Playlist'));
const Movie = lazy(() => import('./Pages/Movie'));

function App() {
  return (
    <div className="App">
      <OwnerProvider>
      <PlaybackProvider>
      <Router>
        <ScrollToTop />
        <Routes>
          <Route
            element={
              <NavigateLayout />
            }
          >
            <Route path="/" element={<HomePage />} />
            <Route path="/image" element={<Gallery />} />
            <Route path="/character" element={<CharacterHub />}>
              <Route path=":name" element={<CharacterPanel />} />
            </Route>
            <Route path="/story" element={<Story />} />
            <Route path="/world" element={<World />} />
            <Route path="/playlist" element={<Playlist />} />
            <Route path="/movie" element={<Movie />} />
          </Route>
        </Routes>
      </Router>
      </PlaybackProvider>
      </OwnerProvider>
    </div>
  );
}

export default App;
