// ============================================================
// TECH HOUSE VIDEO EDITOR — script.js  v6
// Major update: Checkbox bug fixed, BGM J/K/L keyboard controls,
//               B-Roll mute/layout fixed, Undo robust element syncing
// ============================================================

// ── COI ServiceWorker ────────────────────────────────────────
(function () {
  var s = document.createElement('script');
  s.src = './coi-serviceworker.js';
  s.onerror = () => console.warn('[COI] coi-serviceworker.js not found.');
  document.head.appendChild(s);
}());

// ── Firebase Auth (shared with main site) ────────────────────
import { initializeApp }       from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup,
         signInWithRedirect, getRedirectResult,
         onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const fbConfig = {
  apiKey:            "AIzaSyB5CZLo-CTT2JZxw6SEVSA_wuxkCuE7aUI",
  authDomain:        "techhouse-87e28.web.app",
  projectId:         "techhouse-87e28",
  storageBucket:     "techhouse-87e28.firebasestorage.app",
  messagingSenderId: "249148429400",
  appId:             "1:249148429400:web:8ae888aac7a272392ea62d"
};
const fbApp      = initializeApp(fbConfig);
const auth       = getAuth(fbApp);
const gProvider  = new GoogleAuthProvider();

getRedirectResult(auth).catch(err => console.warn('[Auth redirect]', err.message));

// ── FFmpeg ───────────────────────────────────────────────────
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
const previewStage  = document.getElementById('preview-stage');
const overlayLogo   = document.getElementById('overlay-logo');
const illuContainer = document.getElementById('illu-overlay-container');
const brollPlayer   = document.getElementById('broll-player');
const overlayBroll  = document.getElementById('overlay-broll');

const swapAudio = new Audio();
swapAudio.loop  = true;

// ── App State ─────────────────────────────────────────────────
let mainVideoFile = null;
let mainAudioBuffer = null;

let assets = { logo: null, audioSwap: null };
let audioProcessing = 'swap';
let logoPosition    = 'top-right';

let sfxStack = [];
let bgmStack = [];
let illuStack = [];
let brollStack = [];

let selectedSfxId = null;
let times  = { s: 0, e: 0, duration: 0 };
let segments    = [];
let editHistory = [];

let aspect  = 'landscape';
let preset  = 'ultrafast';
let zoomLevel = 1;
let zoomStart = 0;

let engineReady      = false;
let dragType         = null;
let scrubAudioCtx    = null;
let scrubTimeout     = null;
let stackIdCounter   = 0;

// ── Helpers ───────────────────────────────────────────────────
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
function fmtTime(t) {
  if (isNaN(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * 10);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${f}`;
}
function nextId() { return ++stackIdCounter; }

// ── Engine Init ───────────────────────────────────────────────
(async function initEngine() {
  setStatus('Loading FFmpeg engine…');
  try {
    await ffmpeg.load();
    engineReady = true;
    engineBadge.textContent = 'ENGINE READY';
    engineBadge.classList.add('online');
    setStatus('Engine ready. Load a video to begin.');
    toast('FFmpeg engine loaded ✓', 'success');
  } catch (err) {
    engineBadge.textContent = 'ENGINE ERROR';
    setStatus('Engine failed — please refresh.', true);
    toast('Engine error — refresh page', 'error');
  }
})();

// ── Auth Widget ───────────────────────────────────────────────
let authDropdownOpen = false;
function toggleAuthDropdown(forceClose = false) {
  const dropdown    = document.getElementById('auth-dropdown');
  const signinBtn   = document.getElementById('auth-signin-btn');
  const userBtn     = document.getElementById('auth-user-btn');
  authDropdownOpen  = forceClose ? false : !authDropdownOpen;
  dropdown.classList.toggle('hidden', !authDropdownOpen);
  const expanded = String(authDropdownOpen);
  signinBtn.setAttribute('aria-expanded', expanded);
  userBtn.setAttribute('aria-expanded', expanded);
}
document.getElementById('auth-signin-btn').addEventListener('click', () => toggleAuthDropdown());
document.getElementById('auth-user-btn').addEventListener('click',   () => toggleAuthDropdown());
document.addEventListener('click', e => {
  if (!document.getElementById('auth-widget').contains(e.target)) {
    if (authDropdownOpen) toggleAuthDropdown(true);
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && authDropdownOpen) toggleAuthDropdown(true); });

document.getElementById('auth-google-btn').addEventListener('click', async () => {
  toggleAuthDropdown(true);
  try {
    await signInWithPopup(auth, gProvider);
    toast('Signed in to Tech House ✓', 'success');
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') signInWithRedirect(auth, gProvider);
  }
});
document.getElementById('auth-logout-btn').addEventListener('click', async () => {
  toggleAuthDropdown(true); await signOut(auth); toast('Logged out of Tech House', 'info');
});

onAuthStateChanged(auth, user => {
  const signinBtn   = document.getElementById('auth-signin-btn');
  const userBtn     = document.getElementById('auth-user-btn');
  const avatar      = document.getElementById('auth-avatar');
  const nameEl      = document.getElementById('auth-name');
  const googleBtn   = document.getElementById('auth-google-btn');
  const logoutBtn   = document.getElementById('auth-logout-btn');
  const dropName    = document.getElementById('auth-dropdown-name');
  const dropEmail   = document.getElementById('auth-dropdown-email');
  if (user) {
    const displayName = user.displayName || user.email.split('@')[0];
    signinBtn.classList.add('hidden'); userBtn.classList.remove('hidden');
    nameEl.textContent = displayName.split(' ')[0]; dropName.textContent = displayName; dropEmail.textContent = user.email || '';
    avatar.src = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=f59e0b&color=000&size=80`;
    googleBtn.classList.add('hidden'); logoutBtn.classList.remove('hidden');
  } else {
    signinBtn.classList.remove('hidden'); userBtn.classList.add('hidden');
    googleBtn.classList.remove('hidden'); logoutBtn.classList.add('hidden');
    dropName.textContent = '—'; dropEmail.textContent = '—';
  }
});

// ── Video Upload ──────────────────────────────────────────────
document.getElementById('vid-uploader').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  mainVideoFile = file;
  player.src = URL.createObjectURL(file);
  player.load();
  player.onloadedmetadata = () => {
    times.duration = player.duration; times.s = 0; times.e = player.duration;
    segments = [{ s: 0, e: player.duration }]; editHistory = [];
    uploadZone.classList.add('hidden'); previewStage.classList.remove('hidden');
    document.getElementById('export-btn').disabled = false;
    document.getElementById('silence-btn').disabled = false;
    document.getElementById('undo-btn').disabled = true;
    updateTimecodes(); updateTrimBar(); updateSegmentDisplay(); updateSummary(); renderSfxMarkers();
    setStatus(`Loaded: "${file.name}" — ${fmtTime(player.duration)}`); toast('Video loaded ✓', 'success');
    decodeVideoAudio(file);
  };
};

uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.style.borderColor = 'var(--amber)'; });
uploadZone.addEventListener('dragleave', () => { uploadZone.style.borderColor = ''; });
uploadZone.addEventListener('drop', e => {
  e.preventDefault(); uploadZone.style.borderColor = '';
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('video/')) {
    const dt = new DataTransfer(); dt.items.add(file);
    document.getElementById('vid-uploader').files = dt.files;
    document.getElementById('vid-uploader').dispatchEvent(new Event('change'));
  }
});

async function decodeVideoAudio(file) {
  try {
    const arrayBuf = await file.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    mainAudioBuffer = await ctx.decodeAudioData(arrayBuf); ctx.close();
    setStatus(`Audio decoded. ${fmtTime(mainAudioBuffer.duration)} ready for analysis.`);
  } catch (err) {}
}

