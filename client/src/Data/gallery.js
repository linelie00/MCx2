/**
 * gallery.js — 갤러리 목(mock) 데이터
 *
 * UI 개발 단계용 시드 데이터. 추후 Express API(/api/gallery/*)로 대체된다.
 * 실제 저장소 전환 시 이 파일 대신 서버 응답을 쓰게 되며, 데이터 형태(shape)는 동일하게 유지한다.
 *
 * Media { id, type, url, poster?, width, height, tags[], createdAt }
 *   - type: 'image' | 'video'  (생략 시 'image'. gif도 'image'로 둔다)
 *   - poster: 영상 전용. 그리드에 보여줄 첫 프레임 썸네일
 *   - width/height: 원본 픽셀. 메이슨리가 로드 전에 카드 자리를 잡아 레이아웃 밀림을 방지한다.
 *   - tags: tag.id 배열 (이미지당 최대 10개)
 * Tag   { id(slug), label }
 */
import { images } from './constants/images';
import { storyImages } from './storyImages';

// 태그 정의 (노션식으로 런타임 추가 가능 — 여기는 초기 시드)
export const mockTags = [
  { id: 'migel', label: '미겔' },
  { id: 'matiam', label: '마티암' },
  { id: 'mihearti', label: '미하티' },
  { id: 'battle', label: '전투' },
  { id: 'daily', label: '일상' },
  { id: 'world', label: '세계관' },
];

// 시드 이미지 — 번들된 기존 이미지를 재사용해 화면이 바로 보이게 한다.
export const mockImages = [
  { id: 'g01', url: images.characters.migel.full,    width: 1200, height: 1600, tags: ['migel'] },
  { id: 'g02', url: images.characters.matiam.full,   width: 1200, height: 1500, tags: ['matiam'] },
  { id: 'g03', url: images.characters.migel.portrait, width: 1000, height: 1000, tags: ['migel', 'daily'] },
  { id: 'g04', url: images.characters.matiam.portrait, width: 1000, height: 1000, tags: ['matiam', 'daily'] },
  { id: 'g05', url: storyImages['dov-dola_migel'],   width: 1748, height: 2480, tags: ['migel', 'battle'] },
  { id: 'g06', url: storyImages['demon-realm_matiam'], width: 1748, height: 2480, tags: ['matiam', 'battle'] },
  { id: 'g07', url: storyImages['agrem-fandango_migel'], width: 1748, height: 2480, tags: ['migel', 'world'] },
  { id: 'g08', url: storyImages['anacsisaus_migel'],  width: 1748, height: 2480, tags: ['migel', 'world'] },
  { id: 'g09', url: images.world.crow,               width: 1600, height: 1066, tags: ['world'] },
  { id: 'g10', url: images.world.monster,            width: 1600, height: 1066, tags: ['world', 'battle'] },
  { id: 'g11', url: images.world.zetta,              width: 1200, height: 1500, tags: ['world'] },
  { id: 'g12', url: images.world.photo,              width: 1600, height: 1066, tags: ['mihearti', 'daily'] },
  { id: 'g13', url: storyImages['narrs-sewer_migel'], width: 1748, height: 2480, tags: ['migel'] },
  { id: 'g14', url: storyImages['agrem-fandango_matiam'], width: 1748, height: 2480, tags: ['matiam', 'world'] },
  { id: 'g15', url: images.home.card,                width: 1200, height: 1600, tags: ['mihearti'] },
  { id: 'g16', url: images.characters.migel.full,    width: 1200, height: 1600, tags: ['migel', 'mihearti'] },
  // 영상 목(mock) — 실제 mp4가 없어 poster=url로 두었다. 임포트 시 poster는 첫 프레임으로 대체된다.
  { id: 'g17', type: 'video', url: images.world.monster, poster: images.world.monster, width: 1600, height: 1066, tags: ['world', 'battle'] },
];

const galleryData = { mockTags, mockImages };
export default galleryData;
