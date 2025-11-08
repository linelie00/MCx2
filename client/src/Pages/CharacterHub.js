// Pages/CharacterHub.jsx
import { Link, Outlet } from 'react-router-dom';
import '../Styles/Character.css';
import migelImg from '../Assets/Images/img_migel-portrait.png';
import matiamImg from '../Assets/Images/img_matiam-portrait.png';

const CharacterHub = () => {
  return (
    <main className="hub">
      <div className="hub_main">
        <div class="scene">
            <div className="card">
            <div className="card-front">
              <img src={migelImg} alt="Migel Doran" />
            </div>
            <div className="card-back migel">
                <p>"다 같이 뛰어!"</p>
              </div>
          </div>
        </div>
        <div className="scene">
          <div className="card">
            <div className="card-front">
              <img src={matiamImg} alt="Matiam Crohi" />
            </div>
            <div className="card-back matiam">
              <p>“이거 정말 고민되는걸.</p>
              <p>초상화에는 어느 부분이 나와야하지?”</p>
            </div>
          </div>
        </div>
      </div>
      <Outlet />
    </main>
  );
}

export default CharacterHub;