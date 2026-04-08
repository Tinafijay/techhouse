// ============================================================
// TECH HOUSE VIDEO EDITOR — script.js  v3
// Features: Live Preview, Smart Export, Illustration Layout,
//           Logo Position, Cut Segments + Undo, Accessibility
// FFmpeg.wasm 0.11.0 / Chrome 103+
// ============================================================
'use strict';

const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({
  log: true,
  corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
});

// ── DOM refs ─────────────────────────────────────────────────
const player      = document.getElementById('player');
const uploadZone  = document.getElementById('upload-zone');
const statusText  = document.getElementById('status-text');
const livePolite  = document.getElementById('live-region-polite');
const liveUrgent  = document.getElementById('live-region-urgent');
const engineBadge = document.getElementById('engine-badge');
const previewStage = document.getElementById('preview-stage');
const overlayLogo = document.getElementById('overlay-logo');
const overlayIllu = document.getElementById('overlay-illu');

// ── Preview audio elements (for live preview only, not exported) ──
const bgmAudio  = new Audio();
const sfxAudio  = new Audio();
const swapAudio = new Audio(); // Audio Swap preview
bgmAudio.loop   = true;
bgmAudio.volume = 0.18;
swapAudio.loop  = true; // loop swap during preview so it doesn't cut out
let sfxTriggered = false;

// ── App state ─────────────────────────────────────────────────
let mainVideoFile = null;
let assets = { logo: null, illustration: null, bgm: null, sfx: null, audioSwap: null };
let times  = { s: 0, e: 0, illuAt: 0, sfxAt: 0, duration: 0 };

// audioProcessing: 'swap' | 'noise' | 'mute'
let audioProcessing = 'swap';

// Segments: array of {s, e} representing parts of the video to KEEP.
// Initially the whole video. Backspace cuts remove portions.
let segments    = [];
let editHistory = []; // undo stack — each entry is deep-copy of segments + times

let aspect      = 'landscape';
let preset      = 'ultrafast';
let logoPosition = 'top-right';
let illuLayout   = 'center';
let illuDuration = 3;
let pendingLayerType = null;
let engineReady  = false;
let dragType     = null;

// ── Announce helpers ──────────────────────────────────────────
// Clears before setting so identical consecutive messages re-fire.
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
    setStatus('Engine failed to load. Please refresh.', true);
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
    // Reset all cuts on new video load
    segments    = [{ s: 0, e: player.duration }];
    editHistory = [];
    document.getElementById('undo-btn').disabled = true;

    uploadZone.classList.add('hidden');
    previewStage.classList.remove('hidden');
    document.getElementById('export-btn').disabled = false;

    updateTimecodes();
    updateTrimBar();
    updateSegmentDisplay();
    updateSummary();
    setStatus(`Loaded: "${file.name}" — ${fmtTime(player.duration)}`);
    toast('Video loaded ✓', 'success');
  };
};

// Drag-and-drop
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.style.borderColor = 'var(--amber)'; });
uploadZone.addEventListener('dragleave', () => { uploadZone.style.borderColor = ''; });
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

// Audio processing mode (for Audio Swap controls)
function setAudioProcessing(val) {
  audioProcessing = val;
  const note = document.getElementById('audio-processing-note');
  if (val === 'noise') {
    note.textContent = 'anlmdn noise filter will silence original audio mathematically';
  } else if (val === 'mute') {
    note.textContent = 'Original audio muted — no replacement file needed';
  } else {
    note.textContent = 'Swap file replaces original audio track entirely';
  }
  updateSummary();
  announce(`Audio processing set to: ${val === 'swap' ? 'use swap file' : val === 'noise' ? 'noise removal' : 'mute original'}.`);
}

