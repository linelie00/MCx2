/**
 * 이미지 경로 관리
 * Assets 폴더의 이미지를 import 하여 번들 URL을 중앙집중식으로 제공합니다.
 *
 * CRA(webpack) 환경에서는 src/Assets의 이미지를 문자열 경로로 직접 쓸 수 없고,
 * import 해야 빌드 시 해시된 실제 URL로 변환됩니다.
 * 추후 이미지 교체/재구성 시 이 파일에서만 import 경로를 수정하면 됩니다.
 *
 * 주의: <img src>로 쓰는 래스터 이미지(webp/png/jpg)만 관리합니다.
 *       인라인으로 쓰는 SVG(ReactComponent)는 각 컴포넌트에서 직접 import 합니다.
 */

// ===== Characters =====
import migelPortrait from '../../Assets/Images/img_migel-portrait.webp';
import migelFull from '../../Assets/Images/img_migel_1.webp';
import migelWeapon from '../../Assets/Images/img_migel_weapon.webp';
import matiamPortrait from '../../Assets/Images/img_matiam-portrait.webp';
import matiamFull from '../../Assets/Images/img_matiam.webp';
import matiamWeapon from '../../Assets/Images/img_matiam_weapon.webp';

// ===== World =====
import worldMonster from '../../Assets/Images/img_monster.webp';
import worldZetta from '../../Assets/Images/img_zetta.webp';
import worldPhoto from '../../Assets/Images/img_J4Wphoto.webp';
import worldCrow from '../../Assets/Images/img_crow.webp';

// ===== Home =====
import homeCard from '../../Assets/Images/img_J4W.webp';
import homeSeal from '../../Assets/Images/img_J4Wseal.webp';
import homeBackground from '../../Assets/Images/img_background.webp';

export const images = {
  characters: {
    migel: {
      portrait: migelPortrait,
      full: migelFull,
      weapon: migelWeapon,
    },
    matiam: {
      portrait: matiamPortrait,
      full: matiamFull,
      weapon: matiamWeapon,
    },
  },
  world: {
    monster: worldMonster,
    zetta: worldZetta,
    photo: worldPhoto,
    crow: worldCrow,
  },
  home: {
    card: homeCard,
    seal: homeSeal,
    background: homeBackground,
  },
};

export default images;
