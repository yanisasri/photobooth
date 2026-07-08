/* ═══════════════════════════════════════════════════
   VIDEO.JS — records a very short clip of "the process"
   for every photo taken, then composites the clips for
   your chosen photos into a single looping video laid
   out exactly like the photo strip (videos in place of
   photos), matching the current frame color / tint /
   greyscale. Recorded for 15 seconds with each clip
   looping to fill the time, and downloaded as .mp4 where
   the browser supports it (most current browsers do),
   falling back to .webm otherwise.

   Hooks called from photobooth.js (all optional / no-ops
   if this file fails to load):
     - resetVideoCapture()          → initCamera()
     - startPhotoRecording()        → startCountdown() (when count hits 1)
     - stopPhotoRecordingAndStore() → takePhoto()
     - initVideoDownloadUI()        → initDownload()
═══════════════════════════════════════════════════ */

const VIDEO_STRIP_DURATION_MS = 15000;
const VIDEO_STRIP_FPS         = 20;

let capturedVideoBlobs = [];   // parallel array to capturedPhotos
let videoMimeType       = null;
let activeVideoRecorder  = null;
let activeVideoChunks    = [];

let videoStripBlob       = null;
let videoStripUrl        = null;
let videoStripMimeType   = null;
let videoStripGenerating = false;
let videoStripLiveEls    = [];  // <video> elements currently playing for a live composite

// Per-photo clip recorder — tries mp4 first (widely supported by modern
// browsers now), falls back to webm.
function pickVideoMimeType() {
  if (videoMimeType) return videoMimeType;
  const candidates = [
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  videoMimeType = candidates.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  return videoMimeType;
}

// The composited strip has no audio track, so codecs can be video-only.
function pickStripMimeType() {
  const candidates = [
    'video/mp4;codecs=avc1',
    'video/mp4;codecs=h264',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  return candidates.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
}

function resetVideoCapture() {
  capturedVideoBlobs = [];
  activeVideoRecorder = null;
  activeVideoChunks = [];
}

// Starts recording a short clip — called right as the countdown hits "1".
function startPhotoRecording() {
  if (!window.MediaRecorder || !cameraStream) return;
  const mimeType = pickVideoMimeType();
  try {
    activeVideoChunks = [];
    const opts = mimeType ? { mimeType } : undefined;
    activeVideoRecorder = new MediaRecorder(cameraStream, opts);
    activeVideoRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) activeVideoChunks.push(e.data);
    };
    activeVideoRecorder.start();
  } catch (e) {
    console.warn('Video recording unavailable:', e);
    activeVideoRecorder = null;
  }
}

// Stops the in-flight recorder and stores the resulting blob
// at the same index as the photo that was just captured.
function stopPhotoRecordingAndStore() {
  const recorder = activeVideoRecorder;
  if (!recorder || recorder.state === 'inactive') return;
  const idx = capturedPhotos.length - 1; // photo already pushed by takePhoto()
  recorder.onstop = () => {
    const blob = new Blob(activeVideoChunks, { type: recorder.mimeType || videoMimeType || 'video/webm' });
    capturedVideoBlobs[idx] = blob;
  };
  try { recorder.stop(); } catch (e) { /* ignore */ }
  activeVideoRecorder = null;
}

function extensionForMimeType(mt) {
  return (mt || '').indexOf('mp4') !== -1 ? 'mp4' : 'webm';
}

// ── Download page wiring ──

function initVideoDownloadUI() {
  const wrap    = document.getElementById('video-preview-wrap');
  const preview = document.getElementById('final-video-preview');
  const dlBtn   = document.getElementById('download-video-btn');
  const makeBtn = document.getElementById('make-video-btn');
  const statusEl = document.getElementById('video-status');

  stopLiveVideoStripSources();
  if (videoStripUrl) { URL.revokeObjectURL(videoStripUrl); videoStripUrl = null; }
  videoStripBlob = null;
  videoStripMimeType = null;

  if (preview) preview.removeAttribute('src');
  if (wrap) wrap.style.display = 'none';
  if (dlBtn) dlBtn.style.display = 'none';
  if (statusEl) statusEl.textContent = '';

  const hasAnyClip = selectedPhotos.some(i => capturedVideoBlobs[i]);
  if (makeBtn) {
    makeBtn.style.display = hasAnyClip ? 'inline-block' : 'none';
    makeBtn.textContent = '🎬 make video strip (15s)';
    makeBtn.disabled = false;
  }
}

// ── Compositing ──

function loadVideoEl(blob) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.src = URL.createObjectURL(blob);
    const done = () => resolve(video);
    video.addEventListener('loadedmetadata', done, { once: true });
    video.addEventListener('error', () => resolve(null), { once: true });
  });
}

