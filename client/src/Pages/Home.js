import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import '../Styles/Home.css';
import cardImg from '../Assets/Images/img_J4W.png';

const Home = () => {
  const stickyRef = useRef(null); // .stickydiv
  const h1Ref = useRef(null);     // h1

  useEffect(() => {
    const wrap = stickyRef.current;
    const h1 = h1Ref.current;
    if (!wrap || !h1) return;

    // 더 천천히: 구간을 넓혀줍니다.
    const SCROLL_RANGE = 100; // 60 → 240

    // 문서 기준 시작 위치(한 번만 계산)
    const start = wrap.getBoundingClientRect().top + window.scrollY;

    // 부드러운 이징 (easeOutCubic)
    const ease = (t) => 1 - Math.pow(1 - t, 3);

    // 스무딩(저역통과)용 상태
    let pTarget = 0;      // 스크롤에서 계산된 목표 진행도
    let pDisplay = 0;     // 실제 화면에 적용할 진행도(서서히 따라감)
    const follow = 0.12;  // 0.1~0.2 정도 권장 (값 ↑ = 더 빠르게 따라감)

    let ticking = false;
    let rafId = 0;

    // 스타일 적용 함수 (pDisplay 기준)
    const apply = () => {
      // 84 → 24px (변화 폭 60px)
      const fs = 84 - 60 * pDisplay;
      // 800 → 600 (변화 폭 200)
      const fw = 800 - 100 * pDisplay;

      h1.style.fontSize = `${fs}px`;
      h1.style.fontWeight = `${Math.round(fw)}`;
      h1.style.fontVariationSettings = `"wght" ${Math.round(fw)}`; // Variable 폰트면 부드럽게
    };

    // rAF 루프: pDisplay가 pTarget을 서서히 따라가게
    const tick = () => {
      // 지수적 보간(lerp)
      pDisplay += (pTarget - pDisplay) * follow;

      // 아주 작은 차이는 정지 (성능/미세 떨림 방지)
      if (Math.abs(pTarget - pDisplay) < 0.001) {
        pDisplay = pTarget;
      } else {
        rafId = requestAnimationFrame(tick);
      }

      apply();
    };

    const computeTarget = () => {
      const y = window.scrollY;
      const raw = (y - start) / SCROLL_RANGE;
      const clamped = Math.max(0, Math.min(1, raw));
      pTarget = ease(clamped); // 이징 적용
      if (!ticking) {
        ticking = true;
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          ticking = false;
          tick(); // 스무딩 루프 시작/재가동
        });
      }
    };

    const onScroll = () => {
      computeTarget();
    };

    const onResize = () => {
      // 단순화: 리사이즈 시에도 목표만 재계산
      computeTarget();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    // 초기 1회
    computeTarget();
    apply();

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <>
      <div className="stickydiv" ref={stickyRef}>
        <h1 ref={h1Ref}>MIHEARTI</h1>
      </div>
      <div className="title">
        <h2>
            <Link to="/character/migel">Migeldoran Eternos Ozan Colddew</Link>
        </h2>
        <h2>
            <Link to="/character/matiam">Matiam Crohi</Link>
        </h2>
      </div>
      <div className="berry-card">
        <img src={cardImg} alt="카드" />
      </div>
      <section className="bg-100w" />
      <section className="section-385B44" />
    </>
  );
};

export default Home;
