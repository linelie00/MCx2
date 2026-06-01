/**
 * storyImages.js
 * 스토리 삽화 매핑. stories.js 의 image 자리(대사)에 실제 이미지를 연결한다.
 *
 * 키는 `${sessionId}_${speaker}` — 세션마다 화자별 삽화가 최대 1개라 유일하게 구분됨.
 * 새 삽화는 Assets/Images/story/ 에 같은 규칙으로 추가하고 여기에 한 줄 등록하면 된다.
 */
import agremMatiam from '../Assets/Images/story/agrem-fandango_matiam.png';
import agremMigel from '../Assets/Images/story/agrem-fandango_migel.png';
import narrsMigel from '../Assets/Images/story/narrs-sewer_migel.png';
import demonMatiam from '../Assets/Images/story/demon-realm_matiam.png';
import demonMigel from '../Assets/Images/story/demon-realm_migel.png';
import dovMigel from '../Assets/Images/story/dov-dola_migel.png';
import anacsisausMigel from '../Assets/Images/story/anacsisaus_migel.png';

export const storyImages = {
  'agrem-fandango_matiam': agremMatiam,
  'agrem-fandango_migel': agremMigel,
  'narrs-sewer_migel': narrsMigel,
  'demon-realm_matiam': demonMatiam,
  'demon-realm_migel': demonMigel,
  'dov-dola_migel': dovMigel,
  'anacsisaus_migel': anacsisausMigel,
};

// 세션 id + 화자로 삽화를 찾는다. 없으면 null.
export const getStoryImage = (sessionId, speaker) =>
  storyImages[`${sessionId}_${speaker}`] || null;

export default storyImages;
