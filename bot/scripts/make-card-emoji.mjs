/**
 * make-card-emoji — 카드 52장 + 뒷면을 그려서 **앱 이모지로 올린다**
 *
 * 서버 이모지는 무료 50칸이라 52장이 안 들어가지만, **앱 이모지는 앱당 2000개**이고
 * 서버 슬롯을 안 먹으며 USE_EXTERNAL_EMOJIS 권한도 필요 없다. 그래서 카드는 앱 쪽에 둔다.
 *
 * 손으로 53장을 끌어다 넣게 하지 않는다 — 그려서 API 로 바로 올린다.
 *
 * 디자인은 **작게 보일 때 읽히는 것**이 전부다. 판(임베드) 안에서는 이모지가 글자
 * 크기로 나오기 때문이다. 그래서 진짜 카드처럼 그리지 않고 키캡처럼 만든다.
 *
 *   · 타일 전체를 무늬 색으로 칠하고 랭크를 크림색으로 크게 얹는다
 *   · 무늬는 **네 가지 색**으로 나눈다(포커의 four-color deck): ♠ 검정 ♥ 빨강 ♦ 파랑 ♣ 초록.
 *     빨강/검정 두 가지로는 작을 때 ♥♦ 과 ♠♣ 가 구분이 안 된다.
 *   · 무늬 기호는 확인용으로 구석에 작게만 넣는다
 *
 * 글꼴을 안 쓰고 5x7 비트맵으로 직접 찍는다. 이모지 하나 만들자고 글꼴 파일을 들이는
 * 것도, 렌더링 라이브러리를 붙이는 것도 과하다. 의존성은 zlib(노드 내장) 하나뿐이다.
 *
 * 사용법:
 *   node bot/scripts/make-card-emoji.mjs            그려서 앱 이모지로 올린다
 *   node bot/scripts/make-card-emoji.mjs --dry <폴더>  올리지 않고 파일로만 뽑는다
 *   node bot/scripts/make-card-emoji.mjs --force     이미 있는 것도 지우고 다시 올린다
 *   node bot/scripts/make-card-emoji.mjs --sheet a.png  올리기 전에 한 장으로 모아 본다
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import 'dotenv/config';
import { SUITS, RANKS, emojiName, BACK_NAME } from '../src/casino/cards.js';

const SIZE = 128;
const SS = 4;                      // 4배로 그린 뒤 줄여 계단을 없앤다
const W = SIZE * SS;

/** 네 가지 색 덱. 작게 보일 때 무늬를 색으로 구분한다. */
const SUIT_COLOR = {
  s: [0x2f, 0x32, 0x38],           // 스페이드 — 검정
  h: [0xb0, 0x39, 0x2f],           // 하트 — 빨강
  d: [0x2f, 0x5a, 0xa8],           // 다이아 — 파랑
  c: [0x3f, 0x7a, 0x4a],           // 클럽 — 초록
};
const INK = [0xf4, 0xec, 0xdc];    // 랭크와 무늬 기호 (크림)
const BACK = [0x8a, 0x7a, 0x5c];   // 뒷면 — 사이트 테마색

// ---------------------------------------------------------------- 5x7 비트맵 글꼴

const GLYPH = {
  A: ['..#..', '.#.#.', '#...#', '#####', '#...#', '#...#', '#...#'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  4: ['#...#', '#...#', '#...#', '#####', '....#', '....#', '....#'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '..#..', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  // Q 의 꼬리가 작아지면 O 와 헷갈려서 오른쪽 아래로 확실히 뺐다
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
};

/** 무늬 기호. 구석에 작게 들어가므로 7x7 이면 충분하다. */
const PIP = {
  s: ['...#...', '..###..', '.#####.', '#######', '#######', '...#...', '..###..'],
  h: ['.##.##.', '#######', '#######', '#######', '.#####.', '..###..', '...#...'],
  d: ['...#...', '..###..', '.#####.', '#######', '.#####.', '..###..', '...#...'],
  c: ['...#...', '..###..', '#.###.#', '#######', '.#####.', '...#...', '..###..'],
};

/** 카드에 적을 글자. 10 만 두 글자다. */
const rankChars = (rank) => ({ a: 'A', t: '10', j: 'J', q: 'Q', k: 'K' }[rank] ?? rank);

// ---------------------------------------------------------------- 그리기

const px = () => new Uint8Array(W * W * 4);

function put(buf, x, y, color) {
  if (x < 0 || y < 0 || x >= W || y >= W) return;
  const i = (y * W + x) * 4;
  buf[i] = color[0]; buf[i + 1] = color[1]; buf[i + 2] = color[2]; buf[i + 3] = 255;
}

/** 비트맵 한 장을 (x,y) 에 scale 배로 찍는다. */
function stamp(buf, rows, x0, y0, scale, color) {
  rows.forEach((row, ry) => {
    [...row].forEach((ch, rx) => {
      if (ch !== '#') return;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          put(buf, x0 + rx * scale + dx, y0 + ry * scale + dy, color);
        }
      }
    });
  });
}

