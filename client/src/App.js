import './Styles/App.css';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import NavigateLayout from './Layouts/NavigateLayout';
import HomePage from './Pages/Home';
import ImageView from './Pages/ImageView';
import CharacterHub from './Pages/CharacterHub';
import CharacterPanel from './Pages/CharacterPanel';
import Story from './Pages/Story';
import World from './Pages/World';
import Playlist from './Pages/Playlist';

function App() {
  return (
    <div className="App">
      <Router>
        <Routes>
          <Route
            element={
              <NavigateLayout />
            }
          >
            <Route path="/" element={<HomePage />} />
            <Route path="/image" element={<ImageView />} />
            <Route path="/character" element={<CharacterHub />}>
              <Route path=":name" element={<CharacterPanel />} />
            </Route>
            <Route path="/story" element={<Story />} />
            <Route path="/world" element={<World />} />
            <Route path="/playlist" element={<Playlist />} />
          </Route>
        </Routes>
      </Router>
    </div>
  );
}

export default App;
