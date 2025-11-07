import './Styles/App.css';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './Pages/Home';
import ImageView from './Pages/ImageView';
import DialogueView from './Pages/DialogueView';

function App() {
  return (
    <div className="App">
      <Router>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/image" element={<ImageView />} />
          <Route path="/dialogue" element={<DialogueView />} />
        </Routes>
      </Router>
    </div>
  );
}

export default App;
