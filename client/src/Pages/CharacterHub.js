import { useNavigate, Outlet } from 'react-router-dom';
import { useRef, useState, useCallback } from 'react';
import '../Styles/Character.css';
import migelImg from '../Assets/Images/img_migel-portrait.png';
import matiamImg from '../Assets/Images/img_matiam-portrait.png';

const cards = [
  { slug: 'migel', label: 'Migel Doran', color: '#768461', img: migelImg },
  { slug: 'matiam', label: 'Matiam Crohi', color: '#737b7f', img: matiamImg },
];

export default function CharacterHub() {
  const nav = useNavigate();
  const hubRef = useRef(null);

  // 오버레이 상태
  const [burst, setBurst] = useState({
    on: false,
    x: '50%',
    y: '50%',
    color: '#000',
    to: null,             // 이동할 경로
  });

  const handleCardClick = useCallback((e, item) => {
    // 카드 중심 좌표(뷰포트 기준) 구하기
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top  + rect.height / 2;

    // 좌표를 CSS에서 쓰기 쉬운 단위로(픽셀 → px 문자열)
    const x = `${Math.round(cx)}px`;
    const y = `${Math.round(cy)}px`;

    // 오버레이 켜고, clip-path 애니메이션 시작
    setBurst({ on: true, x, y, color: item.color, to: `/character/${item.slug}` });
  }, []);

  const onBurstEnd = useCallback(() => {
    // 애니메이션 끝 → 라우팅
    if (burst.to) nav(burst.to);
    // 종료 후 깔끔히 리셋(뒤 화면에서 잔상/포커스 방지)
    setBurst(prev => ({ ...prev, on: false }));
  }, [burst.to, nav]);

  return (
    <main className="hub" ref={hubRef}>
      <div className="hub_main">
        {cards.map((c) => (
          <div className="scene" key={c.slug} onClick={(e) => handleCardClick(e, c)} role="button" tabIndex={0}>
            <div className="card" aria-label={`${c.label} 상세 보기`}>
              <div className="card-front">
                <img src={c.img} alt={c.label} />
              </div>
              <div className={`card-back ${c.slug === 'migel' ? 'migel' : 'matiam'}`}>
                {c.slug === 'migel' ? <p>"다 같이 뛰어!"</p> : (
                  <>
                    <p>“이거 정말 고민되는걸.</p>
                    <p>초상화에는 어느 부분이 나와야하지?”</p>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 확장 오버레이 */}
      <div
        className={`burst-overlay ${burst.on ? 'on' : ''}`}
        style={{ 
          '--bx': burst.x, 
          '--by': burst.y, 
          '--bcolor': burst.color 
        }}
        onTransitionEnd={(e) => {
          // clip-path transition의 종료만 잡기(다른 트랜지션과 구분)
          if (e.propertyName === 'clip-path') onBurstEnd();
        }}
        aria-hidden="true"
      />

      <Outlet />
    </main>
  );
}
