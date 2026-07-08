/* ═══════════════════════════════════════════════════
   DUO.JS — long-distance duo mode.
   Two browsers connect directly over WebRTC via PeerJS
   (its free public broker is only used to help the two
   peers find each other — once connected, everything
   flows peer-to-peer, nothing touches a server we run).

   Protocol (JSON messages over the PeerJS DataConnection):
     {type:'hello', name}
     {type:'cursor', x, y}                    // normalized 0-1
     {type:'layout', count, orientation, inspo}
     {type:'progress', count}                 // photos taken so far
     {type:'selectedPhotos', photos, style}
     {type:'style', frameColor, tintColor, tintOpacity, useGreyscale}
     {type:'leave'}

   Hooks called from photobooth.js:
     - initDuoSetup()      → goTo('duo-setup')
     - onInitLayoutDuo()   → initLayout()
     - onCameraInitDuo()   → initCamera()
     - onPhotoTakenDuo()   → takePhoto()
     - onDoneChooseDuo()   → doneChoose() (replaces plain goTo('download'))
     - renderFinalCanvasDuo() → called from renderFinalCanvasAny() when active
     - broadcastDuoStyleIfActive() → color/tint/greyscale change handlers

   Long-distance duo mode and inspo mode are independent features —
   picking a meme theme has no effect on whether you're in a duo
   session, and vice versa. If both happen to be active at once,
   the duo two-sided strip (you vs. your friend) takes priority over
   the inspo comparison strip on the download page.
═══════════════════════════════════════════════════ */

let duoActive           = false;
let duoRole             = null;   // 'host' | 'guest'
let duoPeer             = null;
let duoConn             = null;
let duoCode             = null;
let myName              = 'You';
let friendName          = 'Friend';
let duoFriendPhotoCount = 0;
let mySelectedPhotosSent = false;
let friendSelectedPhotos = null;
let duoCursorsReady      = false;
let lastCursorSendTime   = 0;

// ── Room creation / joining ──

function genDuoCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // skip ambiguous 0/O/1/I
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function teardownExistingPeer() {
  if (duoConn) { try { duoConn.close(); } catch (e) {} duoConn = null; }
  if (duoPeer) { try { duoPeer.destroy(); } catch (e) {} duoPeer = null; }
}

function duoCreateRoom() {
  teardownExistingPeer();
  const nameInput = document.getElementById('duo-name-input');
  myName = (nameInput.value || '').trim() || 'You';
  duoRole = 'host';
  attemptCreateDuoPeer(0);
}

function attemptCreateDuoPeer(attempt) {
  const status = document.getElementById('duo-status');
  if (status) status.textContent = 'Setting up your room…';

  const code = genDuoCode();
  const peer = new Peer(code, { debug: 1 });

  peer.on('open', (id) => {
    duoPeer = peer;
    duoCode = id;
    const codeValue = document.getElementById('duo-code-value');
    const codeDisplay = document.getElementById('duo-code-display');
    if (codeValue) codeValue.textContent = duoCode;
    if (codeDisplay) codeDisplay.style.display = 'flex';
    if (status) status.textContent = 'Waiting for your friend to join…';
  });

  peer.on('connection', (conn) => {
    duoConn = conn;
    conn.on('open', () => setupDuoConnection());
  });

  peer.on('error', (err) => {
    console.error('Peer error:', err);
    if (err.type === 'unavailable-id' && attempt < 5) {
      peer.destroy();
      attemptCreateDuoPeer(attempt + 1);
    } else if (status) {
      status.textContent = 'Connection error (' + err.type + '). Please reload and try again.';
    }
  });
}

function duoJoinRoom() {
  teardownExistingPeer();
  const nameInput = document.getElementById('duo-name-input');
  myName = (nameInput.value || '').trim() || 'You';
  const codeInput = document.getElementById('duo-join-input');
  const code = (codeInput.value || '').trim().toUpperCase();
  const status = document.getElementById('duo-status');
  if (!code) { if (status) status.textContent = 'Please enter a room code.'; return; }

  duoRole = 'guest';
  if (status) status.textContent = 'Connecting…';
  duoPeer = new Peer(undefined, { debug: 1 });

  duoPeer.on('open', () => {
    duoConn = duoPeer.connect(code, { reliable: true });
    duoConn.on('open', () => setupDuoConnection());
    duoConn.on('error', (err) => {
      console.error('Connection error:', err);
      if (status) status.textContent = 'Could not connect. Check the code and try again.';
    });
  });

  duoPeer.on('error', (err) => {
    console.error('Peer error:', err);
    if (status) status.textContent = 'Connection error (' + err.type + '). Please try again.';
  });
}

function duoCopyCode() {
  if (!duoCode) return;
  const done = () => {
    const btn = document.getElementById('duo-copy-btn');
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = 'copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(duoCode).then(done).catch(() => {});
  }
}

// ── Connection lifecycle ──

