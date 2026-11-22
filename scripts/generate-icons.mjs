import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ICON_DIR = path.join(ROOT, 'assets', 'icons');
const STORE_DIR = path.join(ROOT, 'store-assets');

/* -------------------------------------------------------------------------- */
/* PNG Encoder (pure Node.js, RGBA 8-bit, zero external dependencies)         */
/* -------------------------------------------------------------------------- */

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([lenBuf, body, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 1; // Sub filter for better compression on smooth gradients
    const srcOff = y * width * 4;
    const dstOff = y * stride + 1;
    for (let i = 0; i < width * 4; i++) {
      const left = i >= 4 ? rgba[srcOff + i - 4] : 0;
      raw[dstOff + i] = (rgba[srcOff + i] - left) & 0xff;
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Signed Distance Field (SDF) & Compositing Helpers                          */
/* -------------------------------------------------------------------------- */

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixRgb(c1, c2, t) {
  const k = clamp(t, 0, 1);
  return [
    lerp(c1[0], c2[0], k),
    lerp(c1[1], c2[1], k),
    lerp(c1[2], c2[2], k),
  ];
}

function brandGradient(t) {
  const k = clamp(t, 0, 1);
  if (k < 0.52) {
    return mixRgb([255, 79, 100], [217, 70, 143], k / 0.52);
  }
  return mixRgb([217, 70, 143], [99, 102, 241], (k - 0.52) / 0.48);
}

/** Signed distance to rounded box centered at (cx, cy), half-extents (hx, hy), corner radius r */
function sdRoundedBox(px, py, cx, cy, hx, hy, r) {
  const dx = Math.abs(px - cx) - hx + r;
  const dy = Math.abs(py - cy) - hy + r;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

/** Signed distance to a line segment (ax, ay) -> (bx, by) */
function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay || 1), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}

/** Signed distance to a triangle (a, b, c) with optional corner rounding */
function sdTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const e0x = bx - ax, e0y = by - ay;
  const e1x = cx - bx, e1y = cy - by;
  const e2x = ax - cx, e2y = ay - cy;

  const v0x = px - ax, v0y = py - ay;
  const v1x = px - bx, v1y = py - by;
  const v2x = px - cx, v2y = py - cy;

  const pq0x = v0x - e0x * clamp((v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y), 0, 1);
  const pq0y = v0y - e0y * clamp((v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y), 0, 1);

  const pq1x = v1x - e1x * clamp((v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y), 0, 1);
  const pq1y = v1y - e1y * clamp((v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y), 0, 1);

  const pq2x = v2x - e2x * clamp((v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y), 0, 1);
  const pq2y = v2y - e2y * clamp((v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y), 0, 1);

  const s = Math.sign(e0x * e2y - e0y * e2x) || 1;
  const d0 = pq0x * pq0x + pq0y * pq0y;
  const d1 = pq1x * pq1x + pq1y * pq1y;
  const d2 = pq2x * pq2x + pq2y * pq2y;
  const minDist = Math.sqrt(Math.min(d0, d1, d2));

  const c0 = s * (v0x * e0y - v0y * e0x);
  const c1 = s * (v1x * e1y - v1y * e1x);
  const c2 = s * (v2x * e2y - v2y * e2x);
  const inside = c0 >= 0 && c1 >= 0 && c2 >= 0;

  return inside ? -minDist : minDist;
}

/** Alpha-blend [r, g, b, a (0..1)] onto existing pixel buffer at index */
function blendPixel(rgba, idx, r, g, b, a) {
  if (a <= 0) return;
  const alpha = clamp(a, 0, 1);
  if (alpha >= 0.999) {
    rgba[idx] = Math.round(clamp(r, 0, 255));
    rgba[idx + 1] = Math.round(clamp(g, 0, 255));
    rgba[idx + 2] = Math.round(clamp(b, 0, 255));
    rgba[idx + 3] = 255;
    return;
  }
  const dstA = rgba[idx + 3] / 255;
  const outA = alpha + dstA * (1 - alpha);
  if (outA <= 0) return;
  const invOutA = 1 / outA;
  rgba[idx] = Math.round(clamp((r * alpha + rgba[idx] * dstA * (1 - alpha)) * invOutA, 0, 255));
  rgba[idx + 1] = Math.round(clamp((g * alpha + rgba[idx + 1] * dstA * (1 - alpha)) * invOutA, 0, 255));
  rgba[idx + 2] = Math.round(clamp((b * alpha + rgba[idx + 2] * dstA * (1 - alpha)) * invOutA, 0, 255));
  rgba[idx + 3] = Math.round(clamp(outA * 255, 0, 255));
}

/** Smooth coverage from SDF distance in pixels */
function aaCoverage(distPx) {
  return clamp(0.5 - distPx, 0, 1);
}

/* -------------------------------------------------------------------------- */
/* TubeNook Emblem Sampler (normalized 0..1 coordinates matching logo.svg)    */
/* -------------------------------------------------------------------------- */

function sampleLogoAt(u, v) {
  // Coordinates normalized to 128x128 viewBox
  const px = u * 128;
  const py = v * 128;

  // Outer rounded-square badge: rect(6, 6, 116, 116, rx=28) -> center (64, 64), half (58, 58)
  const dOuter = sdRoundedBox(px, py, 64, 64, 58, 58, 28);
  if (dOuter > 1.5) return [0, 0, 0, 0];

  // Deep obsidian-indigo background gradient
  const bgT = clamp((px + py) / 256, 0, 1);
  let r = lerp(20, 30, bgT);
  let g = lerp(22, 27, bgT);
  let b = lerp(40, 58, bgT);

  // Subtle top-left sheen
  const sheenDist = Math.hypot((px - 36) / 84, (py - 26) / 84);
  const sheen = Math.max(0, 1 - sheenDist) * 0.14;
  r = lerp(r, 255, sheen);
  g = lerp(g, 255, sheen);
  b = lerp(b, 255, sheen);

  // Coral-to-indigo border ring: center (64,64), half (56,56), rx=26, stroke-width 4
  const dRing = Math.abs(sdRoundedBox(px, py, 64, 64, 56, 56, 26)) - 2.0;
  const brandT = clamp(((px - 16) + (py - 16)) / 192, 0, 1);
  const [br, bgC, bb] = brandGradient(brandT);

  if (dRing < 1.0) {
    const cov = aaCoverage(dRing) * 0.9;
    r = lerp(r, br, cov);
    g = lerp(g, bgC, cov);
    b = lerp(b, bb, cov);
  }

  // Cozy bookshelf / nook frame: rect(24, 26, 80, 66, rx=16) -> center (64, 59), half (40, 33)
  const dNook = sdRoundedBox(px, py, 64, 59, 40, 33, 16);
  if (dNook < 1.0) {
    const cov = aaCoverage(dNook);
    r = lerp(r, br, cov);
    g = lerp(g, bgC, cov);
    b = lerp(b, bb, cov);

    // Subtle book/collection spines inside left of nook
    const dSpine1 = sdRoundedBox(px, py, 37, 59, 4, 23, 4);
    if (dSpine1 < 1.0) {
      const sc1 = aaCoverage(dSpine1) * 0.28 * cov;
      r = lerp(r, 20, sc1);
      g = lerp(g, 22, sc1);
      b = lerp(b, 40, sc1);
    }

    const dSpine2 = sdRoundedBox(px, py, 48.5, 62, 3.5, 20, 3.5);
    if (dSpine2 < 1.0) {
      const sc2 = aaCoverage(dSpine2) * 0.22 * cov;
      r = lerp(r, 20, sc2);
      g = lerp(g, 22, sc2);
      b = lerp(b, 40, sc2);
    }

    // Crisp rounded white play triangle nestled inside nook
    const dPlay = sdTriangle(px, py, 64, 42.5, 64, 74.5, 91, 58.5) - 2.0;
    if (dPlay < 1.0) {
      const pc = aaCoverage(dPlay) * cov;
      r = lerp(r, 255, pc);
      g = lerp(g, 255, pc);
      b = lerp(b, 255, pc);
    }
  }

  // Cozy bottom bookshelf ledge: rect(24, 98, 80, 8, rx=4) -> center (64, 102), half (40, 4)
  const dLedge = sdRoundedBox(px, py, 64, 102, 40, 4, 4);
  if (dLedge < 1.0) {
    const cov = aaCoverage(dLedge) * 0.95;
    const [lr, lg, lb] = mixRgb([255, 122, 138], [129, 140, 248], clamp((px - 24) / 80, 0, 1));
    r = lerp(r, lr, cov);
    g = lerp(g, lg, cov);
    b = lerp(b, lb, cov);
  }

  const outerAlpha = aaCoverage(dOuter);
  return [r, g, b, outerAlpha];
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = size <= 48 ? 4 : 2;
  const invSamples = 1 / (samples * samples);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = (x + (sx + 0.5) / samples) / size;
          const v = (y + (sy + 0.5) / samples) / size;
          const [r, g, b, a] = sampleLogoAt(u, v);
          if (a > 0) {
            rSum += r * a;
            gSum += g * a;
            bSum += b * a;
            aSum += a;
          }
        }
      }

      const idx = (y * size + x) * 4;
      if (aSum > 0) {
        rgba[idx] = Math.round(clamp(rSum / aSum, 0, 255));
        rgba[idx + 1] = Math.round(clamp(gSum / aSum, 0, 255));
        rgba[idx + 2] = Math.round(clamp(bSum / aSum, 0, 255));
        rgba[idx + 3] = Math.round(clamp(aSum * invSamples * 255, 0, 255));
      }
    }
  }

  return encodePng(size, size, rgba);
}

