/**
 * ArticleContainer Component
 * 기사, 콘텐츠 페이지의 반응형 컨테이너입니다.
 * World, Story, Gallery 등 여러 페이지에서 공통으로 사용할 수 있습니다.
 *
 * Props:
 *   - children: ReactNode - 컨테이너 내 콘텐츠
 *   - className?: string - 추가 CSS 클래스
 *   - maxWidth?: string - 최대 너비 (기본값: CSS 변수 사용)
 */

export default function ArticleContainer({ children, className = '', maxWidth }) {
  const style = maxWidth ? { '--content-max-width': maxWidth } : {};

  return (
    <div className={`article-container ${className}`} style={style}>
      {children}
    </div>
  );
}
