/**
 * InfoItem Component
 * 캐릭터 정보, 게시물 메타데이터 등을 표시하는 정보 항목 컴포넌트입니다.
 *
 * Props:
 *   - label: string - 정보 항목의 레이블 (예: "직업", "나이")
 *   - value: string | number - 정보 값
 *   - className?: string - 추가 CSS 클래스
 */

export default function InfoItem({ label, value, className = '' }) {
  // value가 없거나 빈 문자열이면 렌더링하지 않음
  if (!value) return null;

  return (
    <div className={`info-item ${className}`}>
      <span className="label">[{label}]</span>
      <span className="value">{value}</span>
    </div>
  );
}
