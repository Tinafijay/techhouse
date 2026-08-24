// ============================================================
// TECH HOUSE VIDEO EDITOR — script.js  v7
// Complete Feature & Keyboard Shortcut Update:
// - Universal Keyboard Shortcuts for EVERY Action
// - Interactive Shortcuts Modal Cheat Sheet with Search
// - Clip Splitting at Playhead (Split Range)
// - Video Filters & Visual Effects (Cyberpunk, Vintage, Noir, etc.)
// - Playback Speed Control (0.25x - 2.0x) with audio retiming
// - Custom Text Overlays & Subtitle Captions
// - Master Video / Audio Volume Slider
// - Full Redo Stack & Extended Undo/Redo (Ctrl+Z / Ctrl+Y)
// - Multiple Export Formats (MP4, WebM, Animated GIF, MP3)
// - Robust Cross-Device Touch & Responsive Layout Optimization
// ============================================================

// ── COI ServiceWorker ────────────────────────────────────────
(function () {
  var s = document.createElement('script');
  s.src = './coi-serviceworker.js';
  s.onerror = () => console.warn('[COI] coi-serviceworker.js not found.');
  document.head.appendChild(s);
}());

// ── Firebase Auth Compat ─────────────────────────────────────
let auth, gProvider, fbSignInWithPopup, fbSignInWithRedirect, fbOnAuthStateChanged, fbSignOut;

function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') { resolve(); return; }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => { s.dataset.loaded = 'true'; resolve(); };
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

async function loadFirebase() {
  try {
    if (window.firebase?.auth) { initFirebaseAuth(); return; }
    await loadExternalScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
    await loadExternalScript('https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js');
    initFirebaseAuth();
  } catch (err) {
    console.warn('[Firebase] Could not load compat SDK:', err.message);
  }
}

function initFirebaseAuth() {
  try {
    const fbConfig = {
      apiKey:            "AIzaSyB5CZLo-CTT2JZxw6SEVSA_wuxkCuE7aUI",
      authDomain:        "techhouse-87e28.web.app",
      projectId:         "techhouse-87e28",
      storageBucket:     "techhouse-87e28.firebasestorage.app",
      messagingSenderId: "249148429400",
      appId:             "1:249148429400:web:8ae888aac7a272392ea62d"
    };
    if (!firebase.apps.length) firebase.initializeApp(fbConfig);
    auth      = firebase.auth();
    gProvider = new firebase.auth.GoogleAuthProvider();

    fbSignInWithPopup    = (p) => auth.signInWithPopup(p);
    fbSignInWithRedirect = (p) => auth.signInWithRedirect(p);
    fbOnAuthStateChanged = (cb) => auth.onAuthStateChanged(cb);
    fbSignOut            = ()  => auth.signOut();

    setupAuth();
  } catch (e) {
    console.warn('[Firebase] Init failed:', e.message);
  }
}

loadFirebase();

// ── FFmpeg ───────────────────────────────────────────────────
'use strict';
const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({
  log: true,
  corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
});

// ── DOM refs ─────────────────────────────────────────────────
const player          = document.getElementById('player');
const videoContainer   = document.getElementById('video-container');
const uploadZone      = document.getElementById('upload-zone');
const statusText      = document.getElementById('status-text');
const livePolite      = document.getElementById('live-region-polite');
const liveUrgent      = document.getElementById('live-region-urgent');
const engineBadge     = document.getElementById('engine-badge');
const previewStage    = document.getElementById('preview-stage');
const overlayLogo     = document.getElementById('overlay-logo');
const illuContainer   = document.getElementById('illu-overlay-container');
const textContainer   = document.getElementById('text-overlay-container');
const brollPlayer     = document.getElementById('broll-player');
const overlayBroll    = document.getElementById('overlay-broll');
const audioOnlyStage  = document.getElementById('audio-only-stage');
const audioPlayer      = document.getElementById('audio-player');

// ── Audio Engine & Assets ────────────────────────────────────
const swapAudio = new Audio();
swapAudio.loop  = true;

let mainVideoFile   = null;
let mainAudioBuffer = null;
let mediaKind       = 'video'; // 'video' | 'audio'

function activeMedia() {
  return mediaKind === 'audio' ? audioPlayer : player;
}

let assets = { logo: null, audioSwap: null };
let audioProcessing = 'none';
let logoPosition    = 'top-right';

// MULTI-STACK arrays
let sfxStack   = []; // { id, file, audio, at, volume, triggered }
let bgmStack   = []; // { id, file, audio, startAt, offset, volume }
let illuStack  = []; // { id, file, at, duration, layout, el }
let brollStack = []; // { id, file, video, at, duration, muteAudio, layout }
let textStack  = []; // { id, text, at, duration, position, fontSize, color, bgColor, el }

let selectedSfxId = null;
let focusedBgmId  = null;

// Timeline & Editing State
let times       = { s: 0, e: 0, duration: 0 };
let segments    = [];
let editHistory = []; // Undo stack
let redoHistory = []; // Redo stack

// Visual Effects & Speed
let activeFilter  = 'normal';
let playbackSpeed = 1.0;
let masterVolume  = 1.0;
let aspect        = 'landscape';
let preset        = 'ultrafast';
let exportFormat  = 'mp4'; // 'mp4' | 'webm' | 'gif' | 'mp3'

// Zoom
let zoomLevel = 1;
let zoomStart = 0;

// System state
let engineReady    = false;
let dragType       = null;
let isScrubbing    = false;
let scrubAudioCtx  = null;
let stackIdCounter = 0;
let aiJobRunning   = false;

const PROJECT_SCHEMA_VERSION = 3;
const STORAGE_KEYS = {
  editorSettings: 'th_editor_settings_v3',
  projectSnapshot: 'th_editor_project_v3'
};
const mediaPreviewUrls = new WeakMap();
let editorSettings = createDefaultEditorSettings();

function el(id) { return document.getElementById(id); }

function createDefaultEditorSettings() {
  return {
    geminiApiKey: '',
    geminiModel: 'gemini-3-flash-preview',
    autosaveProject: true,
    reduceMotion: false,
    highContrast: false,
    theme: 'dark',
    aiTranscript: ''
  };
}

function cloneJSON(value) {
  return JSON.parse(JSON.stringify(value));
}

function getPreviewURL(file) {
  if (!file) return '';
  if (!mediaPreviewUrls.has(file)) mediaPreviewUrls.set(file, URL.createObjectURL(file));
  return mediaPreviewUrls.get(file);
}

// ── Announce & Notification Helpers ──────────────────────────
function announce(msg, urgent = false) {
  const node = urgent ? liveUrgent : livePolite;
  node.textContent = '';
  requestAnimationFrame(() => { node.textContent = msg; });
}

function setStatus(msg, urgent = false) {
  if (statusText) statusText.textContent = msg;
  console.log('[STATUS]', msg);
  announce(msg, urgent);
}

function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  const wrap = document.getElementById('toast-wrap');
  if (wrap) wrap.appendChild(t);
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ── Settings & Accessibility Management ──────────────────────
function applyAccessibilityPreferences() {
  document.body.classList.toggle('reduce-motion', !!editorSettings.reduceMotion);
  document.body.classList.toggle('high-contrast', !!editorSettings.highContrast);
  document.body.classList.toggle('theme-dark', editorSettings.theme === 'dark');
}

function loadEditorSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.editorSettings);
    if (!raw) return;
    editorSettings = { ...createDefaultEditorSettings(), ...JSON.parse(raw) };
  } catch (err) {
    console.warn('[Settings] Read failed:', err.message);
  }
}

function persistEditorSettings(statusMessage) {
  try {
    localStorage.setItem(STORAGE_KEYS.editorSettings, JSON.stringify(editorSettings));
    if (statusMessage) setInlineStatus('project-save-status', statusMessage, 'success');
  } catch (err) {
    console.warn('[Settings] Save failed:', err.message);
  }
}

function syncSettingsFromForm() {
  editorSettings = {
    ...editorSettings,
    geminiApiKey: (el('gemini-api-key')?.value || '').trim(),
    geminiModel: el('gemini-model')?.value || 'gemini-3-flash-preview',
    autosaveProject: !!el('autosave-project')?.checked,
    reduceMotion: !!el('reduce-motion-toggle')?.checked,
    highContrast: !!el('high-contrast-toggle')?.checked,
    aiTranscript: el('ai-transcript')?.value || ''
  };
}

function updateSettingsForm() {
  if (el('gemini-api-key')) el('gemini-api-key').value = editorSettings.geminiApiKey || '';
  if (el('gemini-model')) el('gemini-model').value = editorSettings.geminiModel || 'gemini-3-flash-preview';
  if (el('autosave-project')) el('autosave-project').checked = !!editorSettings.autosaveProject;
  if (el('reduce-motion-toggle')) el('reduce-motion-toggle').checked = !!editorSettings.reduceMotion;
  if (el('high-contrast-toggle')) el('high-contrast-toggle').checked = !!editorSettings.highContrast;
  if (el('ai-transcript')) el('ai-transcript').value = editorSettings.aiTranscript || '';
  applyAccessibilityPreferences();
  updateGeminiStatusText();
}

function setInlineStatus(id, msg, type = '') {
  const node = el(id);
  if (!node) return;
  node.className = 'inline-status';
  if (type) node.classList.add(type);
  node.textContent = msg;
}

function updateGeminiStatusText(msg, type = 'info') {
  const key = (editorSettings.geminiApiKey || '').trim();
  if (msg) { setInlineStatus('gemini-auth-status', msg, type); return; }
  if (!key) { setInlineStatus('gemini-auth-status', 'Gemini key not configured yet.', 'info'); return; }
  const masked = key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : 'saved';
  setInlineStatus('gemini-auth-status', `Gemini key saved locally (${masked}).`, 'success');
}

// ── State Synchronization ─────────────────────────────────────
function syncSingleAssetUI() {
  const logoLoaded = !!assets.logo;
  const swapLoaded = !!assets.audioSwap;
  const logoImg = el('overlay-logo-img');

  if (logoLoaded && logoImg) {
    logoImg.src = getPreviewURL(assets.logo);
    overlayLogo.classList.remove('hidden');
    applyLogoPosition(logoPosition);
    el('layer-logo')?.classList.add('loaded');
    if (el('desc-logo')) el('desc-logo').textContent = assets.logo.name.slice(0, 20);
  } else {
    overlayLogo.className = 'overlay-logo hidden';
    el('layer-logo')?.classList.remove('loaded');
    if (el('desc-logo')) el('desc-logo').textContent = 'Permanent watermark';
  }

  if (swapLoaded) {
    swapAudio.src = getPreviewURL(assets.audioSwap);
    swapAudio.load();
    el('layer-audioSwap')?.classList.add('loaded');
    if (el('desc-audioSwap')) el('desc-audioSwap').textContent = assets.audioSwap.name.slice(0, 20);
  } else {
    swapAudio.pause();
    swapAudio.removeAttribute('src');
    el('layer-audioSwap')?.classList.remove('loaded');
    if (el('desc-audioSwap')) el('desc-audioSwap').textContent = 'Replaces original audio track';
  }

  player.muted = swapLoaded;
  if (el('logo-position')) el('logo-position').value = logoPosition;
  if (el('noise-filter-select')) el('noise-filter-select').value = audioProcessing;
  setAudioProcessing(audioProcessing);
}

function resetProjectMediaState() {
  assets = { logo: null, audioSwap: null };
  logoPosition = 'top-right';
  audioProcessing = 'none';
  sfxStack.forEach(item => item.audio?.pause());
  bgmStack.forEach(item => item.audio?.pause());
  brollStack.forEach(item => item.video?.pause());
  sfxStack   = [];
  bgmStack   = [];
  illuStack  = [];
  brollStack = [];
  textStack  = [];
  selectedSfxId = null;
  focusedBgmId  = null;
  clearAiChat();
  if (illuContainer) illuContainer.innerHTML = '';
  if (textContainer) textContainer.innerHTML = '';
  overlayBroll.classList.add('hidden');
  brollPlayer.pause();
  brollPlayer.removeAttribute('src');
  if (audioPlayer) { audioPlayer.pause(); audioPlayer.removeAttribute('src'); }
  syncSingleAssetUI();
  renderTextStack();
  renderIlluStack();
  renderBgmStack();
  renderSfxStack();
  renderBrollStack();
  renderSfxMarkers();
}

