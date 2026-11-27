import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function png(width, height, pixelAt) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      const o = rowStart + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const ORANGE = [255, 112, 0];
const WHITE = [255, 255, 255];

function inRoundedRect(x, y, x1, y1, x2, y2, r) {
  if (x < x1 || x > x2 || y < y1 || y > y2) return false;
  const dx = Math.max(x1 + r - x, 0, x - (x2 - r));
  const dy = Math.max(y1 + r - y, 0, y - (y2 - r));
  return dx * dx + dy * dy <= r * r;
}

function inTriangle(x, y, ax, ay, bx, by, cx, cy) {
  const s = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const t = (cx - bx) * (y - by) - (cy - by) * (x - bx);
  const u = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
  return (s >= 0 && t >= 0 && u >= 0) || (s <= 0 && t <= 0 && u <= 0);
}

function iconPixel(scale) {
  const size = 512;
  return (x, y) => {
    const m = 16 * scale;
    const cornerR = 100 * scale;
    const nx = x / scale, ny = y / scale;
    if (!inRoundedRect(nx, ny, m, m, size / scale - m, size / scale - m, cornerR / scale)) {
      return [0, 0, 0, 0];
    }
    const bx1 = 110 * scale, by1 = 128 * scale, bx2 = 402 * scale, by2 = 330 * scale, br = 56 * scale;
    const bubble =
      inRoundedRect(nx, ny, bx1, by1, bx2, by2, br) ||
      inTriangle(nx, ny, 150 * scale, 320 * scale, 235 * scale, 320 * scale, 160 * scale, 395 * scale);
    if (bubble) return [...WHITE, 255];
    const dots = [
      [176, 229], [256, 229], [336, 229],
    ];
    for (const [dx, dy] of dots) {
      const ddx = nx - dx * scale, ddy = ny - dy * scale;
      if (ddx * ddx + ddy * ddy <= 22 * 22 * scale * scale) return [...ORANGE, 255];
    }
    return [...ORANGE, 255];
  };
}

mkdirSync("public/icons", { recursive: true });
for (const size of [192, 512]) {
  const scale = size / 512;
  writeFileSync(`public/icons/icon-${size}.png`, png(size, size, iconPixel(scale)));
  writeFileSync(`public/icons/maskable-${size}.png`, png(size, size, iconPixel(scale)));
}
console.log("Icônes générées : public/icons/icon-{192,512}.png + maskable-{192,512}.png");
