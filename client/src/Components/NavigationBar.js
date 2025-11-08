import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import '../Styles/Components.css';

function NavigationBar() {
  const { pathname } = useLocation();
  const isMigel  = pathname === '/character/migel';
  const isMatiam = pathname === '/character/matiam';

  const barClass = [
    'bar',
    isMigel  && 'bar--migel',
    isMatiam && 'bar--matiam',
  ].filter(Boolean).join(' ');

  return (
    <div className={barClass}>
      <div className="nav-extra">
        {pathname !== '/' && <Link to="/">MIHEARTI</Link>}
      </div>
      <div className="nav-button">
        <Link to="/world">World</Link>
        <Link to="/character">Character</Link>
        <Link to="/story">Story</Link>
        <Link to="/image">Gallery</Link>
        <Link to="/playlist">Playlist</Link>
      </div>
    </div>
  );
}

export default NavigationBar;