document.getElementById('layer-uploader').onchange = (e) => {
  const file = e.target.files[0];
  if (!file || !pendingLayerType) return;
  const type = pendingLayerType;
  pendingLayerType = null;
  assets[type] = file;

  const objectURL = URL.createObjectURL(file);

  if (type === 'illustration') {
    times.illuAt = player.currentTime || 0;
    document.getElementById('overlay-illu-img').src = objectURL;
    applyIlluLayout(illuLayout);
    announce(`Illustration loaded. Will appear at ${fmtTime(times.illuAt)} for ${illuDuration} seconds. Live preview active.`);
  }
  if (type === 'logo') {
    document.getElementById('overlay-logo-img').src = objectURL;
    overlayLogo.classList.remove('hidden');
    applyLogoPosition(logoPosition);
    announce('Logo loaded. Visible in live preview. Default position: top right.');
  }
  if (type === 'bgm') {
    bgmAudio.src = objectURL;
    announce('Background music loaded. Will play during preview and be mixed on export.');
  }
  if (type === 'sfx') {
    times.sfxAt = player.currentTime || 0;
    sfxAudio.src = objectURL;
    announce(`Sound effect loaded. Will trigger at ${fmtTime(times.sfxAt)}.`);
  }
  if (type === 'audioSwap') {
    swapAudio.src = objectURL;
    swapAudio.load();
    // Mute the video element so original audio is silenced in preview
    player.muted = true;
    announce('Audio Swap loaded. Original video audio is now muted in preview. Swap audio will play instead. On export, the original audio track will be fully replaced.');
  }

  const el   = document.getElementById('layer-' + type);
  const desc = document.getElementById('desc-' + type);
  if (el)   el.classList.add('loaded');
  if (desc) {
    const short = file.name.length > 20 ? file.name.slice(0, 18) + '…' : file.name;
    if (type === 'illustration') desc.textContent = `At ${fmtTime(times.illuAt)} · ${illuDuration}s · ${short}`;
    else if (type === 'sfx')     desc.textContent = `At ${fmtTime(times.sfxAt)} · ${short}`;
    else if (type === 'bgm')     desc.textContent = `Live preview + export · ${short}`;
    else if (type === 'audioSwap') desc.textContent = `Replaces original audio · ${short}`;
    else                         desc.textContent = `${logoPosition} · ${short}`;
  }

  updateSummary();
  const labelMap = { logo:'Logo', illustration:'Illustration', bgm:'BGM', sfx:'SFX', audioSwap:'Audio Swap' };
  setStatus(`${labelMap[type] || type} added: ${file.name}`);
  toast(`${labelMap[type] || type} added ✓`, 'success');
  e.target.value = '';
};

// ── LIVE PREVIEW SYSTEM ───────────────────────────────────────

player.addEventListener('play', () => {
  previewStage.classList.add('playing');
  sfxTriggered = false;

  // BGM: start at offset within trimmed range
  if (assets.bgm && bgmAudio.src) {
    const videoOffset = player.currentTime - times.s;
    const bgmOffset   = ((videoOffset % (bgmAudio.duration || 1)) + (bgmAudio.duration || 1)) % (bgmAudio.duration || 1);
    bgmAudio.currentTime = isFinite(bgmOffset) ? bgmOffset : 0;
    bgmAudio.play().catch(() => {});
  }

  // Audio Swap: mute video, play swap file in sync
  if (assets.audioSwap && swapAudio.src) {
    player.muted = true; // ensure original audio stays silent
    const offset = player.currentTime - times.s;
    const dur    = swapAudio.duration || 0;
    swapAudio.currentTime = dur > 0 ? Math.max(0, offset % dur) : 0;
    swapAudio.play().catch(() => {});
  }
});

player.addEventListener('pause', () => {
  previewStage.classList.remove('playing');
  bgmAudio.pause();
  swapAudio.pause();
});

player.addEventListener('seeked', () => {
  // Re-sync BGM
  if (assets.bgm && bgmAudio.src && !player.paused) {
    const videoOffset = player.currentTime - times.s;
    const bgmOffset   = ((videoOffset % (bgmAudio.duration || 1)) + (bgmAudio.duration || 1)) % (bgmAudio.duration || 1);
    bgmAudio.currentTime = isFinite(bgmOffset) ? bgmOffset : 0;
  }
  // Re-sync Audio Swap
  if (assets.audioSwap && swapAudio.src && !player.paused) {
    const offset = player.currentTime - times.s;
    const dur    = swapAudio.duration || 0;
    swapAudio.currentTime = dur > 0 ? Math.max(0, offset % dur) : 0;
  }
  sfxTriggered = false;
});

player.addEventListener('ended', () => {
  previewStage.classList.remove('playing');
  bgmAudio.pause();
  swapAudio.pause();
});

player.ontimeupdate = () => {
  const t = player.currentTime;

  // Update timecode display
  document.getElementById('tc-current').textContent = fmtTime(t);
  if (times.duration > 0) {
    document.getElementById('trim-playhead').style.left = ((t / times.duration) * 100) + '%';
  }

  // ── Illustration live preview ──
  const illuEl = document.getElementById('overlay-illu');
  if (assets.illustration) {
    const showIllu = t >= times.illuAt && t < (times.illuAt + illuDuration);
    if (showIllu) {
      illuEl.classList.remove('hidden');
    } else {
      illuEl.classList.add('hidden');
    }
  } else {
    illuEl.classList.add('hidden');
  }

  // ── SFX trigger ──
  if (assets.sfx && !sfxTriggered && t >= times.sfxAt && t < times.sfxAt + 0.5) {
    sfxAudio.currentTime = 0;
    sfxAudio.play().catch(() => {});
    sfxTriggered = true;
  }

  // ── Skip cut regions (preview the final edited video) ──
  // Find what segment we're currently in
  const inCut = !segments.some(seg => t >= seg.s - 0.05 && t < seg.e + 0.05);
  if (inCut && !player.paused && segments.length > 0) {
    // Jump to the start of the next segment
    const nextSeg = segments.find(seg => seg.s > t);
    if (nextSeg) {
      player.currentTime = nextSeg.s;
    } else {
      player.pause();
    }
  }
};

