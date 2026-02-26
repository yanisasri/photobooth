/* ═══════════════════════════════════════════════════
   PHOTOBOOTH — main script
   1. Navigation
   2. EmailJS / Contact
   3. Layout Picker
   4. Camera + MediaPipe hand-wave detection
   5. Choose Photos
   6. Download + Color Pickers + QR
═══════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────
// 1. NAVIGATION
// ─────────────────────────────────────────────────

const pages = ['landing', 'contact', 'layout', 'camera', 'choose', 'download'];

function goTo(id) {
  pages.forEach(p => document.getElementById('page-' + p).classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  window.scrollTo(0, 0);

  if (id === 'layout')   initLayout();
  if (id === 'camera')   initCamera();
  if (id === 'choose')   initChoose();
  if (id === 'download') initDownload();
  if (id !== 'camera')   stopCamera();
}

// ─────────────────────────────────────────────────
// 2. EMAILJS / CONTACT
// ─────────────────────────────────────────────────

const EMAILJS_PUBLIC_KEY  = 'JaSY9BjRSL-QjjD65';
const EMAILJS_SERVICE_ID  = 'service_yanisa';
const EMAILJS_TEMPLATE_ID = 'template_yanisa_photoboo';

emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });

function submitContact() {
  const name    = document.getElementById('contact-name').value.trim();
  const email   = document.getElementById('contact-email').value.trim();
  const message = document.getElementById('contact-message').value.trim();
  const status  = document.getElementById('contact-status');
  if (!name || !email || !message) { status.textContent = 'Please fill in all fields.'; return; }
  status.textContent = 'Sending…';
  emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, { from_name: name, from_email: email, message })
    .then(() => {
      status.textContent = 'Message sent! Thank you ✨';
      document.getElementById('contact-name').value    = '';
      document.getElementById('contact-email').value   = '';
      document.getElementById('contact-message').value = '';
    }).catch(err => {
      console.error(err);
      status.textContent = 'Something went wrong. Please try again.';
    });
}

// ─────────────────────────────────────────────────
// 3. LAYOUT PICKER
// ─────────────────────────────────────────────────

let selectedCount       = null;
let selectedOrientation = 'portrait';

function initLayout() {
  selectedCount = null;
  selectedOrientation = 'portrait';
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('layout-previews').innerHTML = '';
  document.querySelector('.orientation-toggle').classList.remove('visible');
  updateOrientBtn();
}

function selectCount(n) {
  selectedCount = n;
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', parseInt(t.dataset.count) === n)
  );
  document.querySelector('.orientation-toggle').classList.add('visible');
  document.getElementById('layout-hint').textContent = '';
  renderLayoutPreviews();
}

function toggleOrientation() {
  selectedOrientation = selectedOrientation === 'portrait' ? 'landscape' : 'portrait';
  updateOrientBtn();
  renderLayoutPreviews();
}

function updateOrientBtn() {
  document.getElementById('orient-btn').textContent =
    selectedOrientation === 'portrait' ? 'change to landscape' : 'change to portrait';
}

// ── Shared slot-dimension formula (single source of truth) ──
// BASE = 320px for final canvas quality; all other sizes scale from this.
function getSlotDims(count, orientation, base) {
  // base = reference dimension (width for portrait, height for landscape)
  const gap = 10;
  if (orientation === 'portrait') {
    const slotW = base;
    const slotH = Math.floor((slotW * 3 - gap * (count - 1)) / count);
    return { slotW, slotH, gap };
  } else {
    // Landscape = portrait rotated: base is height
    const slotH = base;
    const slotW = Math.floor((slotH * 3 - gap * (count - 1)) / count);
    return { slotW, slotH, gap };
  }
}

function renderLayoutPreviews() {
  if (!selectedCount) return;
  const wrap = document.getElementById('layout-previews');
  wrap.innerHTML = '';
  const isPortrait = selectedOrientation === 'portrait';

  // Preview strip uses base=160 for the thumbnail
  const { slotW, slotH, gap } = getSlotDims(selectedCount, selectedOrientation, 160);

  const strip = document.createElement('div');
  strip.className = 'strip-thumb ' + selectedOrientation;
  strip.style.display = 'flex';
  strip.style.flexDirection = isPortrait ? 'column' : 'row';
  strip.style.gap = gap + 'px';

  for (let i = 0; i < selectedCount; i++) {
    const cell = document.createElement('div');
    cell.className = 'strip-cell';
    cell.style.width  = slotW + 'px';
    cell.style.height = slotH + 'px';
    strip.appendChild(cell);
  }
  wrap.appendChild(strip);
}

function goToCamera() {
  if (!selectedCount) {
    document.getElementById('layout-hint').textContent = 'Please pick a layout first.';
    return;
  }
  document.getElementById('layout-hint').textContent = '';
  goTo('camera');
}

// ─────────────────────────────────────────────────
// 4. CAMERA + MEDIAPIPE HAND WAVE DETECTION
// ─────────────────────────────────────────────────

const MAX_PHOTOS = 6;
let capturedPhotos = [];
let cameraStream   = null;
let handsModel     = null;
let frameTimerId   = null;
let sendingFrame   = false;
let countingDown   = false;
let waveReady      = false;

let wristXBuffer = [];
const BUFFER_SIZE  = 12;
const SWEEP_THRESH = 0.10;

async function initCamera() {
  capturedPhotos = [];
  countingDown   = false;
  waveReady      = true;
  wristXBuffer   = [];
  updatePhotoCounter();
  document.getElementById('camera-error').textContent = '';
  document.getElementById('camera-hint').textContent  = 'Wave your hand to start a 3 second timer.';

  // Set camera viewport aspect ratio to match slot proportions
  const vp = document.getElementById('camera-viewport');
  const { slotW, slotH } = getSlotDims(selectedCount, selectedOrientation, 160);
  vp.style.aspectRatio = slotW + ' / ' + slotH;
  // Cap width so portrait layouts don't get huge
  vp.style.maxWidth = selectedOrientation === 'portrait' ? '420px' : '100%';

  const video = document.getElementById('camera-video');

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = cameraStream;
    await video.play();
  } catch (e) {
    console.error('Camera error:', e);
    document.getElementById('camera-hint').textContent = 'Camera access denied. Please allow camera access and reload.';
    return;
  }

  await new Promise(res => {
    const check = () => video.videoWidth > 0 ? res() : setTimeout(check, 50);
    check();
  });

  try {
    handsModel = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${file}`
    });
    handsModel.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    handsModel.onResults(onHandResults);

    frameTimerId = setInterval(async () => {
      if (sendingFrame || !handsModel || !cameraStream) return;
      if (video.readyState < 2 || video.videoWidth === 0) return;
      sendingFrame = true;
      try { await handsModel.send({ image: video }); } catch(e) {}
      sendingFrame = false;
    }, 100);
  } catch (e) {
    console.error('MediaPipe failed:', e);
    document.getElementById('camera-hint').textContent = 'Hand detection unavailable. Use the button below.';
    showManualButton();
  }
}

function showManualButton() {
  if (document.getElementById('manual-snap')) return;
  const btn = document.createElement('button');
  btn.id = 'manual-snap';
  btn.className = 'btn-pill btn-solid';
  btn.textContent = 'take photo';
  btn.style.marginTop = '12px';
  btn.onclick = () => { if (!countingDown && capturedPhotos.length < MAX_PHOTOS) startCountdown(); };
  document.querySelector('.camera-bottom').prepend(btn);
}

function onHandResults(results) {
  if (!waveReady || countingDown || capturedPhotos.length >= MAX_PHOTOS) return;
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    wristXBuffer = []; return;
  }
  const x = results.multiHandLandmarks[0][8].x;
  wristXBuffer.push(x);
  if (wristXBuffer.length > BUFFER_SIZE) wristXBuffer.shift();
  if (wristXBuffer.length < BUFFER_SIZE) return;

  let reversals = 0, prevDir = null;
  for (let i = 1; i < wristXBuffer.length; i++) {
    const delta = wristXBuffer[i] - wristXBuffer[i - 1];
    if (Math.abs(delta) < 0.008) continue;
    const dir = delta > 0 ? 1 : -1;
    if (prevDir !== null && dir !== prevDir) reversals++;
    prevDir = dir;
  }
  const swing = Math.max(...wristXBuffer) - Math.min(...wristXBuffer);
  if (reversals >= 2 && swing >= SWEEP_THRESH) {
    waveReady = false; wristXBuffer = [];
    startCountdown();
  }
}

function startCountdown() {
  countingDown = true;
  const overlay = document.getElementById('countdown-overlay');
  const numEl   = document.getElementById('countdown-num');
  overlay.classList.add('visible');
  let count = 3;
  numEl.textContent = count;

  const tick = setInterval(() => {
    count--;
    if (count === 0) {
      clearInterval(tick);
      numEl.textContent = '';
      setTimeout(() => {
        overlay.classList.remove('visible');
        takePhoto();
        countingDown = false;
        waveReady    = true;
        wristXBuffer = [];
      }, 300);
    } else {
      numEl.style.animation = 'none';
      numEl.offsetWidth;
      numEl.style.animation = '';
      numEl.textContent = count;
    }
  }, 1000);
}

function takePhoto() {
  const video  = document.getElementById('camera-video');
  const canvas = document.getElementById('camera-canvas');

  // Capture at slot proportions so photos match layout exactly
  const { slotW, slotH } = getSlotDims(selectedCount, selectedOrientation, 640);
  canvas.width  = slotW;
  canvas.height = slotH;
  const ctx = canvas.getContext('2d');

  // Cover-crop from video into slot dimensions (mirrored)
  const vw = video.videoWidth, vh = video.videoHeight;
  const srcAR  = vw / vh;
  const dstAR  = slotW / slotH;
  let sx = 0, sy = 0, sw = vw, sh = vh;
  if (srcAR > dstAR) { sw = vh * dstAR; sx = (vw - sw) / 2; }
  else               { sh = vw / dstAR; sy = (vh - sh) / 2; }

  ctx.save();
  ctx.translate(slotW, 0);
  ctx.scale(-1, 1);   // mirror
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, slotW, slotH);
  ctx.restore();

  capturedPhotos.push(canvas.toDataURL('image/jpeg', 0.92));
  updatePhotoCounter();

  const flash = document.getElementById('flash-overlay');
  flash.classList.add('flash');
  setTimeout(() => flash.classList.remove('flash'), 150);

  if (capturedPhotos.length >= MAX_PHOTOS) {
    document.getElementById('camera-hint').textContent = '6 photos taken! Press done when ready.';
  }
}

function updatePhotoCounter() {
  document.getElementById('photo-counter').textContent = capturedPhotos.length + '/6';
}

function stopCamera() {
  if (frameTimerId) { clearInterval(frameTimerId); frameTimerId = null; }
  if (handsModel)   { handsModel.close(); handsModel = null; }
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  sendingFrame = false; countingDown = false; waveReady = false;
  const snap = document.getElementById('manual-snap');
  if (snap) snap.remove();
}

function doneCamera() {
  const errorEl = document.getElementById('camera-error');
  if (capturedPhotos.length < selectedCount) {
    errorEl.textContent = `Please take at least ${selectedCount} photo${selectedCount > 1 ? 's' : ''} first.`;
    return;
  }
  errorEl.textContent = '';
  goTo('choose');
}

// ─────────────────────────────────────────────────
// 5. CHOOSE PHOTOS
// ─────────────────────────────────────────────────

let selectedPhotos = [];

function initChoose() {
  selectedPhotos = [];
  document.getElementById('choose-subtitle').textContent =
    `Select up to ${selectedCount} photos. The rest will be discarded.`;
  renderPhotoGrid();
  renderStripPreview();
}

function renderPhotoGrid() {
  const grid = document.getElementById('photo-grid');
  grid.innerHTML = '';
  // Slot AR to display thumbs correctly
  const { slotW, slotH } = getSlotDims(selectedCount, selectedOrientation, 160);
  capturedPhotos.forEach((src, i) => {
    const div = document.createElement('div');
    div.className = 'photo-thumb';
    div.dataset.idx = i;
    // Match slot aspect ratio so images aren't letterboxed
    div.style.aspectRatio = slotW + ' / ' + slotH;
    const img = document.createElement('img');
    img.src = src;
    div.appendChild(img);
    div.addEventListener('click', () => togglePhotoSelect(i));
    grid.appendChild(div);
  });
}

function togglePhotoSelect(idx) {
  const thumbs = document.querySelectorAll('.photo-thumb');
  if (selectedPhotos.includes(idx)) {
    selectedPhotos = selectedPhotos.filter(i => i !== idx);
  } else {
    if (selectedPhotos.length >= selectedCount) return;
    selectedPhotos.push(idx);
  }
  thumbs.forEach((t, i) => {
    const sel = selectedPhotos.includes(i);
    const atLimit = selectedPhotos.length >= selectedCount;
    t.classList.toggle('selected', sel);
    t.classList.toggle('dimmed', !sel && atLimit);
  });
  renderStripPreview();
}

function renderStripPreview() {
  const wrap   = document.getElementById('strip-preview');
  const isPort = selectedOrientation === 'portrait';
  wrap.innerHTML = '';

  // Preview uses base=130
  const { slotW, slotH, gap } = getSlotDims(selectedCount, selectedOrientation, 130);
  wrap.style.display       = 'flex';
  wrap.style.flexDirection = isPort ? 'column' : 'row';
  wrap.style.gap           = gap + 'px';

  for (let i = 0; i < selectedCount; i++) {
    const slot = document.createElement('div');
    slot.className = 'strip-slot';
    slot.style.width  = slotW + 'px';
    slot.style.height = slotH + 'px';
    const photoIdx = selectedPhotos[i];
    if (photoIdx !== undefined) {
      const img = document.createElement('img');
      img.src = capturedPhotos[photoIdx];
      slot.appendChild(img);
    }
    wrap.appendChild(slot);
  }
}

function doneChoose() {
  if (selectedPhotos.length < selectedCount) {
    alert(`Please select ${selectedCount} photos.`);
    return;
  }
  goTo('download');
}

// ─────────────────────────────────────────────────
// 6. DOWNLOAD + COLOR PICKERS + QR
// ─────────────────────────────────────────────────

let frameColor  = '#ffffff';
let tintColor   = '#ffffff';
let tintOpacity = 0;       // 0–1
let useGreyscale = false;

// Frame picker HSV state
let frameHue = 0, frameSat = 0, frameVal = 1;
// Tint picker HSV state
let tintHue  = 0, tintSat  = 0, tintVal  = 1;

function initDownload() {
  frameColor   = '#ffffff';
  tintColor    = '#ffffff';
  tintOpacity  = 0;
  useGreyscale = false;

  // Reset greyscale toggle UI
  const gt = document.getElementById('greyscale-toggle');
  if (gt) { gt.textContent = 'off'; gt.classList.remove('active'); }

  // Reset opacity slider
  const op = document.getElementById('tint-opacity');
  if (op) { op.value = 0; }
  const opv = document.getElementById('tint-opacity-val');
  if (opv) { opv.textContent = '0%'; }

  drawHueStrip('hue-canvas');
  drawHueStrip('tint-hue-canvas');
  drawGradient('gradient-canvas', frameHue);
  drawGradient('tint-gradient-canvas', tintHue);

  updateFrameSwatch();
  updateTintSwatch();
  setupColorPickerEvents();
  renderFinalCanvas();
}

// ── Canvas drawing helpers ──

function drawHueStrip(id) {
  const c = document.getElementById(id);
  if (!c) return;
  const ctx = c.getContext('2d');
  // Use actual pixel dimensions
  const W = c.width, H = c.height;
  const g = ctx.createLinearGradient(0, 0, W, 0);
  for (let h = 0; h <= 360; h += 30) g.addColorStop(h / 360, `hsl(${h},100%,50%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawGradient(id, hue) {
  const c = document.getElementById(id);
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.fillStyle = `hsl(${hue},100%,50%)`;
  ctx.fillRect(0, 0, W, H);
  const wg = ctx.createLinearGradient(0, 0, W, 0);
  wg.addColorStop(0, 'rgba(255,255,255,1)'); wg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = wg; ctx.fillRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, 'rgba(0,0,0,0)'); bg.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
}

function hsvToHex(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if      (h < 60)  { r=c; g=x; }
  else if (h < 120) { r=x; g=c; }
  else if (h < 180) { g=c; b=x; }
  else if (h < 240) { g=x; b=c; }
  else if (h < 300) { r=x; b=c; }
  else              { r=c; b=x; }
  const ri = Math.round((r+m)*255), gi = Math.round((g+m)*255), bi = Math.round((b+m)*255);
  return '#' + ((1<<24)|(ri<<16)|(gi<<8)|bi).toString(16).slice(1).toUpperCase();
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#',''), 16);
  return [(n>>16)&255, (n>>8)&255, n&255];
}

function updateFrameSwatch() {
  frameColor = hsvToHex(frameHue, frameSat, frameVal);
  const sw = document.getElementById('hex-swatch');
  const inp = document.getElementById('hex-input');
  if (sw)  sw.style.background = frameColor;
  if (inp) inp.value = frameColor.slice(1);
  renderFinalCanvas();
}

function updateTintSwatch() {
  tintColor = hsvToHex(tintHue, tintSat, tintVal);
  const sw  = document.getElementById('tint-hex-swatch');
  const inp = document.getElementById('tint-hex-input');
  if (sw)  sw.style.background = tintColor;
  if (inp) inp.value = tintColor.slice(1);
  renderFinalCanvas();
}

// ── Greyscale toggle ──

function toggleGreyscale() {
  useGreyscale = !useGreyscale;
  const btn = document.getElementById('greyscale-toggle');
  btn.textContent = useGreyscale ? 'on' : 'off';
  btn.classList.toggle('active', useGreyscale);
  renderFinalCanvas();
}

// ── Final canvas render ──

function renderFinalCanvas() {
  const canvas = document.getElementById('final-canvas');
  if (!canvas) return;
  const ctx    = canvas.getContext('2d');
  const isPort = selectedOrientation === 'portrait';

  const border = 20;
  // Final output uses base=320 for good resolution
  const { slotW, slotH, gap } = getSlotDims(selectedCount, selectedOrientation, 320);

  // QR code dimensions (proportional to strip width)
  const QR_SIZE = Math.round(isPort ? slotW * 0.18 : slotH * 0.18);
  const QR_PAD  = 8;  // padding inside frame below photos

  const canvasW = isPort
    ? slotW + border * 2
    : slotW * selectedCount + gap * (selectedCount - 1) + border * 2;
  const canvasH = isPort
    ? slotH * selectedCount + gap * (selectedCount - 1) + border * 2 + QR_SIZE + QR_PAD
    : slotH + border * 2 + QR_SIZE + QR_PAD;

  canvas.width  = canvasW;
  canvas.height = canvasH;

  // Fill frame
  ctx.fillStyle = frameColor;
  ctx.fillRect(0, 0, canvasW, canvasH);

  const imgs = selectedPhotos.map(idx => {
    const img = new Image();
    img.src = capturedPhotos[idx];
    return img;
  });

  let loaded = 0;
  imgs.forEach((img, i) => {
    img.onload = () => {
      loaded++;
      const x = isPort ? border : border + i * (slotW + gap);
      const y = border + (isPort ? i * (slotH + gap) : 0);

      // Draw with cover-crop
      const srcAR = img.naturalWidth / img.naturalHeight;
      const dstAR = slotW / slotH;
      let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
      if (srcAR > dstAR) { sw = sh * dstAR; sx = (img.naturalWidth - sw) / 2; }
      else               { sh = sw / dstAR; sy = (img.naturalHeight - sh) / 2; }

      if (useGreyscale) {
        // Draw to offscreen, desaturate, then stamp
        const tmp = document.createElement('canvas');
        tmp.width = slotW; tmp.height = slotH;
        const tctx = tmp.getContext('2d');
        tctx.drawImage(img, sx, sy, sw, sh, 0, 0, slotW, slotH);
        const id = tctx.getImageData(0, 0, slotW, slotH);
        for (let p = 0; p < id.data.length; p += 4) {
          const grey = 0.299 * id.data[p] + 0.587 * id.data[p+1] + 0.114 * id.data[p+2];
          id.data[p] = id.data[p+1] = id.data[p+2] = grey;
        }
        tctx.putImageData(id, 0, 0);
        ctx.drawImage(tmp, x, y);
      } else {
        ctx.drawImage(img, sx, sy, sw, sh, x, y, slotW, slotH);
      }

      // Tint overlay
      if (tintOpacity > 0) {
        const [tr, tg, tb] = hexToRgb(tintColor);
        ctx.save();
        ctx.globalAlpha = tintOpacity;
        ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
        ctx.fillRect(x, y, slotW, slotH);
        ctx.restore();
      }

      if (loaded === imgs.length) drawQR(ctx, canvasW, canvasH, QR_SIZE, QR_PAD);
    };
    if (img.complete) img.onload();
  });
}

// ── QR Code ──

function drawQR(ctx, canvasW, canvasH, qrSize, qrPad) {
  const qr = new Image();
  qr.src = 'qr.jpg';
  const x = canvasW - qrSize - 12;   // bottom-right corner inside frame
  const y = canvasH - qrSize - 10;
  qr.onload  = () => ctx.drawImage(qr, x, y, qrSize, qrSize);
  qr.onerror = () => {}; // silently skip if file missing
  if (qr.complete) qr.onload();
}

// ── Color picker event wiring ──

function makePickerPair({
  gradId, hueId, cursorId, thumbId,
  onGrad,  // (saturation 0-1, value 0-1) => void
  onHue,   // (hue 0-360) => void
}) {
  const gradC  = document.getElementById(gradId);
  const hueC   = document.getElementById(hueId);
  const cursor = document.getElementById(cursorId);
  const thumb  = document.getElementById(thumbId);
  if (!gradC || !hueC) return;

  function pickGrad(e) {
    const r = gradC.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
    const y = Math.max(0, Math.min(e.clientY - r.top,  r.height));
    if (cursor) { cursor.style.left = x + 'px'; cursor.style.top = y + 'px'; }
    onGrad(x / r.width, 1 - y / r.height);
  }
  let dg = false;
  gradC.addEventListener('mousedown', e => { dg = true; pickGrad(e); });
  window.addEventListener('mousemove', e => { if (dg) pickGrad(e); });
  window.addEventListener('mouseup',   () => { dg = false; });
  gradC.addEventListener('touchstart', e => { dg = true; pickGrad(e.touches[0]); }, {passive:true});
  window.addEventListener('touchmove', e => { if (dg) pickGrad(e.touches[0]); }, {passive:true});
  window.addEventListener('touchend',  () => { dg = false; });

  function pickHue(e) {
    const r = hueC.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
    if (thumb) thumb.style.left = x + 'px';
    onHue(Math.round((x / r.width) * 360));
  }
  let dh = false;
  hueC.addEventListener('mousedown', e => { dh = true; pickHue(e); });
  window.addEventListener('mousemove', e => { if (dh) pickHue(e); });
  window.addEventListener('mouseup',   () => { dh = false; });
  hueC.addEventListener('touchstart', e => { dh = true; pickHue(e.touches[0]); }, {passive:true});
  window.addEventListener('touchmove', e => { if (dh) pickHue(e.touches[0]); }, {passive:true});
  window.addEventListener('touchend',  () => { dh = false; });

  // Init cursor position (fully saturated, full brightness = top-right)
  if (cursor) { cursor.style.left = gradC.width + 'px'; cursor.style.top = '0px'; }
  if (thumb)  thumb.style.left = '0px';
}

function setupColorPickerEvents() {
  // Frame color
  makePickerPair({
    gradId: 'gradient-canvas', hueId: 'hue-canvas',
    cursorId: 'gradient-cursor', thumbId: 'hue-thumb',
    onGrad: (s, v) => { frameSat = s; frameVal = v; updateFrameSwatch(); },
    onHue:  (h)    => { frameHue = h; drawGradient('gradient-canvas', h); updateFrameSwatch(); },
  });

  document.getElementById('hex-input').addEventListener('input', e => {
    const val = e.target.value.replace(/[^0-9a-fA-F]/g, '');
    e.target.value = val;
    if (val.length === 6) {
      frameColor = '#' + val.toUpperCase();
      document.getElementById('hex-swatch').style.background = frameColor;
      renderFinalCanvas();
    }
  });

  // Tint color
  makePickerPair({
    gradId: 'tint-gradient-canvas', hueId: 'tint-hue-canvas',
    cursorId: 'tint-gradient-cursor', thumbId: 'tint-hue-thumb',
    onGrad: (s, v) => { tintSat = s; tintVal = v; updateTintSwatch(); },
    onHue:  (h)    => { tintHue = h; drawGradient('tint-gradient-canvas', h); updateTintSwatch(); },
  });

  document.getElementById('tint-hex-input').addEventListener('input', e => {
    const val = e.target.value.replace(/[^0-9a-fA-F]/g, '');
    e.target.value = val;
    if (val.length === 6) {
      tintColor = '#' + val.toUpperCase();
      document.getElementById('tint-hex-swatch').style.background = tintColor;
      renderFinalCanvas();
    }
  });

  // Opacity slider
  const opSlider = document.getElementById('tint-opacity');
  const opLabel  = document.getElementById('tint-opacity-val');
  opSlider.addEventListener('input', () => {
    tintOpacity = parseInt(opSlider.value) / 100;
    opLabel.textContent = opSlider.value + '%';
    renderFinalCanvas();
  });
}

// ── Download ──

function downloadStrip() {
  const canvas = document.getElementById('final-canvas');
  const link   = document.createElement('a');
  link.download = 'photostrip.png';
  link.href     = canvas.toDataURL('image/png');
  link.click();
}