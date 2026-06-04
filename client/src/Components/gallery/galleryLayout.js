/**
 * galleryLayout — 메이슨리 카드 비율 정책 (그리드/카드 공용)
 *
 * 아주 긴 이미지(예: 세로로 긴 만화 한 컷)는 카드가 한 컬럼만 길게 만들어
 * 옆 컬럼에 빈 공간을 남긴다. 그래서 카드(썸네일)의 최대 세로비를 제한한다.
 * 상한을 넘는 이미지는 썸네일에서만 잘리고(object-fit: cover), 원본 비율은 모달에서 본다.
 */
export const MAX_CARD_RATIO = 2; // 카드 세로/가로 최대치 (2 = 가로의 2배 높이까지)

export const cardRatio = (img) => {
  const r = img && img.width ? img.height / img.width : 1;
  return Math.min(r || 1, MAX_CARD_RATIO);
};
