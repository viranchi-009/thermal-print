// Free-layout page model. Positions and sizes are printer dots (203 dpi):
// 384 wide for 58 mm paper, 576 wide for 80 mm. The page is drawn on a canvas and that
// same drawing is what gets thresholded and sent to the printer, so the preview matches.

const PAGE_WIDTH = { 58: 384, 80: 576 };

const FONT_FAMILY = {
  mono: "ui-monospace, Menlo, Consolas, 'Courier New', monospace",
  sans: "system-ui, Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
};

const BARCODE_FORMATS = [
  ['CODE128', 'CODE128'],
  ['CODE39', 'CODE39'],
  ['EAN13', 'EAN-13'],
  ['UPC', 'UPC-A'],
  ['ITF14', 'ITF-14'],
  ['MSI', 'MSI'],
  ['pharmacode', 'Pharmacode'],
  ['codabar', 'Codabar'],
];

const measureCtx = document.createElement('canvas').getContext('2d');
const imageCache = new Map();
const codeCache = new Map();

// The app replaces this so it can redraw when an image finishes loading.
let onAssetLoad = () => {};

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

function newElement(kind, x, y) {
  const base = { id: newId(), kind, x, y };
  switch (kind) {
    case 'text':
      return { ...base, w: 280, text: 'Text', font: 'mono', size: 28, bold: false, italic: false,
        align: 'left', spacing: 0, lineHeight: 1.2, inverse: false };
    case 'image':
      return { ...base, w: 200, h: 120, src: '', name: '', fit: 'contain' };
    case 'barcode':
      return { ...base, w: 320, h: 90, value: '123456789012', format: 'CODE128', showText: true };
    case 'qr':
      return { ...base, w: 140, h: 140, value: 'https://kraya.co', ec: 'M' };
    case 'shape':
      return { ...base, w: 300, h: 3, style: 'fill', stroke: 3 };
    default:
      throw new Error(`Unknown element kind: ${kind}`);
  }
}

function fontString(el) {
  return `${el.italic ? 'italic ' : ''}${el.bold ? 'bold ' : ''}${el.size}px ${FONT_FAMILY[el.font] ?? FONT_FAMILY.mono}`;
}

