// Gera os ícones PNG do jogo (sem dependências): rosto de primata em fundo verde.
// Uso: node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 < r * r;
function face(x, y) {
  const BG = [50, 92, 45, 255], FUR = [139, 90, 43, 255], SKIN = [242, 210, 176, 255], W = [255, 255, 255, 255], K = [20, 20, 20, 255];
  if (inCircle(x, y, 0.5, 0.36, 0.06) || inCircle(x, y, 0.62, 0.36, 0.06)) {
    if (inCircle(x, y, 0.5, 0.37, 0.03) || inCircle(x, y, 0.62, 0.37, 0.03)) return K;
    return W;
  }
  if (inCircle(x, y, 0.56, 0.5, 0.17) && y > 0.42) {
    if (y > 0.56 && y < 0.585 && x > 0.47 && x < 0.65) return K; // boca
    return SKIN;
  }
  if (inCircle(x, y, 0.22, 0.42, 0.09) || inCircle(x, y, 0.88, 0.42, 0.09)) return SKIN;
  if (inCircle(x, y, 0.55, 0.45, 0.3)) return FUR;
  return BG;
}
const out = path.join(__dirname, '..', 'web', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const s of [192, 512]) fs.writeFileSync(path.join(out, `icon-${s}.png`), png(s, face));
fs.mkdirSync(path.join(__dirname, '..', 'desktop', 'build'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'desktop', 'build', 'icon.png'), png(512, face));
console.log('ícones gerados');
