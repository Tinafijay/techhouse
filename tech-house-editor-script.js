// ============================================================
// TECH HOUSE VIDEO EDITOR — script.js
// FFmpeg.wasm 0.11.0 / Chrome 103+
// ============================================================

'use strict';

const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({
  log: true,
  corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
});

// ── DOM refs ─────────────────────────────────────────────────
const player        = document.getElementById('player');
const uploadZone    = document.getElementById('upload-zone');
const statusText    = document.getElementById('status-text');
const livePolite    = document.getElementById('live-region-polite');
const liveUrgent    = document.getElementById('live-region-urgent');
const engineBadge   = document.getElementById('engine-badge');

// ── App state ─────────────────────────────────────────────────
let mainVideoFile = null;
let assets = { logo: null, illustration: null, bgm: null, sfx: null };
let times  = { s: 0, e: 0, illuAt: 0, sfxAt: 0, duration: 0 };
let aspect = 'landscape';
let preset = 'ultrafast';
let pendingLayerType = null;
let engineReady = false;
let dragType = null;

// ── Announce helpers ──────────────────────────────────────────
// Clears region first so identical messages re-fire on screen readers.
function announce(msg, urgent = false) {
  const el = urgent ? liveUrgent : livePolite;
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = msg; });
}

function setStatus(msg, urgent = false) {
  statusText.textContent = msg;
  console.log('[STATUS]', msg);
  announce(msg, urgent);
}

function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  document.getElementById('toast-wrap').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ── Engine init ───────────────────────────────────────────────
(async function initEngine() {
  setStatus('Loading FFmpeg engine…');
  try {
    await ffmpeg.load();
    engineReady = true;
    engineBadge.textContent = 'ENGINE READY';
    engineBadge.classList.add('online');
    setStatus('Engine ready. Load a video to start.');
    toast('FFmpeg engine loaded ✓', 'success');
  } catch (err) {
    engineBadge.textContent = 'ENGINE ERROR';
    setStatus('Engine failed to load. Please refresh the page.', true);
    toast('Engine error — please refresh', 'error');
    console.error(err);
  }
})();

// ── Video upload ──────────────────────────────────────────────
document.getElementById('vid-uploader').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  mainVideoFile = file;
  player.src = URL.createObjectURL(file);
  player.load();
  player.onloadedmetadata = () => {
    times.duration = player.duration;
    times.s = 0;
    times.e = player.duration;
    uploadZone.classList.add('hidden');
    player.classList.remove('hidden');
    document.getElementById('export-btn').disabled = false;
    updateTimecodes();
    updateTrimBar();
    updateSummary();
    setStatus(`Loaded: "${file.name}" — ${fmtTime(player.duration)}`);
    toast('Video loaded ✓', 'success');
  };
};

// Drag-and-drop onto upload zone
uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.style.borderColor = 'var(--amber)';
});
uploadZone.addEventListener('dragleave', () => {
  uploadZone.style.borderColor = '';
});
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.style.borderColor = '';
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('video/')) {
    const dt = new DataTransfer();
    dt.items.add(file);
    document.getElementById('vid-uploader').files = dt.files;
    document.getElementById('vid-uploader').dispatchEvent(new Event('change'));
  }
});

// ── Layer uploads ─────────────────────────────────────────────
function triggerLayer(type) {
  pendingLayerType = type;
  const input = document.getElementById('layer-uploader');
  input.accept = (type === 'logo' || type === 'illustration') ? 'image/*' : 'audio/*';
  input.click();
}

document.getElementById('layer-uploader').onchange = (e) => {
  const file = e.target.files[0];
  if (!file || !pendingLayerType) return;
  const type = pendingLayerType;
  pendingLayerType = null;
  assets[type] = file;

  if (type === 'illustration') times.illuAt = player.currentTime || 0;
  if (type === 'sfx')          times.sfxAt  = player.currentTime || 0;

  const el   = document.getElementById('layer-' + type);
  const desc = document.getElementById('desc-' + type);
  if (el) el.classList.add('loaded');
  if (desc) {
    const short = file.name.length > 22 ? file.name.slice(0, 20) + '…' : file.name;
    if (type === 'illustration') desc.textContent = `At ${fmtTime(times.illuAt)} — ${short}`;
    else if (type === 'sfx')     desc.textContent = `At ${fmtTime(times.sfxAt)} — ${short}`;
    else                         desc.textContent = short;
  }

  updateSummary();
  const label = { logo: 'Logo', illustration: 'Illustration', bgm: 'BGM', sfx: 'SFX' }[type];
  setStatus(`${label} added: ${file.name}`);
  toast(`${label} added ✓`, 'success');
  e.target.value = '';
};

