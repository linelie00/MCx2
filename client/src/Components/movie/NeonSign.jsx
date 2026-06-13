/**
 * NeonSign — 페이지 최상단의 큰 네온사인 텍스트.
 * 어두운 배경 위에서 미하티 색(초록/청회) 네온이 번지고, 일부 글자가 살짝 깜빡인다.
 * CodePen 네온사인 예시 분위기를 미하티 톤으로 옮긴 것.
 */

function NeonSign({ line1 = 'MIHEARTI', line2 = 'MOVIE NIGHT' }) {
  return (
    <div className="mv-neon" aria-label={`${line1} ${line2}`}>
      <span className="mv-neon__line mv-neon__line--1">{line1}</span>
      <span className="mv-neon__line mv-neon__line--2">{line2}</span>
    </div>
  );
}

export default NeonSign;