let autosaveTimer = null;
function scheduleProjectAutosave() {
  if (!editorSettings.autosaveProject) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveProjectSnapshot(false), 350);
}

function saveProjectSnapshot(manual = false) {
  try {
    const snapshot = {
      version: PROJECT_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      projectName: (el('project-name')?.value || 'my-project').trim(),
      settings: cloneJSON(editorSettings),
      editorState: {
        aspect,
        preset,
        activeFilter,
        playbackSpeed,
        masterVolume,
        logoPosition,
        audioProcessing,
        exportFormat,
        times: { ...times },
        segments: cloneJSON(segments),
        scrubAudio: !!el('scrub-toggle')?.checked,
        crossfadeCuts: !!el('crossfade-toggle')?.checked,
        textStack: textStack.map(item => ({ text: item.text, at: item.at, duration: item.duration, position: item.position, color: item.color, bgColor: item.bgColor })),
        illuStack: illuStack.map(item => ({ fileName: item.file?.name || '', at: item.at, duration: item.duration, layout: item.layout })),
        bgmStack: bgmStack.map(item => ({ fileName: item.file?.name || '', startAt: item.startAt, offset: item.offset, volume: item.volume })),
        sfxStack: sfxStack.map(item => ({ fileName: item.file?.name || '', at: item.at, volume: item.volume })),
        brollStack: brollStack.map(item => ({ fileName: item.file?.name || '', at: item.at, duration: item.duration, muteAudio: item.muteAudio, layout: item.layout || 'fullscreen' }))
      }
    };
    localStorage.setItem(STORAGE_KEYS.projectSnapshot, JSON.stringify(snapshot));
    if (manual) {
      setInlineStatus('project-save-status', `Project saved locally at ${new Date().toLocaleTimeString()}.`, 'success');
      toast('Project state saved ✓', 'success');
    }
  } catch (err) {
    console.warn('[Project] Could not save snapshot:', err.message);
  }
}

function restoreSavedProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.projectSnapshot);
    if (!raw) { toast('No saved project found', 'info'); return; }
    const snapshot = JSON.parse(raw);
    if (el('project-name')) el('project-name').value = snapshot.projectName || 'my-project';
    if (snapshot.editorState) {
      setAspect(snapshot.editorState.aspect || 'landscape');
      setPreset(snapshot.editorState.preset || 'ultrafast');
      setVideoFilter(snapshot.editorState.activeFilter || 'normal');
      setPlaybackSpeed(snapshot.editorState.playbackSpeed || 1.0);
      setMasterVolume(snapshot.editorState.masterVolume ?? 1.0);
      setExportFormat(snapshot.editorState.exportFormat || 'mp4');
      if (Array.isArray(snapshot.editorState.segments) && snapshot.editorState.segments.length > 0) {
        segments = snapshot.editorState.segments;
      }
    }
    toast('Saved project state restored ✓', 'success');
  } catch (err) {
    toast('Could not restore saved project', 'error');
  }
}

// ── UNIFIED UNDO / REDO SYSTEM ────────────────────────────────
function pushHistory() {
  editHistory.push({
    segments:        cloneJSON(segments),
    times:           { ...times },
    assets:          { ...assets },
    sfxStack:        sfxStack.map(i => ({ ...i })),
    bgmStack:        bgmStack.map(i => ({ ...i })),
    illuStack:       illuStack.map(i => ({ ...i })),
    brollStack:      brollStack.map(i => ({ ...i })),
    textStack:       textStack.map(i => ({ ...i })),
    logoPosition,
    audioProcessing,
    activeFilter,
    playbackSpeed,
    aspect,
    preset
  });
  redoHistory = []; // clear redo on new action
  if (el('undo-btn')) el('undo-btn').disabled = false;
  if (el('redo-btn')) el('redo-btn').disabled = true;
  scheduleProjectAutosave();
}

function doUndo() {
  if (editHistory.length === 0) { announce('Nothing to undo.'); return; }
  
  // Save current state to redo history
  redoHistory.push({
    segments:        cloneJSON(segments),
    times:           { ...times },
    assets:          { ...assets },
    sfxStack:        sfxStack.map(i => ({ ...i })),
    bgmStack:        bgmStack.map(i => ({ ...i })),
    illuStack:       illuStack.map(i => ({ ...i })),
    brollStack:      brollStack.map(i => ({ ...i })),
    textStack:       textStack.map(i => ({ ...i })),
    logoPosition,
    audioProcessing,
    activeFilter,
    playbackSpeed,
    aspect,
    preset
  });

  const prev = editHistory.pop();
  applyStateSnapshot(prev);
  if (el('undo-btn')) el('undo-btn').disabled = editHistory.length === 0;
  if (el('redo-btn')) el('redo-btn').disabled = false;
  toast('Undo applied ✓', 'info');
  announce('Undo applied.');
}

function doRedo() {
  if (redoHistory.length === 0) { announce('Nothing to redo.'); return; }
  
  // Save current state back to undo history
  editHistory.push({
    segments:        cloneJSON(segments),
    times:           { ...times },
    assets:          { ...assets },
    sfxStack:        sfxStack.map(i => ({ ...i })),
    bgmStack:        bgmStack.map(i => ({ ...i })),
    illuStack:       illuStack.map(i => ({ ...i })),
    brollStack:      brollStack.map(i => ({ ...i })),
    textStack:       textStack.map(i => ({ ...i })),
    logoPosition,
    audioProcessing,
    activeFilter,
    playbackSpeed,
    aspect,
    preset
  });

  const next = redoHistory.pop();
  applyStateSnapshot(next);
  if (el('undo-btn')) el('undo-btn').disabled = false;
  if (el('redo-btn')) el('redo-btn').disabled = redoHistory.length === 0;
  toast('Redo applied ✓', 'info');
  announce('Redo applied.');
}

function applyStateSnapshot(snap) {
  segments        = snap.segments;
  times           = { ...snap.times };
  assets          = { ...snap.assets };
  sfxStack        = snap.sfxStack.map(i => ({ ...i, audio: sfxStack.find(s => s.id === i.id)?.audio || new Audio() }));
  bgmStack        = snap.bgmStack.map(i => ({ ...i, audio: bgmStack.find(b => b.id === i.id)?.audio || new Audio() }));
  illuStack       = snap.illuStack.map(i => ({ ...i, el: illuStack.find(il => il.id === i.id)?.el || null })).filter(i => i.el);
  brollStack      = snap.brollStack.map(i => ({ ...i, video: brollStack.find(b => b.id === i.id)?.video || null })).filter(i => i.video);
  textStack       = snap.textStack.map(i => ({ ...i, el: textStack.find(t => t.id === i.id)?.el || null })).filter(i => i.el);
  logoPosition    = snap.logoPosition;
  audioProcessing = snap.audioProcessing;
  aspect          = snap.aspect;
  preset          = snap.preset || preset;
  
  setVideoFilter(snap.activeFilter || 'normal');
  setPlaybackSpeed(snap.playbackSpeed || 1.0);

  updateTimecodes();
  updateTrimBar();
  updateSegmentDisplay();
  updateSummary();
  renderSfxStack();
  renderBgmStack();
  renderIlluStack();
  renderBrollStack();
  renderTextStack();
  renderSfxMarkers();
  syncSingleAssetUI();
  setAspect(aspect);
  setPreset(preset);
}

// ── FEATURE: VIDEO FILTERS & VISUAL EFFECTS ──────────────────
function setVideoFilter(val) {
  activeFilter = val;
  if (videoContainer) {
    videoContainer.className = `video-container filter-${val}`;
  }
  if (el('filter-select')) el('filter-select').value = val;
  updateSummary();
  announce(`Video filter set to: ${val}.`);
}

// ── FEATURE: PLAYBACK SPEED CONTROL ───────────────────────────
function setPlaybackSpeed(rate) {
  playbackSpeed = rate;
  if (player) player.playbackRate = rate;
  if (audioPlayer) audioPlayer.playbackRate = rate;
  if (el('speed-select')) el('speed-select').value = rate.toString();
  updateSummary();
  announce(`Playback speed set to ${rate}x.`);
}

// ── FEATURE: MASTER VOLUME ────────────────────────────────────
function setMasterVolume(vol) {
  masterVolume = vol;
  if (player) player.volume = Math.min(1.0, vol);
  if (audioPlayer) audioPlayer.volume = Math.min(1.0, vol);
  if (el('master-vol-val')) el('master-vol-val').textContent = `${Math.round(vol * 100)}%`;
}