async function detectSilence() {
  if (!mainAudioBuffer) { toast('Audio not decoded yet — wait a moment', 'error'); return; }
  const thresholdDb  = parseFloat(document.getElementById('silence-threshold').value) || -40;
  const minDurSec    = parseFloat(document.getElementById('silence-min-dur').value)   || 0.5;
  const threshold    = Math.pow(10, thresholdDb / 20);

  setStatus('Scanning for silence…'); toast('Scanning for silent gaps…', 'info');
  const data = mainAudioBuffer.getChannelData(0); const sr = mainAudioBuffer.sampleRate;
  const windowSamp = Math.floor(sr * 0.05);
  const silentRanges = []; let inSilence = false; let silStart = 0;

  for (let i = 0; i < data.length; i += windowSamp) {
    let sum = 0; const end = Math.min(i + windowSamp, data.length);
    for (let j = i; j < end; j++) sum += data[j] * data[j];
    const rms = Math.sqrt(sum / (end - i)); const t = i / sr;
    if (rms < threshold) { if (!inSilence) { inSilence = true; silStart = t; } }
    else {
      if (inSilence) {
        inSilence = false; const dur = t - silStart;
        if (dur >= minDurSec) silentRanges.push({ s: silStart, e: t });
      }
    }
  }
  if (inSilence && (mainAudioBuffer.duration - silStart >= minDurSec)) silentRanges.push({ s: silStart, e: mainAudioBuffer.duration });
  if (silentRanges.length === 0) {
    toast('No silent gaps found above threshold', 'info');
    setStatus('No silence detected. Try lowering the threshold dB value.'); return;
  }

  pushHistory();
  for (const range of silentRanges) {
    const cs = range.s + 0.05; const ce = range.e - 0.05;
    if (ce - cs < 0.1) continue;
    const newSegs = [];
    for (const seg of segments) {
      if (cs > seg.s) newSegs.push({ s: seg.s, e: Math.min(cs, seg.e) });
      if (ce < seg.e) newSegs.push({ s: Math.max(ce, seg.s), e: seg.e });
    }
    segments = newSegs.filter(s => s.e - s.s > 0.05);
  }
  document.getElementById('undo-btn').disabled = false;
  updateSegmentDisplay(); updateSummary(); times.s = 0; times.e = times.duration; updateTrimBar();
  const kept = segments.reduce((a, s) => a + (s.e - s.s), 0);
  setStatus(`Silence removed: ${silentRanges.length} cuts applied.`);
  announce(`Auto-cut ${silentRanges.length} silent gaps. ${fmtTime(kept)} remaining. Ctrl+Z to undo.`);
  toast(`${silentRanges.length} silence cuts applied ✂`, 'success');
}

// ── Layer Assets (Logo / AudioSwap) ───────────────────────────
function triggerLayer(type) {
  const input = document.getElementById('layer-uploader');
  input.accept = (type === 'logo') ? 'image/*' : 'audio/*'; input._type = type; input.click();
}
document.getElementById('layer-uploader').onchange = (e) => {
  const file = e.target.files[0]; if (!file) return;
  const type = e.target._type; assets[type] = file;
  const objectURL = URL.createObjectURL(file);
  if (type === 'logo') {
    document.getElementById('overlay-logo-img').src = objectURL; overlayLogo.classList.remove('hidden');
    applyLogoPosition(logoPosition);
    document.getElementById('layer-logo')?.classList.add('loaded');
    document.getElementById('desc-logo').textContent = file.name.slice(0,20);
    announce('Logo loaded.');
  }
  if (type === 'audioSwap') {
    swapAudio.src = objectURL; swapAudio.load(); player.muted = true;
    document.getElementById('layer-audioSwap')?.classList.add('loaded');
    document.getElementById('desc-audioSwap').textContent = file.name.slice(0,20);
    announce('Audio Swap loaded.');
  }
  pushHistory(); updateSummary(); toast(`${type === 'logo' ? 'Logo' : 'Audio Swap'} added ✓`, 'success');
  e.target.value = '';
};

function setLogoPosition(val) { logoPosition = val; applyLogoPosition(val); updateSummary(); }
function applyLogoPosition(val) { overlayLogo.className = `overlay-logo pos-${val}`; if (!assets.logo) overlayLogo.classList.add('hidden'); }
function setAudioProcessing(val) { audioProcessing = val; updateSummary(); announce(`Audio processing: ${val}.`); }

// ── Multi-Stack: Illustration ─────────────────────────────────
function triggerAddIllu() { document.getElementById('illu-uploader').click(); }
document.getElementById('illu-uploader').onchange = (e) => {
  const file = e.target.files[0]; if (!file) return;
  const id  = nextId(); const at  = player.currentTime || 0; const url = URL.createObjectURL(file);
  const el = document.createElement('div'); el.className = 'illu-overlay-el layout-center hidden'; el.dataset.id = id;
  const img = document.createElement('img'); img.src = url; el.appendChild(img); illuContainer.appendChild(el);
  illuStack.push({ id, file, url, at, duration: 3, layout: 'center', el });
  pushHistory(); renderIlluStack(); updateSummary();
  announce(`Illustration added at ${fmtTime(at)}.`); toast('Illustration added ✓', 'success'); e.target.value = '';
};
function renderIlluStack() {
  const container = document.getElementById('illu-stack'); container.innerHTML = '';
  illuStack.forEach(item => {
    const card = document.createElement('div'); card.className = 'stack-item';
    card.innerHTML = `
      <div class="stack-item-header">
        <span class="stack-item-name">🎨 ${item.file.name.slice(0,18)}</span>
        <button class="stack-item-remove" onclick="removeIllu(${item.id})">✕</button>
      </div>
      <div class="stack-item-controls">
        <div class="stack-ctrl-row"><span class="stack-ctrl-label">At (s)</span><input type="number" class="stack-ctrl-input" value="${item.at.toFixed(2)}" step="0.1" onchange="updateIllu(${item.id},'at',parseFloat(this.value))"></div>
        <div class="stack-ctrl-row"><span class="stack-ctrl-label">Dur (s)</span><input type="number" class="stack-ctrl-input" value="${item.duration}" step="0.5" onchange="updateIllu(${item.id},'duration',parseFloat(this.value))"></div>
        <div style="grid-column:1/-1;">
          <select class="stack-select" onchange="updateIllu(${item.id},'layout',this.value)">
            ${['center','fullscreen','left-third','right-third'].map(l => `<option value="${l}" ${item.layout===l?'selected':''}>${l.replace(/-/g,' ')}</option>`).join('')}
          </select>
        </div>
      </div>`;
    container.appendChild(card);
  });
}
function updateIllu(id, field, val) {
  const item = illuStack.find(i => i.id === id); if (!item) return; item[field] = val;
  if (field === 'layout') item.el.className = `illu-overlay-el layout-${val} hidden`;
  updateSummary();
}
function removeIllu(id) {
  const idx = illuStack.findIndex(i => i.id === id); if (idx === -1) return;
  illuStack[idx].el.remove(); illuStack.splice(idx, 1);
  pushHistory(); renderIlluStack(); updateSummary(); toast('Illustration removed', 'info');
}

// ── Multi-Stack: BGM with Music Focus Controller ─────────────
let focusedBgmId = null;
let bgmScrubIntervals = {};