function setupDuoConnection() {
  duoActive = true;
  document.body.classList.add('duo-active');
  initDuoCursors();

  duoConn.on('data', onDuoData);
  duoConn.on('close', () => {
    const status = document.getElementById('duo-status');
    if (status) status.textContent = friendName + ' disconnected.';
  });

  sendDuo({ type: 'hello', name: myName });
  updateDuoHeaderBadge();

  const status = document.getElementById('duo-status');
  if (status) status.textContent = 'Connected! Say hi 👋';

  setTimeout(() => goTo('layout'), 400);
}

function sendDuo(msg) {
  if (duoConn && duoConn.open) {
    try { duoConn.send(msg); } catch (e) { console.warn('sendDuo failed:', e); }
  }
}

function onDuoData(msg) {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'hello':
      friendName = msg.name || 'Friend';
      updateDuoHeaderBadge();
      break;

    case 'cursor':
      updateFriendCursor(msg.x, msg.y);
      break;

    case 'layout':
      selectedCount = msg.count;
      selectedOrientation = msg.orientation;
      goTo('camera');
      break;

    case 'progress':
      duoFriendPhotoCount = msg.count;
      updateDuoFriendProgress();
      break;

    case 'selectedPhotos':
      friendSelectedPhotos = msg.photos || [];
      if (msg.style) {
        frameColor   = msg.style.frameColor   ?? frameColor;
        tintColor    = msg.style.tintColor    ?? tintColor;
        tintOpacity  = msg.style.tintOpacity  ?? tintOpacity;
        useGreyscale = !!msg.style.useGreyscale;
      }
      maybeAdvanceToDownload();
      break;

    case 'style':
      frameColor   = msg.frameColor;
      tintColor    = msg.tintColor;
      tintOpacity  = msg.tintOpacity;
      useGreyscale = !!msg.useGreyscale;
      if (document.getElementById('page-download').classList.contains('active')) {
        renderFinalCanvasDuo();
      }
      break;

    case 'leave':
      handleFriendLeft();
      break;
  }
}

function broadcastDuoStyleIfActive() {
  if (!duoActive) return;
  sendDuo({ type: 'style', frameColor, tintColor, tintOpacity, useGreyscale });
}

// ── Cursors ──