/* -------------------------------------------------------------------------- */
/* Clean Geometric Vector Wordmark Renderer ("TubeNook")                      */
/* -------------------------------------------------------------------------- */

// Normalized glyph strokes in a 1x1 cell (x in [0, w], y in [0, 1], baseline at y=1)
const GLYPHS = {
  T: { w: 0.72, segs: [[0.04, 0.08, 0.68, 0.08], [0.36, 0.08, 0.36, 0.94]] },
  u: {
    w: 0.62,
    segs: [
      [0.10, 0.36, 0.10, 0.78],
      [0.10, 0.78, 0.22, 0.93],
      [0.22, 0.93, 0.42, 0.93],
      [0.42, 0.93, 0.52, 0.80],
      [0.52, 0.36, 0.52, 0.94],
    ],
  },
  b: {
    w: 0.64,
    segs: [
      [0.10, 0.06, 0.10, 0.94],
      [0.10, 0.48, 0.24, 0.36],
      [0.24, 0.36, 0.44, 0.36],
      [0.44, 0.36, 0.56, 0.50],
      [0.56, 0.50, 0.56, 0.80],
      [0.56, 0.80, 0.44, 0.94],
      [0.44, 0.94, 0.24, 0.94],
      [0.24, 0.94, 0.10, 0.82],
    ],
  },
  e: {
    w: 0.62,
    segs: [
      [0.10, 0.64, 0.54, 0.64],
      [0.54, 0.64, 0.54, 0.50],
      [0.54, 0.50, 0.42, 0.36],
      [0.42, 0.36, 0.22, 0.36],
      [0.22, 0.36, 0.10, 0.50],
      [0.10, 0.50, 0.10, 0.80],
      [0.10, 0.80, 0.22, 0.94],
      [0.22, 0.94, 0.48, 0.94],
    ],
  },
  N: {
    w: 0.76,
    segs: [
      [0.10, 0.94, 0.10, 0.08],
      [0.10, 0.08, 0.66, 0.94],
      [0.66, 0.94, 0.66, 0.08],
    ],
  },
  o: {
    w: 0.62,
    segs: [
      [0.22, 0.36, 0.42, 0.36],
      [0.42, 0.36, 0.54, 0.50],
      [0.54, 0.50, 0.54, 0.80],
      [0.54, 0.80, 0.42, 0.94],
      [0.42, 0.94, 0.22, 0.94],
      [0.22, 0.94, 0.10, 0.80],
      [0.10, 0.80, 0.10, 0.50],
      [0.10, 0.50, 0.22, 0.36],
    ],
  },
  k: {
    w: 0.60,
    segs: [
      [0.10, 0.06, 0.10, 0.94],
      [0.52, 0.36, 0.12, 0.68],
      [0.26, 0.58, 0.54, 0.94],
    ],
  },
};