function triggerAddBGM() { document.getElementById('bgm-uploader').click(); }
document.getElementById('bgm-uploader').onchange = (e) => {
  const file = e.target.files[0]; if (!file) return;
  const id = nextId(); const audio = new Audio();
  audio.src = URL.createObjectURL(file); audio.loop = true; audio.volume = 0.18;
  bgmStack.push({ id, file, audio, startAt: 0, offset: 0, volume: 18 });
  pushHistory(); focusedBgmId = id; renderBgmStack(); updateSummary();
  announce(`BGM added: "${file.name}". K to play/pause. J/L to nudge start time.`); toast('BGM track added ✓', 'success'); e.target.value = '';
};

function renderBgmStack() {
  const container = document.getElementById('bgm-stack'); container.innerHTML = '';
  bgmStack.forEach(item => {
    const isFocused = item.id === focusedBgmId;
    const card = document.createElement('div'); card.className = 'stack-item' + (isFocused ? ' selected' : '');
    card.innerHTML = `
      <div class="stack-item-header">
        <span class="stack-item-name">🎵 ${item.file.name.slice(0,16)}</span>
        <div style="display:flex;gap:4px;align-items:center;">
          ${isFocused ? `<span class="bgm-focused-badge">FOCUSED</span>` : ''}
          <button class="stack-item-remove" onclick="removeBgm(${item.id})">✕</button>
        </div>
      </div>
      <button class="btn btn-sm btn-ghost" style="width:100%;font-size:0.7rem;margin-bottom:4px;" onclick="focusBgm(${item.id})">
        ${isFocused ? '🎯 Focused — use keyboard (J,K,L)' : '🎯 Click to focus'}
      </button>
      ${isFocused ? `
      <div class="bgm-focus-controls" id="bgm-focus-${item.id}">
        <div class="bgm-scrubber-row">
          <button class="bgm-play-btn" id="bgm-play-${item.id}" onclick="toggleBgmPlayback(${item.id})">▶</button>
          <input type="range" class="bgm-scrubber" id="bgm-scrub-${item.id}" min="0" max="100" value="0" step="0.1" oninput="onBgmScrub(${item.id}, this.value)">
          <span class="bgm-time-display" id="bgm-time-${item.id}">0:00 / 0:00</span>
        </div>
        <p class="stack-hint" style="margin-top:2px;">K=play/pause · J/L=±5s start · Shift+J/L=±1s</p>
      </div>` : ''}
      <div class="stack-item-controls">
        <div class="stack-ctrl-row"><span class="stack-ctrl-label">Start at (s)</span><input type="number" class="stack-ctrl-input" value="${item.startAt}" step="0.5" onchange="updateBgm(${item.id},'startAt',parseFloat(this.value))"></div>
        <div class="stack-ctrl-row"><span class="stack-ctrl-label">Offset (s)</span><input type="number" class="stack-ctrl-input" value="${item.offset}" step="1" onchange="updateBgm(${item.id},'offset',parseFloat(this.value))"></div>
        <div style="grid-column:1/-1;"><span class="stack-ctrl-label">Volume ${item.volume}%</span><input type="range" class="stack-vol-slider" min="0" max="100" value="${item.volume}" oninput="updateBgm(${item.id},'volume',parseInt(this.value))"></div>
      </div>`;
    card.addEventListener('click', (e) => { if (!['INPUT','SELECT','BUTTON'].includes(e.target.tagName)) focusBgm(item.id); });
    container.appendChild(card);
    if (isFocused) { clearInterval(bgmScrubIntervals[item.id]); bgmScrubIntervals[item.id] = setInterval(() => updateBgmScrubberDisplay(item.id), 250); }
  });
}
function focusBgm(id) {
  if (focusedBgmId && bgmScrubIntervals[focusedBgmId]) clearInterval(bgmScrubIntervals[focusedBgmId]);
  focusedBgmId = id; renderBgmStack();
  const item = bgmStack.find(i => i.id === id); if (item) announce(`BGM "${item.file.name}" focused.`);
}
function toggleBgmPlayback(id) {
  const item = bgmStack.find(i => i.id === id); if (!item) return;
  const btn = document.getElementById(`bgm-play-${id}`);
  if (item.audio.paused) {
    if (!player.paused) player.pause();
    setTimeout(() => {
      item.audio.currentTime = item.offset; item.audio.play().catch(() => {});
      if (btn) btn.textContent = '⏸'; announce(`BGM playing standalone: ${item.file.name}`);
    }, 50);
  } else {
    item.audio.pause(); if (btn) btn.textContent = '▶'; announce('BGM paused.');
  }
}
function onBgmScrub(id, pct) {
  const item = bgmStack.find(i => i.id === id); if (!item || !item.audio.duration) return;
  const newOffset = (pct / 100) * item.audio.duration; item.audio.currentTime = newOffset; item.offset = newOffset;
  updateBgmScrubberDisplay(id); announce(`Song offset set to ${fmtTime(newOffset)}.`);
}
function updateBgmScrubberDisplay(id) {
  const item = bgmStack.find(i => i.id === id); const scrub = document.getElementById(`bgm-scrub-${id}`); const timeEl = document.getElementById(`bgm-time-${id}`);
  if (!item || !scrub || !timeEl) return;
  const dur = item.audio.duration || 0; const cur = item.audio.currentTime || 0;
  scrub.value = dur > 0 ? ((cur / dur) * 100).toFixed(1) : '0'; timeEl.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
}
function nudgeBgmStartAt(id, deltaSeconds) {
  const item = bgmStack.find(i => i.id === id); if (!item) return;
  item.startAt = Math.max(0, item.startAt + deltaSeconds); renderBgmStack(); updateSummary(); announce(`BGM starts at ${fmtTime(item.startAt)}.`);
}
function updateBgm(id, field, val) {
  const item = bgmStack.find(i => i.id === id); if (!item) return; item[field] = val;
  if (field === 'volume') item.audio.volume = val / 100; if (field === 'offset') item.audio.currentTime = val;
  renderBgmStack(); updateSummary();
}
function removeBgm(id) {
  const idx = bgmStack.findIndex(i => i.id === id); if (idx === -1) return;
  bgmStack[idx].audio.pause(); clearInterval(bgmScrubIntervals[id]); bgmStack.splice(idx, 1);
  if (focusedBgmId === id) focusedBgmId = bgmStack.length > 0 ? bgmStack[0].id : null;
  pushHistory(); renderBgmStack(); updateSummary(); toast('BGM track removed', 'info');
}

