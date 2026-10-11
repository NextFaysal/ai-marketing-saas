/**
 * Milestone 60 — PWA icon generator (no dependencies).
 *
 * There is no source logo artwork in the repo, so the icons are
 * drawn programmatically: the product's gradient rounded square
 * with a geometric "Q" (ring + tail) rendered into a pixel buffer
 * and encoded as PNG with node:zlib. Re-run with:
 *   node apps/web/scripts/generate-pwa-icons.mjs
 * Outputs into apps/web/public/icons/.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

// --- minimal PNG encoder (RGBA, filter 0) -------------------------
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- drawing -------------------------------------------------------
const FROM = [99, 102, 241];   // indigo-500
const VIA = [139, 92, 246];    // violet-500
const TO = [217, 70, 239];     // fuchsia-500
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const gradient = (t) => (t < 0.5 ? mix(FROM, VIA, t * 2) : mix(VIA, TO, (t - 0.5) * 2));

function draw(size, { bleed = false, scale = 1 } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const radius = bleed ? 0 : size * 0.22;
  const cx = size / 2, cy = size / 2;
  const ringR = size * 0.21 * scale, ringW = size * 0.075 * scale;
  // Q tail: thick segment from ring's lower-right outward.
  const tailA = [cx + ringR * 0.45, cy + ringR * 0.45];
  const tailB = [cx + ringR * 1.05, cy + ringR * 1.05];
  const tailW = ringW * 0.95;
  const segDist = (x, y) => {
    const dx = tailB[0] - tailA[0], dy = tailB[1] - tailA[1];
    const t = Math.max(0, Math.min(1, ((x - tailA[0]) * dx + (y - tailA[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (tailA[0] + t * dx), y - (tailA[1] + t * dy));
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // rounded-rect mask
      const rx = Math.max(Math.abs(x - cx) - (size / 2 - radius), 0);
      const ry = Math.max(Math.abs(y - cy) - (size / 2 - radius), 0);
      if (!bleed && Math.hypot(rx, ry) > radius) { px[i + 3] = 0; continue; }
      const [r, g, b] = gradient((x + y) / (2 * size));
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
      const dRing = Math.abs(Math.hypot(x - cx, y - cy) - ringR);
      if (dRing < ringW / 2 || segDist(x, y) < tailW / 2) {
        px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255;
      }
    }
  }
  return encodePng(size, px);
}

writeFileSync(join(outDir, "icon-192.png"), draw(192));
writeFileSync(join(outDir, "icon-512.png"), draw(512));
writeFileSync(join(outDir, "icon-maskable-512.png"), draw(512, { bleed: true, scale: 0.62 }));
writeFileSync(join(outDir, "apple-touch-icon.png"), draw(180, { bleed: true, scale: 0.8 }));
console.log("PWA icons written to", outDir);
