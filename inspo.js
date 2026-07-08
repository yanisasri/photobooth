/* ═══════════════════════════════════════════════════
   INSPO.JS — "inspos for friends" mode.
   Pick a meme theme; every photo you take shows a
   random reference image from that theme next to the
   camera. When choosing your final strip, you get a
   side-by-side (portrait) or stacked (landscape)
   comparison of your strip against the memes you were
   shown — and that comparison is what gets downloaded.

   To add more images to a theme, just add the filename
   to that theme's `files` array below — the file itself
   goes in the matching images/inspo/<folder>/ directory.

   Hooks called from photobooth.js:
     - onInitLayoutInspo()          → initLayout()
     - onCameraInitInspo()          → initCamera()
     - onPhotoTakenInspo()          → takePhoto()
     - renderStripPreview() branches to renderStripPreviewInspo()
     - renderFinalCanvasAny() branches to renderFinalCanvasInspo()

   Duo mode sync: the room creator's chosen theme travels along with the
   {type:'layout'} message (see duo.js), and after that whoever picks a
   new reference image — by taking a photo, or via "choose another" —
   broadcasts it as {type:'inspoRef'} so both of you always see the same
   meme at the same time. onDuoInspoRef() is duo.js's entry point for
   applying an incoming pick. The meme reference only shows while taking
   photos, though — the final downloaded strip in duo mode shows the
   two-sided you-vs-friend comparison instead (see duo.js).
═══════════════════════════════════════════════════ */

const INSPO_THEMES = [
  {
    key: 'general',
    folder: 'images/inspo/general',
    label: 'surprise general memes',
    files: [
      'meme1.jpg', 'meme2.jpg', 'meme3.jpg', 'meme4.jpg', 'meme5.jpg',
      'meme6.jpg', 'meme7.jpg', 'meme8.jpg', 'meme9.jpg', 'meme10.JPG',
      'meme11.jpg', 'meme12.jpg', 'meme13.jpg', 'meme14.jpg', 'meme15.jpg',
      'meme16.jpg', 'meme18.jpg'
    ],
  },
  {
    key: 'monkey',
    folder: 'images/inspo/monkey',
    label: 'gibraltar monkey memes',
    files: ['monkey1.jpg', 'monkey2.jpg', 'monkey3.jpg', 'monkey4.jpg'],
  },
  {
    key: 'spongebob',
    folder: 'images/inspo/spongebob',
    label: 'spongebob & patrick duo memes',
    files: [
      'spongebob1.jpg', 'spongebob2.jpg', 'spongebob3.jpg',
      'spongebob4.jpg', 'spongebob5.jpg', 'spongebob6.jpg', 'spongebob7.jpg'
    ],
  },
];

let inspoThemeKey     = null;   // null | theme.key
let currentInspoIndex = null;   // 0-based index into theme.files, currently shown on camera page
let photoInspoRefs    = [];     // parallel to capturedPhotos: {theme, index} for each shot

function getInspoTheme(key) {
  return INSPO_THEMES.find(t => t.key === key) || null;
}

function getInspoImageUrl(themeKey, index) {
  const theme = getInspoTheme(themeKey);
  if (!theme || !theme.files[index]) return null;
  return `${theme.folder}/${theme.files[index]}`;
}

function pickRandomInspoIndex(themeKey, avoidIndex) {
  const theme = getInspoTheme(themeKey);
  if (!theme || theme.files.length === 0) return null;
  if (theme.files.length === 1) return 0;
  let idx;
  do { idx = Math.floor(Math.random() * theme.files.length); } while (idx === avoidIndex);
  return idx;
}

// Shows an image in a DOM container, falling back to a friendly
// placeholder if the file can't be loaded.
function setImageInto(container, url, label) {
  container.innerHTML = '';
  if (!url) {
    container.innerHTML =
      '<div class="inspo-thumb-missing"><span class="missing-emoji">🖼️</span><span>' + label + '</span></div>';
    return;
  }
  const img = new Image();
  img.alt = label;
  img.onload = () => { container.innerHTML = ''; container.appendChild(img); };
  img.onerror = () => {
    container.innerHTML =
      '<div class="inspo-thumb-missing"><span class="missing-emoji">🖼️</span><span>' + label + '<br>missing: ' + url + '</span></div>';
  };
  img.src = url;
}

// Loads an image for canvas drawing; calls back with (img, found).
function loadImageForCanvas(url, cb) {
  if (!url) { cb(null, false); return; }
  const img = new Image();
  img.onload = () => cb(img, true);
  img.onerror = () => cb(null, false);
  img.src = url;
}

// ── Layout page: theme picker panel (always visible, no toggle) ──

function renderInspoPanelVisibility() {
  renderInspoThemeGrid();
  const note = document.getElementById('inspo-duo-note');
  if (note) {
    const inDuo = typeof duoActive !== 'undefined' && duoActive;
    note.style.display = inDuo ? 'block' : 'none';
  }
}

