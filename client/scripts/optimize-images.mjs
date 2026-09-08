/**
 * optimize-images.mjs
 * Assets/Images 의 무거운 PNG/JPG 를 표시 크기에 맞게 리사이즈하고 WebP 로 변환한다.
 *
 * 왜 필요한가:
 *   프론트는 Netlify(CDN)에 정적 배포되므로 저장 위치가 아니라 "파일 용량"이 곧 렌더 속도다.
 *   원본 PNG 는 실제 표시 크기보다 4~5배 크게 들어와 있어 홈/스토리 진입 시 수 MB 를 받는다.
 *
 * 왜 새 라이브러리를 안 쓰는가:
 *   server 가 이미 의존하는 ffmpeg-static(libwebp 포함)을 그대로 빌린다.
 *   변환은 1회성 작업이고 결과 webp 는 레포에 커밋되므로 client 에 의존성을 추가할 이유가 없다.
 *
 * 사용법:
 *   node scripts/optimize-images.mjs          # 결과물이 없거나 원본이 더 새로우면 변환
 *   node scripts/optimize-images.mjs --force  # 무조건 다시 변환
 *
 * 원본(png/jpg)은 지우지 않는다. 참조만 webp 로 바꾸므로 되돌리기 쉽다.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMAGES = path.join(HERE, '..', 'src', 'Assets', 'Images');

/**
 * 변환 대상. maxWidth 는 원칙적으로 "실제 표시 폭 × 2(레티나)".
 * 표시 폭은 추정하지 말고 1920 뷰포트에서 img.clientWidth 를 재서 정한 값이다.
 * (주석의 "표시 NNN" 이 그 실측치)
 *
 * 예외:
 *   - img_background: background-size 100% auto 라 뷰포트 폭 그대로. 2x 를 적용하지 않는다.
 *   - img_J4Wphoto: 세부가 많은 사진이라 2x(2304px)면 676KB 가 나온다. 1600px 로 타협.
 *   - parchment: 낮은 opacity + blend 로 겹치는 질감이라 1200px 면 충분.
 */
const TARGETS = [
  // --- Home ---
  // .bg-100w 는 background-size: 100% auto 라 뷰포트 폭 그대로 쓴다. 줄이지 않는다.
  { src: 'img_background.png', maxWidth: 1920, quality: 80 },

  // --- World (.article 은 1920 뷰포트에서 1152px) ---
  { src: 'img_J4Wphoto.jpg', maxWidth: 1600, quality: 82 },   // 표시 1152 (2000px 원본은 676KB로 과했다)
  { src: 'img_monster.jpg', maxWidth: 800, quality: 82 },     // 표시 400
  { src: 'img_crow.jpg', maxWidth: 600, quality: 82 },        // 표시 300
  { src: 'img_zetta.png', maxWidth: 300, quality: 82 },       // 표시 150

  // --- Character ---
  // .appearance-figure 는 width 40% / min 500px, --content-max-width 1400 기준 최대 560px
  { src: 'img_migel_1.png', maxWidth: 1200, quality: 82 },
  { src: 'img_migel_2.png', maxWidth: 1200, quality: 82 },
  { src: 'img_matiam.png', maxWidth: 1200, quality: 82 },
  // 포트레이트는 허브 카드 250px / panel-header 100px / 스토리 말머리 26px 에만 쓴다
  { src: 'img_migel-portrait.png', maxWidth: 600, quality: 82 },
  { src: 'img_matiam-portrait.png', maxWidth: 600, quality: 82 },
  { src: 'img_J4Wseal.png', maxWidth: 916, quality: 82 },     // .stamp 576px, 원본이 이미 2x 미만
  { src: 'img_migel_weapon.png', maxWidth: 900, quality: 82 },
  { src: 'img_matiam_weapon.png', maxWidth: 770, quality: 82 },
  { src: 'img_J4W.png', maxWidth: 726, quality: 82 },

  // --- Story ---
  { src: 'img_front_cover.png', maxWidth: 1000, quality: 82 },
  { src: 'img_back_cover.png', maxWidth: 1000, quality: 82 },
  { src: 'parchment.jpg', maxWidth: 1200, quality: 78 },
  { src: 'story/agrem-fandango_matiam.png', maxWidth: 800, quality: 82 },
  { src: 'story/agrem-fandango_migel.png', maxWidth: 800, quality: 82 },
  { src: 'story/narrs-sewer_migel.png', maxWidth: 800, quality: 82 },
  { src: 'story/demon-realm_matiam.png', maxWidth: 800, quality: 82 },
  { src: 'story/demon-realm_migel.png', maxWidth: 800, quality: 82 },
  { src: 'story/dov-dola_migel.png', maxWidth: 800, quality: 82 },
  { src: 'story/anacsisaus_migel.png', maxWidth: 800, quality: 82 },
];

function resolveFfmpeg() {
  for (const id of ['ffmpeg-static', '../../server/node_modules/ffmpeg-static']) {
    try {
      const bin = require(id);
      if (bin && fs.existsSync(bin)) return bin;
    } catch {
      /* 다음 후보로 */
    }
  }
  throw new Error(
    'ffmpeg 바이너리를 찾지 못했습니다. server 폴더에서 `npm install` 을 먼저 실행하세요.'
  );
}

const kb = (p) => Math.round(fs.statSync(p).size / 1024);

function main() {
  const force = process.argv.includes('--force');
  const ffmpeg = resolveFfmpeg();
  let before = 0;
  let after = 0;

  for (const { src, maxWidth, quality } of TARGETS) {
    const input = path.join(IMAGES, src);
    const output = path.join(IMAGES, src.replace(/\.(png|jpe?g)$/i, '.webp'));

    if (!fs.existsSync(input)) {
      console.warn(`SKIP  ${src} — 원본 없음`);
      continue;
    }
    if (!force && fs.existsSync(output) && fs.statSync(output).mtimeMs >= fs.statSync(input).mtimeMs) {
      console.log(`KEEP  ${src} — 최신 결과물 존재`);
      continue;
    }

    // PNG 는 투명도가 있으므로 yuva420p(알파 보존), JPG 는 알파가 없어 yuv420p.
    // -pix_fmt 옵션만으로는 libwebp 가 알파를 떨어뜨려서 필터 체인 끝에서 직접 지정한다.
    const pixFmt = /\.png$/i.test(src) ? 'yuva420p' : 'yuv420p';
    execFileSync(ffmpeg, [
      '-y', '-loglevel', 'error',
      '-i', input,
      // 원본보다 키우지 않는다. -2 는 짝수 정렬(인코더 호환).
      '-vf', `scale='min(${maxWidth},iw)':-2:flags=lanczos,format=${pixFmt}`,
      '-c:v', 'libwebp',
      '-quality', String(quality),
      '-compression_level', '6',
      output,
    ]);

    before += kb(input);
    after += kb(output);
    console.log(`OK    ${src}  ${kb(input)}KB → ${kb(output)}KB`);
  }

  if (before) {
    console.log(`\n합계  ${before}KB → ${after}KB  (-${Math.round((1 - after / before) * 100)}%)`);
  }
}

main();