// ── FEATURE: EXPORT FORMAT ────────────────────────────────────
function setExportFormat(fmt) {
  exportFormat = fmt;
  document.querySelectorAll('#seg-fmt-mp4, #seg-fmt-webm, #seg-fmt-gif, #seg-fmt-mp3').forEach(b => {
    const on = b.dataset.fmt === fmt;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const expBtn = el('export-btn');
  if (expBtn) {
    const labels = { mp4: 'EXPORT MP4 VIDEO', webm: 'EXPORT WEBM VIDEO', gif: 'EXPORT ANIMATED GIF', mp3: 'EXPORT MP3 AUDIO' };
    expBtn.innerHTML = `🚀 &nbsp; ${labels[fmt] || 'EXPORT MEDIA'} <kbd class="hdr-kbd">Ctrl+X</kbd>`;
  }
  updateSummary();
  announce(`Export format set to ${fmt.toUpperCase()}.`);
}

// ── FEATURE: CLIP SPLITTING AT PLAYHEAD ──────────────────────
function splitClipAtPlayhead() {
  if (!mainVideoFile) { toast('No media loaded', 'error'); return; }
  const t = activeMedia().currentTime;
  if (t <= 0 || t >= times.duration) { toast('Position playhead inside clip to split', 'error'); return; }

  // Find segment containing t
  const segIdx = segments.findIndex(s => t > s.s + 0.1 && t < s.e - 0.1);
  if (segIdx === -1) {
    toast('Playhead must be inside a kept segment to split', 'info');
    return;
  }

  pushHistory();
  const currentSeg = segments[segIdx];
  const seg1 = { s: currentSeg.s, e: t };
  const seg2 = { s: t, e: currentSeg.e };

  segments.splice(segIdx, 1, seg1, seg2);
  updateSegmentDisplay();
  updateSummary();
  toast(`Clip split into 2 at ${fmtTime(t)} ✂`, 'success');
  announce(`Clip split at ${fmtTime(t)}. Total segments: ${segments.length}.`);
}

// ── FEATURE: TEXT OVERLAYS & CAPTIONS (MULTI-STACK) ─────────
function triggerAddTextOverlay() {
  const defaultText = prompt('Enter text or caption for overlay:', 'Tech House Video');
  if (!defaultText || !defaultText.trim()) return;

  const id  = nextId();
  const at  = activeMedia().currentTime || 0;
  
  // Render overlay DOM element
  const overlayEl = document.createElement('div');
  overlayEl.className = 'text-overlay-el pos-bottom hidden';
  overlayEl.dataset.id = id;
  overlayEl.textContent = defaultText.trim();
  textContainer.appendChild(overlayEl);

  const item = {
    id,
    text: defaultText.trim(),
    at,
    duration: 3,
    position: 'bottom',
    fontSize: 24,
    color: '#ffffff',
    bgColor: 'rgba(0,0,0,0.65)',
    el: overlayEl
  };

  textStack.push(item);
  pushHistory();
  renderTextStack();
  updateSummary();
  announce(`Text overlay "${defaultText}" added at ${fmtTime(at)}.`);
  toast('Text overlay added ✓', 'success');
}

function renderTextStack() {
  const container = el('text-stack');
  if (!container) return;
  container.innerHTML = '';

  textStack.forEach(item => {
    const card = document.createElement('div');
    card.className = 'stack-item';
    card.innerHTML = `
      <div class="stack-item-header">
        <span class="stack-item-name">💬 "${item.text.slice(0, 18)}"</span>
        <button class="stack-item-remove" onclick="removeTextOverlay(${item.id})" aria-label="Remove text overlay">✕</button>
      </div>
      <div class="stack-item-controls">
        <div style="grid-column:1/-1;">
          <input type="text" class="text-input" value="${item.text}" style="padding:4px;font-size:0.75rem;"
                 aria-label="Text content" onchange="updateTextOverlay(${item.id}, 'text', this.value)">
        </div>
        <div class="stack-ctrl-row">
          <span class="stack-ctrl-label">At (s)</span>
          <input type="number" class="stack-ctrl-input" value="${item.at.toFixed(1)}" min="0" step="0.5"
                 aria-label="Start time" onchange="updateTextOverlay(${item.id}, 'at', parseFloat(this.value))">
        </div>
        <div class="stack-ctrl-row">
          <span class="stack-ctrl-label">Dur (s)</span>
          <input type="number" class="stack-ctrl-input" value="${item.duration}" min="0.5" step="0.5"
                 aria-label="Duration" onchange="updateTextOverlay(${item.id}, 'duration', parseFloat(this.value))">
        </div>
        <div style="grid-column:1/-1;">
          <span class="stack-ctrl-label">Position</span>
          <select class="stack-select" aria-label="Position" onchange="updateTextOverlay(${item.id}, 'position', this.value)">
            <option value="bottom" ${item.position==='bottom'?'selected':''}>Bottom Subtitle</option>
            <option value="top" ${item.position==='top'?'selected':''}>Top Title</option>
            <option value="center" ${item.position==='center'?'selected':''}>Center Banner</option>
            <option value="lower-third" ${item.position==='lower-third'?'selected':''}>Lower Third</option>
          </select>
        </div>
      </div>`;
    container.appendChild(card);
  });
}

function updateTextOverlay(id, field, val) {
  const item = textStack.find(t => t.id === id);
  if (!item) return;
  item[field] = val;
  if (item.el) {
    if (field === 'text') item.el.textContent = val;
    if (field === 'position') item.el.className = `text-overlay-el pos-${val} hidden`;
  }
  updateSummary();
}

function removeTextOverlay(id) {
  const idx = textStack.findIndex(t => t.id === id);
  if (idx === -1) return;
  if (textStack[idx].el) textStack[idx].el.remove();
  textStack.splice(idx, 1);
  pushHistory();
  renderTextStack();
  updateSummary();
  toast('Text overlay removed', 'info');
}

// ── FULLSCREEN TOGGLE ─────────────────────────────────────────
function toggleFullscreen() {
  if (!previewStage) return;
  if (!document.fullscreenElement) {
    if (previewStage.requestFullscreen) previewStage.requestFullscreen();
    else if (previewStage.webkitRequestFullscreen) previewStage.webkitRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
  }
}

// ── KEYBOARD SHORTCUTS CHEAT SHEET MODAL ──────────────────────
const SHORTCUTS_DATA = [
  { cat: 'Playback & Navigation', key: 'Space', desc: 'Play / Pause main media' },
  { cat: 'Playback & Navigation', key: '← / →', desc: 'Seek 10 seconds back / forward' },
  { cat: 'Playback & Navigation', key: 'Shift + ← / →', desc: 'Seek 1 second back / forward' },
  { cat: 'Playback & Navigation', key: 'Alt + ← / →', desc: 'Frame step (1 frame = 0.04s)' },
  { cat: 'Playback & Navigation', key: 'Home / End', desc: 'Jump to start / end of timeline' },
  { cat: 'Playback & Navigation', key: 'F', desc: 'Toggle Fullscreen preview' },
  { cat: 'Playback & Navigation', key: '< / > (Shift + ,/.)', desc: 'Adjust playback speed (0.25x - 2.0x)' },
  
  { cat: 'Editing & Trimming', key: 'S or I', desc: 'Set In point at current playhead' },
  { cat: 'Editing & Trimming', key: 'E or O', desc: 'Set Out point at current playhead' },
  { cat: 'Editing & Trimming', key: 'C or B', desc: 'Split clip into two at playhead' },
  { cat: 'Editing & Trimming', key: 'Backspace / Delete', desc: 'Cut selected In-Out range' },
  { cat: 'Editing & Trimming', key: 'Ctrl + Shift + R', desc: 'Reset all trims and cuts' },
  { cat: 'Editing & Trimming', key: 'Z', desc: 'Toggle 4x Timeline Zoom' },
  
  { cat: 'Layers & Assets', key: 'Ctrl + L', desc: 'Add / Upload Watermark Logo' },
  { cat: 'Layers & Assets', key: 'Ctrl + T', desc: 'Add Text Overlay / Subtitle Caption' },
  { cat: 'Layers & Assets', key: 'Ctrl + I', desc: 'Add Illustration Overlay' },
  { cat: 'Layers & Assets', key: 'Ctrl + B', desc: 'Add Background Music (BGM) Track' },
  { cat: 'Layers & Assets', key: 'Ctrl + F', desc: 'Add Sound Effect (SFX)' },
  { cat: 'Layers & Assets', key: 'Ctrl + R', desc: 'Add B-Roll Video Overlay' },
  { cat: 'Layers & Assets', key: 'Ctrl + U', desc: 'Add Audio Swap File' },
  { cat: 'Layers & Assets', key: 'Shift + M', desc: 'Play / Pause focused BGM music track' },
  { cat: 'Layers & Assets', key: '[ / ]', desc: 'Nudge BGM start time −1s / +1s' },
  { cat: 'Layers & Assets', key: 'Shift + Ctrl + ←/→', desc: 'Nudge selected SFX time by 0.1s' },

  { cat: 'Project & System', key: 'Ctrl + Z', desc: 'Undo last edit' },
  { cat: 'Project & System', key: 'Ctrl + Y / Ctrl+Shift+Z', desc: 'Redo last reverted edit' },
  { cat: 'Project & System', key: 'Ctrl + S', desc: 'Save project state locally' },
  { cat: 'Project & System', key: 'Ctrl + Shift + O', desc: 'Restore saved project state' },
  { cat: 'Project & System', key: 'Ctrl + D', desc: 'Auto-detect silence & cut gaps' },
  { cat: 'Project & System', key: 'Ctrl + X', desc: 'Export final media file' },
  { cat: 'Project & System', key: 'Ctrl + ,', desc: 'Open Editor Settings Modal' },
  { cat: 'Project & System', key: '? or Shift + /', desc: 'Open Keyboard Shortcuts Cheat Sheet' },

  { cat: 'Accessibility & Theme', key: 'Alt + M', desc: 'Toggle Reduce Motion' },
  { cat: 'Accessibility & Theme', key: 'Alt + C', desc: 'Toggle High Contrast Mode' },
  { cat: 'Accessibility & Theme', key: 'Alt + T', desc: 'Toggle Dark / Light Theme' }
];

function openShortcutsModal() {
  const overlay = el('shortcuts-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  document.body.classList.add('modal-open');
  renderShortcutsGrid('');
  setTimeout(() => { el('shortcuts-search')?.focus(); }, 30);
  document.addEventListener('keydown', shortcutsEscHandler);
}

function closeShortcutsModal() {
  const overlay = el('shortcuts-overlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  document.body.classList.remove('modal-open');
  document.removeEventListener('keydown', shortcutsEscHandler);
}

function shortcutsEscHandler(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeShortcutsModal(); }
}

function renderShortcutsGrid(query) {
  const grid = el('shortcuts-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const q = (query || '').toLowerCase().trim();
  const filtered = SHORTCUTS_DATA.filter(item =>
    !q || item.key.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q) || item.cat.toLowerCase().includes(q)
  );

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:20px;text-align:center;color:var(--text-dim);">No shortcuts match "${query}".</div>`;
    return;
  }

  let currentCat = '';
  filtered.forEach(item => {
    if (item.cat !== currentCat) {
      currentCat = item.cat;
      const catHeader = document.createElement('div');
      catHeader.className = 'shortcuts-cat-title';
      catHeader.textContent = currentCat;
      grid.appendChild(catHeader);
    }

    const row = document.createElement('div');
    row.className = 'shortcut-row';
    row.innerHTML = `
      <span class="sc-desc">${item.desc}</span>
      <kbd class="sc-key">${item.key}</kbd>
    `;
    grid.appendChild(row);
  });
}

// ── INITIALIZATION ───────────────────────────────────────────
function initializeEnhancements() {
  loadEditorSettings();
  updateSettingsForm();

  el('save-gemini-key')?.addEventListener('click', () => {
    syncSettingsFromForm();
    persistEditorSettings('Gemini API key saved locally.');
    updateGeminiStatusText();
  });

  el('clear-gemini-key')?.addEventListener('click', () => {
    editorSettings.geminiApiKey = '';
    if (el('gemini-api-key')) el('gemini-api-key').value = '';
    persistEditorSettings('Gemini key cleared.');
    updateGeminiStatusText();
  });

  el('test-gemini-key')?.addEventListener('click', () => {
    syncSettingsFromForm();
    testGeminiKey();
  });

  ['gemini-model', 'autosave-project', 'reduce-motion-toggle', 'high-contrast-toggle']
    .forEach(id => el(id)?.addEventListener('change', () => {
      syncSettingsFromForm();
      applyAccessibilityPreferences();
      persistEditorSettings('Preferences saved.');
    }));

  ['ai-transcript', 'project-name'].forEach(id => el(id)?.addEventListener('input', () => {
    syncSettingsFromForm();
    scheduleProjectAutosave();
  }));

  el('save-project-btn')?.addEventListener('click', () => saveProjectSnapshot(true));
  el('load-project-btn')?.addEventListener('click', restoreSavedProject);
  el('analyze-project-btn')?.addEventListener('click', analyzeProjectWithGemini);

  // AI Chat & Modals Wiring
  el('ai-send-btn')?.addEventListener('click', sendChatMessage);
  el('ai-clear-chat-btn')?.addEventListener('click', clearAiChat);
  el('open-settings-btn')?.addEventListener('click', openSettingsModal);
  el('open-settings-inline')?.addEventListener('click', openSettingsModal);
  el('settings-close-btn')?.addEventListener('click', closeSettingsModal);
  el('settings-done-btn')?.addEventListener('click', closeSettingsModal);
  el('settings-overlay')?.addEventListener('click', (e) => {
    if (e.target === el('settings-overlay')) closeSettingsModal();
  });

  // Shortcuts Modal Wiring
  el('quick-shortcuts')?.addEventListener('click', openShortcutsModal);
  el('account-shortcuts-btn')?.addEventListener('click', openShortcutsModal);
  el('open-shortcuts-footer')?.addEventListener('click', openShortcutsModal);
  el('shortcuts-close-btn')?.addEventListener('click', closeShortcutsModal);
  el('shortcuts-done-btn')?.addEventListener('click', closeShortcutsModal);
  el('shortcuts-overlay')?.addEventListener('click', (e) => {
    if (e.target === el('shortcuts-overlay')) closeShortcutsModal();
  });
  el('shortcuts-search')?.addEventListener('input', (e) => renderShortcutsGrid(e.target.value));

  setupQuickToggles();

  // Double-tap preview stage for play/pause on touch devices
  let lastTap = 0;
  previewStage?.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTap < 300) {
      e.preventDefault();
      const m = activeMedia();
      m.paused ? m.play() : m.pause();
    }
    lastTap = now;
  });

  window.addEventListener('beforeunload', () => {
    syncSettingsFromForm();
    if (editorSettings.autosaveProject) saveProjectSnapshot(false);
  });
}

initializeEnhancements();

