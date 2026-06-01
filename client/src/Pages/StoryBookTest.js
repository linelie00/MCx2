/**
 * StoryBookTest (프로토타입) — /story-test
 * 11개 세션을 "하나의 책"으로 합쳐 넘겨 본다. 정식 Story엔 미반영.
 *
 * - 전체 세션을 한 번에 페이지네이션해 단일 pages 배열로 합침
 * - 각 세션 시작에 도비라(속표지) 페이지: 어느 섹터인지(주점 이니트 등) 표시
 *   도비라는 항상 왼쪽 페이지에 오도록 정렬(필요 시 공백 페이지로 맞춤)
 * - 페이지 타입: 'divider'(도비라) / 'content'(본문) / 'blank'(정렬용 공백)
 * - 흰 종이 양면 + 3D 넘김, 상단 타임라인(현재 세션 강조, 클릭 시 넘김 이동)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import '../Styles/Story.css'; // 상단 타임라인 스타일 재사용
import '../Styles/StoryBookTest.css';
import { stories } from '../Data/stories';
import characters from '../Data/Characters';
import StoryTimeline from '../Components/story/StoryTimeline';

const shortName = (full) => full.split('/')[0].trim();
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 측정용 HTML — 아래 <Segment> 마크업과 동일해야 한다.
function segmentHTML(seg) {
  const ch = characters[seg.speaker];
  const head = seg.isCont
    ? ''
    : `<div class="bp-head"><img class="bp-portrait" src="${ch.portrait}" alt=""><span class="bp-name">${esc(shortName(ch.name))}</span></div>`;
  const text = seg.text ? `<p class="bp-text">${esc(seg.text)}</p>` : '';
  const illust = 'image' in seg ? `<div class="bp-illust">✦ 삽화 ✦</div>` : '';
  return `<div class="bp-line" style="--accent:${ch.color}">${head}${text}${illust}</div>`;
}

// 한 세션의 대사를 높이 측정 기반으로 페이지(세그먼트 배열)들로 분할.
// 규칙: 대사는 되도록 통째로. 현재 페이지에 안 들어가면 다음 페이지로 통째로,
//       한 페이지에도 안 들어갈 만큼 긴 대사만 단어 단위로 분할.
function paginateSession(lines, node, maxH) {
  const fits = (prefix, segHtml) => {
    node.innerHTML = prefix + segHtml;
    return node.scrollHeight <= maxH;
  };
  const pages = [];
  let page = [];
  let prefix = '';
  const commit = (seg) => { page.push(seg); prefix += segmentHTML(seg); };
  const newPage = () => { pages.push(page); page = []; prefix = ''; };

  const splitAcross = (ln) => {
    const words = (ln.text || '').split(' ');
    let idx = 0;
    let first = true;
    do {
      const base = { speaker: ln.speaker, isCont: !first };
      if (first && 'image' in ln) base.image = ln.image;
      if (page.length > 0 && !fits(prefix, segmentHTML({ ...base, text: '' }))) newPage();
      let lo = 0;
      let hi = words.length - idx;
      let best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const text = words.slice(idx, idx + mid).join(' ');
        if (fits(prefix, segmentHTML({ ...base, text }))) { best = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      if (best === 0) best = 1;
      commit({ ...base, text: words.slice(idx, idx + best).join(' ') });
      idx += best;
      first = false;
      if (idx < words.length) newPage();
    } while (idx < words.length);
  };

  for (const ln of lines) {
    const whole = { speaker: ln.speaker, isCont: false, text: ln.text || '' };
    if ('image' in ln) whole.image = ln.image;
    const wholeHtml = segmentHTML(whole);
    if (fits(prefix, wholeHtml)) { commit(whole); continue; }
    if (page.length > 0) {
      if (fits('', wholeHtml)) { newPage(); commit(whole); continue; }
      newPage();
    }
    splitAcross(ln);
  }
  if (page.length) pages.push(page);
  if (pages.length === 0) pages.push([]);
  return pages;
}

// 전체 세션을 하나의 책(페이지 배열)으로 합친다. 도비라는 왼쪽(짝수 index)에 정렬.
function buildBook(node, maxH) {
  const pages = [];
  const dividerBySid = {};
  let lastSid = null;
  for (const session of stories) {
    if (pages.length % 2 === 1) pages.push({ type: 'blank', sid: lastSid }); // 도비라를 왼쪽으로
    dividerBySid[session.id] = pages.length;
    pages.push({ type: 'divider', sid: session.id, title: session.title, order: session.order });
    const content = paginateSession(session.scenes.flatMap((s) => s.lines), node, maxH);
    for (const segs of content) pages.push({ type: 'content', sid: session.id, segs });
    lastSid = session.id;
  }
  if (pages.length % 2 === 1) pages.push({ type: 'blank', sid: lastSid }); // 스프레드 짝수 보정
  return { pages, dividerBySid };
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
      {seg.text && <p className="bp-text">{seg.text}</p>}
      {'image' in seg && <div className="bp-illust">✦ 삽화 ✦</div>}
    </div>
  );
}

function PageBody({ page }) {
  if (!page || page.type === 'blank') return <div className="bp-lines" />;
  if (page.type === 'divider') {
    return (
      <div className="bp-divider">
        <span className="bp-divider-order">CHAPTER {page.order}</span>
        <span className="bp-divider-rule" />
        <h3 className="bp-divider-title">{page.title}</h3>
        <span className="bp-divider-orn">✦</span>
      </div>
    );
  }
  return (
    <div className="bp-lines">
      {page.segs.map((s, i) => <Segment key={i} seg={s} />)}
    </div>
  );
}

export default function StoryBookTest() {
  const measureRef = useRef(null); // 숨겨진 측정 노드
  const sizeRef = useRef(null); // 페이지 치수 측정용 sizer

  const [book, setBook] = useState({ pages: [], dividerBySid: {} });
  const [view, setView] = useState({ spread: 0 });
  const [dims, setDims] = useState(null);
  const [ready, setReady] = useState(false);
  const [flip, setFlip] = useState(null);
  const [animate, setAnimate] = useState(false);

  // 폰트 로드 후 측정
  useEffect(() => {
    let alive = true;
    const p = document.fonts ? document.fonts.ready : Promise.resolve();
    p.then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  // 페이지 콘텐츠 박스 치수 (패딩 제외) + 리사이즈
  useEffect(() => {
    const measure = () => {
      const el = sizeRef.current;
      if (!el) return;
      const cs = getComputedStyle(el);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      setDims({ w: el.clientWidth - padX, h: el.clientHeight - padY });
    };
    measure();
    let t;
    const onResize = () => { clearTimeout(t); t = setTimeout(measure, 150); };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); clearTimeout(t); };
  }, []);

  // 전체 책 조판 (폰트/치수 준비되면)
  useEffect(() => {
    if (!ready || !dims || !measureRef.current) return;
    measureRef.current.style.width = `${dims.w}px`;
    const b = buildBook(measureRef.current, dims.h - 1);
    setBook(b);
    setView((v) => ({ spread: Math.min(v.spread, Math.max(0, b.pages.length - 2)) }));
  }, [ready, dims]);

  const pages = book.pages;
  const lastSpread = Math.max(0, pages.length - 2);
  const safeSpread = Math.min(view.spread, lastSpread);
  const canNext = safeSpread < lastSpread && !flip;
  const canPrev = safeSpread > 0 && !flip;

  // flip 시작 → 다음 프레임에 애니메이션
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
      setView({ spread: flip.end.spread });
      setFlip(null);
      setAnimate(false);
    },
    [flip]
  );

  const goNext = useCallback(() => {
    if (safeSpread >= lastSpread || flip) return;
    setFlip({
      dir: 'next',
      front: pages[safeSpread + 1],
      back: pages[safeSpread + 2],
      staticLeft: pages[safeSpread],
      staticRight: pages[safeSpread + 3],
      end: { spread: safeSpread + 2 },
    });
    setAnimate(false);
  }, [safeSpread, lastSpread, flip, pages]);

  const goPrev = useCallback(() => {
    if (safeSpread <= 0 || flip) return;
    setFlip({
      dir: 'prev',
      front: pages[safeSpread],
      back: pages[safeSpread - 1],
      staticLeft: pages[safeSpread - 2],
      staticRight: pages[safeSpread + 1],
      end: { spread: safeSpread - 2 },
    });
    setAnimate(false);
  }, [safeSpread, flip, pages]);

  // 세션 선택 → 그 세션 도비라로 넘김 모션 이동
  const jumpTo = useCallback(
    (sid) => {
      if (flip) return;
      const target = book.dividerBySid[sid];
      if (target == null || target === safeSpread) return;
      const forward = target > safeSpread;
      setFlip(
        forward
          ? {
              dir: 'next',
              front: pages[safeSpread + 1],
              back: pages[target],
              staticLeft: pages[safeSpread],
              staticRight: pages[target + 1],
              end: { spread: target },
            }
          : {
              dir: 'prev',
              front: pages[safeSpread],
              back: pages[target + 1],
              staticLeft: pages[target],
              staticRight: pages[safeSpread + 1],
              end: { spread: target },
            }
      );
      setAnimate(false);
    },
    [flip, book.dividerBySid, safeSpread, pages]
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

  const pageSid = (i) => (pages[i] && pages[i].sid) || null;
  const currentSid = pageSid(safeSpread) || pageSid(safeSpread + 1) || stories[0].id;

  const leftPage = flip ? flip.staticLeft : pages[safeSpread];
  const rightPage = flip ? flip.staticRight : pages[safeSpread + 1];
  const totalSpreads = Math.max(1, Math.ceil(pages.length / 2));

  return (
    <div className="booktest">
      <StoryTimeline sessions={stories} activeId={currentSid} onSelect={jumpTo} />

      <div className="booktest-stage">
        <div className="book">
          <div className="page page--left"><PageBody page={leftPage} /></div>
          <div className="page page--right"><PageBody page={rightPage} /></div>

          {flip && (
            <div
              className={`page-flip page-flip--${flip.dir} ${animate ? 'is-animating' : ''}`}
              onTransitionEnd={onFlipEnd}
            >
              <div className="page-face page-face--front"><PageBody page={flip.front} /></div>
              <div className="page-face page-face--back"><PageBody page={flip.back} /></div>
            </div>
          )}

          {/* 페이지 치수 측정용 (보이지 않음) */}
          <div className="page page--sizer" aria-hidden="true">
            <div className="bp-lines" ref={sizeRef} />
          </div>
        </div>

        <div className="booktest-controls">
          <button type="button" onClick={goPrev} disabled={!canPrev}>‹ 이전</button>
          <span className="booktest-page">{Math.floor(safeSpread / 2) + 1} / {totalSpreads}</span>
          <button type="button" onClick={goNext} disabled={!canNext}>다음 ›</button>
        </div>
      </div>

      {/* 숨겨진 측정 노드 */}
      <div className="bp-measure" ref={measureRef} aria-hidden="true" />
    </div>
  );
}
