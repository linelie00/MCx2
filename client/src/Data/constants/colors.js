/**
 * 색상 관리
 * 캐릭터별 고유 색상과 테마 색상을 중앙집중식으로 관리합니다.
 */

export const characterColors = {
  migel: {
    primary: '#768461',
  },
  matiam: {
    primary: '#737b7f',
  },
};

export const themeColors = {
  background: '#F7F5ED',
  text: '#333333',
  textLight: '#d9d9cd',
  border: '#000000',
  section385B44: '#385B44',
  white: '#ffffff',
};

// 재생목록 강조색(accent) 선택지 — 비슷한 명도의 차분한 색들
export const playlistAccents = [
  { id: 'green', label: '초록', hex: '#768461' },
  { id: 'blue', label: '청회색', hex: '#737b7f' },
  { id: 'gray', label: '회색', hex: '#7c7a76' },
  { id: 'red', label: '붉은색', hex: '#9c5b52' },
  { id: 'brown', label: '갈색', hex: '#8a6b4a' },
  { id: 'gold', label: '황토색', hex: '#9a8654' },
  { id: 'teal', label: '청록', hex: '#5f8076' },
  { id: 'purple', label: '보라색', hex: '#786a8c' },
];

// id → hex. 기존 캐릭터 accent 값(migel/matiam)도 같은 색으로 매핑해 하위호환.
export const playlistAccentHex = playlistAccents.reduce((m, c) => Object.assign(m, { [c.id]: c.hex }), {
  migel: '#768461',
  matiam: '#737b7f',
});

const colors = {
  characterColors,
  themeColors,
};

export default colors;
