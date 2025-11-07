import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import '../Styles/Components.css';

function NavigationBar() {

  return (
    <div className="bar">
        <div className="nav-button">
            <Link to="/">Home</Link>
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