// ── Multi-Stack: SFX ─────────────────────────────────────────
function triggerAddSFX() { document.getElementById('sfx-uploader').click(); }
document.getElementById('sfx-uploader').onchange = (e) => {
  const file = e.target.files[0]; if (!file) return;
  const id = nextId(); const audio = new Audio(); audio.src = URL.createObjectURL(file); audio.volume = 1.0;
  sfxStack.push({ id, file, audio, at: player.currentTime || 0, volume: 100, triggered: false });
  pushHistory(); renderSfxStack(); renderSfxMarkers(); updateSummary();
  announce(`SFX added at ${fmtTime(player.currentTime)}.`); toast('SFX added ✓', 'success'); e.target.value = '';
};
function renderSfxStack() {
  const container = document.getElementById('sfx-stack'); container.innerHTML = '';
  sfxStack.forEach(item => {
    const card = document.createElement('div'); card.className = 'stack-item' + (item.id === selectedSfxId ? ' selected' : '');
    card.onclick = () => { selectedSfxId = item.id; renderSfxStack(); announce(`SFX selected. Use Shift+Ctrl+Arrow to nudge.`); };
    card.innerHTML = `
      <div class="stack-item-header">
        <span class="stack-item-name">🔊 ${item.file.name.slice(0,18)}</span>
        <button class="stack-item-remove" onclick="event.stopPropagation();removeSfx(${item.id})">✕</button>
      </div>
      <div class="stack-item-controls">
        <div class="stack-ctrl-row"><span class="stack-ctrl-label">At (s)</span><input type="number" class="stack-ctrl-input" value="${item.at.toFixed(2)}" step="0.1" onclick="event.stopPropagation()" onchange="event.stopPropagation();updateSfx(${item.id},'at',parseFloat(this.value))"></div>
        <div style="grid-column:1/-1;"><span class="stack-ctrl-label">Volume ${item.volume}%</span><input type="range" class="stack-vol-slider" min="0" max="100" value="${item.volume}" onclick="event.stopPropagation()" oninput="event.stopPropagation();updateSfx(${item.id},'volume',parseInt(this.value))"></div>
      </div>`;
    container.appendChild(card);
  });
}
function updateSfx(id, field, val) {
  const item = sfxStack.find(i => i.id === id); if (!item) return; item[field] = val;
  if (field === 'volume') item.audio.volume = val / 100; renderSfxStack(); renderSfxMarkers(); updateSummary();
}
function removeSfx(id) {
  const idx = sfxStack.findIndex(i => i.id === id); if (idx === -1) return;
  sfxStack[idx].audio.pause(); sfxStack.splice(idx, 1); if (selectedSfxId === id) selectedSfxId = null;
  pushHistory(); renderSfxStack(); renderSfxMarkers(); updateSummary(); toast('SFX removed', 'info');
}
function renderSfxMarkers() {
  const layer = document.getElementById('sfx-markers-layer'); layer.innerHTML = ''; if (!times.duration) return;
  sfxStack.forEach(item => {
    const frac = item.at / times.duration; const fracVis = Math.max(0, Math.min(1, (frac - zoomStart) * zoomLevel));
    const marker = document.createElement('div'); marker.className = 'sfx-timeline-marker'; marker.style.left = (fracVis * 100) + '%';
    layer.appendChild(marker);
  });
}
function nudgeSelectedSfx(deltaSeconds) {
  if (!selectedSfxId) { announce('No SFX selected.'); return; }
  const item = sfxStack.find(i => i.id === selectedSfxId); if (!item) return;
  item.at = Math.max(0, Math.min(times.duration, item.at + deltaSeconds));
  renderSfxStack(); renderSfxMarkers(); announce(`SFX nudged to ${fmtTime(item.at)}.`);
}

// ── Multi-Stack: B-Roll ───────────────────────────────────────
function triggerAddBRoll() { document.getElementById('broll-uploader').click(); }
document.getElementById('broll-uploader').onchange = (e) => {
  const file = e.target.files[0]; if (!file) return;
  const id = nextId(); const vid = document.createElement('video');
  vid.src = URL.createObjectURL(file); vid.muted = true; vid.preload = 'metadata';
  brollStack.push({ id, file, video: vid, at: player.currentTime || 0, duration: 5, muteAudio: true, layout: 'fullscreen' });
  pushHistory(); renderBrollStack(); updateSummary();
  announce(`B-Roll added at ${fmtTime(player.currentTime)}.`); toast('B-Roll added ✓', 'success'); e.target.value = '';
};
function renderBrollStack() {
  const container = document.getElementById('broll-stack'); container.innerHTML = '';
  brollStack.forEach(item => {
    const card = document.createElement('div'); card.className = 'stack-item';
    card.innerHTML = `
      <div class="stack-item-header">
        <span class="stack-item-name">🎥 ${item.file.name.slice(0,18)}</span>
        <button class="stack-item-remove" onclick="removeBroll(${item.id})">✕</button>
      </div>
      <div class="stack-item-controls">
        <div class="stack-ctrl-row"><span class="stack-ctrl-label">At (s)</span><input type="number" class="stack-ctrl-input" value="${item.at.toFixed(1)}" step="0.5" onchange="updateBroll(${item.id},'at',parseFloat(this.value))"></div>
        <div class="stack-ctrl-row"><span class="stack-ctrl-label">Duration (s)</span><input type="number" class="stack-ctrl-input" value="${item.duration}" step="0.5" onchange="updateBroll(${item.id},'duration',parseFloat(this.value))"></div>
        <div style="grid-column:1/-1;">
          <select class="stack-select" onchange="updateBroll(${item.id},'layout',this.value)">
            ${['fullscreen','center','left-third','right-third'].map(l => `<option value="${l}" ${item.layout===l?'selected':''}>${l.replace(/-/g,' ')}</option>`).join('')}
          </select>
        </div>
        <div style="grid-column:1/-1;">
          <label style="display:flex;align-items:center;gap:6px;font-size:0.72rem;cursor:pointer;">
            <input type="checkbox" ${item.muteAudio?'checked':''} onchange="updateBroll(${item.id},'muteAudio',this.checked)"> Mute B-Roll
          </label>
        </div>
      </div>`;
    container.appendChild(card);
  });
}
function updateBroll(id, field, val) {
  const item = brollStack.find(i => i.id === id); if (!item) return; item[field] = val;
  renderBrollStack(); updateSummary();
}
function removeBroll(id) {
  const idx = brollStack.findIndex(i => i.id === id); if (idx === -1) return;
  brollStack.splice(idx, 1); pushHistory(); renderBrollStack(); updateSummary(); toast('B-Roll removed', 'info');
}

// ── Live Preview Sync ─────────────────────────────────────────
player.addEventListener('play', () => {
  previewStage.classList.add('playing');
  sfxStack.forEach(s => { s.triggered = false; });
  bgmStack.forEach(i => { const btn = document.getElementById(`bgm-play-${i.id}`); if (btn) btn.textContent = '▶'; });

  bgmStack.forEach(item => {
    const videoOffset = player.currentTime - item.startAt;
    if (videoOffset < 0) { item.audio.pause(); return; }
    const dur = item.audio.duration || 1;
    item.audio.currentTime = (item.offset + videoOffset) % dur;
    item.audio.play().catch(() => {});
  });
  if (assets.audioSwap && swapAudio.src) {
    player.muted = true; const dur = swapAudio.duration || 0;
    swapAudio.currentTime = dur > 0 ? player.currentTime % dur : 0;
    swapAudio.play().catch(() => {});
  }
});
player.addEventListener('pause', () => {
  previewStage.classList.remove('playing');
  bgmStack.forEach(i => i.audio.pause()); swapAudio.pause(); brollPlayer.pause();
});
player.addEventListener('seeked', () => {
  sfxStack.forEach(s => { s.triggered = false; });
  if (!player.paused) {
    bgmStack.forEach(item => {
      const videoOffset = player.currentTime - item.startAt;
      if (videoOffset < 0) { item.audio.pause(); return; }
      const dur = item.audio.duration || 1; item.audio.currentTime = (item.offset + videoOffset) % dur;
    });
    if (assets.audioSwap && swapAudio.src) { const dur = swapAudio.duration || 0; swapAudio.currentTime = dur > 0 ? (player.currentTime % dur) : 0; }
  }
  if (document.getElementById('scrub-toggle').checked && !player.paused === false) playScrubSnippet(player.currentTime);
});

