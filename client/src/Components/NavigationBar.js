import React from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import '../Styles/Components.css';

function NavigationBar() {
  const { pathname } = useLocation();
  const showExtra = pathname !== "/";

  return (
    <div className="bar">
        <div className="nav-extra">
            {showExtra && (
                <Link to="">MIHEARTI</Link>
            )}
        </div>
        <div className="nav-button">
            <Link to="world">World</Link>
            <Link to="character">Character</Link>
            <Link to="story">Story</Link>
            <Link to="image">Gallery</Link>
            <Link to="playlist">Playlist</Link>
        </div>
    </div>
  );
}

export default NavigationBar;