function drawWordmark(rgba, width, height, text, startX, startY, glyphH, strokeRadius, colorFn) {
  const tracking = glyphH * 0.10;
  let cursorX = startX;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const g = GLYPHS[ch];
    if (!g) {
      cursorX += glyphH * 0.4;
      continue;
    }

    const x0 = Math.max(0, Math.floor(cursorX - strokeRadius - 2));
    const x1 = Math.min(width - 1, Math.ceil(cursorX + g.w * glyphH + strokeRadius + 2));
    const y0 = Math.max(0, Math.floor(startY - strokeRadius - 2));
    const y1 = Math.min(height - 1, Math.ceil(startY + glyphH + strokeRadius + 2));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let minD = 1e9;
        for (const [ax, ay, bx, by] of g.segs) {
          const d = sdSegment(
            x + 0.5,
            y + 0.5,
            cursorX + ax * glyphH,
            startY + ay * glyphH,
            cursorX + bx * glyphH,
            startY + by * glyphH
          );
          if (d < minD) minD = d;
        }
        const cov = aaCoverage(minD - strokeRadius);
        if (cov > 0) {
          const [r, gr, b] = colorFn(i, x, y);
          blendPixel(rgba, (y * width + x) * 4, r, gr, b, cov);
        }
      }
    }

    cursorX += g.w * glyphH + tracking;
  }
}

