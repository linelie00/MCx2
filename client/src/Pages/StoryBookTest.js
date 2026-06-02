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
import { getStoryImage, storyImages } from '../Data/storyImages';
import StoryTimeline from '../Components/story/StoryTimeline';
import coverFront from '../Assets/Images/img_front_cover.png';
import coverBack from '../Assets/Images/img_back_cover.png';

const COVER = { front: coverFront, back: coverBack };

const shortName = (full) => full.split('/')[0].trim();
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 삽화를 미리 로드해 pageWidth 기준 렌더 높이를 반환한다. (url → px)
function preloadImageHeights(pageWidth) {
  return Promise.all(
    Object.values(storyImages).map((url) =>
      new Promise((resolve) => {
        const img = new window.Image();
        img.onload = () =>
          resolve([url, Math.round((img.naturalHeight / img.naturalWidth) * pageWidth)]);
        img.onerror = () => resolve([url, 180]);
        img.src = url;
      })
    )
  ).then((entries) => Object.fromEntries(entries));
}

// 측정용 HTML — 아래 <Segment> 마크업과 동일해야 한다.
// speakerHeightMap: speaker → px 높이 (preloadImageHeights 결과 기반)
function segmentHTML(seg, speakerHeightMap = {}) {
  const ch = characters[seg.speaker];
  const head = seg.isCont
    ? ''
    : `<div class="bp-head"><img class="bp-portrait" src="${ch.portrait}" alt=""><span class="bp-name">${esc(shortName(ch.name))}</span></div>`;
  const text = seg.text ? `<p class="bp-text">${esc(seg.text)}</p>` : '';
  // 측정용: 실제 이미지 비율로 계산된 높이를 inline으로 주입해 측정 일관성을 유지한다.
  const illustH = speakerHeightMap[seg.speaker] || 180;
  const illust = 'image' in seg ? `<img class="bp-illust" style="height:${illustH}px" alt="">` : '';
  return `<div class="bp-line" style="--accent:${ch.color}">${head}${illust}${text}</div>`;
}

// 한 "시점(scene)"의 대사를 높이 측정 기반으로 페이지들로 분할한다.
// 첫 페이지 상단엔 시점 라벨(날짜)을 두고, 그 높이를 미리 반영해 조판한다.
// 반환: [{ label?, segs[] }, ...]  (label 은 그 시점 첫 페이지에만)
// 규칙: 대사는 되도록 통째로. 안 들어가면 다음 페이지로 통째로,
//       한 페이지에도 안 들어갈 만큼 긴 대사만 단어 단위로 분할.
function paginateScene(lines, node, maxH, label, speakerHeightMap = {}) {
  const labelHTML = label ? `<div class="bp-scene-label"><span>${esc(label)}</span></div>` : '';
  const fits = (prefix, segHtml) => {
    node.innerHTML = prefix + segHtml;
    return node.scrollHeight <= maxH;
  };
  const pages = [];
  let page = [];
  let firstPage = true;
  let prefix = labelHTML; // 첫 페이지엔 라벨 자리를 미리 잡아둔다
  const commit = (seg) => { page.push(seg); prefix += segmentHTML(seg, speakerHeightMap); };
  const flush = () => {
    pages.push({ label: firstPage && label ? label : undefined, segs: page });
    page = [];
    firstPage = false;
    prefix = ''; // 다음 페이지부터는 라벨 없음
  };

  const splitAcross = (ln) => {
    const words = (ln.text || '').split(' ');
    let idx = 0;
    let first = true;
    do {
      const base = { speaker: ln.speaker, isCont: !first };
      if (first && 'image' in ln) base.image = ln.image;
      if (page.length > 0 && !fits(prefix, segmentHTML({ ...base, text: '' }, speakerHeightMap))) flush();
      let lo = 0;
      let hi = words.length - idx;
      let best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const text = words.slice(idx, idx + mid).join(' ');
        if (fits(prefix, segmentHTML({ ...base, text }, speakerHeightMap))) { best = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      if (best === 0) best = 1;
      commit({ ...base, text: words.slice(idx, idx + best).join(' ') });
      idx += best;
      first = false;
      if (idx < words.length) flush();
    } while (idx < words.length);
  };

  const SPLIT_MIN_RATIO = 0.13; // 현재 페이지에 이 비율 이상 여백이 남으면 분할해 채움
  for (const ln of lines) {
    const whole = { speaker: ln.speaker, isCont: false, text: ln.text || '' };
    if ('image' in ln) whole.image = ln.image;
    const wholeHtml = segmentHTML(whole, speakerHeightMap);

    // 1) 현재 페이지에 통째로 들어가면 그대로
    if (fits(prefix, wholeHtml)) { commit(whole); continue; }

    // 2) 안 들어감 — 남은 여백을 보고 분할/이동 결정
    if (page.length > 0) {
      node.innerHTML = prefix;
      const remaining = maxH - node.scrollHeight;
      const roomToSplit = remaining > maxH * SPLIT_MIN_RATIO;
      if (!roomToSplit) {
        // flush 하면 다음 페이지엔 라벨이 없으므로 빈 페이지 기준으로 판정
        if (fits('', wholeHtml)) { flush(); commit(whole); continue; }
        flush(); // 한 페이지에도 안 들어갈 만큼 긺
      }
    }

    // 3) 분할
    splitAcross(ln);
  }
  pages.push({ label: firstPage && label ? label : undefined, segs: page });
  return pages;
}

// 전체 세션을 하나의 책(페이지 배열)으로 합친다. 도비라는 왼쪽(짝수 index)에 정렬.
function buildBook(node, maxH, imageHeights = {}) {
  const pages = [];
  const dividerBySid = {};
  // 앞표지 스프레드: 왼=투명(배경), 오=앞표지
  pages.push({ type: 'cover-blank' });
  pages.push({ type: 'cover', img: COVER.front });
  let lastSid = null;
  for (const session of stories) {
    if (pages.length % 2 === 1) pages.push({ type: 'blank', sid: lastSid }); // 도비라를 왼쪽으로
    dividerBySid[session.id] = pages.length;
    pages.push({ type: 'divider', side: 'left', sid: session.id, title: session.title, order: session.order });
    pages.push({ type: 'divider', side: 'right', sid: session.id, title: session.title, order: session.order });
    // 세션 내 화자별 삽화 높이 (imageHeights는 url → px)
    const speakerHeightMap = {};
    for (const scene of session.scenes) {
      for (const ln of scene.lines) {
        if ('image' in ln && !(ln.speaker in speakerHeightMap)) {
          const url = getStoryImage(session.id, ln.speaker);
          speakerHeightMap[ln.speaker] = (url && imageHeights[url]) ? imageHeights[url] : 180;
        }
      }
    }

    // 시점(scene)별로 조판 → 시점이 바뀌면 새 페이지로 나뉘고, 첫 페이지에 날짜 라벨
    for (const scene of session.scenes) {
      const scenePages = paginateScene(scene.lines, node, maxH, scene.label, speakerHeightMap);
      for (const p of scenePages) {
        for (const seg of p.segs) {
          if ('image' in seg) seg.image = getStoryImage(session.id, seg.speaker);
        }
        pages.push({ type: 'content', sid: session.id, label: p.label, segs: p.segs });
      }
    }
    lastSid = session.id;
  }
  if (pages.length % 2 === 1) pages.push({ type: 'blank', sid: lastSid }); // 스프레드 짝수 보정
  // 뒷표지 스프레드: 왼=뒷표지, 오=투명(배경)
  pages.push({ type: 'cover', img: COVER.back });
  pages.push({ type: 'cover-blank' });
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
      {seg.image && <img className="bp-illust" src={seg.image} alt="삽화" />}
      {seg.text && <p className="bp-text">{seg.text}</p>}
    </div>
  );
}