function playScrubSnippet(atTime) {
  if (!mainAudioBuffer) return;
  if (!document.getElementById('scrub-toggle').checked) return;
  if (scrubAudioCtx) { try { scrubAudioCtx.close(); } catch(_) {} }
  const indicator = document.getElementById('scrub-indicator'); indicator.classList.remove('hidden');
  scrubAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const src = scrubAudioCtx.createBufferSource(); src.buffer = mainAudioBuffer;
  const gain = scrubAudioCtx.createGain();
  gain.gain.setValueAtTime(0, scrubAudioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(0.8, scrubAudioCtx.currentTime + 0.01);
  gain.gain.setValueAtTime(0.8, scrubAudioCtx.currentTime + 0.07);
  gain.gain.linearRampToValueAtTime(0, scrubAudioCtx.currentTime + 0.08);
  src.connect(gain); gain.connect(scrubAudioCtx.destination);
  src.start(0, Math.max(0, atTime), 0.08);
  clearTimeout(scrubTimeout);
  scrubTimeout = setTimeout(() => { indicator.classList.add('hidden'); try { scrubAudioCtx.close(); } catch(_) {} scrubAudioCtx = null; }, 150);
}

player.ontimeupdate = () => {
  const t = player.currentTime;
  document.getElementById('tc-current').textContent = fmtTime(t);
  if (times.duration > 0) {
    const frac = t / times.duration; const fracVis = Math.max(0, Math.min(1, (frac - zoomStart) * zoomLevel));
    document.getElementById('trim-playhead').style.left = (fracVis * 100) + '%';
    if (!player.paused && zoomLevel > 1) {
      const windowSize = 1 / zoomLevel;
      if (frac > zoomStart + windowSize - 0.02) { zoomStart = Math.min(1 - windowSize, frac - 0.02); updateTrimBar(); updateZoomBar(); }
    }
  }

  illuStack.forEach(item => { const show = t >= item.at && t < (item.at + item.duration); item.el.classList.toggle('hidden', !show); });
  sfxStack.forEach(item => {
    if (!item.triggered && t >= item.at && t < item.at + 0.5) {
      item.audio.currentTime = 0; item.audio.play().catch(() => {}); item.triggered = true;
    }
  });

  const activeBroll = brollStack.find(b => t >= b.at && t < b.at + b.duration);
  if (activeBroll) {
    overlayBroll.classList.remove('hidden');
    overlayBroll.className = `overlay-broll layout-${activeBroll.layout || 'fullscreen'}`;
    if (brollPlayer.src !== activeBroll.video.src) brollPlayer.src = activeBroll.video.src;
    brollPlayer.muted = activeBroll.muteAudio;
    if (Math.abs(brollPlayer.currentTime - (t - activeBroll.at)) > 0.3) brollPlayer.currentTime = t - activeBroll.at;
    if (!player.paused && brollPlayer.paused) brollPlayer.play().catch(() => {});
  } else {
    overlayBroll.className = 'overlay-broll hidden';
    brollPlayer.pause();
  }

  bgmStack.forEach(item => {
    if (!player.paused && t >= item.startAt && item.audio.paused) {
      const videoOffset = t - item.startAt; const dur = item.audio.duration || 1;
      item.audio.currentTime = (item.offset + videoOffset) % dur; item.audio.play().catch(() => {});
    }
    if (t < item.startAt && !item.audio.paused) item.audio.pause();
  });

  const inCut = !segments.some(seg => t >= seg.s - 0.05 && t < seg.e + 0.05);
  if (inCut && !player.paused && segments.length > 0) {
    const nextSeg = segments.find(seg => seg.s > t);
    if (nextSeg) { player.currentTime = nextSeg.s; } else { player.pause(); }
  }
};

// ── Trim & UI Elements ────────────────────────────────────────
function setAspect(val) {
  aspect = val;
  document.querySelectorAll('#seg-landscape, #seg-portrait, #seg-blur-bg').forEach(b => {
    const on = b.dataset.val === val; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
  });
  updateSummary(); announce(`Aspect: ${val}.`);
}
function setPreset(val) {
  preset = val;
  document.querySelectorAll('#seg-fast, #seg-balanced, #seg-hq').forEach(b => {
    const on = b.dataset.preset === val; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
  });
}
function cycleZoom() {
  if (!times.duration) return; zoomLevel = (zoomLevel === 1) ? 4 : 1; zoomStart = 0;
  if (zoomLevel === 4) { const playFrac = player.currentTime / times.duration; zoomStart = Math.max(0, Math.min(0.75, playFrac - 0.125)); }
  updateTrimBar(); updateZoomBar(); renderSfxMarkers(); announce(zoomLevel === 1 ? 'Full timeline.' : 'Zoomed 4x.');
}
function updateZoomBar() {
  const bar = document.getElementById('zoom-bar'); const win = document.getElementById('zoom-window');
  if (zoomLevel === 1) { bar.style.display = 'none'; return; }
  bar.style.display = 'block'; win.style.left = (zoomStart * 100) + '%'; win.style.width = ((1 / zoomLevel) * 100) + '%';
}
function zoomToFrac(zf) { return zoomStart + zf * (1 / zoomLevel); }

function updateTrimBar() {
  const dur = times.duration; if (!dur) return;
  const sp = times.s / dur; const ep = times.e / dur;
  const spVis = Math.max(0, Math.min(1, (sp - zoomStart) * zoomLevel)); const epVis = Math.max(0, Math.min(1, (ep - zoomStart) * zoomLevel));
  const rangeL = (Math.max(0, sp - zoomStart) * zoomLevel) * 100;
  const rangeW = (Math.max(0, Math.min(ep, zoomStart + 1/zoomLevel) - Math.max(sp, zoomStart)) * zoomLevel) * 100;
  document.getElementById('trim-range').style.left = rangeL + '%'; document.getElementById('trim-range').style.width = Math.max(0, rangeW) + '%';
  document.getElementById('trim-head-s').style.left = (spVis * 100) + '%'; document.getElementById('trim-head-e').style.left = (epVis * 100) + '%';
  document.getElementById('trim-duration-label').textContent = `${fmtTime(times.s)} → ${fmtTime(times.e)} (${fmtTime(times.e - times.s)})`;
}
function updateSegmentDisplay() {
  const dur = times.duration; const track = document.getElementById('segment-track'); track.innerHTML = '';
  if (!dur || segments.length === 0) return;
  segments.forEach(seg => {
    const bar = document.createElement('div'); bar.className = 'segment-bar';
    bar.style.left = ((seg.s / dur) * 100) + '%'; bar.style.width = (((seg.e - seg.s) / dur) * 100) + '%'; track.appendChild(bar);
  });
  const cutEl = document.getElementById('cut-summary'); const cutCount = segments.length - 1;
  if (cutCount > 0) {
    const kept = segments.reduce((a, s) => a + (s.e - s.s), 0);
    cutEl.textContent = `${cutCount} cuts applied · ${fmtTime(kept)} kept`; cutEl.classList.remove('hidden');
  } else { cutEl.classList.add('hidden'); }
  updateSummary();
}

function startDrag(e, type) { dragType = type; e.preventDefault(); window.addEventListener('mousemove', onDrag); window.addEventListener('mouseup', stopDrag); }
document.getElementById('trim-head-s').addEventListener('mousedown', e => startDrag(e, 's'));
document.getElementById('trim-head-e').addEventListener('mousedown', e => startDrag(e, 'e'));
function onDrag(e) {
  if (!dragType) return; e.preventDefault();
  const rect = document.getElementById('trim-track').getBoundingClientRect(); const cx = e.clientX;
  const rawFrac = Math.max(0, Math.min(1, (cx - rect.left) / rect.width)); const t = zoomToFrac(rawFrac) * times.duration;
  if (dragType === 's') { times.s = Math.min(Math.max(0, t), times.e - 0.5); player.currentTime = times.s; document.getElementById('tc-start').textContent = fmtTime(times.s); }
  else { times.e = Math.max(Math.min(times.duration, t), times.s + 0.5); player.currentTime = times.e; document.getElementById('tc-end').textContent = fmtTime(times.e); }
  updateTrimBar(); updateSummary();
}
function stopDrag() { dragType = null; window.removeEventListener('mousemove', onDrag); window.removeEventListener('mouseup', stopDrag); }
document.getElementById('trim-track').addEventListener('click', e => {
  if (!times.duration || e.target.classList.contains('trim-head')) return;
  const rect = e.currentTarget.getBoundingClientRect(); const rawFrac = (e.clientX - rect.left) / rect.width;
  const seekTo = zoomToFrac(Math.max(0, Math.min(1, rawFrac))) * times.duration; player.currentTime = seekTo; playScrubSnippet(seekTo);
});

document.getElementById('btn-set-start').onclick = () => {
  const t = player.currentTime; if (t >= times.e) { toast('In must be before Out', 'error'); return; }
  pushHistory(); times.s = t; document.getElementById('tc-start').textContent = fmtTime(t); updateTrimBar(); updateSummary();
};
document.getElementById('btn-set-end').onclick = () => {
  const t = player.currentTime; if (t <= times.s) { toast('Out must be after In', 'error'); return; }
  pushHistory(); times.e = t; document.getElementById('tc-end').textContent = fmtTime(t); updateTrimBar(); updateSummary();
};
document.getElementById('btn-reset-trim').onclick = () => {
  pushHistory(); times.s = 0; times.e = times.duration; segments = [{ s: 0, e: times.duration }];
  document.getElementById('tc-start').textContent = fmtTime(0); document.getElementById('tc-end').textContent = fmtTime(times.duration);
  updateTrimBar(); updateSegmentDisplay(); updateSummary(); setStatus('All trims and cuts reset.');
};
function cutSegment() {
  if (!mainVideoFile) return; const cutS = times.s, cutE = times.e;
  if (cutE - cutS < 0.1) { toast('Set In and Out first', 'error'); return; }
  pushHistory();
  const newSegs = [];
  for (const seg of segments) {
    if (cutS > seg.s) newSegs.push({ s: seg.s, e: Math.min(cutS, seg.e) });
    if (cutE < seg.e) newSegs.push({ s: Math.max(cutE, seg.s), e: seg.e });
  }
  segments = newSegs.filter(s => s.e - s.s > 0.05);
  if (segments.length === 0) { doUndo(); toast('Cannot cut everything', 'error'); return; }
  times.s = 0; times.e = times.duration; updateTrimBar(); player.currentTime = Math.min(cutE + 0.05, times.duration - 0.1);
  updateSegmentDisplay(); updateSummary(); document.getElementById('undo-btn').disabled = false; toast('Cut applied ✂', 'info');
}

// ── Unified Undo ──────────────────────────────────────────────
function pushHistory() {
  editHistory.push({
    segments:     JSON.parse(JSON.stringify(segments)),
    times:        { ...times },
    sfxStack:     sfxStack.map(i => ({ ...i })),
    bgmStack:     bgmStack.map(i => ({ ...i })),
    illuStack:    illuStack.map(i => ({ ...i })),
    brollStack:   brollStack.map(i => ({ ...i })),
    logoPosition, audioProcessing, aspect
  });
  document.getElementById('undo-btn').disabled = false;
}

function doUndo() {
  if (editHistory.length === 0) { announce('Nothing to undo.'); return; }
  const prev = editHistory.pop();

  sfxStack.forEach(i => i.audio.pause());
  bgmStack.forEach(i => i.audio.pause());
  illuStack.forEach(i => i.el.remove());
  brollStack.forEach(i => { if (i.video) i.video.pause(); });

  segments        = prev.segments;
  times           = { ...prev.times };
  logoPosition    = prev.logoPosition;
  audioProcessing = prev.audioProcessing;
  aspect          = prev.aspect;

  sfxStack   = prev.sfxStack.map(i => ({ ...i }));
  bgmStack   = prev.bgmStack.map(i => ({ ...i }));
  illuStack  = prev.illuStack.map(i => {
    const item = { ...i };
    if (item.el && !document.getElementById('illu-overlay-container').contains(item.el)) {
      document.getElementById('illu-overlay-container').appendChild(item.el);
    }
    return item;
  });
  brollStack = prev.brollStack.map(i => ({ ...i }));

  document.getElementById('tc-start').textContent = fmtTime(times.s);
  document.getElementById('tc-end').textContent   = fmtTime(times.e);

  updateTrimBar(); updateSegmentDisplay(); updateSummary();
  renderSfxStack(); renderBgmStack(); renderIlluStack(); renderBrollStack(); renderSfxMarkers();
  setAspect(aspect);
  document.getElementById('undo-btn').disabled = editHistory.length === 0; toast('Undo ✓', 'info');
}

// ── Keyboard Shortcuts ────────────────────────────────────────
window.addEventListener('keydown', e => {
  const activeTag = document.activeElement.tagName;
  const activeType = document.activeElement.type;

  // Don't intercept typing in inputs
  if (['TEXTAREA', 'SELECT'].includes(activeTag)) return;
  if (activeTag === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(activeType)) return;

  // Let browser natively handle Spacebar for checkboxes and buttons
  if (e.key === ' ' && ['BUTTON', 'INPUT'].includes(activeTag)) { return; }

  const k = e.key.toLowerCase(); const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && k === 'l') { e.preventDefault(); triggerLayer('logo'); return; }
  if (ctrl && k === 'i') { e.preventDefault(); triggerAddIllu(); return; }
  if (ctrl && k === 'b') { e.preventDefault(); triggerAddBGM(); return; }
  if (ctrl && k === 'f') { e.preventDefault(); triggerAddSFX(); return; }
  if (ctrl && k === 'r') { e.preventDefault(); triggerAddBRoll(); return; }
  if (ctrl && k === 'u') { e.preventDefault(); triggerLayer('audioSwap'); return; }
  if (ctrl && !e.shiftKey && k === 'z') { e.preventDefault(); doUndo(); return; }
  if (ctrl && k === 'x') { e.preventDefault(); runExport(); return; }
  if (ctrl && k === 'd') { e.preventDefault(); detectSilence(); return; }

  // Focused BGM Shortcuts (J, K, L)
  if (focusedBgmId && bgmStack.length > 0) {
    if (k === 'k' && !ctrl) { e.preventDefault(); toggleBgmPlayback(focusedBgmId); return; }
    if ((k === 'j' || k === 'l') && !ctrl) {
      e.preventDefault(); const delta = (e.shiftKey ? 1 : 5) * (k === 'j' ? -1 : 1);
      nudgeBgmStartAt(focusedBgmId, delta); return;
    }
  }

  // SFX Nudge
  if (ctrl && e.shiftKey && (k === 'arrowleft' || k === 'arrowright')) {
    e.preventDefault(); nudgeSelectedSfx(k === 'arrowleft' ? -0.1 : 0.1); return;
  }

  if (k === 's' && !ctrl) { e.preventDefault(); document.getElementById('btn-set-start').click(); }
  if (k === 'e' && !ctrl) { e.preventDefault(); document.getElementById('btn-set-end').click(); }
  if (k === ' ') { e.preventDefault(); if (mainVideoFile) { player.paused ? player.play() : player.pause(); } }
  if (k === 'v' && !ctrl) { setStatus(`Current: ${fmtTime(player.currentTime)} In: ${fmtTime(times.s)} Out: ${fmtTime(times.e)}`); }
  if (k === 'z' && !ctrl) { e.preventDefault(); cycleZoom(); }
  if (k === 'backspace')  { e.preventDefault(); cutSegment(); }

  if (k === 'arrowleft' || k === 'arrowright') {
    if (!mainVideoFile || ctrl) return; e.preventDefault();
    const step = e.shiftKey ? 1 : 10; const dir = k === 'arrowleft' ? -1 : 1;
    player.currentTime = Math.max(0, Math.min(times.duration, player.currentTime + dir * step));
    playScrubSnippet(player.currentTime); announce(`${step}s ${dir > 0 ? 'forward' : 'back'}.`);
  }
});