// ── Logo & Illustration customization ────────────────────────

function setLogoPosition(val) {
  logoPosition = val;
  applyLogoPosition(val);
  updateSummary();
  // Update desc if logo is loaded
  if (assets.logo) {
    const desc = document.getElementById('desc-logo');
    if (desc) {
      const name = assets.logo.name.length > 20 ? assets.logo.name.slice(0,18)+'…' : assets.logo.name;
      desc.textContent = `${val} · ${name}`;
    }
  }
  announce(`Logo position set to ${val.replace(/-/g,' ')}.`);
}

function applyLogoPosition(val) {
  overlayLogo.className = 'overlay-logo'; // reset
  overlayLogo.classList.add('pos-' + val);
  if (!assets.logo) overlayLogo.classList.add('hidden');
}

function setIlluDuration(val) {
  illuDuration = Math.max(0.5, parseFloat(val) || 3);
  updateSummary();
  announce(`Illustration duration set to ${illuDuration} seconds.`);
}

function setIlluLayout(val) {
  illuLayout = val;
  applyIlluLayout(val);
  updateSummary();
  announce(`Illustration layout set to ${val.replace(/-/g,' ')}.`);
}

function applyIlluLayout(val) {
  const el = document.getElementById('overlay-illu');
  el.className = 'overlay-illu hidden'; // reset, keep hidden state
  el.classList.add('layout-' + val);
}