function PageBody({ page }) {
  if (!page || page.type === 'blank') return <div className="bp-lines" />;
  if (page.type === 'cover-blank') return <div className="bp-cover-blank" />;
  if (page.type === 'cover') {
    return <div className="bp-cover" style={{ backgroundImage: `url(${page.img})` }} />;
  }
  if (page.type === 'divider') {
    if (page.side === 'left') {
      return (
        <div className="bp-divider bp-divider--left">
          <span className="bp-divider-orn">✦</span>
          <span className="bp-divider-chapter">CHAPTER</span>
          <span className="bp-divider-num">{page.order}</span>
        </div>
      );
    }
    return (
      <div className="bp-divider bp-divider--right">
        <h3 className="bp-divider-title">{page.title}</h3>
        <span className="bp-divider-rule" />
        <span className="bp-divider-orn">✦</span>
      </div>
    );
  }
  return (
    <div className="bp-lines">
      {page.label && (
        <div className="bp-scene-label"><span>{page.label}</span></div>
      )}
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

  // 전체 책 조판 (폰트/치수 준비되면) — 삽화를 먼저 로드해 실제 높이를 측정에 반영
  useEffect(() => {
    if (!ready || !dims || !measureRef.current) return;
    measureRef.current.style.width = `${dims.w}px`;
    preloadImageHeights(dims.w).then((imageHeights) => {
      const b = buildBook(measureRef.current, dims.h - 6, imageHeights);
      setBook(b);
      setView((v) => ({ spread: Math.min(v.spread, Math.max(0, b.pages.length - 2)) }));
    });
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
  const currentSid = pageSid(safeSpread) || pageSid(safeSpread + 1) || null;

  const leftPage = flip ? flip.staticLeft : pages[safeSpread];
  const rightPage = flip ? flip.staticRight : pages[safeSpread + 1];
  const totalSpreads = Math.max(1, Math.ceil(pages.length / 2));
  const pageMod = (p) => {
    if (!p) return '';
    if (p.type === 'divider') return ' is-divider';
    if (p.type === 'cover' || p.type === 'cover-blank') return ' is-cover';
    return '';
  };

  return (
    <div className="booktest">
      <StoryTimeline sessions={stories} activeId={currentSid} onSelect={jumpTo} />

      <div className="booktest-stage">
        <div className="book">
          <div className={`page page--left${pageMod(leftPage)}`}><PageBody page={leftPage} /></div>
          <div className={`page page--right${pageMod(rightPage)}`}><PageBody page={rightPage} /></div>

          {flip && (
            <div
              className={`page-flip page-flip--${flip.dir} ${animate ? 'is-animating' : ''}`}
              onTransitionEnd={onFlipEnd}
            >
              <div className={`page-face page-face--front${pageMod(flip.front)}`}><PageBody page={flip.front} /></div>
              <div className={`page-face page-face--back${pageMod(flip.back)}`}><PageBody page={flip.back} /></div>
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
