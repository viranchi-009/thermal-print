// Design studio UI: the page canvas with draggable elements, layers, an inspector,
// page settings, and a print preview that shows the exact 1-bit output.

const printer = new ThermalPrinter();
const DRAFT_KEY = 'autoPrinter.design.v3';

const f = (key, label, kind, extra = {}) => ({ key, label, kind, ...extra });

const DEFAULT_SETTINGS = {
  paper: 58,
  copies: 1,
  cut: 'partial',
  dither: true,
  threshold: 128,
  autoHeight: true,
  height: 600,
};

const PAGE_FIELDS = [
  f('paper', 'Paper width', 'select', { num: true, options: [[58, '58 mm'], [80, '80 mm']] }),
  f('copies', 'Copies', 'number', { min: 1, max: 10 }),
  f('cut', 'Cut after print', 'select', {
    options: [['partial', 'Partial'], ['full', 'Full'], ['none', 'No cut']],
  }),
  f('autoHeight', 'Fit height to content', 'checkbox'),
  f('height', 'Page height (dots)', 'number', { min: 60, max: 5000 }),
  f('dither', 'Dithering (smooth shades)', 'checkbox'),
  f('threshold', 'Threshold (0–255, lower = lighter)', 'number', { min: 0, max: 255 }),
];

const KIND_LABEL = { text: 'Text', image: 'Image', barcode: 'Barcode', qr: 'QR code', shape: 'Shape' };
const ALIGN_OPTIONS = [['left', 'Left'], ['center', 'Center'], ['right', 'Right']];
const FONT_OPTIONS = [['mono', 'Monospace'], ['sans', 'Sans-serif'], ['serif', 'Serif']];

function elementFields(item) {
  const geo = [
    f('x', 'X', 'number', { min: -5000, max: 5000 }),
    f('y', 'Y', 'number', { min: -5000, max: 5000 }),
    f('w', item.kind === 'qr' ? 'Size' : 'Width', 'number', { min: 4, max: 5000 }),
  ];
  if (item.kind === 'image' || item.kind === 'barcode' || item.kind === 'shape') {
    geo.push(f('h', 'Height', 'number', { min: 4, max: 5000 }));
  }

  switch (item.kind) {
    case 'text':
      return [
        ...geo,
        f('text', 'Text', 'textarea'),
        f('font', 'Font', 'select', { options: FONT_OPTIONS }),
        f('size', 'Font size (dots)', 'number', { min: 8, max: 300 }),
        f('bold', 'Bold', 'checkbox'),
        f('italic', 'Italic', 'checkbox'),
        f('align', 'Alignment', 'select', { options: ALIGN_OPTIONS }),
        f('spacing', 'Letter spacing (dots)', 'number', { min: -5, max: 60 }),
        f('lineHeight', 'Line height (×)', 'number', { min: 0.8, max: 3, step: 0.1 }),
        f('inverse', 'White on black', 'checkbox'),
      ];
    case 'image':
      return [
        ...geo,
        f('file', 'Image file', 'file'),
        f('fit', 'Fit', 'select', { options: [['contain', 'Contain'], ['cover', 'Cover'], ['stretch', 'Stretch']] }),
      ];
    case 'barcode':
      return [
        ...geo,
        f('value', 'Value', 'text'),
        f('format', 'Format', 'select', { options: BARCODE_FORMATS }),
        f('showText', 'Show text under bars', 'checkbox'),
      ];
    case 'qr':
      return [
        ...geo,
        f('value', 'Value', 'textarea'),
        f('ec', 'Error correction', 'select', {
          options: [['L', 'L (7%)'], ['M', 'M (15%)'], ['Q', 'Q (25%)'], ['H', 'H (30%)']],
        }),
      ];
    case 'shape':
      return [
        ...geo,
        f('style', 'Style', 'select', { options: [['fill', 'Filled'], ['frame', 'Outline']] }),
        f('stroke', 'Outline thickness', 'number', { min: 1, max: 50 }),
      ];
  }
  return geo;
}

