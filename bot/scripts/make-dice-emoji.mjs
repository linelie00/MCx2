/**
 * make-dice-emoji — 주사위 이모지를 그려서 **앱 이모지로 올린다**
 *
 * 키캡 숫자(1️⃣~6️⃣)로도 게임은 돌아가지만, 남긴 주사위를 **색으로** 구분하려면
 * 커스텀 이모지가 필요하다. 이모지는 이미지라 굵게·색 같은 마크다운이 안 먹기 때문이다.
 *
 *   dice1 ~ dice6    보통 주사위 (양피지색)
 *   dice1k ~ dice6k  남긴 주사위 (초록) — "이건 쥐고 간다" 는 뜻
 *
 * 처음에는 서버 이모지에 손으로 올렸는데, 그러면 무료 50칸 중 12칸을 태운다. 카드를
 * 앱 이모지로 옮기면서 주사위도 같이 옮긴다 — 앱당 2000개라 슬롯 걱정이 없고, 어느
 * 서버에서나 쓸 수 있다. 부팅할 때 앱 쪽을 먼저 보므로(index.js) 서버에 남아 있는
 * 옛 주사위는 그냥 무시된다. 지우고 슬롯을 돌려받아도 되고 그냥 둬도 된다.
 *
 * 의존성을 하나도 안 쓴다. PNG 는 zlib(노드 내장)로 직접 만든다 — 이모지 12장 만들자고
 * 이미지 라이브러리를 들이는 건 과하다.
 *
 * 사용법:
 *   node bot/scripts/make-dice-emoji.mjs             그려서 앱 이모지로 올린다
 *   node bot/scripts/make-dice-emoji.mjs --dry <폴더>  올리지 않고 파일로만 뽑는다
 *   node bot/scripts/make-dice-emoji.mjs --force      이미 있는 것도 지우고 다시 올린다
 */
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { toPng } from './lib/png.mjs';
import { upload } from './lib/appEmoji.mjs';

const SIZE = 128;        // 디스코드 이모지 표시 크기
const SS = 4;            // 계단 현상을 없애려고 4배로 그린 뒤 줄인다
const W = SIZE * SS;

// 사이트 톤에 맞춘 색. 양피지 바탕에 짙은 갈색 눈.
const THEMES = {
  '': { face: [0xed, 0xe0, 0xc8], pip: [0x3a, 0x30, 0x26], edge: [0x9c, 0x8a, 0x6d] },
  k: { face: [0x76, 0x84, 0x61], pip: [0x1e, 0x24, 0x18], edge: [0x4d, 0x59, 0x3d] },
};

/** 각 눈의 점 위치. 0~1 로 정규화해 두고 그릴 때 크기를 곱한다. */
const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.28, 0.26], [0.72, 0.26], [0.28, 0.5], [0.72, 0.5], [0.28, 0.74], [0.72, 0.74]],
};

/** 모서리가 둥근 사각형 안쪽인지. 테두리 두께를 재려고 거리도 같이 돌려준다. */
function roundRect(x, y, left, top, right, bottom, r) {
  const cx = Math.min(Math.max(x, left + r), right - r);
  const cy = Math.min(Math.max(y, top + r), bottom - r);
  return Math.hypot(x - cx, y - cy) - r;    // 음수면 안쪽
}

function drawDie(face, theme) {
  const px = new Uint8Array(W * W * 4);
  const m = W * 0.06;                 // 바깥 여백
  const r = W * 0.18;                 // 모서리 반지름
  const edge = W * 0.035;             // 테두리 두께
  const pipR = W * 0.085;

  const pips = PIPS[face].map(([fx, fy]) => [m + fx * (W - 2 * m), m + fy * (W - 2 * m)]);

  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const d = roundRect(x + 0.5, y + 0.5, m, m, W - m, W - m, r);
      if (d > 0) continue;                            // 주사위 밖

      let color = d > -edge ? theme.edge : theme.face;
      for (const [px0, py0] of pips) {
        if (Math.hypot(x + 0.5 - px0, y + 0.5 - py0) < pipR) { color = theme.pip; break; }
      }

      const i = (y * W + x) * 4;
      px[i] = color[0]; px[i + 1] = color[1]; px[i + 2] = color[2]; px[i + 3] = 255;
    }
  }
  return px;
}

/** 4배로 그린 것을 평균 내어 줄인다. 이게 계단 현상을 없애는 전부다. */
function downsample(src) {
  const out = Buffer.alloc(SIZE * SIZE * 4);
  const n = SS * SS;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const sum = [0, 0, 0, 0];
      for (let dy = 0; dy < SS; dy += 1) {
        for (let dx = 0; dx < SS; dx += 1) {
          const i = ((y * SS + dy) * W + (x * SS + dx)) * 4;
          const a = src[i + 3] / 255;
          sum[0] += src[i] * a; sum[1] += src[i + 1] * a; sum[2] += src[i + 2] * a;
          sum[3] += src[i + 3];
        }
      }
      const o = (y * SIZE + x) * 4;
      // 투명한 쪽 색과 섞여 테두리가 탁해지지 않게, 알파로 나눠 되돌린다.
      const k = sum[3] > 0 ? 255 / sum[3] : 0;
      out[o] = Math.round(sum[0] * k);
      out[o + 1] = Math.round(sum[1] * k);
      out[o + 2] = Math.round(sum[2] * k);
      out[o + 3] = Math.round(sum[3] / n);
    }
  }
  return out;
}

// ---------------------------------------------------------------- 실행

/** dice1~6 과 dice1k~6k, 열두 장. */
function everyDie() {
  const out = [];
  for (const [suffix, theme] of Object.entries(THEMES)) {
    for (let face = 1; face <= 6; face += 1) {
      out.push({
        name: `dice${face}${suffix}`,
        png: toPng(downsample(drawDie(face, theme)), SIZE),
      });
    }
  }
  return out;
}

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const force = args.includes('--force');
const dice = everyDie();
const bytes = dice.reduce((a, d) => a + d.png.length, 0);

console.log(`주사위 ${dice.length}장을 그렸습니다 (합계 ${(bytes / 1024).toFixed(0)}KB).`);
console.log('  dice1~dice6   보통 주사위');
console.log('  dice1k~dice6k 남긴 주사위 (초록)\n');

if (dry) {
  const outDir = args[args.indexOf('--dry') + 1] || path.join(process.cwd(), 'dice-emoji');
  fs.mkdirSync(outDir, { recursive: true });
  for (const d of dice) fs.writeFileSync(path.join(outDir, `${d.name}.png`), d.png);
  console.log(`${outDir} 에 저장했습니다. (올리지 않았습니다)`);
} else {
  await upload(dice, { force, what: '주사위' });
}