function updateTimecodes() {
  document.getElementById('tc-start').textContent = fmtTime(times.s);
  document.getElementById('tc-end').textContent = fmtTime(times.e);
  document.getElementById('tc-current').textContent = fmtTime(player.currentTime);
}

function updateSummary() {
  const hasLayers = !!assets.logo || !!assets.audioSwap || sfxStack.length > 0 || bgmStack.length > 0 || illuStack.length > 0 || brollStack.length > 0;
  const hasCuts = segments.length > 1; const copyMode = !hasLayers && !hasCuts && segments.length === 1;
  document.getElementById('summary-mode').textContent = 'Mode: ' + (copyMode ? '⚡ Fast Copy' : '🔧 Re-encode');
  const cutCount = segments.length - 1; document.getElementById('summary-cuts').textContent = cutCount > 0 ? `Cuts: ${cutCount}` : 'Cuts: none';
}

function setProgress(pct, phase) {
  document.getElementById('prog-fill').style.width = pct + '%';
  document.getElementById('progress-pct').textContent = pct + '%';
  if (phase) document.getElementById('progress-phase').textContent = phase;
}

function getLogoOverlayExpr(pos) {
  const pad = 10;
  return { 'top-right': `W-w-${pad}:${pad}`, 'top-left': `${pad}:${pad}`, 'bottom-right': `W-w-${pad}:H-h-${pad}`, 'bottom-left': `${pad}:H-h-${pad}`, 'center': `(W-w)/2:(H-h)/2` }[pos] || `W-w-${pad}:${pad}`;
}