/** 모서리가 둥근 사각형 안쪽인지. 음수면 안. */
function roundRect(x, y, left, top, right, bottom, r) {
  const cx = Math.min(Math.max(x, left + r), right - r);
  const cy = Math.min(Math.max(y, top + r), bottom - r);
  return Math.hypot(x - cx, y - cy) - r;
}

function drawCard(rank, suit) {
  const buf = px();
  const m = W * 0.05;
  const r = W * 0.16;
  const face = SUIT_COLOR[suit];

  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (roundRect(x + 0.5, y + 0.5, m, m, W - m, W - m, r) <= 0) put(buf, x, y, face);
    }
  }

  // 랭크 — 타일을 최대한 채운다. 작아졌을 때 이게 거의 유일하게 읽히는 부분이다.
  //
  // **가로만 보고 크기를 정하면 안 된다.** 처음에 그렇게 했다가 글자가 세로로 캔버스를
  // 넘어가 A·3·4 의 아랫부분이 잘렸다. 가로·세로 둘 다 맞춰 작은 쪽을 쓴다.
  const chars = [...rankChars(rank)];
  const glyphW = 5 * chars.length + (chars.length - 1);       // 글자 사이 한 칸
  const scale = Math.max(1, Math.min(
    Math.floor((W * 0.72) / glyphW),
    Math.floor((W * 0.60) / 7),
  ));

  const totalW = glyphW * scale;
  let x = Math.round((W - totalW) / 2);
  const y = Math.round((W - 7 * scale) / 2 - W * 0.03);       // 살짝 위로
  for (const ch of chars) {
    stamp(buf, GLYPH[ch], x, y, scale, INK);
    x += 6 * scale;
  }

  // 무늬 기호 — 색만으로는 적록색약이 하트와 클럽을 구분 못 하므로 확인용으로 남긴다.
  // 랭크를 키우려고 구석으로 뺐다.
  const pipScale = Math.max(1, Math.floor((W * 0.17) / 7));
  stamp(buf, PIP[suit],
    Math.round(W - W * 0.11 - 7 * pipScale), Math.round(W - W * 0.11 - 7 * pipScale),
    pipScale, INK);

  return buf;
}

function drawBack() {
  const buf = px();
  const m = W * 0.05;
  const r = W * 0.16;

  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (roundRect(x + 0.5, y + 0.5, m, m, W - m, W - m, r) > 0) continue;
      // 비스듬한 줄무늬. 뒷면이라는 게 한눈에 보이면 된다.
      const stripe = Math.floor((x + y) / (W * 0.06)) % 2 === 0;
      put(buf, x, y, stripe ? BACK : [0x6d, 0x5f, 0x47]);
    }
  }
  return buf;
}

/** 4배로 그린 것을 평균 내어 줄인다. */
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
      const k = sum[3] > 0 ? 255 / sum[3] : 0;
      out[o] = Math.round(sum[0] * k);
      out[o + 1] = Math.round(sum[1] * k);
      out[o + 2] = Math.round(sum[2] * k);
      out[o + 3] = Math.round(sum[3] / n);
    }
  }
  return out;
}

// ---------------------------------------------------------------- PNG

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function toPng(rgba) {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (SIZE * 4 + 1)] = 0;
    rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 만들기

function everyCard() {
  const out = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const rgba = downsample(drawCard(rank, suit));
      out.push({ name: emojiName({ rank, suit }), rgba, png: toPng(rgba) });
    }
  }
  const back = downsample(drawBack());
  out.push({ name: BACK_NAME, rgba: back, png: toPng(back) });
  return out;
}

/**
 * 올리기 전에 눈으로 보려고 한 장에 모은다.
 *
 * 위쪽은 원본 크기(128), 아래쪽은 **24px** — 디스코드가 임베드 안에서 그리는 크기다.
 * 이 디자인의 성패는 아래 줄에서 갈린다.
 */