/* -------------------------------------------------------------------------- */
/* Drawing Primitives for Promo Tiles                                         */
/* -------------------------------------------------------------------------- */

function drawRoundedRect(rgba, width, height, cx, cy, hx, hy, r, color, alpha = 1, border = null) {
  const pad = 2;
  const x0 = Math.max(0, Math.floor(cx - hx - pad));
  const x1 = Math.min(width - 1, Math.ceil(cx + hx + pad));
  const y0 = Math.max(0, Math.floor(cy - hy - pad));
  const y1 = Math.min(height - 1, Math.ceil(cy + hy + pad));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = sdRoundedBox(x + 0.5, y + 0.5, cx, cy, hx, hy, r);
      const cov = aaCoverage(d);
      if (cov > 0) {
        const c = typeof color === 'function' ? color(x, y) : color;
        blendPixel(rgba, (y * width + x) * 4, c[0], c[1], c[2], cov * alpha);
      }
      if (border) {
        const bd = Math.abs(d) - border.width * 0.5;
        const bCov = aaCoverage(bd);
        if (bCov > 0) {
          const bc = typeof border.color === 'function' ? border.color(x, y) : border.color;
          blendPixel(rgba, (y * width + x) * 4, bc[0], bc[1], bc[2], bCov * (border.alpha ?? 1));
        }
      }
    }
  }
}

function drawEmblemOnCanvas(rgba, width, height, destX, destY, destSize) {
  const x0 = Math.max(0, Math.floor(destX));
  const x1 = Math.min(width - 1, Math.ceil(destX + destSize));
  const y0 = Math.max(0, Math.floor(destY));
  const y1 = Math.min(height - 1, Math.ceil(destY + destSize));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const u = (x + 0.5 - destX) / destSize;
      const v = (y + 0.5 - destY) / destSize;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const [r, g, b, a] = sampleLogoAt(u, v);
      if (a > 0) {
        blendPixel(rgba, (y * width + x) * 4, r, g, b, a);
      }
    }
  }
}