// ── Aspect & preset ───────────────────────────────────────────
function setAspect(val) {
  aspect = val;
  document.querySelectorAll('#seg-landscape, #seg-portrait').forEach(b => {
    const on = b.dataset.val === val;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  updateSummary();
  announce(`Aspect ratio set to ${val === 'portrait' ? '9 by 16 vertical' : '16 by 9 landscape'}.`);
}

function setPreset(val) {
  preset = val;
  document.querySelectorAll('#seg-fast, #seg-balanced, #seg-hq').forEach(b => {
    const on = b.dataset.preset === val;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const label = { ultrafast: 'Fast', veryfast: 'Balanced', medium: 'High Quality' }[val] || val;
  announce(`Encode speed set to ${label}.`);
}

// ── Trim bar ──────────────────────────────────────────────────
function updateTrimBar() {
  const dur = times.duration;
  if (!dur) return;
  const sp = times.s / dur;
  const ep = times.e / dur;
  document.getElementById('trim-range').style.left  = (sp * 100) + '%';
  document.getElementById('trim-range').style.width = ((ep - sp) * 100) + '%';
  document.getElementById('trim-head-s').style.left = (sp * 100) + '%';
  document.getElementById('trim-head-e').style.left = (ep * 100) + '%';
  document.getElementById('trim-head-s').setAttribute('aria-valuenow', Math.round(sp * 100));
  document.getElementById('trim-head-e').setAttribute('aria-valuenow', Math.round(ep * 100));
  const len = times.e - times.s;
  document.getElementById('trim-duration-label').textContent =
    `${fmtTime(times.s)} → ${fmtTime(times.e)} (${fmtTime(len)})`;
}

// Segment display — green bars above the trim track showing kept parts
function updateSegmentDisplay() {
  const dur = times.duration;
  const track = document.getElementById('segment-track');
  track.innerHTML = '';
  if (!dur || segments.length === 0) return;

  segments.forEach(seg => {
    const bar = document.createElement('div');
    bar.className = 'segment-bar';
    bar.style.left  = ((seg.s / dur) * 100) + '%';
    bar.style.width = (((seg.e - seg.s) / dur) * 100) + '%';
    track.appendChild(bar);
  });

  // Summary text
  const cutEl = document.getElementById('cut-summary');
  const cutCount = segments.length - 1;
  if (cutCount > 0) {
    const totalKept = segments.reduce((acc, s) => acc + (s.e - s.s), 0);
    cutEl.textContent = `${cutCount} cut${cutCount > 1 ? 's' : ''} applied · ${fmtTime(totalKept)} total kept`;
    cutEl.classList.remove('hidden');
  } else {
    cutEl.classList.add('hidden');
  }
  updateSummary();
}

// Drag handles
function startDrag(e, type) {
  dragType = type;
  e.preventDefault();
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup',   stopDrag);
  window.addEventListener('touchmove', onDrag,   { passive: false });
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
  // Full reset — clear cuts too
  pushHistory();
  times.s = 0;
  times.e = times.duration;
  segments = [{ s: 0, e: times.duration }];
  document.getElementById('tc-start').textContent = fmtTime(0);
  document.getElementById('tc-end').textContent   = fmtTime(times.duration);
  document.getElementById('tc-start').classList.remove('muted');
  document.getElementById('tc-end').classList.remove('muted');
  updateTrimBar();
  updateSegmentDisplay();
  updateSummary();
  setStatus('All trims and cuts reset. Full video selected.');
};

// ── CUT SEGMENT (Backspace) ───────────────────────────────────
function cutSegment() {
  if (!mainVideoFile) return;
  const cutS = times.s;
  const cutE = times.e;
  if (cutE - cutS < 0.1) {
    setStatus('Select a range with S and E before cutting.', true);
    toast('Set In and Out points first', 'error');
    return;
  }

  pushHistory(); // save for undo

  // Slice each existing segment against the cut range
  const newSegs = [];
  for (const seg of segments) {
    if (cutS > seg.s) newSegs.push({ s: seg.s, e: Math.min(cutS, seg.e) });
    if (cutE < seg.e) newSegs.push({ s: Math.max(cutE, seg.s), e: seg.e });
  }
  segments = newSegs.filter(s => s.e - s.s > 0.05);

  if (segments.length === 0) {
    undoCut();
    setStatus('Cannot cut the entire video.', true);
    toast('Cannot cut everything', 'error');
    return;
  }

  // FIX: Reset In/Out markers to full range so the next cut can be set freely
  // without hitting the "In point must be before Out point" guard.
  times.s = 0;
  times.e = times.duration;
  document.getElementById('tc-start').textContent = fmtTime(0);
  document.getElementById('tc-end').textContent   = fmtTime(times.duration);
  document.getElementById('tc-start').classList.add('muted');
  document.getElementById('tc-end').classList.add('muted');
  updateTrimBar();

  // Seek to just after the cut point
  player.currentTime = Math.min(cutE + 0.05, times.duration - 0.1);

  updateSegmentDisplay();
  updateSummary();
  document.getElementById('undo-btn').disabled = false;

  const totalKept = segments.reduce((a, s) => a + (s.e - s.s), 0);
  const msg = `Cut applied from ${fmtTime(cutS)} to ${fmtTime(cutE)}. ${fmtTime(totalKept)} remaining. In and Out markers reset. Press Control Z to undo.`;
  setStatus(`Cut: ${fmtTime(cutS)} – ${fmtTime(cutE)} removed.`);
  announce(msg);
  toast('Cut applied ✂', 'info');
}

// ── UNDO ─────────────────────────────────────────────────────
function pushHistory() {
  editHistory.push({
    segments: JSON.parse(JSON.stringify(segments)),
    times:    { ...times }
  });
}

function undoCut() {
  if (editHistory.length === 0) {
    announce('Nothing to undo.');
    return;
  }
  const prev = editHistory.pop();
  segments = prev.segments;
  times    = { ...prev.times };

  document.getElementById('tc-start').textContent = fmtTime(times.s);
  document.getElementById('tc-end').textContent   = fmtTime(times.e);
  document.getElementById('tc-start').classList.remove('muted');
  document.getElementById('tc-end').classList.remove('muted');

  updateTrimBar();
  updateSegmentDisplay();
  updateSummary();
  document.getElementById('undo-btn').disabled = editHistory.length === 0;

  const msg = `Undo successful. ${segments.length} segment${segments.length > 1 ? 's' : ''} restored.`;
  setStatus('Undo: last cut removed.');
  announce(msg);
  toast('Undo ✓', 'info');
}

// ── Keyboard shortcuts ────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

  const k    = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;

  // ── Layer upload shortcuts (all with preventDefault) ──────
  if (ctrl && k === 'l') {
    e.preventDefault();
    announce('Opening logo upload dialog.');
    triggerLayer('logo');
    return;
  }
  if (ctrl && k === 'i') {
    e.preventDefault();
    announce('Opening illustration upload dialog.');
    triggerLayer('illustration');
    return;
  }
  if (ctrl && k === 'b') {
    e.preventDefault();
    announce('Opening background music upload dialog.');
    triggerLayer('bgm');
    return;
  }
  if (ctrl && k === 'f') {
    e.preventDefault(); // stops browser "Find in Page"
    announce('Opening sound effect upload dialog.');
    triggerLayer('sfx');
    return;
  }
  if (ctrl && k === 'u') {
    e.preventDefault();
    announce('Opening audio swap upload dialog.');
    triggerLayer('audioSwap');
    return;
  }

  // ── Edit shortcuts ────────────────────────────────────────
  if (ctrl && k === 'z') {
    e.preventDefault();
    undoCut();
    return;
  }
  if (ctrl && k === 'x') {
    e.preventDefault();
    runExport();
    return;
  }

  // ── Playback / marker shortcuts (no Ctrl) ─────────────────
  if (k === 's' && !ctrl) {
    e.preventDefault();
    document.getElementById('btn-set-start').click();
  }
  if (k === 'e' && !ctrl) {
    e.preventDefault();
    document.getElementById('btn-set-end').click();
  }
  if (k === ' ') {
    e.preventDefault();
    if (!mainVideoFile) return;
    if (player.paused) { player.play();  announce('Playing.'); }
    else               { player.pause(); announce('Paused.'); }
  }
  if (k === 'v' && !ctrl) {
    setStatus(`Current: ${fmtTime(player.currentTime)}  In: ${fmtTime(times.s)}  Out: ${fmtTime(times.e)}`);
  }
  if (k === 'backspace') {
    e.preventDefault();
    cutSegment();
  }
  if (k === 'arrowleft' || k === 'arrowright') {
    if (!mainVideoFile) return;
    e.preventDefault();
    const step = e.shiftKey ? 1 : 10;
    const dir  = k === 'arrowleft' ? -1 : 1;
    player.currentTime = Math.max(0, Math.min(times.duration, player.currentTime + dir * step));
    announce(`${step} second${step > 1 ? 's' : ''} ${dir > 0 ? 'forward' : 'back'}. Now at ${fmtTime(player.currentTime)}.`);
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
  const hasAnyAsset = Object.values(assets).some(Boolean);
  const hasCuts     = segments.length > 1;
  const isCopyMode  = !hasAnyAsset && !hasCuts && segments.length === 1;

  const layerNames = Object.entries(assets)
    .filter(([, v]) => v !== null)
    .map(([k]) => k === 'audioSwap' ? 'audioSwap' : k)
    .join(', ') || 'none';

  // Show audio processing mode if audioSwap is involved
  let audioNote = '';
  if (assets.audioSwap || audioProcessing === 'noise' || audioProcessing === 'mute') {
    const modeLabel = { swap: 'swap file', noise: 'noise removal', mute: 'mute original' };
    audioNote = ` [${modeLabel[audioProcessing] || audioProcessing}]`;
  }

  const cutCount = segments.length - 1;
  document.getElementById('summary-mode').textContent =
    'Mode: ' + (isCopyMode ? '⚡ Fast Copy (stream copy)' : '🔧 Full Re-encode');
  document.getElementById('summary-aspect').textContent =
    'Format: ' + (aspect === 'portrait' ? '9:16 Vertical' : '16:9 Landscape');
  document.getElementById('summary-layers').textContent = 'Layers: ' + layerNames + audioNote;
  if (times.duration > 0) {
    document.getElementById('summary-trim').textContent =
      `Trim: ${fmtTime(times.s)} → ${fmtTime(times.e)}`;
  }
  document.getElementById('summary-cuts').textContent =
    cutCount > 0 ? `Cuts: ${cutCount} applied` : 'Cuts: none';
}

function setProgress(pct, phase) {
  document.getElementById('prog-fill').style.width = pct + '%';
  document.getElementById('progress-pct').textContent = pct + '%';
  document.getElementById('progress-bar-role').setAttribute('aria-valuenow', pct);
  if (phase) document.getElementById('progress-phase').textContent = phase;
}

// ── FFmpeg overlay math helpers ───────────────────────────────
function getLogoOverlayExpr(pos) {
  const pad = 10;
  const map = {
    'top-right':    `W-w-${pad}:${pad}`,
    'top-left':     `${pad}:${pad}`,
    'bottom-right': `W-w-${pad}:H-h-${pad}`,
    'bottom-left':  `${pad}:H-h-${pad}`,
    'center':       `(W-w)/2:(H-h)/2`
  };
  return map[pos] || map['top-right'];
}

function getIlluFilterExpr(layout, inputTag, outTag, t0, t1) {
  // Returns [scaleFilter, overlayFilter] strings
  const enable = `enable='between(t,${t0},${t1})'`;
  switch (layout) {
    case 'fullscreen':
      return [
        `${inputTag}scale=iw:ih,format=rgba[villu]`,  // keep original size, then overlay scales
        // For full screen we scale to W:H
        `${inputTag}scale=W:H,format=rgba[villu]`,
        `VBASE[villu]overlay=0:0:${enable}[${outTag}]`
      ];
    case 'left-third':
      return [
        `${inputTag}scale=trunc(W/3/2)*2:-2,format=rgba[villu]`,
        `VBASE[villu]overlay=0:(H-h)/2:${enable}[${outTag}]`
      ];
    case 'right-third':
      return [
        `${inputTag}scale=trunc(W/3/2)*2:-2,format=rgba[villu]`,
        `VBASE[villu]overlay=W-w:(H-h)/2:${enable}[${outTag}]`
      ];
    case 'center':
    default:
      return [
        `${inputTag}scale=trunc(W*0.45/2)*2:-2,format=rgba[villu]`,
        `VBASE[villu]overlay=(W-w)/2:(H-h)/2:${enable}[${outTag}]`
      ];
  }
}

// ── MASTER RENDER ENGINE ──────────────────────────────────────
//
//  SMART EXPORT:
//  • If no assets AND no cuts AND single segment → -c copy (near-instant)
//  • Otherwise → full filter_complex re-encode
//
//  CUTS EXPORT:
//  • Multiple segments → concat filter (trim each kept segment, concat)
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
    ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(mainVideoFile));
    setProgress(8, 'Building export plan…');

    const hasLogo       = !!assets.logo;
    const hasIllu       = !!assets.illustration;
    const hasBgm        = !!assets.bgm;
    const hasSfx        = !!assets.sfx;
    const hasAudioSwap  = !!assets.audioSwap;
    // noiseMode: user chose 'noise' or 'mute' instead of swap file
    const noiseMode     = audioProcessing === 'noise';
    const muteMode      = audioProcessing === 'mute';
    // Any audio modification that forces re-encode
    const hasAudioMod   = hasAudioSwap || noiseMode || muteMode;
    const hasAnyAsset   = hasLogo || hasIllu || hasBgm || hasSfx || hasAudioMod;
    const hasCuts       = segments.length > 1;

    // ── FAST COPY MODE ────────────────────────────────────────
    // Only valid when: no assets, no cuts, single segment
    if (!hasAnyAsset && !hasCuts && segments.length === 1) {
      const seg     = segments[0];
      const trimDur = seg.e - seg.s;
      setStatus('Smart export: stream copy mode (near instant).');
      announce('Using fast stream copy. No re-encoding needed. Exporting now.');
      setProgress(20, 'Stream copying…');

      ffmpeg.setProgress(({ ratio }) => {
        setProgress(20 + Math.min(75, Math.round(ratio * 75)), 'Copying…');
      });

      await ffmpeg.run(
        '-ss', seg.s.toFixed(3),
        '-t',  trimDur.toFixed(3),
        '-i',  'input.mp4',
        '-c',  'copy',
        '-movflags', '+faststart',
        'output.mp4'
      );

    } else {
      // ── FULL RE-ENCODE MODE ───────────────────────────────
      setProgress(10, 'Building filter graph…');

      // Write asset files
      if (hasLogo)       ffmpeg.FS('writeFile', 'logo.png',  await fetchFile(assets.logo));
      if (hasIllu)       ffmpeg.FS('writeFile', 'illu.png',  await fetchFile(assets.illustration));
      if (hasBgm)        ffmpeg.FS('writeFile', 'bgm.mp3',   await fetchFile(assets.bgm));
      if (hasSfx)        ffmpeg.FS('writeFile', 'sfx.mp3',   await fetchFile(assets.sfx));
      if (hasAudioSwap)  ffmpeg.FS('writeFile', 'swap.mp3',  await fetchFile(assets.audioSwap));

      // Detect video audio stream
      const videoHasAudio = (
        player.mozHasAudio !== undefined
          ? player.mozHasAudio
          : player.webkitAudioDecodedByteCount !== undefined
            ? player.webkitAudioDecodedByteCount > 0
            : true
      );

      // ── Build inputs ──────────────────────────────────────
      let args = [];
      if (hasCuts) {
        args = ['-i', 'input.mp4'];
      } else {
        const seg = segments[0];
        args = ['-ss', seg.s.toFixed(3), '-t', (seg.e - seg.s).toFixed(3), '-i', 'input.mp4'];
      }

      if (hasLogo)  args.push('-i', 'logo.png');
      if (hasIllu)  args.push('-i', 'illu.png');
      if (hasBgm)   args.push('-stream_loop', '-1', '-i', 'bgm.mp3');
      if (hasSfx)   args.push('-i', 'sfx.mp3');
      // Audio swap: loop it so it covers the whole video if shorter
      if (hasAudioSwap) args.push('-stream_loop', '-1', '-i', 'swap.mp3');

      // ── Assign indices ────────────────────────────────────
      let idx = 1;
      const logoIdx  = hasLogo      ? idx++ : -1;
      const illuIdx  = hasIllu      ? idx++ : -1;
      const bgmIdx   = hasBgm       ? idx++ : -1;
      const sfxIdx   = hasSfx       ? idx++ : -1;
      const swapIdx  = hasAudioSwap ? idx++ : -1;

      // ── Build filter_complex ──────────────────────────────
      let filterParts = [];
      let vTag, aTag;

      if (hasCuts) {
        // ── Multi-segment concat ──────────────────────────
        // Build trim+scale for each kept segment, then concat
        const vLabels = [];
        const aLabels = [];

        segments.forEach((seg, i) => {
          const dur = seg.e - seg.s;

          // Video: trim → scale/crop → label
          let scaleFilter;
          if (aspect === 'portrait') {
            scaleFilter = `crop=trunc(ih*9/16/2)*2:trunc(ih/2)*2,scale=720:1280`;
          } else {
            scaleFilter = `scale=1280:720`;
          }
          filterParts.push(`[0:v]trim=${seg.s.toFixed(3)}:${seg.e.toFixed(3)},setpts=PTS-STARTPTS,${scaleFilter}[vs${i}]`);
          vLabels.push(`[vs${i}]`);

          // Audio per segment
          if (videoHasAudio) {
            filterParts.push(`[0:a]atrim=${seg.s.toFixed(3)}:${seg.e.toFixed(3)},asetpts=PTS-STARTPTS[as${i}]`);
            aLabels.push(`[as${i}]`);
          }
        });

        // Concat
        const n = segments.length;
        const concatAudio = videoHasAudio ? 1 : 0;
        if (videoHasAudio) {
          filterParts.push(`${vLabels.join('')}${aLabels.join('')}concat=n=${n}:v=1:a=1[vconcat][aconcat]`);
          vTag = '[vconcat]';
          aTag = '[aconcat]';
        } else {
          filterParts.push(`${vLabels.join('')}concat=n=${n}:v=1:a=0[vconcat]`);
          vTag = '[vconcat]';
          aTag = null;
        }

        // Apply logo overlay on concatenated video
        if (hasLogo) {
          const pos = getLogoOverlayExpr(logoPosition);
          filterParts.push(`[${logoIdx}:v]scale=120:-2,format=rgba[vlogo]`);
          filterParts.push(`${vTag}[vlogo]overlay=${pos}[vl]`);
          vTag = '[vl]';
        }

        // Apply illustration overlay
        if (hasIllu && segments.length > 0) {
          // Compute t0/t1 relative to the new concatenated timeline
          // Find the concat-time offset for illuAt
          let concatOffset = 0;
          for (const seg of segments) {
            if (times.illuAt >= seg.s && times.illuAt < seg.e) {
              concatOffset += (times.illuAt - seg.s);
              break;
            }
            if (times.illuAt >= seg.e) {
              concatOffset += (seg.e - seg.s);
            }
          }
          const t0 = concatOffset.toFixed(2);
          const t1 = (concatOffset + illuDuration).toFixed(2);
          const enable = `enable='between(t,${t0},${t1})'`;
          let scaleIllu, overlayExpr;
          switch (illuLayout) {
            case 'fullscreen':
              scaleIllu  = `[${illuIdx}:v]scale=W:H,format=rgba[villu]`;
              overlayExpr = `0:0`;
              break;
            case 'left-third':
              scaleIllu  = `[${illuIdx}:v]scale=trunc(W/3/2)*2:-2,format=rgba[villu]`;
              overlayExpr = `0:(H-h)/2`;
              break;
            case 'right-third':
              scaleIllu  = `[${illuIdx}:v]scale=trunc(W/3/2)*2:-2,format=rgba[villu]`;
              overlayExpr = `W-w:(H-h)/2`;
              break;
            default: // center
              scaleIllu  = `[${illuIdx}:v]scale=trunc(W*0.45/2)*2:-2,format=rgba[villu]`;
              overlayExpr = `(W-w)/2:(H-h)/2`;
          }
          filterParts.push(scaleIllu);
          filterParts.push(`${vTag}[villu]overlay=${overlayExpr}:${enable}[vi]`);
          vTag = '[vi]';
        }

      } else {
        // ── Single segment (no cuts) ──────────────────────
        const seg    = segments[0];
        const trimDur = seg.e - seg.s;

        if (aspect === 'portrait') {
          filterParts.push(`[0:v]crop=trunc(ih*9/16/2)*2:trunc(ih/2)*2,scale=720:1280[v0]`);
        } else {
          filterParts.push(`[0:v]scale=1280:720[v0]`);
        }
        vTag = '[v0]';

        if (hasLogo) {
          const pos = getLogoOverlayExpr(logoPosition);
          filterParts.push(`[${logoIdx}:v]scale=120:-2,format=rgba[vlogo]`);
          filterParts.push(`${vTag}[vlogo]overlay=${pos}[v1]`);
          vTag = '[v1]';
        }

        if (hasIllu) {
          const t0 = Math.max(0, times.illuAt - seg.s).toFixed(2);
          const t1 = (parseFloat(t0) + illuDuration).toFixed(2);
          const enable = `enable='between(t,${t0},${t1})'`;
          let scaleIllu, overlayExpr;
          switch (illuLayout) {
            case 'fullscreen':
              scaleIllu   = `[${illuIdx}:v]scale=W:H,format=rgba[villu]`;
              overlayExpr = `0:0`;
              break;
            case 'left-third':
              scaleIllu   = `[${illuIdx}:v]scale=trunc(W/3/2)*2:-2,format=rgba[villu]`;
              overlayExpr = `0:(H-h)/2`;
              break;
            case 'right-third':
              scaleIllu   = `[${illuIdx}:v]scale=trunc(W/3/2)*2:-2,format=rgba[villu]`;
              overlayExpr = `W-w:(H-h)/2`;
              break;
            default:
              scaleIllu   = `[${illuIdx}:v]scale=trunc(W*0.45/2)*2:-2,format=rgba[villu]`;
              overlayExpr = `(W-w)/2:(H-h)/2`;
          }
          filterParts.push(scaleIllu);
          filterParts.push(`${vTag}[villu]overlay=${overlayExpr}:${enable}[v2]`);
          vTag = '[v2]';
        }

        // ── Audio chain (single-segment) ────────────────────
        // Priority order:
        //   1. noiseMode  → apply anlmdn noise-removal filter to original audio
        //   2. muteMode   → discard audio entirely (no -map audio)
        //   3. audioSwap  → discard original, map swap file instead
        //   4. bgm/sfx    → mix with original audio
        //   5. default    → map original audio direct

        aTag = null; // will be set below

        if (muteMode) {
          // Completely silent — no audio map at all
          aTag = null;
          announce('Export: original audio muted, no audio in output.');

        } else if (noiseMode) {
          // anlmdn = Non-Local Means Denoising — mathematically reduces audio noise
          if (videoHasAudio) {
            filterParts.push(`[0:a]anlmdn=s=7:p=0.002:r=0.002:m=15[anoise]`);
            aTag = '[anoise]';
          }

        } else if (hasAudioSwap) {
          // Discard original audio; trim swap file to exact trimDur
          filterParts.push(`[${swapIdx}:a]atrim=duration=${trimDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=1.0[aswap]`);
          // Mix with BGM/SFX if present, otherwise use swap alone
          if (hasBgm || hasSfx) {
            const aMixes = ['[aswap]'];
            if (hasBgm) {
              filterParts.push(`[${bgmIdx}:a]atrim=duration=${trimDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=0.18[abgm]`);
              aMixes.push('[abgm]');
            }
            if (hasSfx) {
              const delayMs = Math.max(0, Math.round((times.sfxAt - seg.s) * 1000));
              filterParts.push(`[${sfxIdx}:a]adelay=${delayMs}|${delayMs},atrim=duration=${trimDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=1.0[asfx]`);
              aMixes.push('[asfx]');
            }
            filterParts.push(`${aMixes.join('')}amix=inputs=${aMixes.length}:duration=first:dropout_transition=2[aout]`);
            aTag = '[aout]';
          } else {
            filterParts.push(`[aswap]acopy[aout]`);
            aTag = '[aout]';
          }

        } else {
          // Normal: original audio + optional BGM/SFX mix
          aTag = videoHasAudio ? '0:a' : null;
          if (hasBgm || hasSfx) {
            const aMixes = [];
            if (videoHasAudio) {
              filterParts.push(`[0:a]volume=1.0[am]`);
              aMixes.push('[am]');
            }
            if (hasBgm) {
              filterParts.push(`[${bgmIdx}:a]atrim=duration=${trimDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=0.18[abgm]`);
              aMixes.push('[abgm]');
            }
            if (hasSfx) {
              const delayMs = Math.max(0, Math.round((times.sfxAt - seg.s) * 1000));
              filterParts.push(`[${sfxIdx}:a]adelay=${delayMs}|${delayMs},atrim=duration=${trimDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=1.0[asfx]`);
              aMixes.push('[asfx]');
            }
            if (aMixes.length === 1) {
              filterParts.push(`${aMixes[0]}acopy[aout]`);
            } else {
              filterParts.push(`${aMixes.join('')}amix=inputs=${aMixes.length}:duration=first:dropout_transition=2[aout]`);
            }
            aTag = '[aout]';
          }
        }
      }

      // ── Run FFmpeg ────────────────────────────────────────
      const filterComplex = filterParts.join(';');

      ffmpeg.setProgress(({ ratio }) => {
        const pct = Math.min(97, Math.round(15 + ratio * 82));
        setProgress(pct, `Encoding… ${pct}%`);
        if (pct === 30 || pct === 60 || pct === 90) announce(`Encoding ${pct} percent complete.`);
      });

      const audioArgs = aTag ? ['-map', aTag, '-c:a', 'aac', '-b:a', '192k'] : [];

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
      );
    }

    // ── Package download ──────────────────────────────────────
    setProgress(100, 'Done!');

    const data   = ffmpeg.FS('readFile', 'output.mp4');
    const blob   = new Blob([data.buffer], { type: 'video/mp4' });
    const url    = URL.createObjectURL(blob);
    const dlLink = document.getElementById('download-link');
    dlLink.href     = url;
    dlLink.download = `tech-house-${Date.now()}.mp4`;

    document.getElementById('download-result').classList.remove('hidden');
    dlLink.focus();
    try { dlLink.click(); } catch (_) {}

    // Cleanup wasm FS
    ['input.mp4','logo.png','illu.png','bgm.mp3','sfx.mp3','swap.mp3','output.mp4'].forEach(f => {
      try { ffmpeg.FS('unlink', f); } catch (_) {}
    });

    setStatus('Export complete! Press Download Video to save your file.');
    announce('Export complete. Download Video button is now focused.');
    toast('Export complete ✓', 'success');

  } catch (err) {
    console.error('[EXPORT ERROR]', err);
    setStatus('Export failed: ' + (err.message || String(err)), true);
    toast('Export failed — check browser console for details', 'error');
  } finally {
    document.getElementById('progress-wrap').classList.add('hidden');
    document.getElementById('export-btn').disabled = false;
    setProgress(0, 'Preparing…');
  }
}
