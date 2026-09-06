// Generates the placeholder icon set (a "J" glyph on a rounded square) with zero dependencies.
// Re-run with `node scripts/make-icons.mjs` if the icons are ever lost; output is committed.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BG = [0x1f, 0x2a, 0x37, 0xff];
const FG = [0x7d, 0xd3, 0xa0, 0xff];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const px = (x, y) => {
    const r = size * 0.18;
    // rounded-square mask
    const cx = Math.min(x, size - 1 - x);
    const cy = Math.min(y, size - 1 - y);
    if (cx < r && cy < r && (r - cx) ** 2 + (r - cy) ** 2 > r * r) return [0, 0, 0, 0];
    // "J": vertical stem + bottom hook
    const stemX = size * 0.58;
    const w = Math.max(2, size * 0.12);
    const top = size * 0.22;
    const bot = size * 0.62;
    const inStem = x >= stemX - w / 2 && x <= stemX + w / 2 && y >= top && y <= bot;
    const hookR = size * 0.2;
    const hx = stemX - hookR;
    const hy = bot;
    const d = Math.hypot(x - hx, y - hy);
    const inHook = y >= bot && d <= hookR + w / 2 && d >= hookR - w / 2 && x <= stemX + w / 2;
    const inBar = y >= top - w && y <= top && x >= stemX - w * 1.6 && x <= stemX + w * 1.3;
    return inStem || inHook || inBar ? FG : BG;
  };
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = px(x + 0.5, y + 0.5);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [32, 48, 96]) {
  writeFileSync(new URL(`../icons/${size}.png`, import.meta.url), png(size));
  console.log(`icons/${size}.png`);
}