function initDuoCursors() {
  if (duoCursorsReady) return;
  duoCursorsReady = true;

  const you = document.createElement('div');
  you.className = 'duo-cursor duo-cursor-you';
  you.innerHTML = '<div class="duo-cursor-dot"></div><div class="duo-cursor-label" id="duo-cursor-you-label"></div>';
  you.style.opacity = '0';
  document.body.appendChild(you);

  const friend = document.createElement('div');
  friend.className = 'duo-cursor duo-cursor-friend';
  friend.innerHTML = '<div class="duo-cursor-dot"></div><div class="duo-cursor-label" id="duo-cursor-friend-label"></div>';
  friend.style.opacity = '0';
  document.body.appendChild(friend);

  updateDuoCursorLabels();

  document.addEventListener('mousemove', (e) => {
    if (!duoActive) return;
    you.style.opacity = '1';
    you.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    const now = Date.now();
    if (now - lastCursorSendTime > 40) {
      lastCursorSendTime = now;
      sendDuo({ type: 'cursor', x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    }
  });
}

function updateFriendCursor(nx, ny) {
  const friend = document.querySelector('.duo-cursor-friend');
  if (!friend) return;
  friend.style.opacity = '1';
  friend.style.transform = `translate(${nx * window.innerWidth}px, ${ny * window.innerHeight}px)`;
}

function updateDuoCursorLabels() {
  const youLabel = document.getElementById('duo-cursor-you-label');
  const friendLabel = document.getElementById('duo-cursor-friend-label');
  if (youLabel) youLabel.textContent = myName;
  if (friendLabel) friendLabel.textContent = friendName;
}

// ── Header badge ──

function updateDuoHeaderBadge() {
  const badge = document.getElementById('duo-header-badge');
  if (!badge) return;
  if (duoActive) {
    badge.style.display = 'inline-block';
    badge.style.cursor = 'pointer';
    badge.textContent = '👯 duo: you & ' + friendName;
    badge.onclick = () => { if (confirm('Leave duo mode?')) leaveDuoMode(); };
  } else {
    badge.style.display = 'none';
    badge.onclick = null;
  }
  updateDuoCursorLabels();
}

function handleFriendLeft() {
  const status = document.getElementById('duo-status');
  if (status) status.textContent = friendName + ' left the session.';
}

function leaveDuoMode() {
  if (duoConn) { try { sendDuo({ type: 'leave' }); duoConn.close(); } catch (e) {} }
  if (duoPeer) { try { duoPeer.destroy(); } catch (e) {} }
  duoActive = false;
  duoRole = null;
  duoConn = null;
  duoPeer = null;
  friendSelectedPhotos = null;
  mySelectedPhotosSent = false;
  document.body.classList.remove('duo-active');
  document.querySelectorAll('.duo-cursor').forEach(el => el.remove());
  duoCursorsReady = false;
  updateDuoHeaderBadge();
  goTo('landing');
}

// ── Duo setup page ──

function initDuoSetup() {
  const status = document.getElementById('duo-status');
  const codeDisplay = document.getElementById('duo-code-display');
  if (duoActive) {
    if (status) status.textContent = 'Connected with ' + friendName + '.';
  } else {
    if (status) status.textContent = '';
    if (codeDisplay) codeDisplay.style.display = 'none';
  }
  const nameInput = document.getElementById('duo-name-input');
  if (nameInput && myName && myName !== 'You') nameInput.value = myName;
}

// ── Layout page ──

function onInitLayoutDuo() {
  const waitingMsg   = document.getElementById('layout-duo-waiting');
  const tabGroup     = document.getElementById('layout-tab-group');
  const selectBtn    = document.querySelector('.select-btn');
  const inspoPanel   = document.getElementById('inspo-panel');
  const orientToggle = document.querySelector('.orientation-toggle');

  if (duoActive && duoRole === 'guest') {
    if (waitingMsg) waitingMsg.style.display = 'block';
    if (tabGroup) tabGroup.style.display = 'none';
    if (selectBtn) selectBtn.style.display = 'none';
    if (inspoPanel) inspoPanel.style.display = 'none';
    if (orientToggle) orientToggle.classList.remove('visible');
  } else {
    if (waitingMsg) waitingMsg.style.display = 'none';
    if (tabGroup) tabGroup.style.display = 'flex';
    if (selectBtn) selectBtn.style.display = 'inline-block';
    if (inspoPanel) inspoPanel.style.display = 'flex';
  }
}

// ── Camera page ──

function onCameraInitDuo() {
  const progressEl = document.getElementById('duo-friend-progress');
  if (!progressEl) return;
  if (duoActive) {
    progressEl.style.display = 'block';
    duoFriendPhotoCount = 0;
    mySelectedPhotosSent = false;
    friendSelectedPhotos = null;
    updateDuoFriendProgress();
  } else {
    progressEl.style.display = 'none';
  }
}

function onInitChooseDuo() {
  if (!duoActive) return;
  const btn = document.querySelector('#page-choose .done-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'done'; }
}

function updateDuoFriendProgress() {
  const el = document.getElementById('duo-friend-progress');
  if (!el) return;
  el.textContent = `${friendName} has taken ${duoFriendPhotoCount}/${MAX_PHOTOS} photos`;
}

function onPhotoTakenDuo() {
  if (!duoActive) return;
  sendDuo({ type: 'progress', count: capturedPhotos.length });
}

// ── Choose page ──

function onDoneChooseDuo() {
  if (!duoActive) { goTo('download'); return; }

  const myPhotos = selectedPhotos.map(i => capturedPhotos[i]);
  sendDuo({
    type: 'selectedPhotos',
    photos: myPhotos,
    style: { frameColor, tintColor, tintOpacity, useGreyscale }
  });
  mySelectedPhotosSent = true;
  maybeAdvanceToDownload();
}

function maybeAdvanceToDownload() {
  if (!duoActive) return;
  const btn = document.querySelector('#page-choose .done-btn');
  if (mySelectedPhotosSent && friendSelectedPhotos) {
    if (btn) { btn.disabled = false; btn.textContent = 'done'; }
    if (!document.getElementById('page-download').classList.contains('active')) {
      goTo('download');
    }
  } else if (mySelectedPhotosSent) {
    if (btn) { btn.disabled = true; btn.textContent = 'waiting for ' + friendName + '…'; }
  }
}

// ── Download page: two-sided strip ──
// (invoked directly by renderFinalCanvasAny() in photobooth.js)

function renderFinalCanvasDuo() {
  const canvas = document.getElementById('final-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const isPort = selectedOrientation === 'portrait';

  const border   = 20;
  const sideGap  = 20;
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

  const myPhotos    = selectedPhotos.map(i => capturedPhotos[i]);
  const theirPhotos = friendSelectedPhotos || [];
  const totalImages = myPhotos.length + theirPhotos.length;
  let imagesLoaded  = 0;

  function onImageDone() {
    imagesLoaded++;
    if (imagesLoaded >= totalImages) drawQR(ctx, canvasW, canvasH, QR_SIZE, QR_PAD);
  }

  function drawSide(photos, sideIndex) {
    photos.forEach((src, i) => {
      const img = new Image();
      const draw = () => {
        let x, y;
        if (isPort) {
          x = border + sideIndex * (slotW + sideGap);
          y = border + i * (slotH + gap);
        } else {
          x = border + i * (slotW + gap);
          y = border + sideIndex * (slotH + sideGap);
        }

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

        onImageDone();
      };
      img.onload = draw;
      img.src = src;
      if (img.complete && img.naturalWidth) draw();
    });
  }

  if (totalImages === 0) { drawQR(ctx, canvasW, canvasH, QR_SIZE, QR_PAD); return; }
  drawSide(myPhotos, 0);
  drawSide(theirPhotos, 1);
}