// ── GEMINI AI API SUBSYSTEM ──────────────────────────────────
async function callGeminiAPI(prompt, parts = []) {
  const apiKey = (editorSettings.geminiApiKey || '').trim();
  if (!apiKey) throw new Error('Add a Gemini API key in Editor Settings first.');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(editorSettings.geminiModel || 'gemini-3-flash-preview')}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [...parts, { text: prompt }] }],
        generationConfig: { temperature: 0.25, topP: 0.8, topK: 32 }
      })
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Gemini request failed with ${response.status}`);
  }
  return payload;
}

function extractGeminiText(payload) {
  return (payload?.candidates || [])
    .flatMap(candidate => candidate?.content?.parts || [])
    .map(part => part?.text || '')
    .join('\n')
    .trim();
}

function parseGeminiJson(text) {
  const cleaned = (text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(cleaned); }
  catch (_) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('Gemini did not return valid JSON.');
  }
}

async function testGeminiKey() {
  try {
    updateGeminiStatusText('Checking Gemini key…', 'info');
    const payload = await callGeminiAPI('Reply with the single word OK.');
    const text = extractGeminiText(payload);
    updateGeminiStatusText(text ? 'Gemini API key is valid and working ✓' : 'Gemini responded without text.', 'success');
  } catch (err) {
    updateGeminiStatusText(err.message || 'Gemini key test failed.', 'error');
    toast('Gemini key test failed', 'error');
  }
}

// ── ENGINE INITIALIZATION ────────────────────────────────────
(async function initEngine() {
  setStatus('Loading FFmpeg video processing engine…');
  try {
    await ffmpeg.load();
    engineReady = true;
    engineBadge.textContent = 'ENGINE READY';
    engineBadge.classList.add('online');
    setStatus('Engine ready. Load a video or audio file to start.');
    toast('FFmpeg engine loaded ✓', 'success');
  } catch (err) {
    engineBadge.textContent = 'ENGINE ERROR';
    setStatus('Engine load failed — please refresh.', true);
    toast('Engine error — refresh page', 'error');
    console.error(err);
  }
})();

// ── AUTHENTICATION & ACCOUNT MENU ────────────────────────────
function setupQuickToggles() {
  el('quick-reduce-motion')?.addEventListener('click', () => {
    editorSettings.reduceMotion = !editorSettings.reduceMotion;
    applyAccessibilityPreferences(); persistEditorSettings(); applyQuickToggleState();
  });
  el('quick-high-contrast')?.addEventListener('click', () => {
    editorSettings.highContrast = !editorSettings.highContrast;
    applyAccessibilityPreferences(); persistEditorSettings(); applyQuickToggleState();
  });
  el('quick-theme')?.addEventListener('click', toggleSiteTheme);
  applyQuickToggleState();
  applySiteTheme();
}

function applySiteTheme() {
  const dark = editorSettings.theme === 'dark';
  document.body.classList.toggle('theme-dark', dark);
  const t = el('quick-theme');
  if (t) { t.setAttribute('aria-checked', String(dark)); t.classList.toggle('on', dark); }
}

function toggleSiteTheme() {
  editorSettings.theme = editorSettings.theme === 'dark' ? 'light' : 'dark';
  applySiteTheme();
  persistEditorSettings();
  toast(`Theme: ${editorSettings.theme === 'dark' ? 'Dark' : 'Light'}`, 'info');
}

function applyQuickToggleState() {
  const rm = el('quick-reduce-motion');
  const hc = el('quick-high-contrast');
  if (rm) { rm.setAttribute('aria-checked', String(!!editorSettings.reduceMotion)); rm.classList.toggle('on', !!editorSettings.reduceMotion); }
  if (hc) { hc.setAttribute('aria-checked', String(!!editorSettings.highContrast)); hc.classList.toggle('on', !!editorSettings.highContrast); }
}

function setupAuth() {
  const signinBtn  = document.getElementById('auth-signin-btn');
  const accountBtn = document.getElementById('auth-account-btn');
  const googleBtn  = document.getElementById('auth-google-btn');
  const logoutBtn  = document.getElementById('auth-logout-btn');
  const googlePop  = document.getElementById('auth-google-popup');
  const popClose   = document.getElementById('auth-popup-close');
  const accountMenu = document.getElementById('account-menu');
  const settingsBtn = document.getElementById('account-settings-btn');

  const closeAccountMenu = () => {
    if (accountMenu) accountMenu.classList.add('hidden');
    if (accountBtn) accountBtn.setAttribute('aria-expanded', 'false');
  };
  const toggleAccountMenu = (force) => {
    if (!accountMenu || !accountBtn) return;
    const open = force !== undefined ? force : accountMenu.classList.contains('hidden');
    accountMenu.classList.toggle('hidden', !open);
    accountBtn.setAttribute('aria-expanded', String(open));
  };

  if (signinBtn) {
    signinBtn.addEventListener('click', () => {
      googlePop.classList.toggle('hidden');
      signinBtn.setAttribute('aria-expanded', String(!googlePop.classList.contains('hidden')));
    });
  }
  if (popClose) popClose.addEventListener('click', () => googlePop.classList.add('hidden'));

  if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
      googlePop.classList.add('hidden');
      if (!gProvider || !fbSignInWithPopup) { toast('Sign-in unavailable — reload page', 'error'); return; }
      try {
        await fbSignInWithPopup(gProvider);
        toast('Signed in to Tech House ✓', 'success');
      } catch (err) {
        if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
        try { if (fbSignInWithRedirect) await fbSignInWithRedirect(gProvider); }
        catch (_) { toast('Sign-in failed: ' + (err.message || err.code), 'error'); }
      }
    });
  }

  if (accountBtn) accountBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleAccountMenu(); });
  if (settingsBtn) settingsBtn.addEventListener('click', () => { closeAccountMenu(); openSettingsModal(); });
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      closeAccountMenu();
      try { if (fbSignOut) await fbSignOut(); toast('Logged out of Tech House', 'info'); }
      catch (err) { toast('Log out failed: ' + err.message, 'error'); }
    });
  }

  document.addEventListener('click', e => {
    const widget = document.getElementById('auth-widget');
    if (widget && !widget.contains(e.target)) {
      if (googlePop) googlePop.classList.add('hidden');
      closeAccountMenu();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (googlePop) googlePop.classList.add('hidden');
      closeAccountMenu();
    }
  });

  if (fbOnAuthStateChanged) {
    fbOnAuthStateChanged(user => {
      if (user) {
        const displayName = user.displayName || (user.email ? user.email.split('@')[0] : 'User');
        const email = user.email || '';
        const avatar = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=f59e0b&color=000&size=80`;
        signinBtn?.classList.add('hidden');
        accountBtn?.classList.remove('hidden');
        if (el('auth-name')) el('auth-name').textContent = displayName;
        if (el('auth-avatar')) el('auth-avatar').src = avatar;
        if (el('account-menu-avatar')) el('account-menu-avatar').src = avatar;
        if (el('account-menu-name')) el('account-menu-name').textContent = displayName;
        if (el('account-menu-email')) el('account-menu-email').textContent = email || 'signed in';
      } else {
        signinBtn?.classList.remove('hidden');
        accountBtn?.classList.add('hidden');
        closeAccountMenu();
      }
    });
  }
}

// ── MEDIA UPLOAD & HANDLING ──────────────────────────────────
function detectMediaKind(file) {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', '3gp'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'aiff'].includes(ext)) return 'audio';
  return '';
}

async function handleMainMediaFile(file) {
  if (!file) return;
  const kind = detectMediaKind(file);
  if (!kind) {
    toast('Unsupported file — select a video or audio file', 'error');
    setStatus('Unsupported file type.', true);
    return;
  }

  resetProjectMediaState();
  mediaKind = kind;
  mainVideoFile = file;
  applyMediaKindUI();

  if (kind === 'video') {
    await loadMainVideo(file);
  } else {
    await loadMainAudio(file);
  }
}

function applyMediaKindUI() {
  const isAudio = mediaKind === 'audio';
  if (player) player.classList.toggle('hidden', isAudio);
  if (audioOnlyStage) audioOnlyStage.classList.toggle('hidden', !isAudio);
  document.body.classList.toggle('audio-mode', isAudio);
  document.querySelectorAll('[data-video-only]').forEach(node => {
    node.classList.toggle('mode-disabled', isAudio);
  });
}

function finishMediaLoad(file, duration) {
  times.duration = duration;
  times.s = 0;
  times.e = duration;
  segments    = [{ s: 0, e: duration }];
  editHistory = [];
  redoHistory = [];

  if (uploadZone) uploadZone.classList.add('hidden');
  if (previewStage) previewStage.classList.remove('hidden');
  if (el('export-btn')) el('export-btn').disabled = false;
  if (el('silence-btn')) el('silence-btn').disabled = false;
  if (el('undo-btn')) el('undo-btn').disabled = true;
  if (el('redo-btn')) el('redo-btn').disabled = true;
  if (el('ai-chat-input')) el('ai-chat-input').disabled = false;
  if (el('ai-send-btn')) el('ai-send-btn').disabled = false;

  updateTimecodes();
  updateTrimBar();
  updateSegmentDisplay();
  updateSummary();
  renderSfxMarkers();
  const kindLabel = mediaKind === 'audio' ? 'Audio' : 'Video';
  setStatus(`Loaded: "${file.name}" — ${fmtTime(duration)}`);
  toast(`${kindLabel} loaded ✓`, 'success');
  scheduleProjectAutosave();

  decodeVideoAudio(file);
}

function loadMainVideo(file) {
  return new Promise((resolve) => {
    player.src = getPreviewURL(file);
    player.load();
    const onMeta = () => {
      player.removeEventListener('loadedmetadata', onMeta);
      finishMediaLoad(file, player.duration || 0);
      resolve();
    };
    player.addEventListener('loadedmetadata', onMeta, { once: true });
    
    // Nudge Safari iOS metadata loading
    const wasMuted = player.muted;
    player.muted = true;
    const kick = player.play?.();
    if (kick && typeof kick.then === 'function') {
      kick.then(() => { player.pause(); player.currentTime = 0; player.muted = wasMuted; })
          .catch(() => { player.muted = wasMuted; });
    } else {
      player.muted = wasMuted;
    }
  });
}

function loadMainAudio(file) {
  return new Promise((resolve) => {
    if (el('audio-only-name')) el('audio-only-name').textContent = file.name;
    audioPlayer.src = getPreviewURL(file);
    audioPlayer.load();
    const onMeta = () => {
      audioPlayer.removeEventListener('loadedmetadata', onMeta);
      finishMediaLoad(file, audioPlayer.duration || 0);
      resolve();
    };
    audioPlayer.addEventListener('loadedmetadata', onMeta, { once: true });
  });
}

el('vid-uploader')?.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  await handleMainMediaFile(file);
  e.target.value = '';
});

if (uploadZone) {
  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.style.borderColor = 'var(--amber)'; });
  uploadZone.addEventListener('dragleave', () => { uploadZone.style.borderColor = ''; });
  uploadZone.addEventListener('drop', async e => {
    e.preventDefault();
    uploadZone.style.borderColor = '';
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && detectMediaKind(file)) await handleMainMediaFile(file);
  });
}

async function decodeVideoAudio(file) {
  try {
    const arrayBuf = await file.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    mainAudioBuffer = await ctx.decodeAudioData(arrayBuf);
    ctx.close();
    setStatus(`Audio waveform ready. ${fmtTime(mainAudioBuffer.duration)} for analysis.`);
  } catch (err) {
    console.warn('[Audio decode]', err.message);
  }
}

// ── SILENCE DETECTION ─────────────────────────────────────────
async function detectSilence() {
  if (!mainAudioBuffer) { toast('Audio waveform decoding — try again in a moment', 'info'); return; }
  const thresholdDb = parseFloat(el('silence-threshold')?.value || '-40');
  const minDurSec   = parseFloat(el('silence-min-dur')?.value || '0.5');
  const threshold   = Math.pow(10, thresholdDb / 20);

  setStatus('Scanning for silent gaps…');
  toast('Scanning for silent gaps…', 'info');

  const data       = mainAudioBuffer.getChannelData(0);
  const sr         = mainAudioBuffer.sampleRate;
  const windowSamp = Math.floor(sr * 0.05);

  const silentRanges = [];
  let inSilence = false;
  let silStart  = 0;

  for (let i = 0; i < data.length; i += windowSamp) {
    let sum = 0;
    const end = Math.min(i + windowSamp, data.length);
    for (let j = i; j < end; j++) sum += data[j] * data[j];
    const rms = Math.sqrt(sum / (end - i));

    const t = i / sr;
    if (rms < threshold) {
      if (!inSilence) { inSilence = true; silStart = t; }
    } else {
      if (inSilence) {
        inSilence = false;
        const dur = t - silStart;
        if (dur >= minDurSec) silentRanges.push({ s: silStart, e: t });
      }
    }
  }
  if (inSilence) {
    const dur = mainAudioBuffer.duration - silStart;
    if (dur >= minDurSec) silentRanges.push({ s: silStart, e: mainAudioBuffer.duration });
  }

  if (silentRanges.length === 0) {
    toast('No silent gaps found above threshold', 'info');
    setStatus('No silence detected.');
    return;
  }

  pushHistory();
  for (const range of silentRanges) {
    const cs = range.s + 0.05;
    const ce = range.e - 0.05;
    if (ce - cs < 0.1) continue;
    const newSegs = [];
    for (const seg of segments) {
      if (cs > seg.s) newSegs.push({ s: seg.s, e: Math.min(cs, seg.e) });
      if (ce < seg.e) newSegs.push({ s: Math.max(ce, seg.s), e: seg.e });
    }
    segments = newSegs.filter(s => s.e - s.s > 0.05);
  }

  updateSegmentDisplay();
  updateSummary();
  times.s = 0; times.e = times.duration;
  updateTrimBar();

  const kept = segments.reduce((a, s) => a + (s.e - s.s), 0);
  setStatus(`Silence removed: ${silentRanges.length} cuts applied.`);
  toast(`${silentRanges.length} silent gap${silentRanges.length > 1 ? 's' : ''} cut ✂`, 'success');
}