// ---------- state ----------

function normalize(obj) {
  const settings = { ...DEFAULT_SETTINGS, ...(obj?.settings ?? {}) };
  const elements = (Array.isArray(obj?.elements) ? obj.elements : [])
    .filter((e) => e && KIND_LABEL[e.kind])
    .map((e) => ({ ...newElement(e.kind, 0, 0), ...e }));
  return { settings, elements };
}

function starterDoc() {
  const text = (over) => ({ ...newElement('text', 0, 0), ...over });
  const rule = (y) => ({ ...newElement('shape', 16, y), w: 352, h: 3, style: 'fill' });
  return normalize({
    settings: { paper: 58 },
    elements: [
      text({ x: 0, y: 16, w: 384, text: 'KRAYA CAFÉ', size: 36, bold: true, align: 'center' }),
      text({ x: 0, y: 66, w: 384, text: '123 Main St · Tel 555-0100', size: 16, align: 'center' }),
      rule(98),
      text({ x: 16, y: 114, w: 200, text: 'Flat white', size: 20 }),
      text({ x: 200, y: 114, w: 168, text: '4.50', size: 20, align: 'right' }),
      text({ x: 16, y: 146, w: 200, text: 'Croissant', size: 20 }),
      text({ x: 200, y: 146, w: 168, text: '3.25', size: 20, align: 'right' }),
      rule(186),
      text({ x: 16, y: 200, w: 200, text: 'TOTAL', size: 28, bold: true }),
      text({ x: 200, y: 200, w: 168, text: '7.75', size: 28, bold: true, align: 'right' }),
      { ...newElement('barcode', 40, 250), w: 304, h: 70, value: 'KRAYA-0001' },
      { ...newElement('qr', 128, 340), w: 128, value: 'https://kraya.co' },
    ],
  });
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (err) {
    console.warn('Draft not loaded:', err);
  }
  return starterDoc();
}

let doc = loadDraft();
let selectedId = null;
let mode = 'design';
let scale = 1;
let frame = 0;

function findElement(id) {
  return doc.elements.find((e) => e.id === id) || null;
}

// ---------- DOM helpers ----------

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

const ui = {
  status: document.getElementById('status'),
  connect: document.getElementById('connect'),
  disconnect: document.getElementById('disconnect'),
  print: document.getElementById('print'),
  exportJson: document.getElementById('export-json'),
  importBtn: document.getElementById('import-btn'),
  importJson: document.getElementById('import-json'),
  viewDesign: document.getElementById('view-design'),
  viewPrint: document.getElementById('view-print'),
  desk: document.getElementById('desk'),
  stage: document.getElementById('stage'),
  page: document.getElementById('page'),
  overlay: document.getElementById('overlay'),
  pageInfo: document.getElementById('page-info'),
  layers: document.getElementById('layers'),
  inspector: document.getElementById('inspector'),
  settings: document.getElementById('settings'),
  addButtons: document.getElementById('add-buttons'),
};

function setStatus(message, kind = 'info') {
  ui.status.textContent = message;
  ui.status.dataset.kind = kind;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Scales large photos down so the autosaved draft stays within browser storage limits.
function shrinkImage(dataUrl, max = 1200) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = dataUrl;
  });
}

function makeInput(field, value, onChange) {
  let input;
  switch (field.kind) {
    case 'textarea':
      input = h('textarea', { rows: 3, value: value ?? '' });
      break;
    case 'select':
      input = h(
        'select',
        {},
        ...field.options.map(([v, label]) =>
          h('option', { value: String(v), text: label, selected: String(v) === String(value) })
        )
      );
      break;
    case 'checkbox':
      input = h('input', { type: 'checkbox', checked: !!value });
      break;
    case 'number':
      input = h('input', { type: 'number', min: field.min, max: field.max, step: field.step ?? 1, value: value ?? '' });
      break;
    default:
      input = h('input', { type: 'text', value: value ?? '' });
  }

  const evt = field.kind === 'select' || field.kind === 'checkbox' ? 'change' : 'input';
  input.addEventListener(evt, () => onChange(readValue(field, input)));
  return h('label', { class: 'field' }, h('span', { text: field.label }), input);
}

