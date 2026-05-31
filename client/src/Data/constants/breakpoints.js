/**
 * 반응형 디자인 Breakpoint 관리
 * 프로젝트 전체에서 일관된 breakpoint를 사용합니다.
 *
 * 기준:
 * - Very Small: 375px (iPhone SE)
 * - Mobile: 767px (모바일/태블릿 경계)
 * - Tablet: 1023px (태블릿/데스크톱 경계)
 * - Desktop: 1024px+ (데스크톱)
 */

export const breakpoints = {
  verySmall: 375,
  mobile: 767,
  tablet: 1023,
  desktop: 1024,
};

/**
 * CSS에서 사용할 Media Query 문자열
 * 예: Styles/World.css에서 ${mediaQueries.mobile} { ... } 형태로 사용
 */
export const mediaQueryStrings = {
  verySmall: '@media (max-width: 374px)',
  mobile: '@media (max-width: 767px)',
  tablet: '@media (max-width: 1023px)',
  desktop: '@media (min-width: 1024px)',
};

/**
 * JavaScript에서 현재 화면 크기 확인
 * 예: getBreakpoint() // 'mobile', 'tablet', 'desktop' 중 하나 반환
 */
export const getBreakpoint = () => {
  if (typeof window === 'undefined') return 'desktop';

  const width = window.innerWidth;

  if (width <= 374) return 'verySmall';
  if (width <= 767) return 'mobile';
  if (width <= 1023) return 'tablet';
  return 'desktop';
};

export default {
  breakpoints,
  mediaQueryStrings,
  getBreakpoint,
};