// ── Master Export Engine ──────────────────────────────────────
async function runExport() {
  if (!mainVideoFile) { toast('No video loaded', 'error'); return; }
  if (!engineReady)   { toast('Engine not ready', 'error'); return; }

  setStatus('Preparing export…'); document.getElementById('progress-wrap').classList.remove('hidden');
  document.getElementById('export-btn').disabled = true; setProgress(0, 'Writing files…');

  const useCrossfade = document.getElementById('crossfade-toggle').checked;

  try {
    ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(mainVideoFile));
    const hasLogo = !!assets.logo; const hasAudioSwap = !!assets.audioSwap;
    const noiseMode = audioProcessing === 'noise'; const muteMode = audioProcessing === 'mute';
    const hasCuts = segments.length > 1;
    const hasAnyAsset = hasLogo || hasAudioSwap || bgmStack.length > 0 || sfxStack.length > 0 || illuStack.length > 0 || brollStack.length > 0 || noiseMode || muteMode;

    if (!hasAnyAsset && !hasCuts && segments.length === 1) {
      const seg = segments[0]; setProgress(15, 'Copying…');
      ffmpeg.setProgress(({ ratio }) => setProgress(15 + Math.round(ratio * 80), 'Copying…'));
      await ffmpeg.run('-ss', seg.s.toFixed(3), '-t', (seg.e - seg.s).toFixed(3), '-i', 'input.mp4', '-c', 'copy', '-movflags', '+faststart', 'output.mp4');
    } else {
      if (hasLogo) ffmpeg.FS('writeFile', 'logo.png', await fetchFile(assets.logo));
      if (hasAudioSwap) ffmpeg.FS('writeFile', 'swap.mp3', await fetchFile(assets.audioSwap));
      for (let i = 0; i < bgmStack.length; i++)   ffmpeg.FS('writeFile', `bgm${i}.mp3`,   await fetchFile(bgmStack[i].file));
      for (let i = 0; i < sfxStack.length; i++)   ffmpeg.FS('writeFile', `sfx${i}.mp3`,   await fetchFile(sfxStack[i].file));
      for (let i = 0; i < illuStack.length; i++)  ffmpeg.FS('writeFile', `illu${i}.png`,  await fetchFile(illuStack[i].file));
      for (let i = 0; i < brollStack.length; i++) ffmpeg.FS('writeFile', `broll${i}.mp4`, await fetchFile(brollStack[i].file));

      const videoHasAudio = player.mozHasAudio !== undefined ? player.mozHasAudio : true;
      let args = hasCuts ? ['-i', 'input.mp4'] : ['-ss', segments[0].s.toFixed(3), '-t', (segments[0].e - segments[0].s).toFixed(3), '-i', 'input.mp4'];

      if (hasLogo) args.push('-i', 'logo.png');
      for (let i = 0; i < illuStack.length; i++)  args.push('-i', `illu${i}.png`);
      for (let i = 0; i < bgmStack.length; i++)   args.push('-stream_loop', '-1', '-i', `bgm${i}.mp3`);
      for (let i = 0; i < sfxStack.length; i++)   args.push('-i', `sfx${i}.mp3`);
      if (hasAudioSwap) args.push('-stream_loop', '-1', '-i', 'swap.mp3');
      for (let i = 0; i < brollStack.length; i++) args.push('-i', `broll${i}.mp4`);

      let idx = 1;
      const logoIdx   = hasLogo ? idx++ : -1;
      const illuIdx   = illuStack.map(() => idx++);
      const bgmIdx    = bgmStack.map(() => idx++);
      const sfxIdx    = sfxStack.map(() => idx++);
      const swapIdx   = hasAudioSwap ? idx++ : -1;
      const brollIdx  = brollStack.map(() => idx++);

      let filterParts = []; let vTag;

      if (hasCuts) {
        const concatInputs = []; const hasAudio = videoHasAudio && !muteMode;
        segments.forEach((seg, i) => {
          let scaleF = (aspect === 'portrait') ? `crop=trunc(ih*9/16/2)*2:trunc(ih/2)*2,scale=720:1280` : (aspect === 'blur-bg' ? `scale=720:1280` : `scale=1280:720`);
          filterParts.push(`[0:v]trim=${seg.s.toFixed(3)}:${seg.e.toFixed(3)},setpts=PTS-STARTPTS,${scaleF}[vs${i}]`); concatInputs.push(`[vs${i}]`);
          if (hasAudio) {
            let af = `[0:a]atrim=${seg.s.toFixed(3)}:${seg.e.toFixed(3)},asetpts=PTS-STARTPTS`;
            if (useCrossfade && i > 0) af += `,afade=t=in:st=0:d=0.1`;
            if (useCrossfade && i < segments.length - 1) af += `,afade=t=out:st=${Math.max(0, seg.e-seg.s-0.1).toFixed(2)}:d=0.1`;
            filterParts.push(`${af}[as${i}]`); concatInputs.push(`[as${i}]`);
          }
        });
        const concatStr = concatInputs.join('');
        if (hasAudio) { filterParts.push(`${concatStr}concat=n=${segments.length}:v=1:a=1[vconcat][aconcat]`); vTag = '[vconcat]'; aTag = '[aconcat]'; }
        else { filterParts.push(`${concatStr}concat=n=${segments.length}:v=1:a=0[vconcat]`); vTag = '[vconcat]'; aTag = null; }

        if (aspect === 'blur-bg') {
          filterParts.push(`${vTag}split[bgraw][sharpraw]`);
          filterParts.push(`[bgraw]scale=1280:720,boxblur=20:6,setsar=1[bgblur]`);
          filterParts.push(`[bgblur][sharpraw]overlay=(W-w)/2:0[vblur]`); vTag = '[vblur]';
        }
      } else {
        if (aspect === 'portrait') filterParts.push(`[0:v]crop=trunc(ih*9/16/2)*2:trunc(ih/2)*2,scale=720:1280[v0]`);
        else if (aspect === 'blur-bg') {
          filterParts.push(`[0:v]scale=1280:720,boxblur=20:6,setsar=1[bg]`); filterParts.push(`[0:v]scale=-2:720[sharp]`);
          filterParts.push(`[bg][sharp]overlay=(W-w)/2:0[v0]`);
        } else { filterParts.push(`[0:v]scale=1280:720[v0]`); }
        vTag = '[v0]';
      }

      if (hasLogo) {
        filterParts.push(`[${logoIdx}:v]scale=120:-2,format=rgba[vlogo]`);
        filterParts.push(`${vTag}[vlogo]overlay=${getLogoOverlayExpr(logoPosition)}[vL]`); vTag = '[vL]';
      }

      illuStack.forEach((item, i) => {
        const t0 = Math.max(0, item.at - (hasCuts ? 0 : segments[0].s)).toFixed(2); const t1 = (parseFloat(t0) + item.duration).toFixed(2);
        let scaleI, overlayE;
        switch (item.layout) {
          case 'fullscreen': scaleI = `scale=W:H,format=rgba`; overlayE = `0:0`; break;
          case 'left-third': scaleI = `scale=trunc(W/3/2)*2:-2,format=rgba`; overlayE = `0:(H-h)/2`; break;
          case 'right-third': scaleI = `scale=trunc(W/3/2)*2:-2,format=rgba`; overlayE = `W-w:(H-h)/2`; break;
          default: scaleI = `scale=trunc(W*0.45/2)*2:-2,format=rgba`; overlayE = `(W-w)/2:(H-h)/2`;
        }
        filterParts.push(`[${illuIdx[i]}:v]${scaleI}[vi${i}]`); filterParts.push(`${vTag}[vi${i}]overlay=${overlayE}:enable='between(t,${t0},${t1})'[vI${i}]`); vTag = `[vI${i}]`;
      });

      brollStack.forEach((item, i) => {
        const t0 = Math.max(0, item.at - (hasCuts ? 0 : segments[0].s)).toFixed(2); const t1 = (parseFloat(t0) + item.duration).toFixed(2);
        let scaleB, overlayB;
        switch (item.layout || 'fullscreen') {
          case 'left-third': scaleB = `scale=trunc(W/3/2)*2:-2,format=yuv420p`; overlayB = `0:(H-h)/2`; break;
          case 'right-third': scaleB = `scale=trunc(W/3/2)*2:-2,format=yuv420p`; overlayB = `W-w:(H-h)/2`; break;
          case 'center': scaleB = `scale=trunc(W*0.45/2)*2:-2,format=yuv420p`; overlayB = `(W-w)/2:(H-h)/2`; break;
          default: scaleB = `scale=1280:720,format=yuv420p`; overlayB = `0:0`;
        }
        filterParts.push(`[${brollIdx[i]}:v]${scaleB}[vb${i}]`); filterParts.push(`${vTag}[vb${i}]overlay=${overlayB}:enable='between(t,${t0},${t1})'[vB${i}]`); vTag = `[vB${i}]`;
      });

      let aTag = null; const trimDur = hasCuts ? segments.reduce((a,s) => a + (s.e - s.s), 0) : segments[0].e - segments[0].s;
      if (muteMode) aTag = null;
      else if (noiseMode && videoHasAudio) { filterParts.push(`${hasCuts ? '[aconcat]' : '[0:a]'}anlmdn=s=3:p=0.004:r=0.004:m=10[anoise]`); aTag = '[anoise]'; }
      else if (hasAudioSwap) { filterParts.push(`[${swapIdx}:a]atrim=duration=${trimDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=1.0[aswap]`); aTag = '[aswap]'; }
      else if (hasCuts && videoHasAudio) { aTag = '[aconcat]'; }
      else if (!hasCuts && videoHasAudio) { aTag = '0:a'; }

      if (bgmStack.length > 0) {
        let mainALabel = aTag === '0:a' ? (filterParts.push(`[0:a]volume=1.0[amain]`), '[amain]') : aTag;
        const mixInputs = mainALabel ? [mainALabel] : [];
        bgmStack.forEach((item, i) => {
          const startMs = Math.round(item.startAt * 1000); const bgmDur = Math.max(trimDur, trimDur + 30);
          filterParts.push(`[${bgmIdx[i]}:a]atrim=duration=${bgmDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=${(item.volume/100).toFixed(2)},adelay=${startMs}|${startMs}[abgm${i}]`);
          mixInputs.push(`[abgm${i}]`);
        });
        filterParts.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=2[amixed]`); aTag = '[amixed]';
      }

      if (sfxStack.length > 0 && aTag !== null) {
        let sfxBaseLabel = aTag === '0:a' ? (filterParts.push(`[0:a]volume=1.0[apre]`), '[apre]') : aTag;
        const sfxLabels = [sfxBaseLabel];
        sfxStack.forEach((item, i) => {
          const delayMs = Math.max(0, Math.round((item.at - (hasCuts ? 0 : segments[0].s)) * 1000));
          filterParts.push(`[${sfxIdx[i]}:a]adelay=${delayMs}|${delayMs},atrim=duration=${trimDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=${(item.volume/100).toFixed(2)}[asfx${i}]`);
          sfxLabels.push(`[asfx${i}]`);
        });
        filterParts.push(`${sfxLabels.join('')}amix=inputs=${sfxLabels.length}:duration=first:dropout_transition=1[afinal]`); aTag = '[afinal]';
      }

      ffmpeg.setProgress(({ ratio }) => setProgress(Math.min(97, Math.round(15 + ratio * 82)), 'Encoding…'));
      let audioArgs = aTag === '0:a' || aTag ? ['-map', aTag, '-c:a', 'aac', '-b:a', '192k'] : [];
      await ffmpeg.run(...args, '-filter_complex', filterParts.join(';'), '-map', vTag, ...audioArgs, '-c:v', 'libx264', '-preset', preset, '-crf', '22', '-movflags', '+faststart', 'output.mp4');
    }

    setProgress(100, 'Done!');
    const data = ffmpeg.FS('readFile', 'output.mp4'); const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));
    const safeName = (document.getElementById('project-name').value || 'tech-house').replace(/[^a-zA-Z0-9_\-. ]/g, '').replace(/\s+/g, '-') || 'tech-house';
    const dlLink = document.getElementById('download-link'); dlLink.href = url; dlLink.download = `${safeName}.mp4`;
    document.getElementById('download-result').classList.remove('hidden'); dlLink.focus(); try { dlLink.click(); } catch (_) {}
    
    ['input.mp4','logo.png','swap.mp3','output.mp4', ...bgmStack.map((_,i)=>`bgm${i}.mp3`), ...sfxStack.map((_,i)=>`sfx${i}.mp3`), ...illuStack.map((_,i)=>`illu${i}.png`), ...brollStack.map((_,i)=>`broll${i}.mp4`)].forEach(f => { try { ffmpeg.FS('unlink', f); } catch (_) {} });
    setStatus(`Export complete — ${safeName}.mp4`); toast('Export complete ✓', 'success');

  } catch (err) { toast('Export failed', 'error'); } finally { document.getElementById('progress-wrap').classList.add('hidden'); document.getElementById('export-btn').disabled = false; }
}