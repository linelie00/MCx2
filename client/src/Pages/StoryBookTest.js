/**
 * StoryBookTest (프로토타입)
 * Story 대화를 "책처럼 넘기며" 보는 인터랙션 실험용 페이지. (/story-test)
 * 정식 Story 페이지에는 아직 반영하지 않는다.
 *
 * - 양면 펼침(좌/우 페이지) + 가운데 책등
 * - 다음/이전 시 한 페이지가 책등을 기준으로 3D 회전(rotateY)하며 넘어감
 * - 대화를 글자 수 기준으로 페이지 단위로 분할(임시 페이지네이션)
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import '../Styles/StoryBookTest.css';
import { stories } from '../Data/stories';
import characters from '../Data/Characters';

const shortName = (full) => full.split('/')[0].trim();

// 대사를 글자 수 예산 기준으로 페이지로 분할 (임시 — 정밀 페이지네이션은 추후)
function paginate(session, budget = 240) {
  const lines = session.scenes.flatMap((sc) => sc.lines);
  const pages = [];
  let cur = [];
  let len = 0;
  for (const ln of lines) {
    const t = ln.text || '';
    if (cur.length && len + t.length > budget) {
      pages.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(ln);
    len += t.length;
  }
  if (cur.length) pages.push(cur);
  if (pages.length % 2 === 1) pages.push([]); // 스프레드용 짝수 보정
  return pages;
}

function PageContent({ lines }) {
  if (!lines || lines.length === 0) return <div className="bp-empty" />;
  return (
    <div className="bp-lines">
      {lines.map((ln, i) => {
        const ch = characters[ln.speaker];
        return (
          <div className="bp-line" key={i} style={{ '--accent': ch.color }}>
            <span className="bp-name">{shortName(ch.name)}</span>
            {ln.text && <p className="bp-text">{ln.text}</p>}
            {'image' in ln && <span className="bp-illust">✦ 삽화 ✦</span>}
          </div>
        );
      })}
    </div>
  );
}

export default function StoryBookTest() {
  const [sid, setSid] = useState(stories[0].id);
  const session = stories.find((s) => s.id === sid) ?? stories[0];
  const pages = useMemo(() => paginate(session), [session]);

  const [spread, setSpread] = useState(0); // 왼쪽 페이지 index (짝수)
  const [flip, setFlip] = useState(null); // 'next' | 'prev' | null
  const [animate, setAnimate] = useState(false);

  // 세션 바뀌면 처음으로
  useEffect(() => {
    setSpread(0);
    setFlip(null);
    setAnimate(false);
  }, [sid]);

  const last = Math.max(0, pages.length - 2);
  const canNext = spread < last && !flip;
  const canPrev = spread > 0 && !flip;

  const startFlip = useCallback((dir) => {
    setFlip(dir);
    setAnimate(false);
  }, []);

  // flip 시작 → 다음 프레임에 애니메이션 클래스 부여 (0deg 페인트 후 전환)
  useEffect(() => {
    if (!flip) return undefined;
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => setAnimate(true))
    );
    return () => cancelAnimationFrame(id);
  }, [flip]);

  const onFlipEnd = useCallback(
    (e) => {
      if (e.propertyName !== 'transform') return;
      setSpread((s) => s + (flip === 'next' ? 2 : -2));
      setFlip(null);
      setAnimate(false);
    },
    [flip]
  );

  // 키보드 ← →
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' && spread < last && !flip) startFlip('next');
      if (e.key === 'ArrowLeft' && spread > 0 && !flip) startFlip('prev');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spread, last, flip, startFlip]);

  const page = (i) => (i >= 0 && i < pages.length ? pages[i] : null);

  // flip 중 뒤에서 드러나는 정적 페이지 보정
  let staticLeft = spread;
  let staticRight = spread + 1;
  if (flip === 'next') staticRight = spread + 3;
  if (flip === 'prev') staticLeft = spread - 2;

  return (
    <div className="booktest">
      <div className="booktest-bar">
        <select value={sid} onChange={(e) => setSid(e.target.value)}>
          {stories.map((s) => (
            <option key={s.id} value={s.id}>
              {s.order}. {s.title}
            </option>
          ))}
        </select>
        <span className="booktest-hint">← → 키 또는 버튼으로 넘기기</span>
      </div>

      <div className="book">
        <div className="page page--left">
          <PageContent lines={page(staticLeft)} />
        </div>
        <div className="page page--right">
          <PageContent lines={page(staticRight)} />
        </div>

        {flip && (
          <div
            className={`page-flip page-flip--${flip} ${animate ? 'is-animating' : ''}`}
            onTransitionEnd={onFlipEnd}
          >
            <div className="page-face page-face--front">
              <PageContent lines={page(flip === 'next' ? spread + 1 : spread)} />
            </div>
            <div className="page-face page-face--back">
              <PageContent lines={page(flip === 'next' ? spread + 2 : spread - 1)} />
            </div>
          </div>
        )}
      </div>

      <div className="booktest-controls">
        <button type="button" onClick={() => startFlip('prev')} disabled={!canPrev}>
          ‹ 이전
        </button>
        <span className="booktest-page">
          {Math.min(spread + 1, pages.length)}–{Math.min(spread + 2, pages.length)} / {pages.length}
        </span>
        <button type="button" onClick={() => startFlip('next')} disabled={!canNext}>
          다음 ›
        </button>
      </div>
    </div>
  );
}