// ── Aspect & preset selectors ─────────────────────────────────
function setAspect(val) {
  aspect = val;
  document.querySelectorAll('#seg-landscape, #seg-portrait').forEach(b => {
    const on = b.dataset.val === val;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  updateSummary();
}

function setPreset(val) {
  preset = val;
  document.querySelectorAll('#seg-fast, #seg-balanced, #seg-hq').forEach(b => {
    const on = b.dataset.preset === val;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

// ── Trim bar ──────────────────────────────────────────────────
function updateTrimBar() {
  const dur = times.duration;
  if (!dur) return;
  const sp = times.s / dur;
  const ep = times.e / dur;
  document.getElementById('trim-range').style.left    = (sp * 100) + '%';
  document.getElementById('trim-range').style.width   = ((ep - sp) * 100) + '%';
  document.getElementById('trim-head-s').style.left   = (sp * 100) + '%';
  document.getElementById('trim-head-e').style.left   = (ep * 100) + '%';
  document.getElementById('trim-head-s').setAttribute('aria-valuenow', Math.round(sp * 100));
  document.getElementById('trim-head-e').setAttribute('aria-valuenow', Math.round(ep * 100));
  document.getElementById('trim-duration-label').textContent =
    `${fmtTime(times.s)} → ${fmtTime(times.e)} (${fmtTime(times.e - times.s)})`;
}

player.ontimeupdate = () => {
  const t = player.currentTime;
  document.getElementById('tc-current').textContent = fmtTime(t);
  if (times.duration > 0) {
    document.getElementById('trim-playhead').style.left =
      ((t / times.duration) * 100) + '%';
  }
};

// Drag handles
function startDrag(e, type) {
  dragType = type;
  e.preventDefault();
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup',   stopDrag);
  window.addEventListener('touchmove', onDrag, { passive: false });
  window.addEventListener('touchend',  stopDrag);
}
document.getElementById('trim-head-s').addEventListener('mousedown',  e => startDrag(e, 's'));
document.getElementById('trim-head-e').addEventListener('mousedown',  e => startDrag(e, 'e'));
document.getElementById('trim-head-s').addEventListener('touchstart', e => startDrag(e, 's'), { passive: false });
document.getElementById('trim-head-e').addEventListener('touchstart', e => startDrag(e, 'e'), { passive: false });

function onDrag(e) {
  if (!dragType) return;
  e.preventDefault();
  const rect = document.getElementById('trim-track').getBoundingClientRect();
  const cx   = e.touches ? e.touches[0].clientX : e.clientX;
  const pct  = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
  const t    = pct * times.duration;
  if (dragType === 's') {
    times.s = Math.min(t, times.e - 0.5);
    player.currentTime = times.s;
    document.getElementById('tc-start').textContent = fmtTime(times.s);
    document.getElementById('tc-start').classList.remove('muted');
  } else {
    times.e = Math.max(t, times.s + 0.5);
    player.currentTime = times.e;
    document.getElementById('tc-end').textContent = fmtTime(times.e);
    document.getElementById('tc-end').classList.remove('muted');
  }
  updateTrimBar();
  updateSummary();
}
function stopDrag() {
  dragType = null;
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('mouseup',   stopDrag);
  window.removeEventListener('touchmove', onDrag);
  window.removeEventListener('touchend',  stopDrag);
}

// Click anywhere on track to seek
document.getElementById('trim-track').addEventListener('click', e => {
  if (!times.duration || e.target.classList.contains('trim-head')) return;
  const rect = e.currentTarget.getBoundingClientRect();
  player.currentTime = ((e.clientX - rect.left) / rect.width) * times.duration;
});

// ── Trim buttons ──────────────────────────────────────────────
document.getElementById('btn-set-start').onclick = () => {
  const t = player.currentTime;
  if (t >= times.e) {
    setStatus(`In point must be before Out point (${fmtTime(times.e)}).`, true);
    toast('In point must be before Out point', 'error');
    return;
  }
  times.s = t;
  document.getElementById('tc-start').textContent = fmtTime(t);
  document.getElementById('tc-start').classList.remove('muted');
  updateTrimBar(); updateSummary();
  setStatus(`In point set: ${fmtTime(t)}`);
};

document.getElementById('btn-set-end').onclick = () => {
  const t = player.currentTime;
  if (t <= times.s) {
    setStatus(`Out point must be after In point (${fmtTime(times.s)}).`, true);
    toast('Out point must be after In point', 'error');
    return;
  }
  times.e = t;
  document.getElementById('tc-end').textContent = fmtTime(t);
  document.getElementById('tc-end').classList.remove('muted');
  updateTrimBar(); updateSummary();
  setStatus(`Out point set: ${fmtTime(t)}`);
};

document.getElementById('btn-reset-trim').onclick = () => {
  times.s = 0;
  times.e = times.duration;
  document.getElementById('tc-start').textContent = fmtTime(0);
  document.getElementById('tc-end').textContent   = fmtTime(times.duration);
  document.getElementById('tc-start').classList.remove('muted');
  document.getElementById('tc-end').classList.remove('muted');
  updateTrimBar(); updateSummary();
  setStatus('Trim reset. Full video selected.');
};

// ── Keyboard shortcuts ────────────────────────────────────────
window.addEventListener('keydown', e => {
  // Don't fire if user is typing in an input
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;

  const k = e.key.toLowerCase();

  if (k === 's' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    document.getElementById('btn-set-start').click();
  }
  if (k === 'e' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    document.getElementById('btn-set-end').click();
  }
  if (k === ' ') {
    e.preventDefault();
    if (!mainVideoFile) return;
    if (player.paused) { player.play();  announce('Playing'); }
    else               { player.pause(); announce('Paused');  }
  }
  if (k === 'v') {
    setStatus(`Current: ${fmtTime(player.currentTime)}  In: ${fmtTime(times.s)}  Out: ${fmtTime(times.e)}`);
  }
  if ((e.ctrlKey || e.metaKey) && k === 'x') {
    e.preventDefault();
    runExport();
  }
  if (k === 'arrowleft' || k === 'arrowright') {
    if (!mainVideoFile) return;
    e.preventDefault();
    const step = e.shiftKey ? 1 : 10;
    const dir  = k === 'arrowleft' ? -1 : 1;
    player.currentTime = Math.max(0, Math.min(times.duration, player.currentTime + dir * step));
    announce(`${e.shiftKey ? '1' : '10'} second ${dir > 0 ? 'forward' : 'back'} — ${fmtTime(player.currentTime)}`);
  }
});

// ── Helpers ───────────────────────────────────────────────────
function fmtTime(t) {
  if (isNaN(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * 10);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${f}`;
}

function updateTimecodes() {
  document.getElementById('tc-start').textContent   = fmtTime(times.s);
  document.getElementById('tc-end').textContent     = fmtTime(times.e);
  document.getElementById('tc-current').textContent = fmtTime(player.currentTime);
}

function updateSummary() {
  const layerNames = Object.entries(assets)
    .filter(([, v]) => v !== null).map(([k]) => k).join(', ') || 'none';
  document.getElementById('summary-aspect').textContent =
    'Format: ' + (aspect === 'portrait' ? '9:16 Vertical' : '16:9 Landscape');
  document.getElementById('summary-layers').textContent = 'Layers: ' + layerNames;
  if (times.duration > 0) {
    document.getElementById('summary-trim').textContent =
      `Trim: ${fmtTime(times.s)} → ${fmtTime(times.e)}`;
  }
}

function setProgress(pct, phase) {
  document.getElementById('prog-fill').style.width = pct + '%';
  document.getElementById('progress-pct').textContent = pct + '%';
  document.getElementById('progress-bar-role').setAttribute('aria-valuenow', pct);
  if (phase) document.getElementById('progress-phase').textContent = phase;
}

// ── MASTER RENDER ENGINE ──────────────────────────────────────
//
// KEY BUGS FIXED VS OLD SCRIPT:
//
//  1. '[0:a]' used as -map target without a matching filter output label
//     → fixed: aTag = '0:a' (no brackets) for direct stream map;
//               aTag = '[aout]' (brackets) only when filter creates that label.
//
//  2. aloop=size=2e+09 caused wasm memory hang
//     → fixed: use -stream_loop -1 on the INPUT, paired with atrim to cap length.
//
//  3. -shortest clipped last frames (float rounding with atrim)
//     → fixed: removed -shortest; atrim alone is sufficient.
//
//  4. Portrait crop produced odd-pixel dimensions → libx264 crash
//     → fixed: trunc(X/2)*2 forces even numbers.
//
//  5. scale=-1 produced odd heights → libx264 crash on overlays
//     → fixed: scale=-2 (rounds to nearest even).
//
async function runExport() {
  if (!mainVideoFile) { toast('No video loaded', 'error'); return; }
  if (!engineReady)   { toast('Engine not ready yet', 'error'); return; }

  setStatus('Preparing render… please wait.');
  document.getElementById('progress-wrap').classList.remove('hidden');
  document.getElementById('download-result').classList.add('hidden');
  document.getElementById('export-btn').disabled = true;
  setProgress(0, 'Writing files to memory…');

  try {
    // Write video to wasm virtual FS
    ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(mainVideoFile));
    setProgress(8, 'Building filter graph…');

    const trimDur       = times.e - times.s;
    const hasLogo       = !!assets.logo;
    const hasIllu       = !!assets.illustration;
    const hasBgm        = !!assets.bgm;
    const hasSfx        = !!assets.sfx;
    const hasExtraAudio = hasBgm || hasSfx;

    // Detect whether the video has an audio stream.
    // Mapping a non-existent audio stream crashes FFmpeg entirely.
    // Chrome exposes webkitAudioDecodedByteCount; Firefox exposes mozHasAudio.
    // Fall back to true (safe assumption — FFmpeg will warn but won't crash).
    const videoHasAudio = (
      player.mozHasAudio !== undefined          ? player.mozHasAudio :
      player.webkitAudioDecodedByteCount !== undefined
                                                 ? player.webkitAudioDecodedByteCount > 0
                                                 : true
    );

    // Write asset files
    if (hasLogo) ffmpeg.FS('writeFile', 'logo.png', await fetchFile(assets.logo));
    if (hasIllu) ffmpeg.FS('writeFile', 'illu.png', await fetchFile(assets.illustration));
    if (hasBgm)  ffmpeg.FS('writeFile', 'bgm.mp3',  await fetchFile(assets.bgm));
    if (hasSfx)  ffmpeg.FS('writeFile', 'sfx.mp3',  await fetchFile(assets.sfx));

    // Build input args.
    // -ss / -t before -i = fast seeking (critical for Chrome 103 wasm build).
    // -stream_loop must come directly before its -i.
    let args = ['-ss', times.s.toFixed(3), '-t', trimDur.toFixed(3), '-i', 'input.mp4'];
    if (hasLogo) args.push('-i', 'logo.png');
    if (hasIllu) args.push('-i', 'illu.png');
    if (hasBgm)  args.push('-stream_loop', '-1', '-i', 'bgm.mp3');
    if (hasSfx)  args.push('-i', 'sfx.mp3');

    // Assign stream indices in the same order as -i flags above
    let idx = 1;
    const logoIdx = hasLogo ? idx++ : -1;
    const illuIdx = hasIllu ? idx++ : -1;
    const bgmIdx  = hasBgm  ? idx++ : -1;
    const sfxIdx  = hasSfx  ? idx++ : -1;

    // Build filter_complex
    let filterParts = [];
    let vTag = '[0:v]';

    // Scale / crop — trunc(X/2)*2 forces even pixel dimensions (libx264 requires this)
    if (aspect === 'portrait') {
      filterParts.push(`${vTag}crop=trunc(ih*9/16/2)*2:trunc(ih/2)*2,scale=720:1280[v0]`);
    } else {
      filterParts.push(`${vTag}scale=1280:720[v0]`);
    }
    vTag = '[v0]';

    if (hasLogo) {
      filterParts.push(`[${logoIdx}:v]scale=120:-2,format=rgba[vlogo]`);
      filterParts.push(`${vTag}[vlogo]overlay=W-w-16:16[v1]`);
      vTag = '[v1]';
    }

    if (hasIllu) {
      const t0 = Math.max(0, times.illuAt - times.s).toFixed(2);
      const t1 = (parseFloat(t0) + 3).toFixed(2);
      filterParts.push(`[${illuIdx}:v]scale=400:-2,format=rgba[villu]`);
      filterParts.push(`${vTag}[villu]overlay=(W-w)/2:(H-h)/2:enable='between(t,${t0},${t1})'[v2]`);
      vTag = '[v2]';
    }

    // Audio chain.
    // aTag = '0:a'    → direct stream map (no filter label, no brackets)
    // aTag = '[aout]' → output of filter graph (has brackets)
    // aTag = null     → no audio (video has no audio and no extra audio layers)
    let aTag = videoHasAudio ? '0:a' : null;

    if (hasExtraAudio) {
      const aMixes = [];

      if (videoHasAudio) {
        filterParts.push(`[0:a]volume=1.0[am]`);
        aMixes.push('[am]');
      }
      if (hasBgm) {
        // atrim caps the looped BGM to exactly trimDur — prevents amix hanging
        filterParts.push(
          `[${bgmIdx}:a]atrim=duration=${trimDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=0.18[abgm]`
        );
        aMixes.push('[abgm]');
      }
      if (hasSfx) {
        const delayMs = Math.max(0, Math.round((times.sfxAt - times.s) * 1000));
        filterParts.push(
          `[${sfxIdx}:a]adelay=${delayMs}|${delayMs},atrim=duration=${trimDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=1.0[asfx]`
        );
        aMixes.push('[asfx]');
      }

      if (aMixes.length === 1) {
        // Single stream — acopy is lighter than amix with inputs=1
        filterParts.push(`${aMixes[0]}acopy[aout]`);
      } else {
        filterParts.push(
          `${aMixes.join('')}amix=inputs=${aMixes.length}:duration=first:dropout_transition=2[aout]`
        );
      }
      aTag = '[aout]';
    }

    const filterComplex = filterParts.join(';');

    // Progress callback
    ffmpeg.setProgress(({ ratio }) => {
      const pct = Math.min(97, Math.round(12 + ratio * 85));
      setProgress(pct, `Encoding… ${pct}%`);
      // Also announce every 25% so screen reader users hear progress
      if (pct === 25 || pct === 50 || pct === 75) announce(`Encoding ${pct} percent`);
    });

    // Audio map args — conditionally included
    const audioArgs = aTag
      ? ['-map', aTag, '-c:a', 'aac', '-b:a', '192k']
      : [];

    await ffmpeg.run(
      ...args,
      '-filter_complex', filterComplex,
      '-map', vTag,
      ...audioArgs,
      '-c:v', 'libx264',
      '-preset', preset,
      '-crf', '22',
      '-movflags', '+faststart',
      'output.mp4'
      // Note: NO -shortest flag. atrim already limits BGM to trimDur.
      // -shortest + atrim caused last-frame clipping due to float rounding.
    );

    setProgress(100, 'Done!');

    // Read result and expose download button
    const data   = ffmpeg.FS('readFile', 'output.mp4');
    const blob   = new Blob([data.buffer], { type: 'video/mp4' });
    const url    = URL.createObjectURL(blob);
    const dlLink = document.getElementById('download-link');
    dlLink.href     = url;
    dlLink.download = `tech-house-${Date.now()}.mp4`;

    const dlResult = document.getElementById('download-result');
    dlResult.classList.remove('hidden');
    dlLink.focus(); // Moves screen reader focus to the download button

    // Also try auto-click — Chrome may block it, but it's harmless
    try { dlLink.click(); } catch (_) {}

    // Cleanup wasm virtual FS
    ['input.mp4', 'logo.png', 'illu.png', 'bgm.mp3', 'sfx.mp3', 'output.mp4'].forEach(f => {
      try { ffmpeg.FS('unlink', f); } catch (_) {}
    });

    setStatus('Export complete! Press the Download Video button to save your file.');
    toast('Export complete ✓', 'success');

  } catch (err) {
    console.error('[EXPORT ERROR]', err);
    setStatus('Export failed: ' + (err.message || String(err)), true);
    toast('Export failed — check the browser console for details', 'error');
  } finally {
    document.getElementById('progress-wrap').classList.add('hidden');
    document.getElementById('export-btn').disabled = false;
    setProgress(0, 'Preparing…');
  }
}