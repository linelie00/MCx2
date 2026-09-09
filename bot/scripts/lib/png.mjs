/**
 * png — 의존성 없는 최소 PNG 인코더
 *
 * 이모지 몇십 장 만들자고 이미지 라이브러리를 들이지 않으려고 직접 쓴다.
 * 압축은 노드 내장 zlib 이 해 주므로 우리가 할 일은 청크를 규격대로 쌓는 것뿐이다.
 *
 * 필터는 쓰지 않는다(스캔라인마다 0). 이모지 크기에서는 압축률 차이가 의미 없고,
 * 필터를 넣으면 이 파일이 몇 배로 길어진다.
 */
import zlib from 'node:zlib';

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

/** RGBA 바이트를 PNG 로. 정사각형이면 height 는 생략한다. */
export function toPng(rgba, width, height = width) {
  // 스캔라인마다 필터 바이트 0(필터 안 씀)을 앞에 붙인다. PNG 규격이 요구한다.
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      // 채널당 8비트
  ihdr[9] = 6;      // RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export default { toPng };