function readValue(field, input) {
  switch (field.kind) {
    case 'checkbox':
      return input.checked;
    case 'number': {
      const n = Number(input.value);
      return input.value === '' || !Number.isFinite(n) ? 0 : n;
    }
    case 'select':
      return field.num ? Number(input.value) : input.value;
    default:
      return input.value;
  }
}

function makeFileField(item) {
  const input = h('input', { type: 'file', accept: 'image/*' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      item.src = await shrinkImage(await readAsDataUrl(file));
      item.name = file.name;
      changed();
      renderInspector();
    } catch (err) {
      setStatus(err.message, 'error');
    }
  });
  return h(
    'label',
    { class: 'field' },
    h('span', { text: 'Image file' }),
    input,
    h('small', { text: item.name ? `Current: ${item.name}` : 'No image chosen' })
  );
}

// ---------- drawing and interaction ----------

function requestRedraw() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    redraw();
  });
}

function changed() {
  persist();
  requestRedraw();
}

function redraw() {
  const W = pageWidth(doc);
  if (mode === 'print') renderPrintPreview(doc, ui.page);
  else renderPage(doc, ui.page);

  const H = ui.page.height;
  scale = Math.min(1, Math.max(0.2, (ui.desk.clientWidth - 32) / W));
  ui.stage.style.width = `${W * scale}px`;
  ui.stage.style.height = `${H * scale}px`;
  ui.pageInfo.textContent = `${W} × ${H} dots`;

  renderOverlays();
  renderLayers();
}

function renderOverlays() {
  ui.overlay.hidden = mode === 'print';
  ui.overlay.replaceChildren();
  if (mode === 'print') return;

  for (const item of doc.elements) {
    const box = elementBox(item);
    const isSelected = item.id === selectedId;
    const hit = h('div', { class: isSelected ? 'hit selected' : 'hit', title: summary(item) });
    Object.assign(hit.style, {
      left: `${box.x * scale}px`,
      top: `${box.y * scale}px`,
      width: `${box.w * scale}px`,
      height: `${box.h * scale}px`,
    });
    hit.addEventListener('pointerdown', (e) => beginMove(e, item));
    if (isSelected) {
      const handle = h('div', { class: 'handle' });
      handle.addEventListener('pointerdown', (e) => beginResize(e, item));
      hit.append(handle);
    }
    ui.overlay.append(hit);
  }
}

