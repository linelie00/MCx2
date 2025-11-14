import { useEffect, useMemo, useRef, useState } from "react";
import '../Styles/Components.css';

/**
 * StickyRevealLines
 * - sticky로 고정된 위치에서 스크롤 진행도에 따라 <p> 라인이 한 줄씩 나타남/사라짐
 *
 * props:
 *  - lines: string[]           // 출력할 문장 배열 (각 항목이 <p> 한 줄)
 *  - top: number = 80          // sticky top(px)
 *  - range: number = 280       // 한 줄이 완전히 드러나기까지 필요한 스크롤(px)
 *  - startOffset: number = 0   // 래퍼 시작점에서 효과 시작까지 지연(px)
 *  - className: string = ""    // 추가 클래스
 */
export default function StickyRevealLines({
  lines = [
    "I, Migel Colddew, swear to Matiam Crohi.",
    "I offer the heart that holds the stories life has written. ",
    "And should it be cleaved in two and given to one beyond death, may truth awaken and rise anew.",
    "When all winds fall still, when flowers fade,",
    "and destiny returns to a fleeting chance,",
    "then I shall be reborn to begin the tale once more.",
  ],
  range = 280,
  startOffset = 0,
  className = "",
}) {
  const wrapRef = useRef(null);
  const [prog, setProg] = useState(0); // 스크롤 진행도(실수). 0 → 1 → 2 → ...
  const count = useMemo(() => lines.length, [lines]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    // 문서 기준 시작 위치(고정)
    const startY = () => window.scrollY + el.getBoundingClientRect().top + startOffset;

    let base = startY();
    let ticking = false;

    const update = () => {
      ticking = false;
      const y = window.scrollY;
      // 진행도를 "range" 단위로 정규화: 0~1이면 1줄, 1~2면 2줄…
      const p = (y - base) / range;
      setProg(p);
    };

    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    const onResize = () => {
      base = startY();
      update();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    // 초기 1회
    update();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [range, startOffset]);

  // 래퍼 높이: sticky가 고정될 구간 + 각 라인 range만큼 스크롤 여유 확보
  const wrapperMinH = useMemo(() => {
    // 뷰포트 한 화면 + 라인 수 * range + 여유분
    return `calc(100vh + ${count * range + 200}px)`;
  }, [count, range]);

  return (
    <section
      ref={wrapRef}
      className={`srl-wrap ${className}`}
      style={{ minHeight: wrapperMinH }}
    >
      <div className="srl-stick">
        {lines.map((txt, i) => {
          // i번째 라인의 진행도: prog가 i일 때 막 시작, i+1일 때 완전 표시
          const raw = prog - i;
          // 0~1로 스냅(clamp). 0: 숨김, 1: 완전 표시
          const t = Math.max(0, Math.min(1, raw));

          // 나타날 때 부드럽게: 불투명도/블러/아주 약한 아래→위 이동
          const opacity = t;                         // 0 → 1
          const blur = (1 - t) * 6;                  // 6px → 0
          const translate = (1 - t) * 10;            // 10px ↓ → 0
          // 성능 최적화(필요시 will-change)
          const style = {
            opacity,
            filter: `blur(${blur.toFixed(2)}px)`,
            transform: `translateY(${translate.toFixed(1)}px)`,
          };

          return (
            <p className="srl-line" key={i} style={style}>
              {txt}
            </p>
          );
        })}
      </div>
    </section>
  );
}