function loadImgEl(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function stopLiveVideoStripSources() {
  videoStripLiveEls.forEach(el => {
    try { el.pause(); } catch (e) {}
    if (el.src) URL.revokeObjectURL(el.src);
  });
  videoStripLiveEls = [];
}

async function generateVideoStrip() {
  if (videoStripGenerating) return;
  const btn      = document.getElementById('make-video-btn');
  const statusEl = document.getElementById('video-status');
  const wrap     = document.getElementById('video-preview-wrap');
  const preview  = document.getElementById('final-video-preview');
  const dlBtn    = document.getElementById('download-video-btn');

  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    if (statusEl) statusEl.textContent = "Sorry, this browser can't generate video strips.";
    return;
  }

  videoStripGenerating = true;
  if (btn) { btn.disabled = true; btn.textContent = 'recording… 0%'; }
  if (statusEl) statusEl.textContent = 'looping through your clips — this takes about 15 seconds…';
  if (dlBtn) dlBtn.style.display = 'none';

  try {
    const { blob, mimeType } = await recordVideoStrip((pct) => {
      if (btn) btn.textContent = `recording… ${pct}%`;
    });

    if (videoStripUrl) URL.revokeObjectURL(videoStripUrl);
    videoStripBlob = blob;
    videoStripMimeType = mimeType;
    videoStripUrl = URL.createObjectURL(blob);

    if (preview) preview.src = videoStripUrl;
    if (wrap) wrap.style.display = 'flex';
    if (dlBtn) dlBtn.style.display = 'inline-block';
    if (statusEl) statusEl.textContent = '';
    if (btn) { btn.textContent = '🎬 regenerate video strip'; btn.disabled = false; }
  } catch (e) {
    console.error('Video strip generation failed:', e);
    if (statusEl) statusEl.textContent = "Couldn't generate the video strip on this browser.";
    if (btn) { btn.textContent = '🎬 make video strip (15s)'; btn.disabled = false; }
  } finally {
    videoStripGenerating = false;
  }
}

function recordVideoStrip(onProgress) {
  return new Promise(async (resolve, reject) => {
    const isPort = selectedOrientation === 'portrait';
    const border = 20;
    const { slotW, slotH, gap } = getSlotDims(selectedCount, selectedOrientation, 240);

    const QR_SIZE = Math.round(isPort ? slotW * 0.18 : slotH * 0.18);
    const QR_PAD  = 8;

    const canvasW = isPort
      ? slotW + border * 2
      : slotW * selectedCount + gap * (selectedCount - 1) + border * 2;
    const canvasH = isPort
      ? slotH * selectedCount + gap * (selectedCount - 1) + border * 2 + QR_SIZE + QR_PAD
      : slotH + border * 2 + QR_SIZE + QR_PAD;

    // Load each slot's video clip (or fall back to the still photo if a
    // clip failed to record) plus the QR stamp, before starting to record.
    const slotPromises = selectedPhotos.map(async (idx) => {
      const blob = capturedVideoBlobs[idx];
      if (blob) {
        const video = await loadVideoEl(blob);
        if (video) return { video, img: null };
      }
      const img = await loadImgEl(capturedPhotos[idx]);
      return { video: null, img };
    });

    const [slots, qrImg] = await Promise.all([
      Promise.all(slotPromises),
      loadImgEl('qr.jpg'),
    ]);

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');

    const liveVideos = slots.map(s => s.video).filter(Boolean);
    videoStripLiveEls = liveVideos;
    await Promise.all(liveVideos.map(v => v.play().catch(() => {})));

    function drawFrame() {
      ctx.filter = 'none';
      ctx.fillStyle = frameColor;
      ctx.fillRect(0, 0, canvasW, canvasH);

      slots.forEach((slot, i) => {
        const x = isPort ? border : border + i * (slotW + gap);
        const y = border + (isPort ? i * (slotH + gap) : 0);
        const source = slot.video || slot.img;
        if (!source) return;

        const natW = source.videoWidth || source.naturalWidth || slotW;
        const natH = source.videoHeight || source.naturalHeight || slotH;
        const srcAR = natW / natH;
        const dstAR = slotW / slotH;
        let sx = 0, sy = 0, sw = natW, sh = natH;
        if (srcAR > dstAR) { sw = natH * dstAR; sx = (natW - sw) / 2; }
        else               { sh = natW / dstAR; sy = (natH - sh) / 2; }

        ctx.save();
        ctx.filter = useGreyscale ? 'grayscale(1)' : 'none';
        ctx.drawImage(source, sx, sy, sw, sh, x, y, slotW, slotH);
        ctx.restore();

        if (tintOpacity > 0) {
          const [tr, tg, tb] = hexToRgb(tintColor);
          ctx.save();
          ctx.globalAlpha = tintOpacity;
          ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
          ctx.fillRect(x, y, slotW, slotH);
          ctx.restore();
        }
      });

      if (qrImg) {
        const qx = canvasW - QR_SIZE - 12;
        const qy = canvasH - QR_SIZE - 10;
        ctx.drawImage(qrImg, qx, qy, QR_SIZE, QR_SIZE);
      }
    }

    const stream = canvas.captureStream(VIDEO_STRIP_FPS);
    const mimeType = pickStripMimeType();
    let recorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (e) {
      stopLiveVideoStripSources();
      reject(e);
      return;
    }

    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

    let rafId = null;
    recorder.onstop = () => {
      if (rafId) cancelAnimationFrame(rafId);
      stopLiveVideoStripSources();
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'video/webm' });
      resolve({ blob, mimeType: recorder.mimeType || mimeType });
    };
    recorder.onerror = (e) => {
      if (rafId) cancelAnimationFrame(rafId);
      stopLiveVideoStripSources();
      reject(e.error || e);
    };

    recorder.start();
    const startTime = performance.now();

    function loop() {
      drawFrame();
      const elapsed = performance.now() - startTime;
      if (onProgress) onProgress(Math.min(99, Math.round((elapsed / VIDEO_STRIP_DURATION_MS) * 100)));
      if (elapsed < VIDEO_STRIP_DURATION_MS) {
        rafId = requestAnimationFrame(loop);
      } else {
        try { recorder.stop(); } catch (e) {}
      }
    }
    rafId = requestAnimationFrame(loop);
  });
}

function downloadVideo() {
  if (!videoStripBlob) return;
  const url  = URL.createObjectURL(videoStripBlob);
  const link = document.createElement('a');
  link.download = 'photobooth-strip.' + extensionForMimeType(videoStripMimeType);
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
