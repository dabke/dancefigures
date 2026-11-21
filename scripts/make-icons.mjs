// Generates the PWA icons (192, 512 and a maskable 512) as PNGs using only
// Node built-ins: a neon "dancing figure" rendered with signed-distance shading.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = 'public/icons';
mkdirSync(OUT, { recursive: true });

// Figure in unit coordinates (0..1), arms up, one knee raised.
const J = {
  head: [0.5, 0.2],
  neck: [0.5, 0.31],
  hip: [0.5, 0.56],
  lh: [0.26, 0.1], le: [0.33, 0.3],
  rh: [0.78, 0.16], re: [0.68, 0.33],
  lk: [0.37, 0.7], lf: [0.32, 0.9],
  rk: [0.66, 0.66], rf: [0.62, 0.86],
};
const SEG = [
  ['neck', 'hip'], ['neck', 'le'], ['le', 'lh'], ['neck', 're'], ['re', 'rh'],
  ['hip', 'lk'], ['lk', 'lf'], ['hip', 'rk'], ['rk', 'rf'],
];

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function render(size, scale) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Map pixel to figure space, scaled around the center (for maskable safe zone).
      const u = ((x + 0.5) / size - 0.5) / scale + 0.5;
      const v = ((y + 0.5) / size - 0.5) / scale + 0.5;
      let d = Math.abs(Math.hypot(u - J.head[0], v - J.head[1]) - 0.075);
      for (const [a, b] of SEG) d = Math.min(d, segDist(u, v, J[a], J[b]));
      const lw = 0.028;
      const core = d < lw * 0.45 ? 1 : 0;
      const glow = Math.exp(-Math.max(0, d - lw * 0.45) / 0.035);
      // Background: deep purple -> navy vertical gradient.
      const g = y / size;
      let r = 22 + 10 * (1 - g), gg = 8, b = 48 + 20 * g;
      // Magenta/cyan glow blend + white core.
      r += glow * 255 * 0.9; gg += glow * 80; b += glow * 255;
      if (core) { r = 255; gg = 245; b = 255; }
      const i = (y * size + x) * 4;
      px[i] = Math.min(255, r); px[i + 1] = Math.min(255, gg); px[i + 2] = Math.min(255, b); px[i + 3] = 255;
    }
  }
  return encodePng(size, size, px);
}

// --- minimal PNG encoder ---
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const files = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['maskable-512.png', 512, 0.72], // keep figure inside the maskable safe zone
  ['apple-touch-icon.png', 180, 0.9],
];
let made = 0;
for (const [name, size, scale] of files) {
  const path = `${OUT}/${name}`;
  if (existsSync(path)) continue; // icons are deterministic; generate once
  writeFileSync(path, render(size, scale));
  made++;
}
console.log(`[make-icons] ${made ? `generated ${made} icon(s)` : 'icons up to date'}`);