// Word-wraps text to the element width. Returns the lines and line height.
function layoutText(g, el) {
  g.font = fontString(el);
  g.letterSpacing = `${el.spacing || 0}px`;
  const lineH = el.size * el.lineHeight;
  const lines = [];
  for (const para of String(el.text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (line && g.measureText(test).width > el.w) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return { lines, lineH, height: Math.max(1, lines.length) * lineH };
}

// Bounding box used for layout, hit testing and page height.
function elementBox(el) {
  if (el.kind === 'text') {
    return { x: el.x, y: el.y, w: el.w, h: layoutText(measureCtx, el).height };
  }
  if (el.kind === 'qr') return { x: el.x, y: el.y, w: el.w, h: el.w };
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

function drawText(g, el) {
  const L = layoutText(g, el);
  if (el.inverse) {
    g.fillStyle = '#000';
    g.fillRect(el.x, el.y, el.w, L.height);
  }
  g.fillStyle = el.inverse ? '#fff' : '#000';
  g.font = fontString(el);
  g.letterSpacing = `${el.spacing || 0}px`;
  g.textBaseline = 'top';
  g.textAlign = 'left';
  const inset = (L.lineH - el.size) / 2;
  L.lines.forEach((line, i) => {
    const lw = g.measureText(line).width;
    const dx = el.align === 'center' ? (el.w - lw) / 2 : el.align === 'right' ? el.w - lw : 0;
    g.fillText(line, el.x + dx, el.y + i * L.lineH + inset);
  });
}

function drawImage(g, el) {
  const img = getImage(el.src);
  if (!img) {
    placeholder(g, el, el.src ? 'Loading image…' : 'Image');
    return;
  }
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  let dw = el.w;
  let dh = el.h;
  let dx = el.x;
  let dy = el.y;
  if (el.fit === 'contain' || el.fit === 'cover') {
    const k = el.fit === 'contain' ? Math.min(el.w / iw, el.h / ih) : Math.max(el.w / iw, el.h / ih);
    dw = iw * k;
    dh = ih * k;
    dx = el.x + (el.w - dw) / 2;
    dy = el.y + (el.h - dh) / 2;
  }
  g.save();
  g.beginPath();
  g.rect(el.x, el.y, el.w, el.h);
  g.clip();
  g.drawImage(img, dx, dy, dw, dh);
  g.restore();
}

function getImage(src) {
  if (!src) return null;
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => onAssetLoad();
    img.src = src;
    imageCache.set(src, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

// Renders the barcode at its box height. Returns null when the value is invalid for the format.
function barcodeCanvas(el) {
  const key = ['bc', el.value, el.format, el.showText, el.h].join('|');
  if (!codeCache.has(key)) {
    let canvas = null;
    if (window.JsBarcode && el.value) {
      try {
        canvas = document.createElement('canvas');
        JsBarcode(canvas, String(el.value), {
          format: el.format,
          width: 3,
          height: Math.max(20, el.h),
          displayValue: el.showText,
          margin: 0,
          fontSize: 18,
        });
      } catch (err) {
        canvas = null;
      }
    }
    codeCache.set(key, canvas);
  }
  return codeCache.get(key);
}

function drawBarcode(g, el) {
  const canvas = barcodeCanvas(el);
  if (!canvas) {
    placeholder(g, el, el.value ? 'Invalid barcode for this format' : 'Barcode');
    return;
  }
  g.drawImage(canvas, el.x, el.y, el.w, el.h);
}

// Builds the QR module grid with qrcode-generator. Returns null if it can't encode the value.
function qrGrid(value, ec) {
  const key = `qr|${value}|${ec}`;
  if (!codeCache.has(key)) {
    let grid = null;
    if (window.qrcode && value) {
      try {
        const qr = qrcode(0, ec);
        qr.addData(String(value));
        qr.make();
        const n = qr.getModuleCount();
        const cells = new Uint8Array(n * n);
        for (let r = 0; r < n; r++) {
          for (let c = 0; c < n; c++) cells[r * n + c] = qr.isDark(r, c) ? 1 : 0;
        }
        grid = { n, cells };
      } catch (err) {
        grid = null;
      }
    }
    codeCache.set(key, grid);
  }
  return codeCache.get(key);
}

function drawQr(g, el) {
  const grid = qrGrid(el.value, el.ec);
  if (!grid) {
    placeholder(g, el, el.value ? 'Value too long for QR' : 'QR');
    return;
  }
  const side = el.w;
  const m = side / grid.n;
  g.fillStyle = '#000';
  for (let r = 0; r < grid.n; r++) {
    for (let c = 0; c < grid.n; c++) {
      if (!grid.cells[r * grid.n + c]) continue;
      const x0 = Math.round(el.x + c * m);
      const x1 = Math.round(el.x + (c + 1) * m);
      const y0 = Math.round(el.y + r * m);
      const y1 = Math.round(el.y + (r + 1) * m);
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
}

function drawShape(g, el) {
  g.fillStyle = '#000';
  if (el.style === 'frame') {
    const s = Math.max(1, el.stroke);
    g.lineWidth = s;
    g.strokeStyle = '#000';
    g.strokeRect(el.x + s / 2, el.y + s / 2, el.w - s, el.h - s);
  } else {
    g.fillRect(el.x, el.y, el.w, el.h);
  }
}

function placeholder(g, el, label) {
  g.save();
  g.strokeStyle = '#888';
  g.lineWidth = 1;
  g.setLineDash([4, 4]);
  const box = elementBox(el);
  g.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
  g.fillStyle = '#666';
  g.font = `${Math.max(10, Math.min(18, box.h / 4))}px ${FONT_FAMILY.sans}`;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillText(label, box.x + box.w / 2, box.y + box.h / 2, box.w - 8);
  g.restore();
}

function drawElement(g, el) {
  switch (el.kind) {
    case 'text': return drawText(g, el);
    case 'image': return drawImage(g, el);
    case 'barcode': return drawBarcode(g, el);
    case 'qr': return drawQr(g, el);
    case 'shape': return drawShape(g, el);
  }
}

function pageWidth(doc) {
  return PAGE_WIDTH[doc.settings.paper] ?? PAGE_WIDTH[80];
}

function pageHeight(doc) {
  if (!doc.settings.autoHeight) return doc.settings.height;
  let bottom = 0;
  for (const el of doc.elements) {
    const box = elementBox(el);
    bottom = Math.max(bottom, box.y + box.h);
  }
  return Math.max(120, Math.ceil(bottom + 24));
}

// Draws the full page into `canvas` at print resolution.
function renderPage(doc, canvas) {
  const w = pageWidth(doc);
  const h = pageHeight(doc);
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  for (const el of doc.elements) drawElement(g, el);
  return { w, h };
}

// Thresholds or dithers the page to 1-bit, exactly as it will be printed.
function printBits(doc) {
  const canvas = document.createElement('canvas');
  const { w, h } = renderPage(doc, canvas);
  const { data } = canvas.getContext('2d').getImageData(0, 0, w, h);
  return toBitmap(data, w, h, {
    dither: !!doc.settings.dither,
    threshold: doc.settings.threshold,
    invert: false,
  });
}

// Draws the 1-bit result onto `canvas`, for the print preview.
function renderPrintPreview(doc, canvas) {
  const bits = printBits(doc);
  canvas.width = bits.width;
  canvas.height = bits.height;
  const g = canvas.getContext('2d');
  const img = g.createImageData(bits.width, bits.height);
  for (let y = 0; y < bits.height; y++) {
    for (let x = 0; x < bits.width; x++) {
      const on = (bits.data[y * bits.bytesPerRow + (x >> 3)] >> (7 - (x & 7))) & 1;
      const v = on ? 0 : 255;
      const k = (y * bits.width + x) * 4;
      img.data[k] = v;
      img.data[k + 1] = v;
      img.data[k + 2] = v;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}