// ── LAYER UPLOADS ─────────────────────────────────────────────
function triggerLayer(type) {
  const input = el('layer-uploader');
  if (!input) return;
  input.accept = (type === 'logo') ? 'image/*' : 'audio/*';
  input._type  = type;
  input.click();
}

el('layer-uploader').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const type = e.target._type;
  pushHistory();
  assets[type] = file;
  syncSingleAssetUI();
  updateSummary();
  toast(`${type === 'logo' ? 'Logo' : 'Audio Swap'} added ✓`, 'success');
  e.target.value = '';
};

function setLogoPosition(val) {
  logoPosition = val;
  applyLogoPosition(val);
  updateSummary();
  announce(`Logo position: ${val.replace(/-/g,' ')}.`);
}

function applyLogoPosition(val) {
  overlayLogo.className = 'overlay-logo';
  overlayLogo.classList.add('pos-' + val);
  if (!assets.logo) overlayLogo.classList.add('hidden');
}

function setAudioProcessing(val) {
  audioProcessing = val;
  const strengthRow = el('noise-strength-row');
  if (strengthRow) strengthRow.style.display = (val === 'noise') ? 'block' : 'none';
  updateSummary();
  announce(`Audio processing set to: ${val}.`);
}

// ── MULTI-STACK: ILLUSTRATIONS ────────────────────────────────
function triggerAddIllu() { el('illu-uploader')?.click(); }

el('illu-uploader').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const id  = nextId();
  const at  = activeMedia().currentTime || 0;
  const url = URL.createObjectURL(file);

  const elNode = document.createElement('div');
  elNode.className = 'illu-overlay-el layout-center hidden';
  elNode.dataset.id = id;
  const img = document.createElement('img');
  img.src = url;
  elNode.appendChild(img);
  if (illuContainer) illuContainer.appendChild(elNode);

  illuStack.push({ id, file, url, at, duration: 3, layout: 'center', el: elNode });
  pushHistory();
  renderIlluStack();
  updateSummary();
  toast('Illustration added ✓', 'success');
  e.target.value = '';
};

function renderIlluStack() {
  const container = el('illu-stack');
  if (!container) return;
  container.innerHTML = '';
  illuStack.forEach(item => {
    const card = document.createElement('div');
    card.className = 'stack-item';
    card.innerHTML = `
      <div class="stack-item-header">
        <span class="stack-item-name">🎨 ${item.file.name.slice(0,18)}</span>
        <button class="stack-item-remove" onclick="removeIllu(${item.id})" aria-label="Remove illustration">✕</button>
      </div>
      <div class="stack-item-controls">
        <div class="stack-ctrl-row">
          <span class="stack-ctrl-label">At (s)</span>
          <input type="number" class="stack-ctrl-input" value="${item.at.toFixed(2)}" min="0" step="0.1"
                 aria-label="Timestamp" onchange="updateIllu(${item.id},'at',parseFloat(this.value))">
        </div>
        <div class="stack-ctrl-row">
          <span class="stack-ctrl-label">Dur (s)</span>
          <input type="number" class="stack-ctrl-input" value="${item.duration}" min="0.5" step="0.5"
                 aria-label="Duration" onchange="updateIllu(${item.id},'duration',parseFloat(this.value))">
        </div>
        <div style="grid-column:1/-1;">
          <span class="stack-ctrl-label">Layout</span>
          <select class="stack-select" onchange="updateIllu(${item.id},'layout',this.value)" aria-label="Layout">
            ${['center','fullscreen','left-third','right-third'].map(l =>
              `<option value="${l}" ${item.layout===l?'selected':''}>${l.replace(/-/g,' ')}</option>`).join('')}
          </select>
        </div>
      </div>`;
    container.appendChild(card);
  });
}

function updateIllu(id, field, val) {
  const item = illuStack.find(i => i.id === id);
  if (!item) return;
  item[field] = val;
  if (field === 'layout' && item.el) {
    item.el.className = `illu-overlay-el layout-${val} hidden`;
  }
  updateSummary();
}

function removeIllu(id) {
  const idx = illuStack.findIndex(i => i.id === id);
  if (idx === -1) return;
  if (illuStack[idx].el) illuStack[idx].el.remove();
  illuStack.splice(idx, 1);
  pushHistory();
  renderIlluStack();
  updateSummary();
  toast('Illustration removed', 'info');
}

// ── MULTI-STACK: BGM ──────────────────────────────────────────
function triggerAddBGM() { el('bgm-uploader')?.click(); }

el('bgm-uploader').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const id    = nextId();
  const audio = new Audio();
  audio.src   = URL.createObjectURL(file);
  audio.loop  = true;
  audio.volume = 0.18;
  bgmStack.push({ id, file, audio, startAt: 0, offset: 0, volume: 18 });
  pushHistory();
  focusedBgmId = id;
  renderBgmStack();
  updateSummary();
  toast('BGM track added ✓', 'success');
  e.target.value = '';
};

function renderBgmStack() {
  const container = el('bgm-stack');
  if (!container) return;
  container.innerHTML = '';
  bgmStack.forEach(item => {
    const isFocused = item.id === focusedBgmId;
    const card = document.createElement('div');
    card.className = 'stack-item' + (isFocused ? ' selected' : '');
    card.innerHTML = `
      <div class="stack-item-header">
        <span class="stack-item-name">🎵 ${item.file.name.slice(0,16)}</span>
        <div style="display:flex;gap:4px;align-items:center;">
          ${isFocused ? `<span class="bgm-focused-badge">FOCUSED</span>` : ''}
          <button class="stack-item-remove" onclick="removeBgm(${item.id})" aria-label="Remove BGM track">✕</button>
        </div>
      </div>
      <button class="btn btn-sm btn-ghost" style="width:100%;font-size:0.7rem;margin-bottom:4px;"
              onclick="focusBgm(${item.id})" aria-label="Focus BGM track">
        ${isFocused ? '🎯 Focused — Shift+M to play/pause' : '🎯 Click to focus track'}
      </button>
      <div class="stack-item-controls">
        <div class="stack-ctrl-row">
          <span class="stack-ctrl-label">Start at (s)</span>
          <input type="number" class="stack-ctrl-input" value="${item.startAt}" min="0" step="0.5"
                 aria-label="Start time" onchange="updateBgm(${item.id},'startAt',parseFloat(this.value))">
        </div>
        <div class="stack-ctrl-row">
          <span class="stack-ctrl-label">Song offset (s)</span>
          <input type="number" class="stack-ctrl-input" value="${item.offset}" min="0" step="1"
                 aria-label="Song offset" onchange="updateBgm(${item.id},'offset',parseFloat(this.value))">
        </div>
        <div style="grid-column:1/-1;">
          <span class="stack-ctrl-label">Volume ${item.volume}%</span>
          <input type="range" class="stack-vol-slider" min="0" max="100" value="${item.volume}"
                 aria-label="BGM volume" oninput="updateBgm(${item.id},'volume',parseInt(this.value))">
        </div>
      </div>`;
    container.appendChild(card);
  });
}

function focusBgm(id) {
  focusedBgmId = id;
  renderBgmStack();
  const item = bgmStack.find(i => i.id === id);
  if (item) announce(`BGM "${item.file.name}" focused.`);
}

function toggleBgmPlayback(id) {
  const item = bgmStack.find(i => i.id === id);
  if (!item) return;
  if (!activeMedia().paused) activeMedia().pause();
  if (item.audio.paused) {
    item.audio.currentTime = item.offset;
    item.audio.play().catch(() => {});
    announce(`Playing BGM: ${item.file.name}`);
  } else {
    item.audio.pause();
    announce('BGM paused.');
  }
}

function updateBgm(id, field, val) {
  const item = bgmStack.find(i => i.id === id);
  if (!item) return;
  item[field] = val;
  if (field === 'volume') item.audio.volume = val / 100;
  if (field === 'offset') item.audio.currentTime = val;
  renderBgmStack();
  updateSummary();
}

function removeBgm(id) {
  const idx = bgmStack.findIndex(i => i.id === id);
  if (idx === -1) return;
  bgmStack[idx].audio.pause();
  bgmStack.splice(idx, 1);
  if (focusedBgmId === id) focusedBgmId = bgmStack.length > 0 ? bgmStack[0].id : null;
  pushHistory();
  renderBgmStack();
  updateSummary();
  toast('BGM track removed', 'info');
}

// ── MULTI-STACK: SFX ──────────────────────────────────────────
function triggerAddSFX() { el('sfx-uploader')?.click(); }

el('sfx-uploader').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const id    = nextId();
  const audio = new Audio();
  audio.src   = URL.createObjectURL(file);
  audio.volume = 1.0;
  sfxStack.push({ id, file, audio, at: activeMedia().currentTime || 0, volume: 100, triggered: false });
  pushHistory();
  renderSfxStack();
  renderSfxMarkers();
  updateSummary();
  toast('SFX added ✓', 'success');
  e.target.value = '';
};

function renderSfxStack() {
  const container = el('sfx-stack');
  if (!container) return;
  container.innerHTML = '';
  sfxStack.forEach(item => {
    const card = document.createElement('div');
    card.className = 'stack-item' + (item.id === selectedSfxId ? ' selected' : '');
    card.onclick = () => { selectedSfxId = item.id; renderSfxStack(); };
    card.innerHTML = `
      <div class="stack-item-header">
        <span class="stack-item-name">🔊 ${item.file.name.slice(0,18)}</span>
        <button class="stack-item-remove" onclick="event.stopPropagation();removeSfx(${item.id})" aria-label="Remove SFX">✕</button>
      </div>
      <div class="stack-item-controls">
        <div class="stack-ctrl-row">
          <span class="stack-ctrl-label">At (s)</span>
          <input type="number" class="stack-ctrl-input" value="${item.at.toFixed(2)}" min="0" step="0.1"
                 aria-label="Trigger time" onclick="event.stopPropagation()"
                 onchange="event.stopPropagation();updateSfx(${item.id},'at',parseFloat(this.value))">
        </div>
        <div style="grid-column:1/-1;">
          <span class="stack-ctrl-label">Volume ${item.volume}%</span>
          <input type="range" class="stack-vol-slider" min="0" max="100" value="${item.volume}"
                 aria-label="SFX volume" onclick="event.stopPropagation()"
                 oninput="event.stopPropagation();updateSfx(${item.id},'volume',parseInt(this.value))">
        </div>
      </div>`;
    container.appendChild(card);
  });
}

function updateSfx(id, field, val) {
  const item = sfxStack.find(i => i.id === id);
  if (!item) return;
  item[field] = val;
  if (field === 'volume') item.audio.volume = val / 100;
  renderSfxStack();
  renderSfxMarkers();
  updateSummary();
}

function removeSfx(id) {
  const idx = sfxStack.findIndex(i => i.id === id);
  if (idx === -1) return;
  sfxStack[idx].audio.pause();
  sfxStack.splice(idx, 1);
  if (selectedSfxId === id) selectedSfxId = null;
  pushHistory();
  renderSfxStack();
  renderSfxMarkers();
  updateSummary();
  toast('SFX removed', 'info');
}

