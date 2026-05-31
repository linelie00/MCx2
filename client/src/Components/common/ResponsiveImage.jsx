/**
 * ResponsiveImage Component
 * 반응형 이미지 컴포넌트입니다.
 * aspect-ratio를 설정하여 layout shift를 방지합니다.
 *
 * Props:
 *   - src: string - 이미지 경로
 *   - alt: string - 이미지 대체 텍스트
 *   - width?: number - 이미지 원본 너비 (aspect-ratio 계산용)
 *   - height?: number - 이미지 원본 높이 (aspect-ratio 계산용)
 *   - className?: string - 추가 CSS 클래스
 *   - rounded?: boolean - 모서리 둥글게 처리
 *   - circle?: boolean - 원형 처리
 */

export default function ResponsiveImage({
  src,
  alt,
  width,
  height,
  className = '',
  rounded = false,
  circle = false,
}) {
  // aspect-ratio 계산
  const aspectRatio = width && height ? `${width} / ${height}` : undefined;

  const imgClasses = [
    'responsive-image',
    rounded && 'responsive-image--rounded',
    circle && 'responsive-image--circle',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const style = aspectRatio ? { aspectRatio } : {};

  return (
    <img
      src={src}
      alt={alt}
      className={imgClasses}
      style={style}
      loading="lazy"
    />
  );
}
