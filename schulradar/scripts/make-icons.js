'use strict';
// Erzeugt die App-Symbole (PNG) ohne externe Bibliotheken.
// Aufruf: npm run icons
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// Signed-Distance-Funktionen im 32er-Koordinatensystem
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function sdCircle(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r;
}
function sdSegment(x, y, ax, ay, bx, by, r) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const t = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * t, pay - bay * t) - r;
}

const lerp = (a, b, t) => a + (b - a) * t;

function shade(x, y, simple, symbolOnly = false) {
  if (symbolOnly) {
    // nur die weißen Radar-Linien (für das adaptive Android-Symbol und die Benachrichtigung)
    let a = 0;
    const add = (alpha) => (a = Math.max(a, alpha));
    if (Math.abs(sdCircle(x, y, 16, 16, 9.5)) - 1.3 <= 0) add(0.6);
    if (Math.abs(sdCircle(x, y, 16, 16, 5)) - 1.2 <= 0) add(0.8);
    if (sdSegment(x, y, 16, 16, 24.5, 9.5, 1.6) <= 0) add(1);
    if (sdCircle(x, y, 21.5, 20.5, 2.4) <= 0) add(1);
    return a ? [255, 255, 255, Math.round(a * 255)] : [0, 0, 0, 0];
  }
  // Hintergrund: abgerundetes Quadrat mit Farbverlauf
  const inBg = sdRoundRect(x, y, 16, 16, 15, 15, 8) <= 0;
  if (!inBg) return [0, 0, 0, 0];
  const t = Math.max(0, Math.min(1, (x + y) / 64));
  let r = lerp(0x4c, 0x15, t);
  let g = lerp(0x6e, 0xaa, t);
  let b = lerp(0xf5, 0xbf, t);
  const over = (alpha) => {
    r = lerp(r, 255, alpha);
    g = lerp(g, 255, alpha);
    b = lerp(b, 255, alpha);
  };
  const ringOuter = Math.abs(sdCircle(x, y, 16, 16, 9.5)) - (simple ? 1.3 : 0.8);
  if (ringOuter <= 0) over(simple ? 0.6 : 0.45);
  const ringInner = Math.abs(sdCircle(x, y, 16, 16, 5)) - (simple ? 1.2 : 0.8);
  if (ringInner <= 0) over(0.7);
  if (sdSegment(x, y, 16, 16, 24.5, 9.5, simple ? 1.6 : 1.1) <= 0) over(1);
  if (sdCircle(x, y, 21.5, 20.5, simple ? 2.4 : 1.9) <= 0) over(1);
  if (!simple && sdCircle(x, y, 11, 11.5, 1.4) <= 0) over(0.8);
  return [r, g, b, 255];
}

function render(size, { simple = false, symbolOnly = false, scale = 1 } = {}) {
  const ss = 4;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          // scale < 1: Motiv kleiner in der Mitte (Rand bleibt durchsichtig)
          const x = 16 + (((px + (sx + 0.5) / ss) / size) * 32 - 16) / scale;
          const y = 16 + (((py + (sy + 0.5) / ss) / size) * 32 - 16) / scale;
          const c = x < 0 || y < 0 || x > 32 || y > 32 ? [0, 0, 0, 0] : shade(x, y, simple, symbolOnly);
          const al = c[3] / 255;
          r += c[0] * al;
          g += c[1] * al;
          b += c[2] * al;
          a += al;
        }
      }
      const i = (py * size + px) * 4;
      const n = ss * ss;
      out[i] = a ? Math.round(r / a) : 0;
      out[i + 1] = a ? Math.round(g / a) : 0;
      out[i + 2] = a ? Math.round(b / a) : 0;
      out[i + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePng(size, out);
}

module.exports = { render };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), render(512));
  fs.writeFileSync(path.join(root, 'assets', 'icon.png'), render(256));
  fs.writeFileSync(path.join(root, 'assets', 'tray.png'), render(16, { simple: true }));
  fs.writeFileSync(path.join(root, 'assets', 'tray@2x.png'), render(32, { simple: true }));
  console.log('Symbole erzeugt: build/icon.png, assets/icon.png, assets/tray.png, assets/tray@2x.png');

  // Android-App (mobile/)
  const res = path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'res');
  if (fs.existsSync(res)) {
    const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
    for (const [name, f] of Object.entries(densities)) {
      const dir = path.join(res, `mipmap-${name}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'ic_launcher.png'), render(Math.round(48 * f), { scale: 0.92 }));
      fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), render(Math.round(48 * f), { scale: 0.92 }));
      // adaptives Symbol: 108dp, Motiv im sicheren Bereich (ca. 60 %)
      fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), render(Math.round(108 * f), { symbolOnly: true, scale: 0.62 }));
      const nd = path.join(res, `drawable-${name}`);
      fs.mkdirSync(nd, { recursive: true });
      fs.writeFileSync(path.join(nd, 'ic_stat_schulradar.png'), render(Math.round(24 * f), { symbolOnly: true, scale: 1.1 }));
    }
    fs.mkdirSync(path.join(res, 'drawable-nodpi'), { recursive: true });
    fs.writeFileSync(path.join(res, 'drawable-nodpi', 'splash_icon.png'), render(288));
    console.log('Android-Symbole erzeugt.');
  }
}