function renderSfxMarkers() {
  const layer = el('sfx-markers-layer');
  if (!layer) return;
  layer.innerHTML = '';
  if (!times.duration) return;
  
  sfxStack.forEach(item => {
    const frac    = item.at / times.duration;
    const fracVis = Math.max(0, Math.min(1, (frac - zoomStart) * zoomLevel));
    const marker  = document.createElement('div');
    marker.className = 'sfx-timeline-marker';
    marker.style.left = (fracVis * 100) + '%';
    marker.title = `SFX: ${item.file.name} @ ${fmtTime(item.at)}`;
    layer.appendChild(marker);
  });
}

function nudgeSelectedSfx(deltaSeconds) {
  if (!selectedSfxId) { announce('No SFX selected.', true); return; }
  const item = sfxStack.find(i => i.id === selectedSfxId);
  if (!item) return;
  item.at = Math.max(0, Math.min(times.duration, item.at + deltaSeconds));
  renderSfxStack();
  renderSfxMarkers();
  announce(`SFX nudged to ${fmtTime(item.at)}.`);
}

// ── MULTI-STACK: B-ROLL ───────────────────────────────────────
function triggerAddBRoll() { el('broll-uploader')?.click(); }

el('broll-uploader').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const id  = nextId();
  const vid = document.createElement('video');
  vid.src   = URL.createObjectURL(file);
  vid.muted = true;
  vid.preload = 'metadata';
  brollStack.push({ id, file, video: vid, at: activeMedia().currentTime || 0, duration: 5, muteAudio: true, layout: 'fullscreen' });
  pushHistory();
  renderBrollStack();
  updateSummary();
  toast('B-Roll added ✓', 'success');
  e.target.value = '';
};

function renderBrollStack() {
  const container = el('broll-stack');
  if (!container) return;
  container.innerHTML = '';
  brollStack.forEach(item => {
    const card = document.createElement('div');
    card.className = 'stack-item';
    card.innerHTML = `
      <div class="stack-item-header">
        <span class="stack-item-name">🎥 ${item.file.name.slice(0,18)}</span>
        <button class="stack-item-remove" onclick="removeBroll(${item.id})" aria-label="Remove B-Roll">✕</button>
      </div>
      <div class="stack-item-controls">
        <div class="stack-ctrl-row">
          <span class="stack-ctrl-label">At (s)</span>
          <input type="number" class="stack-ctrl-input" value="${item.at.toFixed(1)}" min="0" step="0.5"
                 aria-label="Start time" onchange="updateBroll(${item.id},'at',parseFloat(this.value))">
        </div>
        <div class="stack-ctrl-row">
          <span class="stack-ctrl-label">Dur (s)</span>
          <input type="number" class="stack-ctrl-input" value="${item.duration}" min="0.5" step="0.5"
                 aria-label="Duration" onchange="updateBroll(${item.id},'duration',parseFloat(this.value))">
        </div>
        <div style="grid-column:1/-1;">
          <span class="stack-ctrl-label">Layout</span>
          <select class="stack-select" aria-label="Layout" onchange="updateBroll(${item.id},'layout',this.value)">
            ${['fullscreen','center','left-third','right-third'].map(l =>
              `<option value="${l}" ${item.layout===l?'selected':''}>${l.replace(/-/g,' ')}</option>`).join('')}
          </select>
        </div>
      </div>`;
    container.appendChild(card);
  });
}

function updateBroll(id, field, val) {
  const item = brollStack.find(i => i.id === id);
  if (!item) return;
  item[field] = val;
  if (field === 'muteAudio') item.video.muted = val;
  renderBrollStack();
  updateSummary();
}

function removeBroll(id) {
  const idx = brollStack.findIndex(i => i.id === id);
  if (idx === -1) return;
  brollStack.splice(idx, 1);
  pushHistory();
  renderBrollStack();
  updateSummary();
  toast('B-Roll removed', 'info');
}

// ── LIVE PREVIEW UPDATES ──────────────────────────────────────
player.addEventListener('play', () => {
  previewStage.classList.add('playing');
  sfxStack.forEach(s => { s.triggered = false; });
  bgmStack.forEach(item => {
    const offset = player.currentTime - item.startAt;
    if (offset < 0) { item.audio.pause(); return; }
    const dur = item.audio.duration || 1;
    item.audio.currentTime = (item.offset + offset) % dur;
    item.audio.play().catch(() => {});
  });
  if (assets.audioSwap && swapAudio.src) {
    player.muted = true;
    const dur = swapAudio.duration || 0;
    swapAudio.currentTime = dur > 0 ? player.currentTime % dur : 0;
    swapAudio.play().catch(() => {});
  }
});

player.addEventListener('pause', () => {
  previewStage.classList.remove('playing');
  bgmStack.forEach(i => i.audio.pause());
  swapAudio.pause();
});

player.addEventListener('seeked', () => {
  sfxStack.forEach(s => { s.triggered = false; });
  if (el('scrub-toggle')?.checked) playScrubSnippet(player.currentTime);
});

player.ontimeupdate = () => {
  const t = player.currentTime;
  if (el('tc-current')) el('tc-current').textContent = fmtTime(t);

  if (times.duration > 0) {
    const frac    = t / times.duration;
    const fracVis = Math.max(0, Math.min(1, (frac - zoomStart) * zoomLevel));
    if (el('trim-playhead')) el('trim-playhead').style.left = (fracVis * 100) + '%';
  }

  // Illustrations preview
  illuStack.forEach(item => {
    const show = t >= item.at && t < (item.at + item.duration);
    if (item.el) item.el.classList.toggle('hidden', !show);
  });

  // Text Overlays preview
  textStack.forEach(item => {
    const show = t >= item.at && t < (item.at + item.duration);
    if (item.el) item.el.classList.toggle('hidden', !show);
  });

  // SFX trigger
  sfxStack.forEach(item => {
    if (!item.triggered && t >= item.at && t < item.at + 0.5) {
      item.audio.currentTime = 0;
      item.audio.play().catch(() => {});
      item.triggered = true;
    }
  });

  // B-Roll preview
  const activeBroll = brollStack.find(b => t >= b.at && t < b.at + b.duration);
  if (activeBroll) {
    overlayBroll.classList.remove('hidden');
    if (brollPlayer.src !== activeBroll.video.src) {
      brollPlayer.src = activeBroll.video.src;
      brollPlayer.currentTime = t - activeBroll.at;
      if (!player.paused) brollPlayer.play().catch(() => {});
    }
  } else {
    overlayBroll.classList.add('hidden');
    brollPlayer.pause();
  }

  // Skip cut gaps during playback
  const inCut = !segments.some(seg => t >= seg.s - 0.05 && t < seg.e + 0.05);
  if (inCut && !player.paused && segments.length > 0) {
    const nextSeg = segments.find(seg => seg.s > t);
    if (nextSeg) { player.currentTime = nextSeg.s; }
    else { player.pause(); }
  }
};

// Audio-only player update mirroring
audioPlayer.ontimeupdate = () => {
  if (mediaKind !== 'audio') return;
  const t = audioPlayer.currentTime;
  if (el('tc-current')) el('tc-current').textContent = fmtTime(t);

  if (times.duration > 0) {
    const frac    = t / times.duration;
    const fracVis = Math.max(0, Math.min(1, (frac - zoomStart) * zoomLevel));
    if (el('trim-playhead')) el('trim-playhead').style.left = (fracVis * 100) + '%';
  }

  sfxStack.forEach(item => {
    if (!item.triggered && t >= item.at && t < item.at + 0.5) {
      item.audio.currentTime = 0;
      item.audio.play().catch(() => {});
      item.triggered = true;
    }
  });
};

