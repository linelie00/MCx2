import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import '../Styles/Components.css';

function NavigationBar() {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const isMigel  = pathname === '/character/migel';
  const isMatiam = pathname === '/character/matiam';

  const barClass = [
    'bar',
    isMigel && 'bar--migel',
    isMatiam && 'bar--matiam',
  ].filter(Boolean).join(' ');

  return (
    <div className={`${barClass} ${menuOpen ? 'open' : ''}`}>
      <div className="nav-extra">
        {pathname !== '/' && <Link to="/">MIHEARTI</Link>}
      </div>

      {/* 햄버거 버튼 */}
      <div
        className={`hamburger ${menuOpen ? 'active' : ''}`}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        <span></span>
        <span></span>
        <span></span>
      </div>

      {/* 메뉴 */}
      <div className={`nav-button ${menuOpen ? 'open' : ''}`}>
        <Link to="/world" onClick={() => setMenuOpen(false)}>World</Link>
        <Link to="/character" onClick={() => setMenuOpen(false)}>Character</Link>
        <Link to="/story" onClick={() => setMenuOpen(false)}>Story</Link>
        <Link to="/image" onClick={() => setMenuOpen(false)}>Gallery</Link>
        <Link to="/playlist" onClick={() => setMenuOpen(false)}>Playlist</Link>
      </div>
    </div>
  );
}

export default NavigationBar;