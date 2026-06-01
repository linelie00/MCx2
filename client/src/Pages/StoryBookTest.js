/**
 * StoryBookTest (프로토타입) — /story-test
 * Story 대화를 "실제 책처럼" 넘겨 보는 인터랙션 실험. 정식 Story엔 미반영.
 *
 * - 흰 종이 양면 펼침 + 책등, 페이지 3D 회전 넘김
 * - 높이 측정 기반 페이지네이션: 페이지를 글로 꽉 채우고, 한 대사가 길어 넘치면
 *   잘라서 다음 페이지로 이어진다(페이지 내부 스크롤 없음). 이어진 부분은 "(이어서)" 표시
 * - 화자 포트레잇/이름 표시
 * - 상단 세션 타임라인(StoryTimeline) + 세션 선택 시 넘김 모션으로 이동
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import '../Styles/Story.css';        // 상단 타임라인 스타일 재사용
import '../Styles/StoryBookTest.css';
import { stories } from '../Data/stories';
import characters from '../Data/Characters';
import StoryTimeline from '../Components/story/StoryTimeline';

const shortName = (full) => full.split('/')[0].trim();
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pageAt = (pages, i) => (i >= 0 && i < pages.length ? pages[i] : null);

// 측정용 HTML — 아래 <Segment> 마크업과 동일해야 한다.
function segmentHTML(seg) {
  const ch = characters[seg.speaker];
  const head = seg.isCont
    ? ''
    : `<div class="bp-head"><img class="bp-portrait" src="${ch.portrait}" alt=""><span class="bp-name">${esc(shortName(ch.name))}</span></div>`;
  const cont = seg.isCont ? `<span class="bp-cont">(이어서)</span>` : '';
  const text = seg.text ? `<p class="bp-text">${esc(seg.text)}</p>` : '';
  const illust = 'image' in seg ? `<div class="bp-illust">✦ 삽화 ✦</div>` : '';
  return `<div class="bp-line" style="--accent:${ch.color}">${head}${cont}${text}${illust}</div>`;
}

// 높이 측정 기반 페이지 분할. node=측정용 DOM, maxH=페이지 내용 높이.
function paginate(lines, node, maxH) {
  const fits = (prefix, segHtml) => {
    node.innerHTML = prefix + segHtml;
    return node.scrollHeight <= maxH;
  };
  const pages = [];
  let page = [];
  let prefix = '';
  const commit = (seg) => { page.push(seg); prefix += segmentHTML(seg); };
  const newPage = () => { pages.push(page); page = []; prefix = ''; };

  for (const ln of lines) {
    const words = (ln.text || '').split(' ');
    let idx = 0;
    let first = true;
    do {
      const base = { speaker: ln.speaker, isCont: !first };
      if (first && 'image' in ln) base.image = ln.image;

      // 현재 페이지에 머리글조차 안 들어가면 새 페이지로
      if (page.length > 0 && !fits(prefix, segmentHTML({ ...base, text: '' }))) newPage();

      // idx부터 들어가는 최대 단어 수를 이분 탐색
      let lo = 0;
      let hi = words.length - idx;
      let best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const text = words.slice(idx, idx + mid).join(' ');
        if (fits(prefix, segmentHTML({ ...base, text }))) { best = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      if (best === 0) best = 1; // 한 단어도 안 들어가도 강제 진행(무한루프 방지)

      commit({ ...base, text: words.slice(idx, idx + best).join(' ') });
      idx += best;
      first = false;
      if (idx < words.length) newPage();
    } while (idx < words.length);
  }
  if (page.length) pages.push(page);
  if (pages.length === 0) pages.push([]);
  if (pages.length % 2 === 1) pages.push([]); // 스프레드용 짝수 보정
  return pages;
}

function Segment({ seg }) {
  const ch = characters[seg.speaker];
  return (
    <div className="bp-line" style={{ '--accent': ch.color }}>
      {!seg.isCont && (
        <div className="bp-head">
          <img className="bp-portrait" src={ch.portrait} alt="" />
          <span className="bp-name">{shortName(ch.name)}</span>
        </div>
      )}
      {seg.isCont && <span className="bp-cont">(이어서)</span>}
      {seg.text && <p className="bp-text">{seg.text}</p>}
      {'image' in seg && <div className="bp-illust">✦ 삽화 ✦</div>}
    </div>
  );
}

function Page({ segs, innerRef }) {
  return (
    <div className="bp-lines" ref={innerRef}>
      {(segs || []).map((s, i) => <Segment key={i} seg={s} />)}
    </div>
  );
}

export default function StoryBookTest() {
  const measureRef = useRef(null); // 숨겨진 측정 노드
  const sizeRef = useRef(null);    // 실제 왼쪽 페이지(.bp-lines) — 치수 측정용

  const [view, setView] = useState({ sid: stories[0].id, spread: 0 });
  const [pages, setPages] = useState([[]]);
  const [dims, setDims] = useState(null);
  const [ready, setReady] = useState(false);
  const [flip, setFlip] = useState(null);
  const [animate, setAnimate] = useState(false);

  const currentSession = useMemo(
    () => stories.find((s) => s.id === view.sid) ?? stories[0],
    [view.sid]
  );

  // 폰트 로드 후 측정해야 높이가 정확
  useEffect(() => {
    let alive = true;
    const p = document.fonts ? document.fonts.ready : Promise.resolve();
    p.then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  // 페이지 박스 치수 측정 (+ 리사이즈)
  useEffect(() => {
    const measure = () => {
      const el = sizeRef.current;
      if (el) setDims({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const getPages = useCallback(
    (session) => {
      const node = measureRef.current;
      if (!node || !dims) return [[]];
      node.style.width = `${dims.w}px`;
      return paginate(session.scenes.flatMap((s) => s.lines), node, dims.h - 2);
    },
    [dims]
  );

  // 현재 세션 페이지 (세션/치수/폰트 준비 변화 시 재계산)
  useEffect(() => {
    if (!ready || !dims) return;
    setPages(getPages(currentSession));
  }, [ready, dims, currentSession, getPages]);

  const lastSpread = Math.max(0, pages.length - 2);
  const safeSpread = Math.min(view.spread, lastSpread);
  const canNext = safeSpread < lastSpread && !flip;
  const canPrev = safeSpread > 0 && !flip;

  // flip 시작 후 다음 프레임에 애니메이션 (0deg 페인트 → 전환)
  useEffect(() => {
    if (!flip) return undefined;
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => setAnimate(true))
    );
    return () => cancelAnimationFrame(id);
  }, [flip]);

  const onFlipEnd = useCallback(
    (e) => {
      if (e.propertyName !== 'transform' || !flip) return;
      setPages(flip.end.pages);
      setView({ sid: flip.end.sid, spread: flip.end.spread });
      setFlip(null);
      setAnimate(false);
    },
    [flip]
  );

  const goNext = useCallback(() => {
    if (safeSpread >= lastSpread || flip) return;
    setFlip({
      dir: 'next',
      front: pageAt(pages, safeSpread + 1),
      back: pageAt(pages, safeSpread + 2),
      staticLeft: pageAt(pages, safeSpread),
      staticRight: pageAt(pages, safeSpread + 3),
      end: { sid: view.sid, spread: safeSpread + 2, pages },
    });
    setAnimate(false);
  }, [safeSpread, lastSpread, flip, pages, view.sid]);

  const goPrev = useCallback(() => {
    if (safeSpread <= 0 || flip) return;
    setFlip({
      dir: 'prev',
      front: pageAt(pages, safeSpread),
      back: pageAt(pages, safeSpread - 1),
      staticLeft: pageAt(pages, safeSpread - 2),
      staticRight: pageAt(pages, safeSpread + 1),
      end: { sid: view.sid, spread: safeSpread - 2, pages },
    });
    setAnimate(false);
  }, [safeSpread, flip, pages, view.sid]);

  // 세션 선택 → 넘김 모션으로 이동
  const jumpTo = useCallback(
    (id) => {
      if (id === view.sid || flip) return;
      const cur = stories.find((s) => s.id === view.sid);
      const tgt = stories.find((s) => s.id === id);
      const tPages = getPages(tgt);
      const forward = tgt.order > cur.order;
      setFlip(
        forward
          ? {
              dir: 'next',
              front: pageAt(pages, safeSpread + 1),
              back: pageAt(tPages, 0),
              staticLeft: pageAt(pages, safeSpread),
              staticRight: pageAt(tPages, 1),
              end: { sid: id, spread: 0, pages: tPages },
            }
          : {
              dir: 'prev',
              front: pageAt(pages, safeSpread),
              back: pageAt(tPages, 1),
              staticLeft: pageAt(tPages, 0),
              staticRight: pageAt(pages, safeSpread + 1),
              end: { sid: id, spread: 0, pages: tPages },
            }
      );
      setAnimate(false);
    },
    [view.sid, flip, pages, safeSpread, getPages]
  );

  // 키보드 ← →
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev]);

  const leftSegs = flip ? flip.staticLeft : pageAt(pages, safeSpread);
  const rightSegs = flip ? flip.staticRight : pageAt(pages, safeSpread + 1);
  const totalSpreads = Math.max(1, pages.length / 2);

  return (
    <div className="booktest">
      <StoryTimeline sessions={stories} activeId={view.sid} onSelect={jumpTo} />

      <div className="booktest-stage">
        <div className="book">
          <div className="page page--left">
            <Page segs={leftSegs} innerRef={sizeRef} />
          </div>
          <div className="page page--right">
            <Page segs={rightSegs} />
          </div>

          {flip && (
            <div
              className={`page-flip page-flip--${flip.dir} ${animate ? 'is-animating' : ''}`}
              onTransitionEnd={onFlipEnd}
            >
              <div className="page-face page-face--front">
                <Page segs={flip.front} />
              </div>
              <div className="page-face page-face--back">
                <Page segs={flip.back} />
              </div>
            </div>
          )}
        </div>

        <div className="booktest-controls">
          <button type="button" onClick={goPrev} disabled={!canPrev}>‹ 이전</button>
          <span className="booktest-page">
            {Math.floor(safeSpread / 2) + 1} / {totalSpreads}
          </span>
          <button type="button" onClick={goNext} disabled={!canNext}>다음 ›</button>
        </div>
      </div>

      {/* 숨겨진 측정 노드 */}
      <div className="bp-measure" ref={measureRef} aria-hidden="true" />
    </div>
  );
}