function renderInspoThemeGrid() {
  const grid = document.getElementById('inspo-theme-grid');
  if (!grid) return;
  grid.innerHTML = '';

  INSPO_THEMES.forEach(theme => {
    const card = document.createElement('div');
    card.className = 'inspo-theme-card' + (inspoThemeKey === theme.key ? ' selected' : '');
    card.addEventListener('click', () => selectInspoTheme(theme.key));

    const preview = document.createElement('div');
    preview.className = 'inspo-theme-preview';
    for (let i = 0; i < 4; i++) {
      const cell = document.createElement('div');
      cell.className = 'inspo-theme-preview-cell';
      preview.appendChild(cell);
      setImageInto(cell, getInspoImageUrl(theme.key, i % theme.files.length), theme.label);
    }
    card.appendChild(preview);

    const title = document.createElement('h4');
    title.textContent = theme.label;
    card.appendChild(title);

    if (inspoThemeKey === theme.key) {
      const badge = document.createElement('span');
      badge.className = 'inspo-theme-selected-badge';
      badge.textContent = '✓ selected';
      card.appendChild(badge);
    }

    grid.appendChild(card);
  });
}

function selectInspoTheme(key) {
  inspoThemeKey = (inspoThemeKey === key) ? null : key;
  renderInspoThemeGrid();
  renderInspoPanelVisibility();
}

function onInitLayoutInspo() {
  renderInspoPanelVisibility();
}

// ── Camera page ──

function onCameraInitInspo() {
  const panel = document.getElementById('inspo-reference-panel');
  const wrap  = document.getElementById('inspo-reference-img-wrap');
  photoInspoRefs = [];
  if (!panel) return;
  if (!inspoThemeKey) { panel.classList.remove('visible'); return; }
  panel.classList.add('visible');

  // Match the meme box's shape (landscape/square/portrait) to the
  // actual photo slot shape for the chosen layout.
  if (wrap && typeof getSlotDims === 'function' && selectedCount) {
    const { slotW, slotH } = getSlotDims(selectedCount, selectedOrientation, 100);
    wrap.style.aspectRatio = slotW + ' / ' + slotH;
  }

  // In duo mode, the room creator's pick is authoritative — whoever
  // joined waits for the {type:'inspoRef'} broadcast instead of rolling
  // their own, so you both start out looking at the same meme.
  const waitForHostPick = typeof duoActive !== 'undefined' && duoActive && duoRole === 'guest';
  if (waitForHostPick) {
    currentInspoIndex = null;
    updateInspoReferenceDisplay();
  } else {
    currentInspoIndex = pickRandomInspoIndex(inspoThemeKey);
    updateInspoReferenceDisplay();
    broadcastInspoRefIfActive();
  }
}

function updateInspoReferenceDisplay() {
  const wrap    = document.getElementById('inspo-reference-img-wrap');
  const theme   = getInspoTheme(inspoThemeKey);
  if (!wrap || !theme) return;

  if (currentInspoIndex === null) {
    wrap.innerHTML = '<div class="inspo-thumb-missing"><span class="missing-emoji">⏳</span><span>waiting for your friend\'s pick…</span></div>';
    return;
  }
  setImageInto(wrap, getInspoImageUrl(inspoThemeKey, currentInspoIndex), theme.label);
}

// Broadcasts the current meme reference to a connected duo peer, if any,
// so you're always both looking at the same one.
function broadcastInspoRefIfActive() {
  if (typeof duoActive === 'undefined' || !duoActive) return;
  if (typeof sendDuo !== 'function' || !inspoThemeKey || currentInspoIndex === null) return;
  sendDuo({ type: 'inspoRef', theme: inspoThemeKey, index: currentInspoIndex });
}

// Called by duo.js when the peer broadcasts a new (or their initial) pick.
function onDuoInspoRef(theme, index) {
  inspoThemeKey = theme;
  currentInspoIndex = index;
  updateInspoReferenceDisplay();
}

function onPhotoTakenInspo() {
  if (!inspoThemeKey || currentInspoIndex === null) return;
  photoInspoRefs[capturedPhotos.length - 1] = { theme: inspoThemeKey, index: currentInspoIndex };
  currentInspoIndex = pickRandomInspoIndex(inspoThemeKey, currentInspoIndex);
  updateInspoReferenceDisplay();
  broadcastInspoRefIfActive();
}

// "choose another inspo pic" button on the camera page — re-rolls the
// reference shown right now, without waiting for a photo to be taken.
function chooseAnotherInspoPic() {
  if (!inspoThemeKey || currentInspoIndex === null) return;
  currentInspoIndex = pickRandomInspoIndex(inspoThemeKey, currentInspoIndex);
  updateInspoReferenceDisplay();
  broadcastInspoRefIfActive();
}

// ── Choose page: side-by-side / stacked comparison preview ──