function contactSheet(cards, cols) {
  const SMALL = 24;
  const rows = Math.ceil(cards.length / cols);
  const sheetW = cols * SIZE;
  const sheetH = rows * SIZE + SMALL + 8;
  const out = Buffer.alloc(sheetW * sheetH * 4);

  const blit = (rgba, srcSize, dx, dy, dstSize) => {
    for (let y = 0; y < dstSize; y += 1) {
      for (let x = 0; x < dstSize; x += 1) {
        const sx = Math.floor((x * srcSize) / dstSize);
        const sy = Math.floor((y * srcSize) / dstSize);
        const si = (sy * srcSize + sx) * 4;
        const di = ((dy + y) * sheetW + (dx + x)) * 4;
        out[di] = rgba[si]; out[di + 1] = rgba[si + 1];
        out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3];
      }
    }
  };

  cards.forEach((c, i) => {
    blit(c.rgba, SIZE, (i % cols) * SIZE, Math.floor(i / cols) * SIZE, SIZE);
  });
  // 아래 줄 — 실제로 보이는 크기
  cards.slice(0, Math.floor(sheetW / SMALL)).forEach((c, i) => {
    blit(c.rgba, SIZE, i * SMALL, rows * SIZE + 8, SMALL);
  });

  const raw = Buffer.alloc((sheetW * 4 + 1) * sheetH);
  for (let y = 0; y < sheetH; y += 1) {
    raw[y * (sheetW * 4 + 1)] = 0;
    out.copy(raw, y * (sheetW * 4 + 1) + 1, y * sheetW * 4, (y + 1) * sheetW * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(sheetW, 0);
  ihdr.writeUInt32BE(sheetH, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 올리기

const API = 'https://discord.com/api/v10';

async function api(pathname, init = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function upload(cards, force) {
  const app = await api('/applications/@me');
  const existing = (await api(`/applications/${app.id}/emojis`)).items ?? [];
  const byName = new Map(existing.map((e) => [e.name, e]));
  console.log(`앱 이모지 ${existing.length}/2000 개가 이미 있습니다.\n`);

  let made = 0;
  let skipped = 0;
  for (const card of cards) {
    const old = byName.get(card.name);
    if (old && !force) { skipped += 1; continue; }
    if (old) await api(`/applications/${app.id}/emojis/${old.id}`, { method: 'DELETE' });

    await api(`/applications/${app.id}/emojis`, {
      method: 'POST',
      body: JSON.stringify({
        name: card.name,
        image: `data:image/png;base64,${card.png.toString('base64')}`,
      }),
    });
    made += 1;
    process.stdout.write(`\r  올리는 중 ${made}/${cards.length - skipped}  (${card.name})   `);
    // 이모지 생성은 레이트리밋이 빡빡하다. 천천히 간다.
    await new Promise((r) => { setTimeout(r, 350); });
  }
  console.log(`\n\n올림 ${made}개${skipped ? ` · 이미 있어서 건너뜀 ${skipped}개` : ''}.`);
  if (skipped) console.log('다시 올리려면 --force 를 붙이세요.');
  console.log('봇을 재시작하면 부팅할 때 찾아서 씁니다.');
}

// ---------------------------------------------------------------- 실행

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const force = args.includes('--force');
const cards = everyCard();
const bytes = cards.reduce((a, c) => a + c.png.length, 0);

console.log(`카드 ${cards.length}장을 그렸습니다 (합계 ${(bytes / 1024).toFixed(0)}KB).`);
const tooBig = cards.filter((c) => c.png.length > 256 * 1024);
if (tooBig.length) {
  console.error(`256KB 를 넘는 그림이 ${tooBig.length}개 있습니다. 디스코드가 거절합니다.`);
  process.exit(1);
}

if (args.includes('--sheet')) {
  const file = args[args.indexOf('--sheet') + 1] || 'cards.png';
  fs.writeFileSync(file, contactSheet(cards, RANKS.length));
  console.log(`${file} 에 모아 두었습니다. (올리지 않았습니다)`);
  console.log('아래 작은 줄이 디스코드 임베드에서 보이는 실제 크기입니다.');
} else if (dry) {
  const outDir = args[args.indexOf('--dry') + 1] || path.join(process.cwd(), 'card-emoji');
  fs.mkdirSync(outDir, { recursive: true });
  for (const c of cards) fs.writeFileSync(path.join(outDir, `${c.name}.png`), c.png);
  console.log(`${outDir} 에 저장했습니다. (올리지 않았습니다)`);
} else {
  await upload(cards, force);
}