function dragWith(move) {
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    renderInspector();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function beginMove(e, item) {
  if (e.button !== 0) return;
  e.preventDefault();
  select(item.id);
  const start = { px: e.clientX, py: e.clientY, x: item.x, y: item.y };
  dragWith((ev) => {
    item.x = Math.round(start.x + (ev.clientX - start.px) / scale);
    item.y = Math.round(start.y + (ev.clientY - start.py) / scale);
    changed();
  });
}

function beginResize(e, item) {
  e.preventDefault();
  e.stopPropagation();
  const start = { px: e.clientX, py: e.clientY, w: item.w, h: item.h ?? item.w };
  const resizesHeight = item.kind === 'image' || item.kind === 'barcode' || item.kind === 'shape';
  dragWith((ev) => {
    item.w = Math.max(4, Math.round(start.w + (ev.clientX - start.px) / scale));
    if (resizesHeight) item.h = Math.max(4, Math.round(start.h + (ev.clientY - start.py) / scale));
    if (item.kind === 'qr') item.w = Math.max(16, item.w);
    changed();
  });
}

function select(id) {
  selectedId = id;
  renderInspector();
  requestRedraw();
}

// ---------- layers ----------

function summary(item) {
  switch (item.kind) {
    case 'text':
      return String(item.text).split('\n')[0].slice(0, 28) || '(empty)';
    case 'image':
      return item.name || 'no image';
    case 'barcode':
      return item.value || '(empty)';
    case 'qr':
      return item.value ? item.value.slice(0, 28) : '(empty)';
    case 'shape':
      return item.style === 'frame' ? 'outline' : 'filled';
  }
  return '';
}

function iconButton(label, title, disabled, onClick) {
  return h('button', { type: 'button', class: 'icon', text: label, title, disabled, onclick: onClick });
}

function renderLayers() {
  if (!doc.elements.length) {
    ui.layers.replaceChildren(h('p', { class: 'muted', text: 'Nothing on the page yet. Add an element above.' }));
    return;
  }
  const top = doc.elements.length - 1;
  ui.layers.replaceChildren(
    ...[...doc.elements].reverse().map((item, shown) => {
      const index = top - shown;
      return h(
        'div',
        { class: item.id === selectedId ? 'layer active' : 'layer' },
        h('button', {
          type: 'button',
          class: 'layer-name',
          text: `${KIND_LABEL[item.kind]} · ${summary(item)}`,
          onclick: () => select(item.id),
        }),
        iconButton('↑', 'Bring forward', index === top, () => moveElement(item.id, 1)),
        iconButton('↓', 'Send back', index === 0, () => moveElement(item.id, -1))
      );
    })
  );
}

function moveElement(id, delta) {
  const i = doc.elements.findIndex((e) => e.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= doc.elements.length) return;
  [doc.elements[i], doc.elements[j]] = [doc.elements[j], doc.elements[i]];
  changed();
}

function duplicateElement(id) {
  const item = findElement(id);
  if (!item) return;
  const copy = JSON.parse(JSON.stringify(item));
  copy.id = newId();
  copy.x += 12;
  copy.y += 12;
  doc.elements.push(copy);
  select(copy.id);
  changed();
}

function deleteElement(id) {
  doc.elements = doc.elements.filter((e) => e.id !== id);
  if (selectedId === id) selectedId = null;
  renderInspector();
  changed();
}

function addElement(kind) {
  let bottom = 0;
  for (const item of doc.elements) {
    const box = elementBox(item);
    bottom = Math.max(bottom, box.y + box.h);
  }
  const item = newElement(kind, 24, doc.elements.length ? Math.round(bottom + 12) : 24);
  doc.elements.push(item);
  select(item.id);
  changed();
}

// ---------- inspector and page settings ----------

function renderInspector() {
  const item = findElement(selectedId);
  if (!item) {
    ui.inspector.replaceChildren(
      h('p', { class: 'muted', text: 'Select an element on the page, or in the layers list, to edit it.' })
    );
    return;
  }

  const fields = elementFields(item).map((field) =>
    field.kind === 'file'
      ? makeFileField(item)
      : makeInput(field, item[field.key], (v) => {
          item[field.key] = v;
          if (item.kind === 'qr' && field.key === 'w') item.w = Math.max(16, v);
          changed();
        })
  );

  ui.inspector.replaceChildren(
    h(
      'div',
      { class: 'row' },
      h('strong', { text: KIND_LABEL[item.kind] }),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', text: 'Duplicate', onclick: () => duplicateElement(item.id) }),
      h('button', { type: 'button', text: 'Delete', onclick: () => deleteElement(item.id) })
    ),
    h('div', { class: 'fields single' }, ...fields)
  );
}

function renderSettings() {
  ui.settings.replaceChildren(
    ...PAGE_FIELDS.map((field) =>
      makeInput(field, doc.settings[field.key], (v) => {
        doc.settings[field.key] = v;
        changed();
      })
    )
  );
}

// ---------- printing ----------

async function printDesign() {
  const s = doc.settings;
  const bits = printBits(doc);
  const job = new EscPos().init().raster(bits);
  if (s.cut === 'none') job.feed(4);
  else job.cut(s.cut, 4);

  const one = job.build();
  const copies = Math.min(10, Math.max(1, Math.round(s.copies)));
  const out = new Uint8Array(one.length * copies);
  for (let i = 0; i < copies; i++) out.set(one, i * one.length);
  await printer.print(out);
}

async function run(action, busyMessage) {
  try {
    setStatus(busyMessage);
    await action();
    setStatus('Done', 'ok');
  } catch (err) {
    console.error(err);
    setStatus(err.message || String(err), 'error');
  }
}

function refreshUi() {
  const connected = printer.connected;
  ui.connect.hidden = connected;
  ui.disconnect.hidden = !connected;
  ui.print.disabled = !connected;
  if (connected) setStatus(`Connected to ${printer.name}`, 'ok');
}

// ---------- storage and files ----------

let persistTimerId = null;

function persist() {
  clearTimeout(persistTimerId);
  persistTimerId = setTimeout(saveDraft, 300);
}

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(doc));
  } catch (err) {
    setStatus('Autosave is full (large images). Export JSON to keep your work.', 'error');
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setMode(next) {
  mode = next;
  ui.viewDesign.setAttribute('aria-pressed', String(next === 'design'));
  ui.viewPrint.setAttribute('aria-pressed', String(next === 'print'));
  requestRedraw();
}

// ---------- wiring ----------

ui.connect.addEventListener('click', () =>
  run(async () => {
    await printer.pair();
    refreshUi();
  }, 'Waiting for printer selection...')
);

ui.disconnect.addEventListener('click', async () => {
  await printer.disconnect();
  refreshUi();
  setStatus('Disconnected');
});

ui.print.addEventListener('click', () => run(printDesign, 'Printing...'));

ui.viewDesign.addEventListener('click', () => setMode('design'));
ui.viewPrint.addEventListener('click', () => setMode('print'));

ui.stage.addEventListener('pointerdown', (e) => {
  if (e.target === ui.page) select(null);
});

ui.exportJson.addEventListener('click', () =>
  downloadBlob(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), 'receipt-design.json')
);