function fillPromoBackground(rgba, width, height, glow1, glow2) {
  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      // Base deep obsidian-indigo gradient
      let r = lerp(13, 24, nx * 0.6 + ny * 0.4);
      let g = lerp(15, 22, nx * 0.6 + ny * 0.4);
      let b = lerp(29, 52, nx * 0.6 + ny * 0.4);

      // Ambient coral radial glow
      const d1 = Math.hypot((nx - glow1.x) * (width / height), ny - glow1.y);
      const g1 = Math.exp(-d1 * d1 * glow1.falloff) * glow1.strength;
      r += 255 * g1;
      g += 79 * g1;
      b += 100 * g1;

      // Ambient indigo radial glow
      const d2 = Math.hypot((nx - glow2.x) * (width / height), ny - glow2.y);
      const g2 = Math.exp(-d2 * d2 * glow2.falloff) * glow2.strength;
      r += 99 * g2;
      g += 102 * g2;
      b += 241 * g2;

      // Subtle architectural dot grid
      const gx = x % 28;
      const gy = y % 28;
      if (gx === 14 && gy === 14) {
        r += 16;
        g += 18;
        b += 32;
      }

      const idx = (y * width + x) * 4;
      rgba[idx] = Math.round(clamp(r, 0, 255));
      rgba[idx + 1] = Math.round(clamp(g, 0, 255));
      rgba[idx + 2] = Math.round(clamp(b, 0, 255));
      rgba[idx + 3] = 255;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Chrome Web Store Small Promo Tile (440x280)                                */
/* -------------------------------------------------------------------------- */

function renderSmallPromoTile() {
  const W = 440;
  const H = 280;
  const rgba = Buffer.alloc(W * H * 4);

  fillPromoBackground(
    rgba,
    W,
    H,
    { x: 0.25, y: 0.35, falloff: 3.4, strength: 0.28 },
    { x: 0.80, y: 0.72, falloff: 3.0, strength: 0.32 }
  );

  // Subtle decorative card frame behind hero composition
  drawRoundedRect(rgba, W, H, W * 0.5, H * 0.5, 196, 114, 22, [22, 25, 46], 0.55, {
    width: 1.5,
    color: [129, 140, 248],
    alpha: 0.22,
  });

  // TubeNook emblem (centered top-left)
  drawEmblemOnCanvas(rgba, W, H, 54, 72, 102);

  // Geometric "TubeNook" wordmark
  drawWordmark(rgba, W, H, 'TubeNook', 176, 98, 36, 2.7, (idx) =>
    idx < 4 ? [255, 255, 255] : [255, 110, 128]
  );

  // Clean brand accent bar + feature indicator pills
  drawRoundedRect(
    rgba,
    W,
    H,
    244,
    152,
    68,
    3,
    3,
    (x) => brandGradient((x - 176) / 136),
    0.95
  );

  // 3 sleek mini feature pills (Folders, Deck, Courses)
  const pills = [
    { cx: 206, hx: 30, col: [255, 79, 100] },
    { cx: 274, hx: 30, col: [139, 92, 246] },
    { cx: 342, hx: 30, col: [56, 189, 248] },
  ];
  for (const p of pills) {
    drawRoundedRect(rgba, W, H, p.cx, 180, p.hx, 11, 11, [30, 34, 62], 0.9, {
      width: 1.2,
      color: p.col,
      alpha: 0.6,
    });
    drawRoundedRect(rgba, W, H, p.cx - 14, 180, 5, 5, 5, p.col, 0.95);
    drawRoundedRect(rgba, W, H, p.cx + 7, 180, 11, 2.5, 2.5, [226, 232, 240], 0.7);
  }

  return encodePng(W, H, rgba);
}

/* -------------------------------------------------------------------------- */
/* Chrome Web Store Marquee Promo Tile (1400x560)                             */
/* -------------------------------------------------------------------------- */

function renderMarqueePromoTile() {
  const W = 1400;
  const H = 560;
  const rgba = Buffer.alloc(W * H * 4);

  fillPromoBackground(
    rgba,
    W,
    H,
    { x: 0.18, y: 0.42, falloff: 2.2, strength: 0.30 },
    { x: 0.78, y: 0.58, falloff: 1.8, strength: 0.34 }
  );

  // Left hero column: Emblem + Wordmark + Accent divider + Feature pills
  drawEmblemOnCanvas(rgba, W, H, 96, 172, 168);

  drawWordmark(rgba, W, H, 'TubeNook', 298, 198, 68, 5.0, (idx) =>
    idx < 4 ? [255, 255, 255] : [255, 110, 128]
  );

  // Vibrant brand gradient bar
  drawRoundedRect(
    rgba,
    W,
    H,
    438,
    294,
    140,
    5,
    5,
    (x) => brandGradient((x - 298) / 280),
    0.95
  );

  // 4 sleek feature pills below bar
  const heroPills = [
    { cx: 356, hx: 56, col: [255, 79, 100] },
    { cx: 484, hx: 56, col: [139, 92, 246] },
    { cx: 612, hx: 56, col: [56, 189, 248] },
    { cx: 356, cy: 386, hx: 76, col: [52, 211, 153] },
    { cx: 526, cy: 386, hx: 76, col: [251, 191, 36] },
  ];
  for (const p of heroPills) {
    const cy = p.cy || 338;
    drawRoundedRect(rgba, W, H, p.cx, cy, p.hx, 15, 15, [28, 32, 58], 0.9, {
      width: 1.5,
      color: p.col,
      alpha: 0.55,
    });
    drawRoundedRect(rgba, W, H, p.cx - p.hx + 18, cy, 6, 6, 6, p.col, 0.95);
    drawRoundedRect(rgba, W, H, p.cx + 8, cy, p.hx - 24, 3.5, 3.5, [226, 232, 240], 0.65);
  }

  // Right side: Stylized TubeNook Deck & Courses Glassmorphic UI Showcase
  // Main app frame
  drawRoundedRect(rgba, W, H, 1030, 280, 294, 214, 26, [20, 23, 42], 0.88, {
    width: 2,
    color: [129, 140, 248],
    alpha: 0.30,
  });

  // Top toolbar bar inside mockup
  drawRoundedRect(rgba, W, H, 1030, 96, 274, 18, 12, [30, 34, 62], 0.92);
  // Window traffic-light accent dots
  drawRoundedRect(rgba, W, H, 780, 96, 5, 5, 5, [255, 79, 100], 0.9);
  drawRoundedRect(rgba, W, H, 798, 96, 5, 5, 5, [251, 191, 36], 0.9);
  drawRoundedRect(rgba, W, H, 816, 96, 5, 5, 5, [52, 211, 153], 0.9);
  // Search bar pill in toolbar
  drawRoundedRect(rgba, W, H, 1030, 96, 96, 9, 9, [18, 21, 38], 0.9);
  // Sync badge on right of toolbar
  drawRoundedRect(rgba, W, H, 1258, 96, 30, 9, 9, [99, 102, 241], 0.85);

  // 3 Deck Columns (Subscriptions / Courses / Watch Queue)
  const cols = [
    { cx: 846, accent: [255, 79, 100], progress: 0.78 },
    { cx: 1030, accent: [139, 92, 246], progress: 0.56 },
    { cx: 1214, accent: [52, 211, 153], progress: 0.90 },
  ];

  for (const col of cols) {
    // Column shell
    drawRoundedRect(rgba, W, H, col.cx, 304, 82, 168, 16, [26, 30, 54], 0.92, {
      width: 1.2,
      color: col.accent,
      alpha: 0.25,
    });

    // Column header bar
    drawRoundedRect(rgba, W, H, col.cx, 158, 68, 12, 8, col.accent, 0.22);
    drawRoundedRect(rgba, W, H, col.cx - 48, 158, 6, 6, 6, col.accent, 0.95);
    drawRoundedRect(rgba, W, H, col.cx + 6, 158, 38, 3.5, 3.5, [241, 245, 249], 0.85);

    // 3 video/course cards per column
    for (let row = 0; row < 3; row++) {
      const cardCy = 224 + row * 94;
      drawRoundedRect(rgba, W, H, col.cx, cardCy, 68, 38, 10, [34, 39, 68], 0.95);

      // Thumbnail rectangle with play accent
      drawRoundedRect(
        rgba,
        W,
        H,
        col.cx - 32,
        cardCy - 6,
        28,
        18,
        6,
        row === 0 ? col.accent : [48, 55, 92],
        row === 0 ? 0.85 : 0.95
      );

      // Title lines
      drawRoundedRect(rgba, W, H, col.cx + 28, cardCy - 12, 26, 3.5, 3.5, [226, 232, 240], 0.8);
      drawRoundedRect(rgba, W, H, col.cx + 20, cardCy, 18, 3, 3, [148, 163, 184], 0.6);

      // Course / watch progress bar at bottom of card
      drawRoundedRect(rgba, W, H, col.cx, cardCy + 24, 56, 3, 3, [18, 21, 38], 0.9);
      const fillW = Math.max(10, Math.round(56 * clamp(col.progress - row * 0.18, 0.25, 1)));
      drawRoundedRect(rgba, W, H, col.cx - 56 + fillW, cardCy + 24, fillW, 3, 3, col.accent, 0.95);
    }
  }

  return encodePng(W, H, rgba);
}

/* -------------------------------------------------------------------------- */
/* Public Entry Point                                                         */
/* -------------------------------------------------------------------------- */

export function generateAllIcons() {
  fs.mkdirSync(ICON_DIR, { recursive: true });
  fs.mkdirSync(STORE_DIR, { recursive: true });

  const generated = [];
  const sizes = [16, 32, 48, 128];
  let icon128Buf = null;

  for (const size of sizes) {
    const png = renderIcon(size);
    const outPath = path.join(ICON_DIR, `icon${size}.png`);
    fs.writeFileSync(outPath, png);
    generated.push(outPath);
    if (size === 128) icon128Buf = png;
  }

  // Chrome Web Store 128x128 icon
  const storeIconPath = path.join(STORE_DIR, 'icon-128.png');
  fs.writeFileSync(storeIconPath, icon128Buf);
  generated.push(storeIconPath);

  // Chrome Web Store Small Promo Tile (440x280)
  const smallPromoPath = path.join(STORE_DIR, 'promo-small-440x280.png');
  fs.writeFileSync(smallPromoPath, renderSmallPromoTile());
  generated.push(smallPromoPath);

  // Chrome Web Store Marquee Promo Tile (1400x560)
  const marqueePromoPath = path.join(STORE_DIR, 'promo-marquee-1400x560.png');
  fs.writeFileSync(marqueePromoPath, renderMarqueePromoTile());
  generated.push(marqueePromoPath);

  return generated;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = generateAllIcons();
  for (const file of files) {
    const stat = fs.statSync(file);
    console.log(`Generated ${path.relative(ROOT, file)} (${(stat.size / 1024).toFixed(1)} KB)`);
  }
}
