// Minimal ESC/POS builder. The page is sent as one 1-bit raster image (GS v 0),
// so layout, fonts, images, barcodes and QR codes all look the same on screen and on paper.

const ESC = 0x1b;
const GS = 0x1d;

class EscPos {
  constructor() {
    this.bytes = [];
  }

  raw(...values) {
    for (const v of values) this.bytes.push(v);
    return this;
  }

  init() {
    return this.raw(ESC, 0x40);
  }

  // Feeds `lines` blank lines.
  feed(lines) {
    return this.raw(ESC, 0x64, Math.min(255, Math.max(0, Math.round(lines))));
  }

  // mode: 'full' or 'partial'. Feeds `feed` lines, then cuts.
  cut(mode, feed) {
    const n = Math.min(255, Math.max(0, Math.round(feed)));
    return this.raw(GS, 0x56, mode === 'full' ? 65 : 66, n);
  }

  // r: { bytesPerRow, height, data }, with 1 bits as black dots.
  raster(r) {
    const w = r.bytesPerRow;
    const h = r.height;
    this.raw(GS, 0x76, 0x30, 0, w & 0xff, (w >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff);
    for (const v of r.data) this.bytes.push(v);
    return this;
  }

  build() {
    return Uint8Array.from(this.bytes);
  }
}

// Converts RGBA pixels into 1-bit rows (1 = black), thresholded or Floyd-Steinberg dithered.
function toBitmap(rgba, width, height, { dither, threshold, invert }) {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const k = i * 4;
    const lum = 0.299 * rgba[k] + 0.587 * rgba[k + 1] + 0.114 * rgba[k + 2];
    gray[i] = invert ? 255 - lum : lum;
  }

  const bytesPerRow = (width + 7) >> 3;
  const out = new Uint8Array(bytesPerRow * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = gray[i];
      const black = old < threshold;
      const nv = black ? 0 : 255;
      if (black) out[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);

      if (dither) {
        const err = old - nv;
        if (x + 1 < width) gray[i + 1] += (err * 7) / 16;
        if (y + 1 < height) {
          if (x > 0) gray[i + width - 1] += (err * 3) / 16;
          gray[i + width] += (err * 5) / 16;
          if (x + 1 < width) gray[i + width + 1] += err / 16;
        }
      }
    }
  }

  return { width, bytesPerRow, height, data: out };
}
