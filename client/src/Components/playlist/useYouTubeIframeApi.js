/**
 * useYouTubeIframeApi — YouTube IFrame Player API 스크립트를 1회만 주입하고
 * 준비되면 window.YT를 돌려준다. 재생은 키가 필요 없다(임베드 전용).
 */
import { useEffect, useState } from 'react';

let apiPromise = null;

function loadApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev();
      resolve(window.YT);
    };
    if (!document.getElementById('youtube-iframe-api')) {
      const tag = document.createElement('script');
      tag.id = 'youtube-iframe-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }
  });
  return apiPromise;
}

export default function useYouTubeIframeApi() {
  const [yt, setYt] = useState(() => (window.YT && window.YT.Player ? window.YT : null));
  useEffect(() => {
    let alive = true;
    loadApi().then((Y) => {
      if (alive) setYt(Y);
    });
    return () => {
      alive = false;
    };
  }, []);
  return yt;
}
