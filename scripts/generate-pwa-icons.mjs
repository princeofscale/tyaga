// Генерирует PNG-иконки PWA (180 apple-touch-icon, 192, 512, 512 maskable с safe-zone)
// из той же геометрии штанги, что и public/favicon.svg, без внешних зависимостей.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BG = [0xc8, 0xf3, 0x6b, 0xff]; // #c8f36b
const FG = [0x17, 0x20, 0x18, 0xff]; // #172018

// CRC32 table for PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function insideRoundedRect(x, y, rx, ry, rw, rh, rad) {
  if (x < rx || x > rx + rw || y < ry || y > ry + rh) return false;
  const cx = x < rx + rad ? rx + rad : x > rx + rw - rad ? rx + rw - rad : x;
  const cy = y < ry + rad ? ry + rad : y > ry + rh - rad ? ry + rh - rad : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= rad * rad;
}

// Barbell rectangles from public/favicon.svg (viewBox 0 0 48 48)
const BARBELL = [
  [7, 14, 7, 20, 2],
  [34, 14, 7, 20, 2],
  [14, 21, 20, 6, 0],
  [3, 19, 4, 10, 1],
  [41, 19, 4, 10, 1],
];

function renderIcon(size, { maskable = false, opaque = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  // Maskable icons require >=20% outer safe zone (barbell scaled into central 72%).
  const scale = maskable ? 0.72 : 1;
  const offset = (1 - scale) * 24;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const idx = (py * size + px) * 4;
      const vx = ((px + 0.5) / size) * 48;
      const vy = ((py + 0.5) / size) * 48;
      const inBg = opaque || maskable ? true : insideRoundedRect(vx, vy, 0, 0, 48, 48, 12);
      if (!inBg) continue;
      const bx = (vx - offset) / scale;
      const by = (vy - offset) / scale;
      const inFg = BARBELL.some(([x, y, w, h, r]) => insideRoundedRect(bx, by, x, y, w, h, r));
      const color = inFg ? FG : BG;
      rgba[idx] = color[0];
      rgba[idx + 1] = color[1];
      rgba[idx + 2] = color[2];
      rgba[idx + 3] = color[3];
    }
  }
  return encodePng(size, size, rgba);
}

const outDir = resolve("public");
writeFileSync(resolve(outDir, "apple-touch-icon.png"), renderIcon(180, { opaque: true }));
writeFileSync(resolve(outDir, "icon-192.png"), renderIcon(192));
writeFileSync(resolve(outDir, "icon-512.png"), renderIcon(512));
writeFileSync(resolve(outDir, "icon-512-maskable.png"), renderIcon(512, { maskable: true, opaque: true }));
console.log("Generated PWA PNG icons in public/");
