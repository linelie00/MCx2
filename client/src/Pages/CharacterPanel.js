import { useNavigate, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import '../Styles/Character.css';
import characters from '../Data/Characters.js';

const COLOR_MAP = {
  migel: '#768461',
  matiam: '#737b7f',
};

const CharacterPanel = () => {
  const nav = useNavigate();
  const { name = '' } = useParams();
  const color = COLOR_MAP[name.toLowerCase()] ?? '#2f2f2f'; // 기본색

  return (
    <div className='panel_content' style={{ '--panel-bg': color }}>
      <div className='panel-inner'>
        <div className='panel-header'>
          <img src={characters[name]?.portrait} alt={characters[name]?.name} />
          <p>{characters[name]?.name}</p>
        </div>
        <div className='panel-body'>
          <h2>{characters[name]?.title}</h2>
          <p>{characters[name]?.description}</p>
        </div>
      </div>
    </div>
  );
}

export default CharacterPanel;