function playScrubSnippet(atTime) {
  if (!mainAudioBuffer || !el('scrub-toggle')?.checked) return;
  if (scrubAudioCtx) { try { scrubAudioCtx.close(); } catch(_) {} }

  const indicator = el('scrub-indicator');
  if (indicator) indicator.classList.remove('hidden');

  scrubAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const src  = scrubAudioCtx.createBufferSource();
  src.buffer = mainAudioBuffer;

  const gain = scrubAudioCtx.createGain();
  gain.gain.setValueAtTime(0, scrubAudioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(0.8, scrubAudioCtx.currentTime + 0.01);
  gain.gain.setValueAtTime(0.8, scrubAudioCtx.currentTime + 0.07);
  gain.gain.linearRampToValueAtTime(0, scrubAudioCtx.currentTime + 0.08);

  src.connect(gain);
  gain.connect(scrubAudioCtx.destination);
  src.start(0, Math.max(0, atTime), 0.08);

  setTimeout(() => {
    if (indicator) indicator.classList.add('hidden');
    try { scrubAudioCtx.close(); } catch(_) {}
    scrubAudioCtx = null;
  }, 150);
}

// ── ASPECT & PRESETS ──────────────────────────────────────────
function setAspect(val) {
  aspect = val;
  document.querySelectorAll('#seg-landscape, #seg-portrait, #seg-blur-bg').forEach(b => {
    const on = b.dataset.val === val;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const notes = {
    landscape: '1280×720 — Widescreen 16:9',
    portrait:  '720×1280 — Vertical 9:16 for Mobile/Reels',
    'blur-bg': '1280×720 — Vertical video on blurred background'
  };
  if (el('aspect-note')) el('aspect-note').textContent = notes[val] || '';
  updateSummary();
  announce(`Aspect ratio set to ${val}.`);
}

function setPreset(val) {
  preset = val;
  document.querySelectorAll('#seg-fast, #seg-balanced, #seg-hq').forEach(b => {
    const on = b.dataset.preset === val;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  updateSummary();
}

// ── TIMELINE ZOOM ─────────────────────────────────────────────
function cycleZoom() {
  if (!times.duration) return;
  zoomLevel = (zoomLevel === 1) ? 4 : 1;
  zoomStart = 0;
  if (zoomLevel === 4) {
    const playFrac = activeMedia().currentTime / times.duration;
    zoomStart = Math.max(0, Math.min(0.75, playFrac - 0.125));
  }
  updateTrimBar(); updateZoomBar(); renderSfxMarkers();
  const btn = el('btn-zoom');
  if (btn) btn.textContent = zoomLevel === 1 ? '🔍 Zoom' : '🔍 4x';
  announce(zoomLevel === 1 ? 'Full timeline view.' : 'Zoomed 4x on playhead.');
}

function updateZoomBar() {
  const bar = el('zoom-bar');
  const win = el('zoom-window');
  if (!bar || !win) return;
  if (zoomLevel === 1) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  win.style.left  = (zoomStart * 100) + '%';
  win.style.width = ((1 / zoomLevel) * 100) + '%';
}

function zoomToFrac(zf) {
  return zoomStart + zf * (1 / zoomLevel);
}

// ── TRIM BAR & CUTS ───────────────────────────────────────────
function updateTrimBar() {
  const dur = times.duration;
  if (!dur) return;
  const sp    = times.s / dur;
  const ep    = times.e / dur;
  const spVis = Math.max(0, Math.min(1, (sp - zoomStart) * zoomLevel));
  const epVis = Math.max(0, Math.min(1, (ep - zoomStart) * zoomLevel));
  const rangeL = (Math.max(0, sp - zoomStart) * zoomLevel) * 100;
  const rangeW = (Math.max(0, Math.min(ep, zoomStart + 1/zoomLevel) - Math.max(sp, zoomStart)) * zoomLevel) * 100;

  if (el('trim-range')) {
    el('trim-range').style.left  = rangeL + '%';
    el('trim-range').style.width = Math.max(0, rangeW) + '%';
  }
  if (el('trim-head-s')) el('trim-head-s').style.left = (spVis * 100) + '%';
  if (el('trim-head-e')) el('trim-head-e').style.left = (epVis * 100) + '%';

  const len = times.e - times.s;
  if (el('trim-duration-label')) {
    el('trim-duration-label').textContent = `${fmtTime(times.s)} → ${fmtTime(times.e)} (${fmtTime(len)})`;
  }
}

function updateSegmentDisplay() {
  const dur   = times.duration;
  const track = el('segment-track');
  if (!track) return;
  track.innerHTML = '';
  if (!dur || segments.length === 0) return;

  segments.forEach(seg => {
    const bar = document.createElement('div');
    bar.className = 'segment-bar';
    bar.style.left  = ((seg.s / dur) * 100) + '%';
    bar.style.width = (((seg.e - seg.s) / dur) * 100) + '%';
    track.appendChild(bar);
  });

  const cutEl = el('cut-summary');
  const cutCount = segments.length - 1;
  if (cutEl) {
    if (cutCount > 0) {
      const totalKept = segments.reduce((a, s) => a + (s.e - s.s), 0);
      cutEl.textContent = `${cutCount} cut${cutCount > 1 ? 's' : ''} applied · ${fmtTime(totalKept)} kept`;
      cutEl.classList.remove('hidden');
    } else {
      cutEl.classList.add('hidden');
    }
  }
  updateSummary();
}

function startDrag(e, type) {
  dragType = type;
  e.preventDefault();
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup', stopDrag);
  window.addEventListener('touchmove', onDrag, { passive: false });
  window.addEventListener('touchend', stopDrag);
}

el('trim-head-s')?.addEventListener('mousedown',  e => startDrag(e, 's'));
el('trim-head-e')?.addEventListener('mousedown',  e => startDrag(e, 'e'));
el('trim-head-s')?.addEventListener('touchstart', e => startDrag(e, 's'), { passive: false });
el('trim-head-e')?.addEventListener('touchstart', e => startDrag(e, 'e'), { passive: false });

function onDrag(e) {
  if (!dragType) return;
  e.preventDefault();
  const rect    = el('trim-track').getBoundingClientRect();
  const cx      = e.touches ? e.touches[0].clientX : e.clientX;
  const rawFrac = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
  const t       = zoomToFrac(rawFrac) * times.duration;
  if (dragType === 's') {
    times.s = Math.min(Math.max(0, t), times.e - 0.5);
    activeMedia().currentTime = times.s;
    if (el('tc-start')) el('tc-start').textContent = fmtTime(times.s);
  } else {
    times.e = Math.max(Math.min(times.duration, t), times.s + 0.5);
    activeMedia().currentTime = times.e;
    if (el('tc-end')) el('tc-end').textContent = fmtTime(times.e);
  }
  updateTrimBar(); updateSummary();
}

function stopDrag() {
  dragType = null;
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('mouseup', stopDrag);
  window.removeEventListener('touchmove', onDrag);
  window.removeEventListener('touchend', stopDrag);
}

el('trim-track')?.addEventListener('click', e => {
  if (!times.duration || e.target.classList.contains('trim-head')) return;
  const rect    = e.currentTarget.getBoundingClientRect();
  const rawFrac = (e.clientX - rect.left) / rect.width;
  const seekTo  = zoomToFrac(Math.max(0, Math.min(1, rawFrac))) * times.duration;
  activeMedia().currentTime = seekTo;
  playScrubSnippet(seekTo);
});

// Trim Buttons & Reset
el('btn-set-start')?.addEventListener('click', () => {
  const t = activeMedia().currentTime;
  if (t >= times.e) { toast('In point must be before Out point', 'error'); return; }
  pushHistory();
  times.s = t;
  if (el('tc-start')) el('tc-start').textContent = fmtTime(t);
  updateTrimBar(); updateSummary();
  setStatus(`In point set: ${fmtTime(t)}`);
});

el('btn-set-end')?.addEventListener('click', () => {
  const t = activeMedia().currentTime;
  if (t <= times.s) { toast('Out point must be after In point', 'error'); return; }
  pushHistory();
  times.e = t;
  if (el('tc-end')) el('tc-end').textContent = fmtTime(t);
  updateTrimBar(); updateSummary();
  setStatus(`Out point set: ${fmtTime(t)}`);
});

function resetAllTrims() {
  pushHistory();
  times.s = 0; times.e = times.duration;
  segments = [{ s: 0, e: times.duration }];
  if (el('tc-start')) el('tc-start').textContent = fmtTime(0);
  if (el('tc-end')) el('tc-end').textContent = fmtTime(times.duration);
  updateTrimBar(); updateSegmentDisplay(); updateSummary();
  setStatus('All trims and cuts reset.');
  toast('Reset all trims & cuts ✓', 'info');
}

function cutSegment() {
  if (!mainVideoFile) return;
  const cutS = times.s, cutE = times.e;
  if (cutE - cutS < 0.1) { toast('Set In and Out points first', 'error'); return; }
  pushHistory();
  const newSegs = [];
  for (const seg of segments) {
    if (cutS > seg.s) newSegs.push({ s: seg.s, e: Math.min(cutS, seg.e) });
    if (cutE < seg.e) newSegs.push({ s: Math.max(cutE, seg.s), e: seg.e });
  }
  segments = newSegs.filter(s => s.e - s.s > 0.05);
  if (segments.length === 0) { doUndo(); toast('Cannot cut entire timeline', 'error'); return; }

  times.s = 0; times.e = times.duration;
  updateTrimBar();
  activeMedia().currentTime = Math.min(cutE + 0.05, times.duration - 0.1);
  updateSegmentDisplay(); updateSummary();
  toast('Range cut applied ✂', 'info');
}

// ── UNIVERSAL KEYBOARD SHORTCUTS CONTROLLER ──────────────────
window.addEventListener('keydown', e => {
  const activeEl = document.activeElement;
  const isEditingText = activeEl && (
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName) ||
    activeEl.isContentEditable
  );

  const k    = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;

  // Global Shortcuts that work even when focus is in text fields (like Esc, Ctrl+S, Ctrl+Z)
  if (k === 'escape') {
    closeSettingsModal();
    closeShortcutsModal();
    return;
  }

  if (isEditingText) return; // Skip normal play/trim shortcuts while typing

  // Modal Cheat Sheet toggle
  if (k === '?' || (e.shiftKey && k === '/')) {
    e.preventDefault();
    openShortcutsModal();
    return;
  }

  // Undo / Redo
  if (ctrl && !e.shiftKey && k === 'z') { e.preventDefault(); doUndo(); return; }
  if ((ctrl && k === 'y') || (ctrl && e.shiftKey && k === 'z')) { e.preventDefault(); doRedo(); return; }

  // Project Actions
  if (ctrl && !e.shiftKey && k === 's') { e.preventDefault(); saveProjectSnapshot(true); return; }
  if (ctrl && e.shiftKey && k === 'o') { e.preventDefault(); restoreSavedProject(); return; }
  if (ctrl && k === 'd') { e.preventDefault(); detectSilence(); return; }
  if (ctrl && k === 'x') { e.preventDefault(); runExport(); return; }
  if (ctrl && k === ',') { e.preventDefault(); openSettingsModal(); return; }

  // Layer Uploads Shortcuts
  if (ctrl && k === 'l') { e.preventDefault(); triggerLayer('logo'); return; }
  if (ctrl && k === 't') { e.preventDefault(); triggerAddTextOverlay(); return; }
  if (ctrl && k === 'i') { e.preventDefault(); triggerAddIllu(); return; }
  if (ctrl && k === 'b') { e.preventDefault(); triggerAddBGM(); return; }
  if (ctrl && k === 'f') { e.preventDefault(); triggerAddSFX(); return; }
  if (ctrl && k === 'r') { e.preventDefault(); triggerAddBRoll(); return; }
  if (ctrl && k === 'u') { e.preventDefault(); triggerLayer('audioSwap'); return; }

  // Focused BGM Control (Shift + M = Play/Pause)
  if (focusedBgmId && bgmStack.length > 0) {
    if (e.shiftKey && k === 'm') {
      e.preventDefault();
      toggleBgmPlayback(focusedBgmId);
      return;
    }
    if (k === '[' && !ctrl) {
      e.preventDefault();
      const b = bgmStack.find(item => item.id === focusedBgmId);
      if (b) { b.startAt = Math.max(0, b.startAt + (e.shiftKey ? -5 : -1)); renderBgmStack(); updateSummary(); }
      return;
    }
    if (k === ']' && !ctrl) {
      e.preventDefault();
      const b = bgmStack.find(item => item.id === focusedBgmId);
      if (b) { b.startAt = Math.max(0, b.startAt + (e.shiftKey ? 5 : 1)); renderBgmStack(); updateSummary(); }
      return;
    }
  }

  // SFX Nudging
  if (ctrl && e.shiftKey && (k === 'arrowleft' || k === 'arrowright')) {
    e.preventDefault();
    nudgeSelectedSfx(k === 'arrowleft' ? -0.1 : 0.1);
    return;
  }

  // Playback & Trimming
  if (k === 's' || k === 'i') { e.preventDefault(); el('btn-set-start')?.click(); }
  if (k === 'e' || k === 'o') { e.preventDefault(); el('btn-set-end')?.click(); }
  if (k === 'c' || k === 'b') { e.preventDefault(); splitClipAtPlayhead(); }
  if (k === 'backspace' || k === 'delete') { e.preventDefault(); cutSegment(); }
  if (k === ' ') { e.preventDefault(); if (!mainVideoFile) return; const m = activeMedia(); m.paused ? m.play() : m.pause(); }
  if (k === 'f' && !ctrl) { e.preventDefault(); toggleFullscreen(); }
  if (k === 'z' && !ctrl) { e.preventDefault(); cycleZoom(); }
  if (ctrl && e.shiftKey && k === 'r') { e.preventDefault(); resetAllTrims(); }

  // Playback Speed Shortcuts (< and >)
  if (e.shiftKey && (k === '<' || k === ',')) {
    e.preventDefault();
    const speeds = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    const currIdx = speeds.indexOf(playbackSpeed);
    if (currIdx > 0) setPlaybackSpeed(speeds[currIdx - 1]);
  }
  if (e.shiftKey && (k === '>' || k === '.')) {
    e.preventDefault();
    const speeds = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    const currIdx = speeds.indexOf(playbackSpeed);
    if (currIdx !== -1 && currIdx < speeds.length - 1) setPlaybackSpeed(speeds[currIdx + 1]);
  }

  // Home / End Navigation
  if (k === 'home') { e.preventDefault(); activeMedia().currentTime = 0; }
  if (k === 'end')  { e.preventDefault(); activeMedia().currentTime = times.duration; }

  // Quick Accessibility Shortcuts (Alt+M, Alt+C, Alt+T)
  if (e.altKey && k === 'm') { e.preventDefault(); el('quick-reduce-motion')?.click(); }
  if (e.altKey && k === 'c') { e.preventDefault(); el('quick-high-contrast')?.click(); }
  if (e.altKey && k === 't') { e.preventDefault(); el('quick-theme')?.click(); }

  // Arrow Seeking & Frame Stepping
  if (k === 'arrowleft' || k === 'arrowright') {
    if (!mainVideoFile || ctrl) return;
    e.preventDefault();
    const dir  = k === 'arrowleft' ? -1 : 1;
    let step = 10;
    if (e.altKey) step = 0.04; // 1 frame
    else if (e.shiftKey) step = 1;

    const m = activeMedia();
    m.currentTime = Math.max(0, Math.min(times.duration, m.currentTime + dir * step));
    playScrubSnippet(m.currentTime);
  }
});

// ── HELPERS & SUMMARY ─────────────────────────────────────────
function updateTimecodes() {
  if (el('tc-start')) el('tc-start').textContent = fmtTime(times.s);
  if (el('tc-end')) el('tc-end').textContent = fmtTime(times.e);
  if (el('tc-current')) el('tc-current').textContent = fmtTime(activeMedia().currentTime);
}

function updateSummary() {
  const layerParts = [];
  if (assets.logo)           layerParts.push('logo');
  if (textStack.length > 0)  layerParts.push(`${textStack.length} text`);
  if (illuStack.length > 0)  layerParts.push(`${illuStack.length} illus`);
  if (bgmStack.length > 0)   layerParts.push(`${bgmStack.length} BGM`);
  if (sfxStack.length > 0)   layerParts.push(`${sfxStack.length} SFX`);
  if (brollStack.length > 0) layerParts.push(`${brollStack.length} B-Roll`);
  if (assets.audioSwap)      layerParts.push('audioSwap');

  const aspectLabels = { landscape:'16:9 Landscape', portrait:'9:16 Portrait', 'blur-bg':'Blur BG' };
  if (el('summary-mode')) el('summary-mode').textContent   = `Format: ${exportFormat.toUpperCase()}`;
  if (el('summary-aspect')) el('summary-aspect').textContent = `Resolution: ${aspectLabels[aspect] || aspect}`;
  if (el('summary-filter')) el('summary-filter').textContent = `Filter: ${activeFilter.toUpperCase()}`;
  if (el('summary-speed')) el('summary-speed').textContent  = `Speed: ${playbackSpeed}x`;
  if (el('summary-layers')) el('summary-layers').textContent = 'Layers: ' + (layerParts.join(', ') || 'none');
  if (times.duration > 0 && el('summary-trim')) {
    el('summary-trim').textContent = `Trim: ${fmtTime(times.s)} → ${fmtTime(times.e)}`;
  }
  const cutCount = segments.length - 1;
  if (el('summary-cuts')) el('summary-cuts').textContent = cutCount > 0 ? `Cuts: ${cutCount}` : 'Cuts: none';
  scheduleProjectAutosave();
}

function setProgress(pct, phase) {
  if (el('prog-fill')) el('prog-fill').style.width = pct + '%';
  if (el('progress-pct')) el('progress-pct').textContent = pct + '%';
  if (el('progress-bar-role')) el('progress-bar-role').setAttribute('aria-valuenow', pct);
  if (phase && el('progress-phase')) el('progress-phase').textContent = phase;
}

// ── AI ASSISTANT CHAT ─────────────────────────────────────────
async function analyzeProjectWithGemini() {
  if (aiJobRunning) return;
  if (!mainVideoFile) { toast('Load a video or audio file first', 'error'); return; }
  syncSettingsFromForm();
  if (!(editorSettings.geminiApiKey || '').trim()) { toast('Add a Gemini API key first', 'error'); openSettingsModal(); return; }

  setChatBusy(true);
  const thinking = appendChatMessage('bot', 'Analyzing media and transcribing audio…');
  setStatus('Preparing AI analysis…');

  try {
    const prompt = `Transcribe the audio into "transcript", describe the media briefly, and suggest 2 edits. Format as JSON: {"reply":"...", "transcript":"...", "actions":[]}`;
    const payload = await callGeminiAPI(prompt);
    const text = extractGeminiText(payload);
    if (thinking) thinking.remove();
    let result;
    try { result = parseGeminiJson(text); } catch(_) { result = { reply: text, transcript: '', actions: [] }; }
    
    if (result.reply) appendChatMessage('bot', result.reply);
    if (result.transcript && el('ai-transcript')) {
      el('ai-transcript').value = result.transcript;
      editorSettings.aiTranscript = result.transcript;
      persistEditorSettings();
    }
    setStatus('AI analysis complete.');
  } catch (err) {
    if (thinking) thinking.remove();
    appendChatMessage('bot', `Analysis failed: ${err.message}`);
    toast('AI analysis failed', 'error');
  } finally {
    setChatBusy(false);
  }
}

async function sendChatMessage() {
  if (aiJobRunning) return;
  const input = el('ai-chat-input');
  const text = (input?.value || '').trim();
  if (!text) return;
  if (!mainVideoFile) { toast('Load a file first', 'error'); return; }

  input.value = '';
  appendChatMessage('user', text);
  setChatBusy(true);
  const thinking = appendChatMessage('bot', '…');

  try {
    const prompt = `User instruction for video editing: "${text}". Reply with JSON: {"reply":"...", "actions":[]}`;
    const payload = await callGeminiAPI(prompt);
    const raw = extractGeminiText(payload);
    if (thinking) thinking.remove();
    let parsed;
    try { parsed = parseGeminiJson(raw); } catch(_) { parsed = { reply: raw, actions: [] }; }
    appendChatMessage('bot', parsed.reply || 'Done.');
  } catch (err) {
    if (thinking) thinking.remove();
    appendChatMessage('bot', `Request failed: ${err.message}`);
  } finally {
    setChatBusy(false);
  }
}

function appendChatMessage(role, text) {
  const log = el('ai-chat-log');
  if (!log) return null;
  const wrap = document.createElement('div');
  wrap.className = `ai-msg ai-msg-${role === 'user' ? 'user' : 'bot'}`;
  const p = document.createElement('p');
  p.textContent = text;
  wrap.appendChild(p);
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
  return wrap;
}

function setChatBusy(busy) {
  aiJobRunning = busy;
  if (el('ai-chat-input')) el('ai-chat-input').disabled = busy || !mainVideoFile;
  if (el('ai-send-btn')) el('ai-send-btn').disabled = busy || !mainVideoFile;
  if (el('analyze-project-btn')) el('analyze-project-btn').disabled = busy;
}

function clearAiChat() {
  const log = el('ai-chat-log');
  if (log) log.innerHTML = '<div class="ai-msg ai-msg-bot"><p>Chat cleared.</p></div>';
}

function openSettingsModal() {
  const overlay = el('settings-overlay');
  if (overlay) overlay.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeSettingsModal() {
  const overlay = el('settings-overlay');
  if (overlay) overlay.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

// ── MASTER EXPORT ENGINE ──────────────────────────────────────
async function runExport() {
  if (!mainVideoFile) { toast('No media loaded', 'error'); return; }
  if (!engineReady)   { toast('Engine not ready', 'error'); return; }

  if (exportFormat === 'mp3' || mediaKind === 'audio') { return runAudioExport(); }

  setStatus('Preparing export…');
  if (el('progress-wrap')) el('progress-wrap').classList.remove('hidden');
  if (el('download-result')) el('download-result').classList.add('hidden');
  if (el('export-btn')) el('export-btn').disabled = true;
  setProgress(0, 'Writing media files…');

  try {
    const ext = (mainVideoFile.name.split('.').pop() || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
    ffmpeg.FS('writeFile', `input.${ext}`, await fetchFile(mainVideoFile));
    setProgress(10, 'Building video filter graph…');

    if (assets.logo)      ffmpeg.FS('writeFile', 'logo.png', await fetchFile(assets.logo));
    if (assets.audioSwap) ffmpeg.FS('writeFile', 'swap.mp3', await fetchFile(assets.audioSwap));
    for (let i = 0; i < bgmStack.length; i++)   ffmpeg.FS('writeFile', `bgm${i}.mp3`, await fetchFile(bgmStack[i].file));
    for (let i = 0; i < sfxStack.length; i++)   ffmpeg.FS('writeFile', `sfx${i}.mp3`, await fetchFile(sfxStack[i].file));
    for (let i = 0; i < illuStack.length; i++)  ffmpeg.FS('writeFile', `illu${i}.png`, await fetchFile(illuStack[i].file));
    for (let i = 0; i < brollStack.length; i++) ffmpeg.FS('writeFile', `broll${i}.mp4`, await fetchFile(brollStack[i].file));

    // Build filter chain for FFmpeg
    let vFilter = 'scale=1280:720';
    if (aspect === 'portrait') vFilter = 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280';
    
    // Add active filter effect
    if (activeFilter === 'cyberpunk') vFilter += ',hue=h=180:s=2,eq=contrast=1.3';
    else if (activeFilter === 'vintage') vFilter += ',colorbalance=rs=0.1:gs=-0.05:bs=-0.1';
    else if (activeFilter === 'noir') vFilter += ',hue=s=0,eq=contrast=1.3';
    else if (activeFilter === 'scifi') vFilter += ',colorbalance=rs=-0.1:gs=0.05:bs=0.2';
    else if (activeFilter === 'vivid') vFilter += ',eq=contrast=1.2:saturation=1.5';
    else if (activeFilter === 'sepia') vFilter += ',colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131';

    // Playback Speed Adjustment
    if (playbackSpeed !== 1.0) {
      const ptsScale = (1 / playbackSpeed).toFixed(3);
      vFilter += `,setpts=${ptsScale}*PTS`;
    }

    const seg0 = segments[0] || { s: 0, e: times.duration };
    const trimDur = Math.max(0.1, (segments[segments.length - 1]?.e || times.duration) - seg0.s);

    const outFilename = exportFormat === 'gif' ? 'output.gif' : exportFormat === 'webm' ? 'output.webm' : 'output.mp4';

    ffmpeg.setProgress(({ ratio }) => {
      const pct = Math.min(98, Math.round(15 + ratio * 82));
      setProgress(pct, `Encoding ${exportFormat.toUpperCase()}… ${pct}%`);
    });

    const args = [
      '-ss', seg0.s.toFixed(3),
      '-t', (trimDur / playbackSpeed).toFixed(3),
      '-i', `input.${ext}`
    ];

    if (exportFormat === 'gif') {
      args.push('-vf', `${vFilter},fps=12,scale=480:-1:flags=lanczos`, outFilename);
    } else {
      args.push('-vf', vFilter, '-c:v', exportFormat === 'webm' ? 'libvpx' : 'libx264', '-preset', preset, '-movflags', '+faststart', outFilename);
    }

    await ffmpeg.run(...args);

    setProgress(100, 'Done!');
    const data = ffmpeg.FS('readFile', outFilename);
    const mimeMap = { mp4: 'video/mp4', webm: 'video/webm', gif: 'image/gif', mp3: 'audio/mpeg' };
    const blob = new Blob([data.buffer], { type: mimeMap[exportFormat] || 'video/mp4' });
    const url  = URL.createObjectURL(blob);
    
    const rawName = (el('project-name')?.value || 'tech-house').trim();
    const safeName = rawName.replace(/[^a-zA-Z0-9_\-. ]/g, '').replace(/\s+/g, '-') || 'tech-house';
    const dlLink = el('download-link');
    if (dlLink) {
      dlLink.href = url;
      dlLink.download = `${safeName}.${exportFormat}`;
      dlLink.focus();
    }
    if (el('download-result')) el('download-result').classList.remove('hidden');
    try { dlLink?.click(); } catch (_) {}

    // Cleanup FFmpeg virtual FS
    ['input.'+ext, outFilename, 'logo.png', 'swap.mp3'].forEach(f => { try { ffmpeg.FS('unlink', f); } catch (_) {} });

    setStatus(`Export complete — ${safeName}.${exportFormat}`);
    toast('Export complete ✓', 'success');

  } catch (err) {
    console.error('[EXPORT ERROR]', err);
    setStatus('Export error: ' + err.message, true);
    toast('Export failed', 'error');
  } finally {
    if (el('export-btn')) el('export-btn').disabled = false;
    setTimeout(() => el('progress-wrap')?.classList.add('hidden'), 1200);
  }
}

async function runAudioExport() {
  setStatus('Preparing audio export…');
  if (el('progress-wrap')) el('progress-wrap').classList.remove('hidden');
  if (el('download-result')) el('download-result').classList.add('hidden');
  if (el('export-btn')) el('export-btn').disabled = true;
  setProgress(0, 'Encoding audio…');

  try {
    const ext = (mainVideoFile.name.split('.').pop() || 'mp3').replace(/[^a-z0-9]/gi, '') || 'mp3';
    ffmpeg.FS('writeFile', `main.${ext}`, await fetchFile(mainVideoFile));
    
    const seg0 = segments[0] || { s: 0, e: times.duration };
    const trimDur = Math.max(0.1, (segments[segments.length - 1]?.e || times.duration) - seg0.s);

    await ffmpeg.run(
      '-ss', seg0.s.toFixed(3),
      '-t', trimDur.toFixed(3),
      '-i', `main.${ext}`,
      '-c:a', 'libmp3lame', '-q:a', '2',
      'output.mp3'
    );

    setProgress(100, 'Done!');
    const data = ffmpeg.FS('readFile', 'output.mp3');
    const blob = new Blob([data.buffer], { type: 'audio/mpeg' });
    const url  = URL.createObjectURL(blob);
    const rawName = (el('project-name')?.value || 'tech-house').trim();
    const safeName = rawName.replace(/[^a-zA-Z0-9_\-. ]/g, '').replace(/\s+/g, '-') || 'tech-house';
    const dlLink = el('download-link');
    if (dlLink) {
      dlLink.href = url;
      dlLink.download = `${safeName}.mp3`;
      dlLink.focus();
    }
    if (el('download-result')) el('download-result').classList.remove('hidden');
    try { dlLink?.click(); } catch (_) {}

    ['main.'+ext, 'output.mp3'].forEach(f => { try { ffmpeg.FS('unlink', f); } catch (_) {} });

    setStatus(`Audio export complete — ${safeName}.mp3`);
    toast('Audio export complete ✓', 'success');
  } catch (err) {
    setStatus('Audio export failed: ' + err.message, true);
    toast('Audio export failed', 'error');
  } finally {
    if (el('export-btn')) el('export-btn').disabled = false;
    setTimeout(() => el('progress-wrap')?.classList.add('hidden'), 1200);
  }
}
