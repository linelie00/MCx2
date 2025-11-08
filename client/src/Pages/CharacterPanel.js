import { useNavigate, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import '../Styles/Character.css';

const COLOR_MAP = {
  migel: '#768461',
  matiam: '#5b656c',
};

const CharacterPanel = () => {
  const nav = useNavigate();
  const { name = '' } = useParams();
  const color = COLOR_MAP[name.toLowerCase()] ?? '#2f2f2f'; // 기본색

  return (
    <div className='panel_content' style={{ '--panel-bg': color }}>
    </div>
  );
}

export default CharacterPanel;