ui.importBtn.addEventListener('click', () => ui.importJson.click());

ui.importJson.addEventListener('change', async () => {
  const file = ui.importJson.files[0];
  ui.importJson.value = '';
  if (!file) return;
  try {
    doc = normalize(JSON.parse(await file.text()));
    selectedId = null;
    renderSettings();
    renderInspector();
    changed();
    setStatus(`Imported ${file.name}`, 'ok');
  } catch (err) {
    setStatus(`Import failed: ${err.message}`, 'error');
  }
});

for (const [kind, label] of Object.entries(KIND_LABEL)) {
  ui.addButtons.append(h('button', { type: 'button', text: `+ ${label}`, onclick: () => addElement(kind) }));
}

document.addEventListener('keydown', (e) => {
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const item = findElement(selectedId);
  if (!item) return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteElement(item.id);
    return;
  }
  const step = e.shiftKey ? 10 : 1;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (moves[e.key]) {
    e.preventDefault();
    item.x += moves[e.key][0];
    item.y += moves[e.key][1];
    renderInspector();
    changed();
  }
});

// Page is redrawn when a photo finishes loading, or the window changes size.
onAssetLoad = requestRedraw;
window.addEventListener('resize', requestRedraw);

if (!('usb' in navigator)) {
  setStatus('WebUSB is not supported here. Use Chrome or Edge on https or localhost.', 'error');
  ui.connect.disabled = true;
} else {
  navigator.usb.addEventListener('disconnect', (event) => {
    if (event.device === printer.device) {
      printer.device = null;
      refreshUi();
      setStatus('Printer was unplugged', 'error');
    }
  });

  printer
    .restore()
    .then((restored) => {
      refreshUi();
      if (!restored) setStatus('No printer connected');
    })
    .catch((err) => {
      console.error(err);
      refreshUi();
      setStatus(err.message, 'error');
    });
}

renderSettings();
renderLayers();
renderInspector();
refreshUi();
requestRedraw();