function renderStripPreviewInspo() {
  const outerWrap = document.getElementById('strip-preview-wrap');
  if (!outerWrap) return;
  const isPort = selectedOrientation === 'portrait';

  outerWrap.innerHTML = '';

  const comparison = document.createElement('div');
  comparison.className = 'strip-comparison ' + (isPort ? 'side-by-side' : 'stacked');

  const mineSources = [];
  const memeSources = [];
  for (let i = 0; i < selectedCount; i++) {
    const photoIdx = selectedPhotos[i];
    mineSources.push(photoIdx !== undefined ? capturedPhotos[photoIdx] : null);
    const ref = photoIdx !== undefined ? photoInspoRefs[photoIdx] : null;
    memeSources.push(ref ? getInspoImageUrl(ref.theme, ref.index) : null);
  }

  comparison.appendChild(buildStripColumn(mineSources, isPort, 'photo'));
  comparison.appendChild(buildStripColumn(memeSources, isPort, 'meme'));
  outerWrap.appendChild(comparison);
}

function buildStripColumn(sources, isPort, kind) {
  const { slotW, slotH, gap } = getSlotDims(selectedCount, selectedOrientation, 130);
  const col = document.createElement('div');
  col.className = 'strip-preview strip-preview-' + kind;
  col.style.display = 'flex';
  col.style.flexDirection = isPort ? 'column' : 'row';
  col.style.gap = gap + 'px';

  sources.forEach(src => {
    const slot = document.createElement('div');
    slot.className = 'strip-slot';
    slot.style.width  = slotW + 'px';
    slot.style.height = slotH + 'px';
    if (kind === 'meme') {
      setImageInto(slot, src, 'meme');
    } else if (src) {
      const img = document.createElement('img');
      img.src = src;
      slot.appendChild(img);
    }
    col.appendChild(slot);
  });
  return col;
}

// ── Download page: side-by-side / stacked comparison canvas ──

function renderFinalCanvasInspo() {
  const canvas = document.getElementById('final-canvas');
  if (!canvas) return;
  const ctx    = canvas.getContext('2d');
  const isPort = selectedOrientation === 'portrait';

  const border  = 20;
  const sideGap = 20;
  const { slotW, slotH, gap } = getSlotDims(selectedCount, selectedOrientation, 320);

  const QR_SIZE = Math.round(isPort ? slotW * 0.16 : slotH * 0.16);
  const QR_PAD  = 8;

  let canvasW, canvasH;
  if (isPort) {
    canvasW = slotW * 2 + sideGap + border * 2;
    canvasH = slotH * selectedCount + gap * (selectedCount - 1) + border * 2 + QR_SIZE + QR_PAD;
  } else {
    canvasW = slotW * selectedCount + gap * (selectedCount - 1) + border * 2;
    canvasH = slotH * 2 + sideGap + border * 2 + QR_SIZE + QR_PAD;
  }

  canvas.width  = canvasW;
  canvas.height = canvasH;

  ctx.fillStyle = frameColor;
  ctx.fillRect(0, 0, canvasW, canvasH);

  const myPhotos = selectedPhotos.map(i => capturedPhotos[i]);
  const memeRefs = selectedPhotos.map(i => photoInspoRefs[i] || null);
  const totalImages = myPhotos.length + memeRefs.length;
  let imagesLoaded = 0;

  function onImageDone() {
    imagesLoaded++;
    if (imagesLoaded >= totalImages) drawQR(ctx, canvasW, canvasH, QR_SIZE, QR_PAD);
  }

  function drawAt(img, i, sideIndex, isPlaceholder) {
    let x, y;
    if (isPort) {
      x = border + sideIndex * (slotW + sideGap);
      y = border + i * (slotH + gap);
    } else {
      x = border + i * (slotW + gap);
      y = border + sideIndex * (slotH + sideGap);
    }

    if (isPlaceholder || !img) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(x, y, slotW, slotH);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.font = '13px "DM Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🖼️ missing image', x + slotW / 2, y + slotH / 2);
      ctx.restore();
    } else {
      const srcAR = img.naturalWidth / img.naturalHeight;
      const dstAR = slotW / slotH;
      let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
      if (srcAR > dstAR) { sw = sh * dstAR; sx = (img.naturalWidth - sw) / 2; }
      else               { sh = sw / dstAR; sy = (img.naturalHeight - sh) / 2; }

      if (useGreyscale) {
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

      if (tintOpacity > 0) {
        const [tr, tg, tb] = hexToRgb(tintColor);
        ctx.save();
        ctx.globalAlpha = tintOpacity;
        ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
        ctx.fillRect(x, y, slotW, slotH);
        ctx.restore();
      }
    }

    onImageDone();
  }

  if (totalImages === 0) { drawQR(ctx, canvasW, canvasH, QR_SIZE, QR_PAD); return; }

  myPhotos.forEach((src, i) => {
    const img = new Image();
    img.onload = () => drawAt(img, i, 0);
    img.src = src;
    if (img.complete && img.naturalWidth) drawAt(img, i, 0);
  });

  memeRefs.forEach((ref, i) => {
    if (!ref) { drawAt(null, i, 1, true); return; }
    loadImageForCanvas(getInspoImageUrl(ref.theme, ref.index), (img, found) => {
      drawAt(img, i, 1, !found);
    });
  });
}
