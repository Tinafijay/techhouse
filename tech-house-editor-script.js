// ============================================================
// TECH HOUSE VIDEO EDITOR — script.js  v5
// Major update: Firebase Auth sidebar, Multi-asset stacks,
//   B-Roll, Silence detection, Audio scrubbing, Crossfade,
//   Blur-BG mode, Extended undo, 0.1s nudging
// ============================================================

// ============================================================
// TECH HOUSE VIDEO EDITOR — script.js  v6
// Bug fixes: trunc() crash, module scope, auth widget,
//   BGM keyboard conflict, noise slider, concat fix
// ============================================================

// ── COI ServiceWorker ────────────────────────────────────────
(function () {
  var s = document.createElement('script');
  s.src = './coi-serviceworker.js';
  s.onerror = () => console.warn('[COI] coi-serviceworker.js not found.');
  document.head.appendChild(s);
}());

// ── Firebase (loaded via compat CDN scripts in HTML, or inline) ──
// We use the compat global approach so the script works without type=module.
// Firebase compat globals are loaded via a dynamic script injection here.
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

    // Bind helpers
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
const audioOnlyStage = document.getElementById('audio-only-stage');
const audioPlayer    = document.getElementById('audio-player');

// ── Preview Audio (BGM swap use arrays now) ──────────────────
const swapAudio = new Audio();
swapAudio.loop  = true;

// ── App State ─────────────────────────────────────────────────
let mainVideoFile = null;
let mainAudioBuffer = null; // decoded audio for silence detection
let mediaKind = 'video'; // 'video' | 'audio' — hybrid editor mode

// Returns the media element currently driving the timeline (video or audio).
function activeMedia() {
  return mediaKind === 'audio' ? audioPlayer : player;
}

// Single-item assets (logo, audioSwap)
let assets = { logo: null, audioSwap: null };
let audioProcessing = 'none';
let logoPosition    = 'top-right';

// MULTI-STACK arrays
// Each SFX: { id, file, audio, at, volume, triggered }
let sfxStack = [];
// Each BGM: { id, file, audio, startAt, offset, volume }
let bgmStack = [];
// Each Illu: { id, file, at, duration, layout, el }
let illuStack = [];
// Each B-Roll: { id, file, video, at, duration, muteAudio }
let brollStack = [];

let selectedSfxId = null; // for keyboard nudging

// Timeline / trim
let times  = { s: 0, e: 0, duration: 0 };
let segments    = [];
let editHistory = []; // unified undo stack — stores full snapshots

// Appearance
let aspect  = 'landscape';
let preset  = 'ultrafast';

// Zoom
let zoomLevel = 1;
let zoomStart = 0;

// Misc
let engineReady      = false;
let dragType         = null;
let isScrubbing      = false;
let scrubAudioCtx    = null;
let stackIdCounter   = 0;
let latestAiSuggestions = null;
let aiJobRunning = false;

const PROJECT_SCHEMA_VERSION = 2;
const STORAGE_KEYS = {
  editorSettings: 'th_editor_settings_v2',
  projectSnapshot: 'th_editor_project_v2'
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
    aiUserBrief: '',
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

// ── Announce helpers ──────────────────────────────────────────
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

let autosaveTimer = null;

function setInlineStatus(id, msg, type = '') {
  const node = el(id);
  if (!node) return;
  node.className = 'inline-status';
  if (type) node.classList.add(type);
  node.textContent = msg;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function applyAccessibilityPreferences() {
  document.body.classList.toggle('reduce-motion', !!editorSettings.reduceMotion);
  document.body.classList.toggle('high-contrast', !!editorSettings.highContrast);
}

function loadEditorSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.editorSettings);
    if (!raw) return;
    editorSettings = { ...createDefaultEditorSettings(), ...JSON.parse(raw) };
  } catch (err) {
    console.warn('[Settings] Could not read settings:', err.message);
  }
}

function persistEditorSettings(statusMessage) {
  try {
    localStorage.setItem(STORAGE_KEYS.editorSettings, JSON.stringify(editorSettings));
    if (statusMessage) setInlineStatus('project-save-status', statusMessage, 'success');
  } catch (err) {
    console.warn('[Settings] Could not persist settings:', err.message);
    setInlineStatus('project-save-status', 'Could not save settings in this browser.', 'error');
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
    aiUserBrief: el('ai-user-brief')?.value || '',
    aiTranscript: el('ai-transcript')?.value || ''
  };
}

function updateSettingsForm() {
  if (el('gemini-api-key')) el('gemini-api-key').value = editorSettings.geminiApiKey || '';
  if (el('gemini-model')) el('gemini-model').value = editorSettings.geminiModel || 'gemini-3-flash-preview';
  if (el('autosave-project')) el('autosave-project').checked = !!editorSettings.autosaveProject;
  if (el('reduce-motion-toggle')) el('reduce-motion-toggle').checked = !!editorSettings.reduceMotion;
  if (el('high-contrast-toggle')) el('high-contrast-toggle').checked = !!editorSettings.highContrast;
  if (el('ai-user-brief')) el('ai-user-brief').value = editorSettings.aiUserBrief || '';
  if (el('ai-transcript')) el('ai-transcript').value = editorSettings.aiTranscript || '';
  applyAccessibilityPreferences();
  updateGeminiStatusText();
}

function updateGeminiStatusText(msg, type = 'info') {
  const key = (editorSettings.geminiApiKey || '').trim();
  if (msg) {
    setInlineStatus('gemini-auth-status', msg, type);
    return;
  }
  if (!key) {
    setInlineStatus('gemini-auth-status', 'Gemini key not configured yet.', 'info');
    return;
  }
  const masked = key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : 'saved';
  setInlineStatus('gemini-auth-status', `Gemini key saved locally (${masked}).`, 'success');
}

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
    if (el('desc-audioSwap')) el('desc-audioSwap').textContent = 'Replaces original audio';
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
  sfxStack = [];
  bgmStack = [];
  illuStack = [];
  brollStack = [];
  selectedSfxId = null;
  focusedBgmId = null;
  latestAiSuggestions = null;
  el('apply-ai-btn')?.setAttribute('disabled', 'disabled');
  if (el('apply-ai-btn')) el('apply-ai-btn').disabled = true;
  if (el('ai-analysis-result')) el('ai-analysis-result').textContent = 'Load a video or audio file, then run AI analysis to get editing suggestions.';
  illuContainer.innerHTML = '';
  overlayBroll.classList.add('hidden');
  brollPlayer.pause();
  brollPlayer.removeAttribute('src');
  if (audioPlayer) { audioPlayer.pause(); audioPlayer.removeAttribute('src'); }
  syncSingleAssetUI();
  renderIlluStack();
  renderBgmStack();
  renderSfxStack();
  renderBrollStack();
  renderSfxMarkers();
}

function buildProjectSnapshot() {
  return {
    version: PROJECT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    projectName: (el('project-name')?.value || 'my-project').trim(),
    settings: {
      autosaveProject: !!editorSettings.autosaveProject,
      reduceMotion: !!editorSettings.reduceMotion,
      highContrast: !!editorSettings.highContrast,
      geminiModel: editorSettings.geminiModel || 'gemini-3-flash-preview',
      aiUserBrief: editorSettings.aiUserBrief || '',
      aiTranscript: editorSettings.aiTranscript || ''
    },
    editorState: {
      aspect,
      preset,
      logoPosition,
      audioProcessing,
      times: { ...times },
      segments: cloneJSON(segments),
      scrubAudio: !!el('scrub-toggle')?.checked,
      crossfadeCuts: !!el('crossfade-toggle')?.checked,
      silenceThreshold: el('silence-threshold')?.value || '-40',
      silenceMinDuration: el('silence-min-dur')?.value || '0.5',
      assets: {
        logoLoaded: !!assets.logo,
        logoName: assets.logo?.name || '',
        audioSwapLoaded: !!assets.audioSwap,
        audioSwapName: assets.audioSwap?.name || ''
      },
      illuStack: illuStack.map(item => ({
        fileName: item.file?.name || '',
        at: item.at,
        duration: item.duration,
        layout: item.layout
      })),
      bgmStack: bgmStack.map(item => ({
        fileName: item.file?.name || '',
        startAt: item.startAt,
        offset: item.offset,
        volume: item.volume
      })),
      sfxStack: sfxStack.map(item => ({
        fileName: item.file?.name || '',
        at: item.at,
        volume: item.volume
      })),
      brollStack: brollStack.map(item => ({
        fileName: item.file?.name || '',
        at: item.at,
        duration: item.duration,
        muteAudio: item.muteAudio,
        layout: item.layout || 'fullscreen'
      }))
    }
  };
}

function migrateProjectSnapshot(raw) {
  const defaults = {
    version: PROJECT_SCHEMA_VERSION,
    savedAt: '',
    projectName: 'my-project',
    settings: createDefaultEditorSettings(),
    editorState: {
      aspect: 'landscape',
      preset: 'ultrafast',
      logoPosition: 'top-right',
      audioProcessing: 'none',
      times: { s: 0, e: times.duration || 0, duration: times.duration || 0 },
      segments: times.duration ? [{ s: 0, e: times.duration }] : [],
      scrubAudio: true,
      crossfadeCuts: true,
      silenceThreshold: '-40',
      silenceMinDuration: '0.5',
      assets: { logoLoaded: false, logoName: '', audioSwapLoaded: false, audioSwapName: '' },
      illuStack: [],
      bgmStack: [],
      sfxStack: [],
      brollStack: []
    }
  };
  const merged = {
    ...defaults,
    ...(raw || {}),
    settings: { ...defaults.settings, ...(raw?.settings || {}) },
    editorState: { ...defaults.editorState, ...(raw?.editorState || {}) }
  };
  ['illuStack', 'bgmStack', 'sfxStack', 'brollStack', 'segments'].forEach(key => {
    if (!Array.isArray(merged.editorState[key])) merged.editorState[key] = defaults.editorState[key];
  });
  return merged;
}

function saveProjectSnapshot(manual = false) {
  try {
    const snapshot = buildProjectSnapshot();
    localStorage.setItem(STORAGE_KEYS.projectSnapshot, JSON.stringify(snapshot));
    if (manual) {
      setInlineStatus(
        'project-save-status',
        `Saved project settings locally at ${new Date(snapshot.savedAt).toLocaleTimeString()}.`,
        'success'
      );
      toast('Project settings saved locally ✓', 'success');
    }
  } catch (err) {
    console.warn('[Project] Could not save snapshot:', err.message);
    setInlineStatus('project-save-status', 'Could not save project settings in this browser.', 'error');
  }
}

function scheduleProjectAutosave() {
  if (!editorSettings.autosaveProject) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveProjectSnapshot(false), 350);
}

function applyProjectSnapshot(rawSnapshot) {
  const snapshot = migrateProjectSnapshot(rawSnapshot);
  editorSettings = {
    ...editorSettings,
    ...snapshot.settings,
    geminiApiKey: editorSettings.geminiApiKey
  };
  updateSettingsForm();

  if (el('project-name')) el('project-name').value = snapshot.projectName || 'my-project';

  setAspect(snapshot.editorState.aspect || 'landscape');
  setPreset(snapshot.editorState.preset || 'ultrafast');
  logoPosition = snapshot.editorState.logoPosition || 'top-right';
  audioProcessing = snapshot.editorState.audioProcessing || 'none';
  if (el('scrub-toggle')) el('scrub-toggle').checked = snapshot.editorState.scrubAudio !== false;
  if (el('crossfade-toggle')) el('crossfade-toggle').checked = snapshot.editorState.crossfadeCuts !== false;
  if (el('silence-threshold')) el('silence-threshold').value = snapshot.editorState.silenceThreshold || '-40';
  if (el('silence-min-dur')) el('silence-min-dur').value = snapshot.editorState.silenceMinDuration || '0.5';

  if (times.duration > 0) {
    const incomingTimes = snapshot.editorState.times || {};
    times.s = clamp(Number(incomingTimes.s) || 0, 0, times.duration);
    times.e = clamp(Number(incomingTimes.e) || times.duration, 0, times.duration);
    times.duration = player.duration || times.duration;
    if (times.e <= times.s) {
      times.s = 0;
      times.e = times.duration;
    }
    if (snapshot.editorState.segments.length > 0) {
      segments = snapshot.editorState.segments
        .map(seg => ({
          s: clamp(Number(seg.s) || 0, 0, times.duration),
          e: clamp(Number(seg.e) || 0, 0, times.duration)
        }))
        .filter(seg => seg.e - seg.s > 0.05);
      if (!segments.length) segments = [{ s: 0, e: times.duration }];
    }
  }

  snapshot.editorState.illuStack.forEach((saved, index) => {
    const item = illuStack[index];
    if (!item) return;
    item.at = clamp(Number(saved.at) || item.at, 0, times.duration || item.at);
    item.duration = Math.max(0.5, Number(saved.duration) || item.duration);
    item.layout = saved.layout || item.layout;
    if (item.el) item.el.className = `illu-overlay-el layout-${item.layout} hidden`;
  });
  snapshot.editorState.bgmStack.forEach((saved, index) => {
    const item = bgmStack[index];
    if (!item) return;
    item.startAt = Math.max(0, Number(saved.startAt) || 0);
    item.offset = Math.max(0, Number(saved.offset) || 0);
    item.volume = clamp(Number(saved.volume) || item.volume, 0, 100);
    item.audio.volume = item.volume / 100;
  });
  snapshot.editorState.sfxStack.forEach((saved, index) => {
    const item = sfxStack[index];
    if (!item) return;
    item.at = clamp(Number(saved.at) || item.at, 0, times.duration || item.at);
    item.volume = clamp(Number(saved.volume) || item.volume, 0, 100);
    item.audio.volume = item.volume / 100;
  });
  snapshot.editorState.brollStack.forEach((saved, index) => {
    const item = brollStack[index];
    if (!item) return;
    item.at = clamp(Number(saved.at) || item.at, 0, times.duration || item.at);
    item.duration = Math.max(0.5, Number(saved.duration) || item.duration);
    item.muteAudio = saved.muteAudio !== false;
    item.layout = saved.layout || item.layout || 'fullscreen';
    item.video.muted = item.muteAudio;
  });

  syncSingleAssetUI();
  updateTimecodes();
  updateTrimBar();
  updateSegmentDisplay();
  renderIlluStack();
  renderBgmStack();
  renderSfxStack();
  renderBrollStack();
  renderSfxMarkers();
  updateSummary();
  applyAccessibilityPreferences();

  const restoredMedia = mainVideoFile ? 'media placements' : 'settings only (reload media files to restore file-based layers)';
  setInlineStatus('project-save-status', `Restored ${restoredMedia} from the saved local snapshot.`, 'success');
}

function restoreSavedProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.projectSnapshot);
    if (!raw) {
      setInlineStatus('project-save-status', 'No saved local project snapshot found yet.', 'info');
      toast('No saved local project found', 'info');
      return;
    }
    applyProjectSnapshot(JSON.parse(raw));
    toast('Saved project restored ✓', 'success');
  } catch (err) {
    console.warn('[Project] Could not restore snapshot:', err.message);
    setInlineStatus('project-save-status', 'Could not restore the saved project snapshot.', 'error');
  }
}

function initializeEnhancements() {
  loadEditorSettings();
  updateSettingsForm();

  el('save-gemini-key')?.addEventListener('click', () => {
    syncSettingsFromForm();
    persistEditorSettings('Gemini settings saved locally.');
    updateGeminiStatusText();
    scheduleProjectAutosave();
  });

  el('clear-gemini-key')?.addEventListener('click', () => {
    editorSettings.geminiApiKey = '';
    if (el('gemini-api-key')) el('gemini-api-key').value = '';
    persistEditorSettings('Gemini key cleared from this browser.');
    updateGeminiStatusText();
  });

  el('test-gemini-key')?.addEventListener('click', () => {
    syncSettingsFromForm();
    persistEditorSettings();
    testGeminiKey();
  });

  ['gemini-model', 'autosave-project', 'reduce-motion-toggle', 'high-contrast-toggle']
    .forEach(id => el(id)?.addEventListener('change', () => {
      syncSettingsFromForm();
      applyAccessibilityPreferences();
      persistEditorSettings('Editor preferences saved locally.');
      scheduleProjectAutosave();
    }));

  ['ai-user-brief', 'ai-transcript', 'project-name'].forEach(id => el(id)?.addEventListener('input', () => {
    syncSettingsFromForm();
    persistEditorSettings();
    scheduleProjectAutosave();
  }));

  el('save-project-btn')?.addEventListener('click', () => {
    syncSettingsFromForm();
    persistEditorSettings();
    saveProjectSnapshot(true);
  });

  el('load-project-btn')?.addEventListener('click', restoreSavedProject);
  el('analyze-project-btn')?.addEventListener('click', analyzeProjectWithGemini);
  el('apply-ai-btn')?.addEventListener('click', applyAiSuggestions);

  window.addEventListener('beforeunload', () => {
    syncSettingsFromForm();
    persistEditorSettings();
    if (editorSettings.autosaveProject) saveProjectSnapshot(false);
  });
}

initializeEnhancements();

function arrayBufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
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
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error('Gemini did not return valid JSON.');
  }
}

async function callGeminiAPI(prompt, parts = []) {
  const apiKey = (editorSettings.geminiApiKey || '').trim();
  if (!apiKey) throw new Error('Add a Gemini API key in Editor Preferences first.');

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
    const message = payload?.error?.message || `Gemini request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function testGeminiKey() {
  try {
    updateGeminiStatusText('Checking Gemini key…', 'info');
    const payload = await callGeminiAPI('Reply with the single word OK.');
    const text = extractGeminiText(payload);
    updateGeminiStatusText(text ? 'Gemini key is valid and ready.' : 'Gemini responded, but returned no text.', 'success');
  } catch (err) {
    console.error('[Gemini test]', err);
    updateGeminiStatusText(err.message || 'Gemini key test failed.', 'error');
    toast('Gemini key test failed', 'error');
  }
}

function waitForMediaEvent(node, eventName) {
  return new Promise((resolve, reject) => {
    const onDone = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Media event failed: ${eventName}`));
    };
    const cleanup = () => {
      node.removeEventListener(eventName, onDone);
      node.removeEventListener('error', onError);
    };
    node.addEventListener(eventName, onDone, { once: true });
    node.addEventListener('error', onError, { once: true });
  });
}

async function captureVideoSnapshots(file) {
  const tempVideo = document.createElement('video');
  tempVideo.preload = 'auto';
  tempVideo.muted = true;
  tempVideo.playsInline = true;
  tempVideo.src = getPreviewURL(file);
  await waitForMediaEvent(tempVideo, 'loadedmetadata');

  const duration = tempVideo.duration || times.duration || 0;
  const baseTargets = [
    { label: 'start', time: Math.min(0.5, Math.max(0, duration * 0.1)) },
    { label: 'middle', time: duration / 2 || 0 },
    { label: 'end', time: Math.max(0, duration - Math.min(0.5, duration / 3 || 0.5)) }
  ];

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const width = tempVideo.videoWidth || 640;
  const height = tempVideo.videoHeight || 360;
  const scale = Math.min(1, 640 / width, 360 / height);
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const snapshots = [];
  for (const target of baseTargets) {
    const seekTime = clamp(target.time || 0, 0, Math.max(0, duration - 0.05));
    if (Math.abs(tempVideo.currentTime - seekTime) > 0.02) {
      const seekPromise = waitForMediaEvent(tempVideo, 'seeked');
      tempVideo.currentTime = seekTime;
      await seekPromise;
    }
    ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.82).split(',')[1];
    snapshots.push({
      label: target.label,
      time: Number(seekTime.toFixed(2)),
      inlineData: { mimeType: 'image/jpeg', data }
    });
  }
  return snapshots;
}

async function extractAudioSampleForAi(file) {
  if (!engineReady) {
    return { part: null, note: 'Audio transcript skipped because FFmpeg is still loading.' };
  }

  const duration = times.duration || player.duration || audioPlayer.duration || 0;
  const mediaLabel = mediaKind === 'audio' ? 'audio file' : 'video';

  // Media over 10 minutes asks the user before sending the full audio track.
  const LONG_MEDIA_THRESHOLD = 600; // seconds
  if (duration > LONG_MEDIA_THRESHOLD) {
    const proceed = window.confirm(
      `This ${mediaLabel} is ${fmtTime(duration)} long (over 10 minutes).\n\n` +
      'Send the full audio to Gemini for transcription anyway?\n\n' +
      (mediaKind === 'audio'
        ? 'OK = send audio.  Cancel = skip AI transcription.'
        : 'OK = send audio.  Cancel = analyze snapshots only (no audio).')
    );
    if (!proceed) {
      return { part: null, note: 'Audio transcript skipped — you chose not to send audio for this long file.' };
    }
  }

  const ext = (file.name.split('.').pop() || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const inputName = `ai-input-${stamp}.${ext}`;
  const outputName = `ai-audio-${stamp}.mp3`;

  try {
    ffmpeg.FS('writeFile', inputName, await fetchFile(file));
    await ffmpeg.run(
      '-i', inputName,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-b:a', '48k',
      outputName
    );
    const audioBytes = ffmpeg.FS('readFile', outputName);
    return {
      part: {
        inlineData: {
          mimeType: 'audio/mpeg',
          data: arrayBufferToBase64(audioBytes)
        }
      },
      note: 'Included the full audio track for transcript and pacing analysis.'
    };
  } catch (err) {
    console.warn('[AI audio]', err.message);
    return { part: null, note: 'Audio transcript could not be extracted from this video.' };
  } finally {
    try { ffmpeg.FS('unlink', inputName); } catch (_) {}
    try { ffmpeg.FS('unlink', outputName); } catch (_) {}
  }
}

function normalizeAiSuggestions(data) {
  const safe = data && typeof data === 'object' ? data : {};
  return {
    projectSummary: safe.projectSummary || 'No project summary returned.',
    audioTranscript: typeof safe.audioTranscript === 'string' ? safe.audioTranscript : '',
    audioSummary: safe.audioSummary || 'No audio summary returned.',
    illustrationSuggestions: Array.isArray(safe.illustrationSuggestions) ? safe.illustrationSuggestions : [],
    brollSuggestions: Array.isArray(safe.brollSuggestions) ? safe.brollSuggestions : [],
    bgmSuggestions: Array.isArray(safe.bgmSuggestions) ? safe.bgmSuggestions : [],
    sfxSuggestions: Array.isArray(safe.sfxSuggestions) ? safe.sfxSuggestions : [],
    accessibilityFindings: Array.isArray(safe.accessibilityFindings) ? safe.accessibilityFindings : [],
    compatibilityFindings: Array.isArray(safe.compatibilityFindings) ? safe.compatibilityFindings : [],
    bugChecks: Array.isArray(safe.bugChecks) ? safe.bugChecks : []
  };
}

function renderAiAnalysisResult(result, audioNote = '') {
  const lines = [
    `Summary: ${result.projectSummary || 'None'}`,
    `Audio: ${result.audioSummary || audioNote || 'Not provided'}`,
    ...(result.audioTranscript ? ['', 'Transcript:', result.audioTranscript] : []),
    '',
    `Illustration suggestions: ${result.illustrationSuggestions.length}`,
    ...result.illustrationSuggestions.slice(0, 4).map(item =>
      `- Illu ${item.index}: ${fmtTime(Number(item.at) || 0)} for ${Number(item.duration) || 0}s (${item.layout || 'center'}) — ${item.reason || 'No reason'}`
    ),
    '',
    `B-Roll suggestions: ${result.brollSuggestions.length}`,
    ...result.brollSuggestions.slice(0, 4).map(item =>
      `- B-Roll ${item.index}: ${fmtTime(Number(item.at) || 0)} for ${Number(item.duration) || 0}s (${item.layout || 'fullscreen'}) — ${item.reason || 'No reason'}`
    ),
    '',
    `BGM suggestions: ${result.bgmSuggestions.length}`,
    ...result.bgmSuggestions.slice(0, 4).map(item =>
      `- BGM ${item.index}: start ${fmtTime(Number(item.startAt) || 0)} at ${Number(item.volume) || 0}% — ${item.reason || 'No reason'}`
    ),
    '',
    `SFX suggestions: ${result.sfxSuggestions.length}`,
    ...result.sfxSuggestions.slice(0, 4).map(item =>
      `- SFX ${item.index}: ${fmtTime(Number(item.at) || 0)} at ${Number(item.volume) || 0}% — ${item.reason || 'No reason'}`
    ),
    '',
    'Accessibility checks:',
    ...(result.accessibilityFindings.length ? result.accessibilityFindings.map(item => `- ${item}`) : ['- None returned']),
    '',
    'Compatibility checks:',
    ...(result.compatibilityFindings.length ? result.compatibilityFindings.map(item => `- ${item}`) : ['- None returned']),
    '',
    'Bug checks:',
    ...(result.bugChecks.length ? result.bugChecks.map(item => `- ${item}`) : ['- None returned'])
  ];
  if (audioNote && !result.audioSummary) lines.splice(1, 0, `Audio note: ${audioNote}`);
  if (el('ai-analysis-result')) el('ai-analysis-result').textContent = lines.join('\n');
}

async function analyzeProjectWithGemini() {
  if (aiJobRunning) return;
  if (!mainVideoFile) {
    toast('Load a video or audio file before running AI analysis', 'error');
    return;
  }

  syncSettingsFromForm();
  persistEditorSettings();

  if (!(editorSettings.geminiApiKey || '').trim()) {
    updateGeminiStatusText('Paste and save a Gemini API key first.', 'error');
    toast('Add a Gemini API key first', 'error');
    return;
  }

  const isAudio = mediaKind === 'audio';

  aiJobRunning = true;
  el('analyze-project-btn').disabled = true;
  el('apply-ai-btn').disabled = true;
  latestAiSuggestions = null;
  if (el('ai-analysis-result')) {
    el('ai-analysis-result').textContent = isAudio
      ? 'Transcribing audio and analyzing pacing…'
      : 'Analyzing video snapshots and audio transcript…';
  }
  setStatus('Preparing AI analysis…');

  try {
    // Snapshots only make sense for video. Audio is always transcribed.
    const snapshots = isAudio ? [] : await captureVideoSnapshots(mainVideoFile);
    const audioSample = await extractAudioSampleForAi(mainVideoFile);
    const parts = snapshots.map(item => item.inlineData);
    if (audioSample.part) parts.push(audioSample.part);

    const prompt = [
      isAudio
        ? 'You are helping a browser-based AUDIO editor. The user uploaded an audio file (no video frames exist).'
        : 'You are helping a browser-based VIDEO editor place already-uploaded visual assets onto a timeline.',
      'Return strict JSON only. No markdown fences.',
      'JSON schema:',
      '{',
      '  "projectSummary": "short paragraph",',
      '  "audioTranscript": "verbatim, punctuated transcript of the spoken audio; empty string only if there is truly no speech",',
      '  "audioSummary": "short paragraph summarizing tone and pacing; mention if audio was unavailable",',
      '  "illustrationSuggestions": [{"index":1,"at":12.5,"duration":3,"layout":"center","reason":"why"}],',
      '  "brollSuggestions": [{"index":1,"at":24.5,"duration":4,"layout":"fullscreen","reason":"why"}],',
      '  "bgmSuggestions": [{"index":1,"startAt":0,"volume":18,"reason":"why"}],',
      '  "sfxSuggestions": [{"index":1,"at":8.0,"volume":100,"reason":"why"}],',
      '  "accessibilityFindings": ["..."],',
      '  "compatibilityFindings": ["..."],',
      '  "bugChecks": ["..."]',
      '}',
      '',
      `Project type: ${isAudio ? 'audio-only' : 'video'}`,
      `Media duration: ${fmtTime(times.duration || player.duration || audioPlayer.duration || 0)}`,
      isAudio
        ? 'Illustration/B-Roll assets: not applicable for audio projects (keep those arrays empty).'
        : `Current illustration assets: ${illuStack.length ? illuStack.map((item, index) => `${index + 1}:${item.file.name}`).join(', ') : 'none uploaded'}`,
      isAudio ? '' : `Current B-Roll assets: ${brollStack.length ? brollStack.map((item, index) => `${index + 1}:${item.file.name}`).join(', ') : 'none uploaded'}`,
      `Current background music tracks: ${bgmStack.length ? bgmStack.map((item, index) => `${index + 1}:${item.file.name}`).join(', ') : 'none uploaded'}`,
      `Current sound effects: ${sfxStack.length ? sfxStack.map((item, index) => `${index + 1}:${item.file.name}`).join(', ') : 'none uploaded'}`,
      `Audio swap: ${assets.audioSwap ? 'loaded' : 'not loaded'}`,
      `User editing goal: ${editorSettings.aiUserBrief || 'No extra goal provided.'}`,
      `Transcript or notes supplied by user: ${editorSettings.aiTranscript || 'None — please generate the transcript from the audio.'}`,
      `Audio analysis note: ${audioSample.note}`,
      isAudio ? '' : `Snapshot times: ${snapshots.map(item => `${item.label}@${fmtTime(item.time)}`).join(', ')}`,
      'Rules:',
      '- Always transcribe the spoken audio into audioTranscript when an audio track is provided.',
      isAudio
        ? '- This is audio-only: keep illustrationSuggestions and brollSuggestions empty. Focus on transcript, bgmSuggestions and sfxSuggestions.'
        : '- Use only uploaded illustration indexes 1..N and B-Roll indexes 1..M. Layout must be one of: center, fullscreen, left-third, right-third.',
      '- Use only uploaded BGM indexes 1..N and SFX indexes 1..M. startAt/at are seconds within the timeline; volume is a percent 0..100.',
      '- Keep any array empty when there are no uploaded assets of that type.',
      '- Suggestions must be conservative and timeline-safe.',
      '- Accessibility findings should focus on captions/transcripts, contrast, keyboard flow, and motion sensitivity.',
      '- Compatibility findings should focus on browser support, persistence, and failure modes.',
      '- Bug checks should highlight likely editor regressions to manually verify.'
    ].filter(Boolean).join('\n');

    const payload = await callGeminiAPI(prompt, parts);
    const parsed = normalizeAiSuggestions(parseGeminiJson(extractGeminiText(payload)));
    latestAiSuggestions = parsed;

    // Auto-fill the transcript box so Gemini's transcript becomes reusable context.
    if (parsed.audioTranscript && el('ai-transcript')) {
      el('ai-transcript').value = parsed.audioTranscript;
      editorSettings.aiTranscript = parsed.audioTranscript;
      persistEditorSettings();
      announce('Transcript generated and added to the transcript box.');
    }

    renderAiAnalysisResult(parsed, audioSample.note);
    el('apply-ai-btn').disabled = !(
      parsed.illustrationSuggestions.length ||
      parsed.brollSuggestions.length ||
      parsed.bgmSuggestions.length ||
      parsed.sfxSuggestions.length
    );
    updateGeminiStatusText('Gemini analysis completed successfully.', 'success');
    setStatus('AI analysis complete.');
    toast('AI analysis complete ✓', 'success');
  } catch (err) {
    console.error('[AI analysis]', err);
    if (el('ai-analysis-result')) el('ai-analysis-result').textContent = `AI analysis failed: ${err.message}`;
    updateGeminiStatusText(err.message || 'Gemini analysis failed.', 'error');
    toast('AI analysis failed', 'error');
  } finally {
    aiJobRunning = false;
    el('analyze-project-btn').disabled = false;
  }
}

function applyAiSuggestions() {
  if (!latestAiSuggestions) {
    toast('Run AI analysis first', 'info');
    return;
  }

  let applied = 0;
  pushHistory();

  latestAiSuggestions.illustrationSuggestions.forEach(suggestion => {
    const item = illuStack[(Number(suggestion.index) || 0) - 1];
    if (!item) return;
    item.at = clamp(Number(suggestion.at) || item.at, 0, times.duration || item.at);
    item.duration = Math.max(0.5, Number(suggestion.duration) || item.duration);
    item.layout = ['center', 'fullscreen', 'left-third', 'right-third'].includes(suggestion.layout) ? suggestion.layout : item.layout;
    if (item.el) item.el.className = `illu-overlay-el layout-${item.layout} hidden`;
    applied++;
  });

  latestAiSuggestions.brollSuggestions.forEach(suggestion => {
    const item = brollStack[(Number(suggestion.index) || 0) - 1];
    if (!item) return;
    item.at = clamp(Number(suggestion.at) || item.at, 0, times.duration || item.at);
    item.duration = Math.max(0.5, Number(suggestion.duration) || item.duration);
    item.layout = ['center', 'fullscreen', 'left-third', 'right-third'].includes(suggestion.layout) ? suggestion.layout : item.layout;
    applied++;
  });

  // Apply BGM suggestions: start time + volume.
  (latestAiSuggestions.bgmSuggestions || []).forEach(suggestion => {
    const item = bgmStack[(Number(suggestion.index) || 0) - 1];
    if (!item) return;
    if (suggestion.startAt != null && !isNaN(Number(suggestion.startAt))) {
      item.startAt = clamp(Number(suggestion.startAt), 0, times.duration || Number(suggestion.startAt));
    }
    if (suggestion.volume != null && !isNaN(Number(suggestion.volume))) {
      item.volume = clamp(Math.round(Number(suggestion.volume)), 0, 100);
      if (item.audio) item.audio.volume = item.volume / 100;
    }
    applied++;
  });

  // Apply SFX suggestions: trigger time + volume.
  (latestAiSuggestions.sfxSuggestions || []).forEach(suggestion => {
    const item = sfxStack[(Number(suggestion.index) || 0) - 1];
    if (!item) return;
    if (suggestion.at != null && !isNaN(Number(suggestion.at))) {
      item.at = clamp(Number(suggestion.at), 0, times.duration || Number(suggestion.at));
    }
    if (suggestion.volume != null && !isNaN(Number(suggestion.volume))) {
      item.volume = clamp(Math.round(Number(suggestion.volume)), 0, 100);
      if (item.audio) item.audio.volume = item.volume / 100;
    }
    item.triggered = false;
    applied++;
  });

  if (!applied) {
    toast('AI returned review notes but no applicable asset placements', 'info');
    return;
  }

  renderIlluStack();
  renderBrollStack();
  renderBgmStack();
  renderSfxStack();
  renderSfxMarkers();
  updateSummary();
  announce(`Applied ${applied} AI placement suggestion${applied === 1 ? '' : 's'}.`);
  toast(`Applied ${applied} AI suggestion${applied === 1 ? '' : 's'} ✓`, 'success');
}

// ── ENGINE INIT ───────────────────────────────────────────────
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
    console.error(err);
  }
})();

// ── FIREBASE AUTH + INLINE AUTH WIDGET ───────────────────────
// Shows: [Avatar] Signed in as [Name] [Log Out]  when logged in
// Shows: [Sign In] button  when logged out
// Signing in/out syncs across the whole Tech House suite.

function setupAuth() {
  const signinBtn  = document.getElementById('auth-signin-btn');
  const loggedinEl = document.getElementById('auth-loggedin');
  const googleBtn  = document.getElementById('auth-google-btn');
  const logoutBtn  = document.getElementById('auth-logout-btn');
  const googlePop  = document.getElementById('auth-google-popup');
  const popClose   = document.getElementById('auth-popup-close');

  // "Sign In" button → show Google popup card
  if (signinBtn) {
    signinBtn.addEventListener('click', () => {
      googlePop.classList.toggle('hidden');
      signinBtn.setAttribute('aria-expanded', !googlePop.classList.contains('hidden'));
    });
  }
  if (popClose) {
    popClose.addEventListener('click', () => googlePop.classList.add('hidden'));
  }

  // Google sign-in
  if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
      googlePop.classList.add('hidden');
      try {
        await fbSignInWithPopup(gProvider);
        toast('Signed in to Tech House ✓', 'success');
      } catch (err) {
        if (err.code !== 'auth/popup-closed-by-user' &&
            err.code !== 'auth/cancelled-popup-request') {
          fbSignInWithRedirect(gProvider);
        }
      }
    });
  }

  // Log out
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await fbSignOut();
      toast('Logged out of Tech House', 'info');
    });
  }

  // Close popup on outside click
  document.addEventListener('click', e => {
    const widget = document.getElementById('auth-widget');
    if (widget && !widget.contains(e.target)) {
      googlePop.classList.add('hidden');
    }
  });

  // Auth state → update inline widget
  fbOnAuthStateChanged(user => {
    if (user) {
      const displayName = user.displayName || user.email.split('@')[0];
      // Hide sign-in, show logged-in row
      signinBtn.classList.add('hidden');
      loggedinEl.classList.remove('hidden');
      // Update name
      const nameEl = document.getElementById('auth-name');
      if (nameEl) nameEl.textContent = displayName;
      // Update avatar
      const avatarEl = document.getElementById('auth-avatar');
      if (avatarEl) {
        avatarEl.src = user.photoURL ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=f59e0b&color=000&size=80`;
      }
    } else {
      signinBtn.classList.remove('hidden');
      loggedinEl.classList.add('hidden');
    }
  });
}

// ── MEDIA UPLOAD (HYBRID: VIDEO OR AUDIO) ─────────────────────

// Robust media-type detection. iOS Chrome/Safari sometimes report an empty
// or generic file.type, so we fall back to the file extension.
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
    toast('Unsupported file — please pick a video or audio file', 'error');
    setStatus('Unsupported file type. Load a video or audio file.', true);
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

// Show/hide the correct preview surface and adjust controls for the mode.
function applyMediaKindUI() {
  const isAudio = mediaKind === 'audio';
  if (player) player.classList.toggle('hidden', isAudio);
  if (audioOnlyStage) audioOnlyStage.classList.toggle('hidden', !isAudio);
  document.body.classList.toggle('audio-mode', isAudio);
  // Video-only overlay layers (logo, illustrations, B-roll) are dimmed for audio.
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

  uploadZone.classList.add('hidden');
  previewStage.classList.remove('hidden');
  document.getElementById('export-btn').disabled  = false;
  document.getElementById('silence-btn').disabled = false;
  document.getElementById('undo-btn').disabled    = true;

  updateTimecodes();
  updateTrimBar();
  updateSegmentDisplay();
  updateSummary();
  renderSfxMarkers();
  const kindLabel = mediaKind === 'audio' ? 'Audio' : 'Video';
  setStatus(`Loaded: "${file.name}" — ${fmtTime(duration)}`);
  toast(`${kindLabel} loaded ✓`, 'success');
  scheduleProjectAutosave();

  // Decode audio for silence detection + AI transcription in the background.
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
    // iOS Safari occasionally withholds loadedmetadata until playback is
    // nudged; a muted no-op play()/pause() reliably forces metadata to load.
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

document.getElementById('vid-uploader').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  await handleMainMediaFile(file);
  // Reset so re-selecting the same file still fires 'change' (needed on iOS).
  e.target.value = '';
});

// Drag-and-drop (desktop) — accepts video OR audio.
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.style.borderColor = 'var(--amber)'; });
uploadZone.addEventListener('dragleave', () => { uploadZone.style.borderColor = ''; });
uploadZone.addEventListener('drop', async e => {
  e.preventDefault();
  uploadZone.style.borderColor = '';
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file && detectMediaKind(file)) {
    await handleMainMediaFile(file);
  } else if (file) {
    toast('Drop a video or audio file', 'error');
  }
});

// ── DECODE AUDIO FOR SILENCE DETECTION ───────────────────────
async function decodeVideoAudio(file) {
  try {
    const arrayBuf = await file.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    mainAudioBuffer = await ctx.decodeAudioData(arrayBuf);
    ctx.close();
    setStatus(`Audio decoded. ${fmtTime(mainAudioBuffer.duration)} ready for analysis.`);
  } catch (err) {
    console.warn('[Audio decode]', err.message);
    // Not fatal — silence detection just won't work
  }
}

// ── SILENCE DETECTION / AUTO JUMP-CUT ────────────────────────
async function detectSilence() {
  if (!mainAudioBuffer) {
    toast('Audio not decoded yet — wait a moment', 'error');
    return;
  }
  const thresholdDb  = parseFloat(document.getElementById('silence-threshold').value) || -40;
  const minDurSec    = parseFloat(document.getElementById('silence-min-dur').value)   || 0.5;
  const threshold    = Math.pow(10, thresholdDb / 20); // dB → linear

  setStatus('Scanning for silence…');
  toast('Scanning for silent gaps…', 'info');

  const data       = mainAudioBuffer.getChannelData(0); // mono channel
  const sr         = mainAudioBuffer.sampleRate;
  const windowSamp = Math.floor(sr * 0.05); // 50ms RMS windows

  const silentRanges = [];
  let inSilence = false;
  let silStart  = 0;

  for (let i = 0; i < data.length; i += windowSamp) {
    // Compute RMS for this window
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
    setStatus('No silence detected. Try lowering the threshold dB value.');
    return;
  }

  // Save state then apply cuts
  pushHistory();
  for (const range of silentRanges) {
    // Expand silence slightly inward (keep 50ms of silence at edges for smoothness)
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

  document.getElementById('undo-btn').disabled = false;
  updateSegmentDisplay();
  updateSummary();
  times.s = 0; times.e = times.duration;
  updateTrimBar();

  const kept = segments.reduce((a, s) => a + (s.e - s.s), 0);
  const msg  = `Auto-cut ${silentRanges.length} silent gap${silentRanges.length > 1 ? 's' : ''}. ${fmtTime(kept)} of audio remains. Ctrl+Z to undo.`;
  setStatus(`Silence removed: ${silentRanges.length} cuts applied.`);
  announce(msg);
  toast(`${silentRanges.length} silence cut${silentRanges.length > 1 ? 's' : ''} applied ✂`, 'success');
}

// ── LAYER UPLOADS (logo, audioSwap) ──────────────────────────
function triggerLayer(type) {
  const input = document.getElementById('layer-uploader');
  input.accept = (type === 'logo') ? 'image/*' : 'audio/*';
  input._type  = type;
  input.click();
}
document.getElementById('layer-uploader').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const type = e.target._type;
  pushHistory();
  assets[type] = file;
  const objectURL = getPreviewURL(file);

  if (type === 'logo') {
    document.getElementById('overlay-logo-img').src = objectURL;
    overlayLogo.classList.remove('hidden');
    applyLogoPosition(logoPosition);
    const el = document.getElementById('layer-logo');
    if (el) el.classList.add('loaded');
    document.getElementById('desc-logo').textContent = file.name.slice(0,20);
    announce('Logo loaded. Permanent watermark active in preview.');
  }
  if (type === 'audioSwap') {
    swapAudio.src = objectURL;
    swapAudio.load();
    player.muted = true;
    const el = document.getElementById('layer-audioSwap');
    if (el) el.classList.add('loaded');
    document.getElementById('desc-audioSwap').textContent = file.name.slice(0,20);
    announce('Audio Swap loaded. Original audio muted in preview.');
  }

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
  const labels = {
    none:  'Original audio kept as-is',
    swap:  'Swap file replaces the original audio track',
    noise: 'Noise removal — adjust strength with the slider',
    mute:  'Original audio is completely removed'
  };
  document.getElementById('audio-processing-note').textContent = labels[val] || '';
  // Show/hide noise strength slider
  const strengthRow = document.getElementById('noise-strength-row');
  if (strengthRow) strengthRow.style.display = (val === 'noise') ? 'block' : 'none';
  updateSummary();
  announce(`Audio processing set to: ${val}.`);
}

// ── MULTI-STACK: ILLUSTRATION ─────────────────────────────────
function triggerAddIllu() {
  document.getElementById('illu-uploader').click();
}
document.getElementById('illu-uploader').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const id  = nextId();
  const at  = player.currentTime || 0;
  const url = URL.createObjectURL(file);

  // Create preview DOM element
  const el = document.createElement('div');
  el.className = 'illu-overlay-el layout-center hidden';
  el.dataset.id = id;
  const img = document.createElement('img');
  img.src = url;
  el.appendChild(img);
  illuContainer.appendChild(el);

  const item = { id, file, url, at, duration: 3, layout: 'center', el };
  illuStack.push(item);

  pushHistory();
  renderIlluStack();
  updateSummary();
  announce(`Illustration added at ${fmtTime(at)}. Duration 3 seconds.`);
  toast('Illustration added ✓', 'success');
  e.target.value = '';
};

function renderIlluStack() {
  const container = document.getElementById('illu-stack');
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
                 aria-label="Illustration timestamp"
                 onchange="updateIllu(${item.id},'at',parseFloat(this.value))">
        </div>
        <div class="stack-ctrl-row">
          <span class="stack-ctrl-label">Dur (s)</span>
          <input type="number" class="stack-ctrl-input" value="${item.duration}" min="0.5" step="0.5"
                 aria-label="Illustration duration"
                 onchange="updateIllu(${item.id},'duration',parseFloat(this.value))">
        </div>
        <div style="grid-column:1/-1;">
          <span class="stack-ctrl-label">Layout</span>
          <select class="stack-select" onchange="updateIllu(${item.id},'layout',this.value)" aria-label="Illustration layout">
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
  if (field === 'layout') {
    item.el.className = `illu-overlay-el layout-${val} hidden`;
  }
  updateSummary();
}
function removeIllu(id) {
  const idx = illuStack.findIndex(i => i.id === id);
  if (idx === -1) return;
  illuStack[idx].el.remove();
  illuStack.splice(idx, 1);
  pushHistory();
  renderIlluStack();
  updateSummary();
  toast('Illustration removed', 'info');
}

// ── MULTI-STACK: BGM with Music Focus Controller ─────────────
// The "focused" BGM track gets a visual scrubber + play/pause button.
// Keyboard when focused: Space = play/pause, Left/Right = ±5s start, Shift+Left/Right = ±1s
let focusedBgmId = null;
let bgmScrubIntervals = {}; // interval refs per BGM id for scrubber update

function triggerAddBGM() {
  document.getElementById('bgm-uploader').click();
}
document.getElementById('bgm-uploader').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const id    = nextId();
  const audio = new Audio();
  audio.src   = URL.createObjectURL(file);
  audio.loop  = true;
  audio.volume = 0.18;
  bgmStack.push({ id, file, audio, startAt: 0, offset: 0, volume: 18 });
  pushHistory();
  // Focus the new track automatically
  focusedBgmId = id;
  renderBgmStack();
  updateSummary();
  announce(`BGM track added: "${file.name}". Now focused. Press Space to preview. Left/Right arrows nudge start time.`);
  toast('BGM track added ✓', 'success');
  e.target.value = '';
};

function renderBgmStack() {
  const container = document.getElementById('bgm-stack');
  container.innerHTML = '';
  bgmStack.forEach(item => {
    const isFocused = item.id === focusedBgmId;
    const card = document.createElement('div');
    card.className = 'stack-item' + (isFocused ? ' selected' : '');
    card.setAttribute('data-bgm-id', item.id);
    card.innerHTML = `
      <div class="stack-item-header">
        <span class="stack-item-name">🎵 ${item.file.name.slice(0,16)}</span>
        <div style="display:flex;gap:4px;align-items:center;">
          ${isFocused ? `<span class="bgm-focused-badge">FOCUSED</span>` : ''}
          <button class="stack-item-remove" onclick="removeBgm(${item.id})" aria-label="Remove BGM track">✕</button>
        </div>
      </div>

      <!-- Click to focus -->
      <button class="btn btn-sm btn-ghost" style="width:100%;font-size:0.7rem;margin-bottom:4px;"
              onclick="focusBgm(${item.id})"
              aria-label="${isFocused ? 'Track is focused' : 'Click to focus this BGM track for keyboard control'}">
        ${isFocused ? '🎯 Focused — use keyboard to control' : '🎯 Click to focus'}
      </button>

      <!-- Music Focus Controller (only shown when focused) -->
      ${isFocused ? `
      <div class="bgm-focus-controls" id="bgm-focus-${item.id}">
        <div class="bgm-scrubber-row">
          <button class="bgm-play-btn" id="bgm-play-${item.id}"
                  aria-label="Play or pause this BGM track"
                  onclick="toggleBgmPlayback(${item.id})">▶</button>
          <input type="range" class="bgm-scrubber" id="bgm-scrub-${item.id}"
                 min="0" max="100" value="0" step="0.1"
                 aria-label="BGM song position scrubber"
                 oninput="onBgmScrub(${item.id}, this.value)">
          <span class="bgm-time-display" id="bgm-time-${item.id}">0:00 / 0:00</span>
        </div>
        <p class="stack-hint" style="margin-top:2px;">M=play/pause · [=−1s start · ]=+1s · Shift+[]=±5s</p>
      </div>` : ''}

      <div class="stack-item-controls">
        <div class="stack-ctrl-row">
          <span class="stack-ctrl-label">Start at (s)</span>
          <input type="number" class="stack-ctrl-input" value="${item.startAt}" min="0" step="0.5"
                 aria-label="At what point in the video BGM starts playing"
                 onchange="updateBgm(${item.id},'startAt',parseFloat(this.value))">
        </div>
        <div class="stack-ctrl-row">
          <span class="stack-ctrl-label">Song offset (s)</span>
          <input type="number" class="stack-ctrl-input" value="${item.offset}" min="0" step="1"
                 aria-label="How far into the song to start from"
                 onchange="updateBgm(${item.id},'offset',parseFloat(this.value))">
        </div>
        <div style="grid-column:1/-1;">
          <span class="stack-ctrl-label">Volume ${item.volume}%</span>
          <input type="range" class="stack-vol-slider" min="0" max="100" value="${item.volume}"
                 aria-label="BGM volume"
                 oninput="updateBgm(${item.id},'volume',parseInt(this.value))">
        </div>
      </div>`;

    card.addEventListener('click', (e) => {
      // Focus on click anywhere in the card (unless a control was clicked)
      if (!['INPUT','SELECT','BUTTON'].includes(e.target.tagName)) {
        focusBgm(item.id);
      }
    });

    container.appendChild(card);

    // Start scrubber update interval for focused track
    if (isFocused) {
      clearInterval(bgmScrubIntervals[item.id]);
      bgmScrubIntervals[item.id] = setInterval(() => updateBgmScrubberDisplay(item.id), 250);
    }
  });
}

function focusBgm(id) {
  // Clear old interval
  if (focusedBgmId && bgmScrubIntervals[focusedBgmId]) {
    clearInterval(bgmScrubIntervals[focusedBgmId]);
  }
  focusedBgmId = id;
  renderBgmStack();
  const item = bgmStack.find(i => i.id === id);
  if (item) announce(`BGM "${item.file.name}" focused. Press M to play or pause. Use [ and ] to nudge start time.`);
}

function toggleBgmPlayback(id) {
  const item = bgmStack.find(i => i.id === id);
  if (!item) return;
  // Pause main video while using music focus
  if (!player.paused) player.pause();
  if (item.audio.paused) {
    item.audio.currentTime = item.offset;
    item.audio.play().catch(() => {});
    const btn = document.getElementById(`bgm-play-${id}`);
    if (btn) btn.textContent = '⏸';
    announce(`BGM playing: ${item.file.name}`);
  } else {
    item.audio.pause();
    const btn = document.getElementById(`bgm-play-${id}`);
    if (btn) btn.textContent = '▶';
    announce('BGM paused.');
  }
}

function onBgmScrub(id, pct) {
  const item = bgmStack.find(i => i.id === id);
  if (!item || !item.audio.duration) return;
  // Moving the scrubber sets the song offset (where in the song to start)
  const newOffset = (pct / 100) * item.audio.duration;
  item.audio.currentTime = newOffset;
  item.offset = newOffset;
  updateBgmScrubberDisplay(id);
  announce(`Song position set to ${fmtTime(newOffset)}.`);
}

function updateBgmScrubberDisplay(id) {
  const item   = bgmStack.find(i => i.id === id);
  const scrub  = document.getElementById(`bgm-scrub-${id}`);
  const timeEl = document.getElementById(`bgm-time-${id}`);
  if (!item || !scrub || !timeEl) return;
  const dur  = item.audio.duration || 0;
  const cur  = item.audio.currentTime || 0;
  scrub.value = dur > 0 ? ((cur / dur) * 100).toFixed(1) : '0';
  timeEl.textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
}

function nudgeBgmStartAt(id, deltaSeconds) {
  const item = bgmStack.find(i => i.id === id);
  if (!item) return;
  item.startAt = Math.max(0, item.startAt + deltaSeconds);
  renderBgmStack();
  updateSummary();
  announce(`BGM starts at ${fmtTime(item.startAt)} in video.`);
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
  clearInterval(bgmScrubIntervals[id]);
  bgmStack.splice(idx, 1);
  if (focusedBgmId === id) focusedBgmId = bgmStack.length > 0 ? bgmStack[0].id : null;
  pushHistory();
  renderBgmStack();
  updateSummary();
  toast('BGM track removed', 'info');
}

// ── MULTI-STACK: SFX ─────────────────────────────────────────
function triggerAddSFX() {
  document.getElementById('sfx-uploader').click();
}
document.getElementById('sfx-uploader').onchange = (e) => {
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
  announce(`SFX added at ${fmtTime(activeMedia().currentTime)}. Select it and use Shift+Ctrl+Arrow to nudge.`);
  toast('SFX added ✓', 'success');
  e.target.value = '';
};
function renderSfxStack() {
  const container = document.getElementById('sfx-stack');
  container.innerHTML = '';
  sfxStack.forEach(item => {
    const card = document.createElement('div');
    card.className = 'stack-item' + (item.id === selectedSfxId ? ' selected' : '');
    card.onclick = () => { selectedSfxId = item.id; renderSfxStack(); announce(`SFX "${item.file.name}" selected. Use Shift+Ctrl+Arrow to nudge.`); };
    card.setAttribute('tabindex','0');
    card.setAttribute('role','button');
    card.setAttribute('aria-label', `SFX: ${item.file.name}, at ${fmtTime(item.at)}`);
    card.innerHTML = `
      <div class="stack-item-header">
        <span class="stack-item-name">🔊 ${item.file.name.slice(0,18)}</span>
        <button class="stack-item-remove" onclick="event.stopPropagation();removeSfx(${item.id})" aria-label="Remove SFX">✕</button>
      </div>
      <div class="stack-item-controls">
        <div class="stack-ctrl-row">
          <span class="stack-ctrl-label">At (s)</span>
          <input type="number" class="stack-ctrl-input" value="${item.at.toFixed(2)}" min="0" step="0.1"
                 aria-label="SFX trigger time"
                 onclick="event.stopPropagation()"
                 onchange="event.stopPropagation();updateSfx(${item.id},'at',parseFloat(this.value))">
        </div>
        <div style="grid-column:1/-1;">
          <span class="stack-ctrl-label">Volume ${item.volume}%</span>
          <input type="range" class="stack-vol-slider" min="0" max="100" value="${item.volume}"
                 aria-label="SFX volume"
                 onclick="event.stopPropagation()"
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
  const layer = document.getElementById('sfx-markers-layer');
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
  if (!selectedSfxId) {
    announce('No SFX selected. Click an SFX item first, then nudge with Shift+Ctrl+Arrow.', true);
    return;
  }
  const item = sfxStack.find(i => i.id === selectedSfxId);
  if (!item) return;
  item.at = Math.max(0, Math.min(times.duration, item.at + deltaSeconds));
  renderSfxStack();
  renderSfxMarkers();
  announce(`SFX nudged to ${fmtTime(item.at)}.`);
}

// ── MULTI-STACK: B-ROLL ───────────────────────────────────────
function triggerAddBRoll() {
  document.getElementById('broll-uploader').click();
}
document.getElementById('broll-uploader').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const id  = nextId();
  const vid = document.createElement('video');
  vid.src   = URL.createObjectURL(file);
  vid.muted = true;
  vid.preload = 'metadata';
  brollStack.push({ id, file, video: vid, at: player.currentTime || 0, duration: 5, muteAudio: true, layout: 'fullscreen' });
  pushHistory();
  renderBrollStack();
  updateSummary();
  announce(`B-Roll clip added at ${fmtTime(player.currentTime)}. Overlays main video as fullscreen by default. You can change the layout.`);
  toast('B-Roll added ✓', 'success');
  e.target.value = '';
};
function renderBrollStack() {
  const container = document.getElementById('broll-stack');
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
                 aria-label="B-Roll start time in video"
                 onchange="updateBroll(${item.id},'at',parseFloat(this.value))">
        </div>
        <div class="stack-ctrl-row">
          <span class="stack-ctrl-label">Duration (s)</span>
          <input type="number" class="stack-ctrl-input" value="${item.duration}" min="0.5" step="0.5"
                 aria-label="How long the B-Roll shows"
                 onchange="updateBroll(${item.id},'duration',parseFloat(this.value))">
        </div>
        <div style="grid-column:1/-1;">
          <span class="stack-ctrl-label">Layout / Position</span>
          <select class="stack-select" aria-label="B-Roll layout on screen"
                  onchange="updateBroll(${item.id},'layout',this.value)">
            ${['fullscreen','center','left-third','right-third'].map(l =>
              `<option value="${l}" ${item.layout===l?'selected':''}>${l.replace(/-/g,' ')}</option>`).join('')}
          </select>
        </div>
        <div style="grid-column:1/-1;">
          <label style="display:flex;align-items:center;gap:6px;font-size:0.72rem;cursor:pointer;">
            <input type="checkbox" ${item.muteAudio?'checked':''} aria-label="Mute B-Roll audio — keep main video audio"
                   onchange="updateBroll(${item.id},'muteAudio',this.checked)">
            Mute B-Roll audio (keep main audio)
          </label>
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

// ── LIVE PREVIEW SYSTEM ───────────────────────────────────────
player.addEventListener('play', () => {
  previewStage.classList.add('playing');
  // Reset SFX triggers
  sfxStack.forEach(s => { s.triggered = false; });

  // BGM: sync all tracks
  bgmStack.forEach(item => {
    const videoOffset = player.currentTime - item.startAt;
    if (videoOffset < 0) { item.audio.pause(); return; }
    const dur = item.audio.duration || 1;
    item.audio.currentTime = (item.offset + videoOffset) % dur;
    item.audio.play().catch(() => {});
  });

  // Audio Swap
  if (assets.audioSwap && swapAudio.src) {
    player.muted = true;
    const offset = player.currentTime;
    const dur    = swapAudio.duration || 0;
    swapAudio.currentTime = dur > 0 ? offset % dur : 0;
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

  if (!player.paused) {
    bgmStack.forEach(item => {
      const videoOffset = player.currentTime - item.startAt;
      if (videoOffset < 0) { item.audio.pause(); return; }
      const dur = item.audio.duration || 1;
      item.audio.currentTime = (item.offset + videoOffset) % dur;
    });
    if (assets.audioSwap && swapAudio.src) {
      const dur = swapAudio.duration || 0;
      swapAudio.currentTime = dur > 0 ? (player.currentTime % dur) : 0;
    }
  }

  // Audio scrubbing — play 80ms snippet on seek
  if (document.getElementById('scrub-toggle').checked && !player.paused === false) {
    playScrubSnippet(player.currentTime);
  }
});

player.addEventListener('ended', () => {
  previewStage.classList.remove('playing');
  bgmStack.forEach(i => i.audio.pause());
  swapAudio.pause();
});

// ── AUDIO SCRUBBING ───────────────────────────────────────────
// Plays an 80ms snippet of audio when the user seeks.
// Uses Web Audio API — zero latency, no player audio needed.
let scrubTimeout = null;
function playScrubSnippet(atTime) {
  if (!mainAudioBuffer) return;
  if (!document.getElementById('scrub-toggle').checked) return;

  // Cancel pending scrub
  if (scrubAudioCtx) { try { scrubAudioCtx.close(); } catch(_) {} }

  const indicator = document.getElementById('scrub-indicator');
  indicator.classList.remove('hidden');

  scrubAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const src  = scrubAudioCtx.createBufferSource();
  src.buffer = mainAudioBuffer;

  // Tiny gain envelope to avoid clicks
  const gain = scrubAudioCtx.createGain();
  gain.gain.setValueAtTime(0, scrubAudioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(0.8, scrubAudioCtx.currentTime + 0.01);
  gain.gain.setValueAtTime(0.8, scrubAudioCtx.currentTime + 0.07);
  gain.gain.linearRampToValueAtTime(0, scrubAudioCtx.currentTime + 0.08);

  src.connect(gain);
  gain.connect(scrubAudioCtx.destination);
  src.start(0, Math.max(0, atTime), 0.08);

  clearTimeout(scrubTimeout);
  scrubTimeout = setTimeout(() => {
    indicator.classList.add('hidden');
    try { scrubAudioCtx.close(); } catch(_) {}
    scrubAudioCtx = null;
  }, 150);
}

// ── TIMECODE + PLAYHEAD ───────────────────────────────────────
player.ontimeupdate = () => {
  const t = player.currentTime;
  document.getElementById('tc-current').textContent = fmtTime(t);

  // Zoom-aware playhead
  if (times.duration > 0) {
    const frac    = t / times.duration;
    const fracVis = Math.max(0, Math.min(1, (frac - zoomStart) * zoomLevel));
    document.getElementById('trim-playhead').style.left = (fracVis * 100) + '%';

    // Auto-scroll zoom window
    if (!player.paused && zoomLevel > 1) {
      const windowSize = 1 / zoomLevel;
      if (frac > zoomStart + windowSize - 0.02) {
        zoomStart = Math.min(1 - windowSize, frac - 0.02);
        updateTrimBar(); updateZoomBar();
      }
    }
  }

  // Illustration live preview
  illuStack.forEach(item => {
    const show = t >= item.at && t < (item.at + item.duration);
    item.el.classList.toggle('hidden', !show);
  });

  // SFX triggers
  sfxStack.forEach(item => {
    if (!item.triggered && t >= item.at && t < item.at + 0.5) {
      item.audio.currentTime = 0;
      item.audio.play().catch(() => {});
      item.triggered = true;
    }
  });

  // B-Roll live preview (only first active b-roll shown in preview for simplicity)
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

  // BGM start-at logic (start BGM when playhead reaches startAt)
  bgmStack.forEach(item => {
    if (!player.paused && t >= item.startAt && item.audio.paused) {
      const videoOffset = t - item.startAt;
      const dur = item.audio.duration || 1;
      item.audio.currentTime = (item.offset + videoOffset) % dur;
      item.audio.play().catch(() => {});
    }
    if (t < item.startAt && !item.audio.paused) {
      item.audio.pause();
    }
  });

  // Skip cut regions
  const inCut = !segments.some(seg => t >= seg.s - 0.05 && t < seg.e + 0.05);
  if (inCut && !player.paused && segments.length > 0) {
    const nextSeg = segments.find(seg => seg.s > t);
    if (nextSeg) { player.currentTime = nextSeg.s; }
    else { player.pause(); }
  }
};

// ── AUDIO-ONLY LIVE PREVIEW ───────────────────────────────────
// Mirrors the video preview engine for audio projects, driving BGM/SFX,
// timecode and cut-skipping off the dedicated <audio> element.
audioPlayer.addEventListener('play', () => {
  previewStage.classList.add('playing');
  sfxStack.forEach(s => { s.triggered = false; });
  bgmStack.forEach(item => {
    const off = audioPlayer.currentTime - item.startAt;
    if (off < 0) { item.audio.pause(); return; }
    const dur = item.audio.duration || 1;
    item.audio.currentTime = (item.offset + off) % dur;
    item.audio.play().catch(() => {});
  });
});
audioPlayer.addEventListener('pause', () => {
  previewStage.classList.remove('playing');
  bgmStack.forEach(i => i.audio.pause());
});
audioPlayer.addEventListener('ended', () => {
  previewStage.classList.remove('playing');
  bgmStack.forEach(i => i.audio.pause());
});
audioPlayer.addEventListener('seeked', () => {
  sfxStack.forEach(s => { s.triggered = false; });
});
audioPlayer.ontimeupdate = () => {
  if (mediaKind !== 'audio') return;
  const t = audioPlayer.currentTime;
  document.getElementById('tc-current').textContent = fmtTime(t);

  if (times.duration > 0) {
    const frac    = t / times.duration;
    const fracVis = Math.max(0, Math.min(1, (frac - zoomStart) * zoomLevel));
    document.getElementById('trim-playhead').style.left = (fracVis * 100) + '%';
  }

  // SFX triggers
  sfxStack.forEach(item => {
    if (!item.triggered && t >= item.at && t < item.at + 0.5) {
      item.audio.currentTime = 0;
      item.audio.play().catch(() => {});
      item.triggered = true;
    }
  });

  // BGM start-at logic
  bgmStack.forEach(item => {
    if (!audioPlayer.paused && t >= item.startAt && item.audio.paused) {
      const off = t - item.startAt;
      const dur = item.audio.duration || 1;
      item.audio.currentTime = (item.offset + off) % dur;
      item.audio.play().catch(() => {});
    }
    if (t < item.startAt && !item.audio.paused) item.audio.pause();
  });

  // Skip cut regions
  const inCut = !segments.some(seg => t >= seg.s - 0.05 && t < seg.e + 0.05);
  if (inCut && !audioPlayer.paused && segments.length > 0) {
    const nextSeg = segments.find(seg => seg.s > t);
    if (nextSeg) { audioPlayer.currentTime = nextSeg.s; }
    else { audioPlayer.pause(); }
  }
};

// ── ASPECT & PRESET ───────────────────────────────────────────
function setAspect(val) {
  aspect = val;
  document.querySelectorAll('#seg-landscape, #seg-portrait, #seg-blur-bg').forEach(b => {
    const on = b.dataset.val === val;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const notes = {
    landscape: '1280×720 — standard widescreen',
    portrait:  '720×1280 — auto-centred crop for TikTok/Reels',
    'blur-bg': '1280×720 — portrait video + blurred background fill'
  };
  document.getElementById('aspect-note').textContent = notes[val] || '';
  updateSummary();
  announce(`Aspect: ${val}.`);
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

// ── ZOOM ─────────────────────────────────────────────────────
function cycleZoom() {
  if (!times.duration) return;
  zoomLevel = (zoomLevel === 1) ? 4 : 1;
  zoomStart = 0;
  if (zoomLevel === 4) {
    const playFrac = player.currentTime / times.duration;
    zoomStart = Math.max(0, Math.min(0.75, playFrac - 0.125));
  }
  updateTrimBar(); updateZoomBar(); renderSfxMarkers();
  const btn = document.getElementById('btn-zoom');
  btn.textContent = zoomLevel === 1 ? '🔍 Zoom' : '🔍 4x';
  announce(zoomLevel === 1 ? 'Full timeline.' : 'Zoomed 4x on current time.');
}
function updateZoomBar() {
  const bar = document.getElementById('zoom-bar');
  const win = document.getElementById('zoom-window');
  if (zoomLevel === 1) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  win.style.left  = (zoomStart * 100) + '%';
  win.style.width = ((1 / zoomLevel) * 100) + '%';
}
function fracToZoom(frac) {
  const ws = 1 / zoomLevel;
  return (frac - zoomStart) / ws;
}
function zoomToFrac(zf) {
  return zoomStart + zf * (1 / zoomLevel);
}

// ── TRIM BAR ──────────────────────────────────────────────────
function updateTrimBar() {
  const dur = times.duration;
  if (!dur) return;
  const sp    = times.s / dur;
  const ep    = times.e / dur;
  const spVis = Math.max(0, Math.min(1, (sp - zoomStart) * zoomLevel));
  const epVis = Math.max(0, Math.min(1, (ep - zoomStart) * zoomLevel));
  const rangeL = (Math.max(0, sp - zoomStart) * zoomLevel) * 100;
  const rangeW = (Math.max(0, Math.min(ep, zoomStart + 1/zoomLevel) - Math.max(sp, zoomStart)) * zoomLevel) * 100;
  document.getElementById('trim-range').style.left  = rangeL + '%';
  document.getElementById('trim-range').style.width = Math.max(0, rangeW) + '%';
  document.getElementById('trim-head-s').style.left = (spVis * 100) + '%';
  document.getElementById('trim-head-e').style.left = (epVis * 100) + '%';
  document.getElementById('trim-head-s').setAttribute('aria-valuenow', Math.round(sp * 100));
  document.getElementById('trim-head-e').setAttribute('aria-valuenow', Math.round(ep * 100));
  const len = times.e - times.s;
  const zn  = zoomLevel > 1 ? ` · ${zoomLevel}x zoom` : '';
  document.getElementById('trim-duration-label').textContent =
    `${fmtTime(times.s)} → ${fmtTime(times.e)} (${fmtTime(len)})${zn}`;
}
function updateSegmentDisplay() {
  const dur   = times.duration;
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
  const cutEl    = document.getElementById('cut-summary');
  const cutCount = segments.length - 1;
  if (cutCount > 0) {
    const totalKept = segments.reduce((a, s) => a + (s.e - s.s), 0);
    cutEl.textContent = `${cutCount} cut${cutCount > 1 ? 's' : ''} applied · ${fmtTime(totalKept)} kept`;
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
  window.addEventListener('mouseup', stopDrag);
  window.addEventListener('touchmove', onDrag, { passive: false });
  window.addEventListener('touchend', stopDrag);
}
document.getElementById('trim-head-s').addEventListener('mousedown',  e => startDrag(e, 's'));
document.getElementById('trim-head-e').addEventListener('mousedown',  e => startDrag(e, 'e'));
document.getElementById('trim-head-s').addEventListener('touchstart', e => startDrag(e, 's'), { passive: false });
document.getElementById('trim-head-e').addEventListener('touchstart', e => startDrag(e, 'e'), { passive: false });

function onDrag(e) {
  if (!dragType) return;
  e.preventDefault();
  const rect    = document.getElementById('trim-track').getBoundingClientRect();
  const cx      = e.touches ? e.touches[0].clientX : e.clientX;
  const rawFrac = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
  const t       = zoomToFrac(rawFrac) * times.duration;
  if (dragType === 's') {
    times.s = Math.min(Math.max(0, t), times.e - 0.5);
    activeMedia().currentTime = times.s;
    document.getElementById('tc-start').textContent = fmtTime(times.s);
    document.getElementById('tc-start').classList.remove('muted');
  } else {
    times.e = Math.max(Math.min(times.duration, t), times.s + 0.5);
    activeMedia().currentTime = times.e;
    document.getElementById('tc-end').textContent = fmtTime(times.e);
    document.getElementById('tc-end').classList.remove('muted');
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
document.getElementById('trim-track').addEventListener('click', e => {
  if (!times.duration || e.target.classList.contains('trim-head')) return;
  const rect    = e.currentTarget.getBoundingClientRect();
  const rawFrac = (e.clientX - rect.left) / rect.width;
  const seekTo  = zoomToFrac(Math.max(0, Math.min(1, rawFrac))) * times.duration;
  activeMedia().currentTime = seekTo;
  playScrubSnippet(seekTo);
});

// ── TRIM BUTTONS ──────────────────────────────────────────────
document.getElementById('btn-set-start').onclick = () => {
  const t = activeMedia().currentTime;
  if (t >= times.e) { toast('In must be before Out', 'error'); return; }
  pushHistory();
  times.s = t;
  document.getElementById('tc-start').textContent = fmtTime(t);
  document.getElementById('tc-start').classList.remove('muted');
  updateTrimBar(); updateSummary();
  setStatus(`In point: ${fmtTime(t)}`);
};
document.getElementById('btn-set-end').onclick = () => {
  const t = activeMedia().currentTime;
  if (t <= times.s) { toast('Out must be after In', 'error'); return; }
  pushHistory();
  times.e = t;
  document.getElementById('tc-end').textContent = fmtTime(t);
  document.getElementById('tc-end').classList.remove('muted');
  updateTrimBar(); updateSummary();
  setStatus(`Out point: ${fmtTime(t)}`);
};
document.getElementById('btn-reset-trim').onclick = () => {
  pushHistory();
  times.s = 0; times.e = times.duration;
  segments = [{ s: 0, e: times.duration }];
  document.getElementById('tc-start').textContent = fmtTime(0);
  document.getElementById('tc-end').textContent   = fmtTime(times.duration);
  document.getElementById('tc-start').classList.remove('muted');
  document.getElementById('tc-end').classList.remove('muted');
  updateTrimBar(); updateSegmentDisplay(); updateSummary();
  setStatus('All trims and cuts reset.');
};

// ── CUT SEGMENT ───────────────────────────────────────────────
function cutSegment() {
  if (!mainVideoFile) return;
  const cutS = times.s, cutE = times.e;
  if (cutE - cutS < 0.1) { toast('Set In and Out first', 'error'); return; }
  pushHistory();
  const newSegs = [];
  for (const seg of segments) {
    if (cutS > seg.s) newSegs.push({ s: seg.s, e: Math.min(cutS, seg.e) });
    if (cutE < seg.e) newSegs.push({ s: Math.max(cutE, seg.s), e: seg.e });
  }
  segments = newSegs.filter(s => s.e - s.s > 0.05);
  if (segments.length === 0) { doUndo(); toast('Cannot cut everything', 'error'); return; }

  times.s = 0; times.e = times.duration;
  document.getElementById('tc-start').textContent = fmtTime(0);
  document.getElementById('tc-end').textContent   = fmtTime(times.duration);
  document.getElementById('tc-start').classList.add('muted');
  document.getElementById('tc-end').classList.add('muted');
  updateTrimBar();
  player.currentTime = Math.min(cutE + 0.05, times.duration - 0.1);
  updateSegmentDisplay(); updateSummary();
  document.getElementById('undo-btn').disabled = false;
  const kept = segments.reduce((a, s) => a + (s.e - s.s), 0);
  announce(`Cut from ${fmtTime(cutS)} to ${fmtTime(cutE)}. ${fmtTime(kept)} remaining. Ctrl+Z to undo.`);
  toast('Cut applied ✂', 'info');
}

// ── UNIFIED UNDO ──────────────────────────────────────────────
// Captures a full snapshot of all editable state.
function pushHistory() {
  editHistory.push({
    segments:     JSON.parse(JSON.stringify(segments)),
    times:        { ...times },
    assets:       { ...assets },
    sfxStack:     sfxStack.map(i => ({ ...i })),
    bgmStack:     bgmStack.map(i => ({ ...i })),
    illuStack:    illuStack.map(i => ({ ...i })),
    brollStack:   brollStack.map(i => ({ ...i })),
    logoPosition,
    audioProcessing,
    aspect,
    preset,
  });
  document.getElementById('undo-btn').disabled = false;
}

function doUndo() {
  if (editHistory.length === 0) { announce('Nothing to undo.'); return; }
  const prev = editHistory.pop();

  segments        = prev.segments;
  times           = { ...prev.times };
  assets          = { ...prev.assets };
  sfxStack        = prev.sfxStack.map(i => ({ ...i, audio: sfxStack.find(s => s.id === i.id)?.audio || new Audio() }));
  bgmStack        = prev.bgmStack.map(i => ({ ...i, audio: bgmStack.find(b => b.id === i.id)?.audio || new Audio() }));
  illuStack       = prev.illuStack.map(i => ({ ...i, el: illuStack.find(il => il.id === i.id)?.el || null })).filter(i => i.el);
  brollStack      = prev.brollStack.map(i => ({ ...i, video: brollStack.find(b => b.id === i.id)?.video || null })).filter(i => i.video);
  logoPosition    = prev.logoPosition;
  audioProcessing = prev.audioProcessing;
  aspect          = prev.aspect;
  preset          = prev.preset || preset;

  document.getElementById('tc-start').textContent = fmtTime(times.s);
  document.getElementById('tc-end').textContent   = fmtTime(times.e);
  document.getElementById('tc-start').classList.remove('muted');
  document.getElementById('tc-end').classList.remove('muted');

  updateTrimBar(); updateSegmentDisplay(); updateSummary();
  renderSfxStack(); renderBgmStack(); renderIlluStack(); renderBrollStack();
  renderSfxMarkers();
  syncSingleAssetUI();
  setAspect(aspect);
  setPreset(preset);

  document.getElementById('undo-btn').disabled = editHistory.length === 0;
  announce(`Undo applied. ${segments.length} segment${segments.length > 1 ? 's' : ''} restored.`);
  toast('Undo ✓', 'info');
}

// ── KEYBOARD SHORTCUTS ─────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
  const k    = e.key.toLowerCase();
  const ctrl = e.ctrlKey || e.metaKey;

  // Layer uploads
  if (ctrl && k === 'l') { e.preventDefault(); triggerLayer('logo'); announce('Opening logo upload.'); return; }
  if (ctrl && k === 'i') { e.preventDefault(); triggerAddIllu(); announce('Opening illustration upload.'); return; }
  if (ctrl && k === 'b') { e.preventDefault(); triggerAddBGM(); announce('Opening BGM upload.'); return; }
  if (ctrl && k === 'f') { e.preventDefault(); triggerAddSFX(); announce('Opening SFX upload.'); return; }
  if (ctrl && k === 'r') { e.preventDefault(); triggerAddBRoll(); announce('Opening B-Roll upload.'); return; }
  if (ctrl && k === 'u') { e.preventDefault(); triggerLayer('audioSwap'); announce('Opening audio swap upload.'); return; }

  // BGM Music Focus keyboard control — only when a track is focused AND video is not playing
  // M = play/pause focused BGM · [ = nudge startAt -1s · ] = nudge startAt +1s
  // Shift+[ / Shift+] = nudge ±5s
  // This does NOT intercept Space so video playback always works normally.
  if (focusedBgmId && bgmStack.length > 0) {
    if (k === 'm' && !ctrl) {
      e.preventDefault();
      toggleBgmPlayback(focusedBgmId);
      return;
    }
    if (k === '[' && !ctrl) {
      e.preventDefault();
      nudgeBgmStartAt(focusedBgmId, e.shiftKey ? -5 : -1);
      return;
    }
    if (k === ']' && !ctrl) {
      e.preventDefault();
      nudgeBgmStartAt(focusedBgmId, e.shiftKey ? 5 : 1);
      return;
    }
  }

  // Undo
  if (ctrl && !e.shiftKey && k === 'z') { e.preventDefault(); doUndo(); return; }

  // Export
  if (ctrl && k === 'x') { e.preventDefault(); runExport(); return; }

  // Silence detection
  if (ctrl && k === 'd') { e.preventDefault(); detectSilence(); return; }

  // SFX nudge: Shift+Ctrl+Arrow = ±0.1s
  if (ctrl && e.shiftKey && (k === 'arrowleft' || k === 'arrowright')) {
    e.preventDefault();
    nudgeSelectedSfx(k === 'arrowleft' ? -0.1 : 0.1);
    return;
  }

  // Playback
  if (k === 's' && !ctrl) { e.preventDefault(); document.getElementById('btn-set-start').click(); }
  if (k === 'e' && !ctrl) { e.preventDefault(); document.getElementById('btn-set-end').click(); }
  if (k === ' ')           { e.preventDefault(); if (!mainVideoFile) return; const m = activeMedia(); m.paused ? m.play() : m.pause(); }
  if (k === 'v' && !ctrl) { setStatus(`Current: ${fmtTime(activeMedia().currentTime)}  In: ${fmtTime(times.s)}  Out: ${fmtTime(times.e)}`); }
  if (k === 'z' && !ctrl) { e.preventDefault(); cycleZoom(); }
  if (k === 'backspace')   { e.preventDefault(); cutSegment(); }

  if (k === 'arrowleft' || k === 'arrowright') {
    if (!mainVideoFile || ctrl) return;
    e.preventDefault();
    const step = e.shiftKey ? 1 : 10;
    const dir  = k === 'arrowleft' ? -1 : 1;
    const m = activeMedia();
    m.currentTime = Math.max(0, Math.min(times.duration, m.currentTime + dir * step));
    playScrubSnippet(m.currentTime);
    announce(`${step}s ${dir > 0 ? 'forward' : 'back'}. Now at ${fmtTime(m.currentTime)}.`);
  }
});

// ── HELPERS ───────────────────────────────────────────────────
function updateTimecodes() {
  document.getElementById('tc-start').textContent   = fmtTime(times.s);
  document.getElementById('tc-end').textContent     = fmtTime(times.e);
  document.getElementById('tc-current').textContent = fmtTime(activeMedia().currentTime);
}

function updateSummary() {
  const hasAnyLayer = !!assets.logo || !!assets.audioSwap ||
    sfxStack.length > 0 || bgmStack.length > 0 || illuStack.length > 0 || brollStack.length > 0;
  const hasCuts   = segments.length > 1;
  const copyMode  = !hasAnyLayer && !hasCuts && segments.length === 1;

  const layerParts = [];
  if (assets.logo)           layerParts.push('logo');
  if (illuStack.length > 0)  layerParts.push(`${illuStack.length} illus`);
  if (bgmStack.length > 0)   layerParts.push(`${bgmStack.length} BGM`);
  if (sfxStack.length > 0)   layerParts.push(`${sfxStack.length} SFX`);
  if (brollStack.length > 0) layerParts.push(`${brollStack.length} B-Roll`);
  if (assets.audioSwap)      layerParts.push('audioSwap');

  const aspectLabels = { landscape:'16:9 Landscape', portrait:'9:16 Portrait', 'blur-bg':'Blur BG' };
  document.getElementById('summary-mode').textContent   = 'Mode: ' + (copyMode ? '⚡ Fast Copy' : '🔧 Re-encode');
  document.getElementById('summary-aspect').textContent = 'Format: ' + (aspectLabels[aspect] || aspect);
  document.getElementById('summary-layers').textContent = 'Layers: ' + (layerParts.join(', ') || 'none');
  if (times.duration > 0) {
    document.getElementById('summary-trim').textContent = `Trim: ${fmtTime(times.s)} → ${fmtTime(times.e)}`;
  }
  const cutCount = segments.length - 1;
  document.getElementById('summary-cuts').textContent   = cutCount > 0 ? `Cuts: ${cutCount}` : 'Cuts: none';
  scheduleProjectAutosave();
}

function setProgress(pct, phase) {
  document.getElementById('prog-fill').style.width = pct + '%';
  document.getElementById('progress-pct').textContent = pct + '%';
  document.getElementById('progress-bar-role').setAttribute('aria-valuenow', pct);
  if (phase) document.getElementById('progress-phase').textContent = phase;
}

function getLogoOverlayExpr(pos) {
  const pad = 10;
  return {
    'top-right':    `W-w-${pad}:${pad}`,
    'top-left':     `${pad}:${pad}`,
    'bottom-right': `W-w-${pad}:H-h-${pad}`,
    'bottom-left':  `${pad}:H-h-${pad}`,
    'center':       `(W-w)/2:(H-h)/2`
  }[pos] || `W-w-${pad}:${pad}`;
}

// ── AUDIO-ONLY EXPORT ─────────────────────────────────────────
async function runAudioExport() {
  setStatus('Preparing audio export…');
  document.getElementById('progress-wrap').classList.remove('hidden');
  document.getElementById('download-result').classList.add('hidden');
  document.getElementById('export-btn').disabled = true;
  setProgress(0, 'Writing files…');

  try {
    const ext = (mainVideoFile.name.split('.').pop() || 'mp3').replace(/[^a-z0-9]/gi, '') || 'mp3';
    ffmpeg.FS('writeFile', `main.${ext}`, await fetchFile(mainVideoFile));
    for (let i = 0; i < bgmStack.length; i++) ffmpeg.FS('writeFile', `bgm${i}.mp3`, await fetchFile(bgmStack[i].file));
    for (let i = 0; i < sfxStack.length; i++) ffmpeg.FS('writeFile', `sfx${i}.mp3`, await fetchFile(sfxStack[i].file));
    setProgress(12, 'Building filter graph…');

    const seg0 = segments[0] || { s: 0, e: times.duration };
    const trimDur = Math.max(0.1, (segments[segments.length - 1]?.e || times.duration) - seg0.s);

    const args = ['-ss', seg0.s.toFixed(3), '-t', trimDur.toFixed(3), '-i', `main.${ext}`];
    for (let i = 0; i < bgmStack.length; i++) args.push('-stream_loop', '-1', '-i', `bgm${i}.mp3`);
    for (let i = 0; i < sfxStack.length; i++) args.push('-i', `sfx${i}.mp3`);

    let idx = 1;
    const bgmIdx = bgmStack.map(() => idx++);
    const sfxIdx = sfxStack.map(() => idx++);

    const muteMain = audioProcessing === 'mute';
    const filterParts = [`[0:a]volume=${muteMain ? 0 : 1.0}[main]`];
    const mixLabels = ['[main]'];

    bgmStack.forEach((item, i) => {
      const delayMs = Math.max(0, Math.round((item.startAt - seg0.s) * 1000));
      filterParts.push(`[${bgmIdx[i]}:a]adelay=${delayMs}|${delayMs},atrim=duration=${trimDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=${(item.volume/100).toFixed(2)}[abgm${i}]`);
      mixLabels.push(`[abgm${i}]`);
    });
    sfxStack.forEach((item, i) => {
      const delayMs = Math.max(0, Math.round((item.at - seg0.s) * 1000));
      filterParts.push(`[${sfxIdx[i]}:a]adelay=${delayMs}|${delayMs},atrim=duration=${trimDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=${(item.volume/100).toFixed(2)}[asfx${i}]`);
      mixLabels.push(`[asfx${i}]`);
    });

    let mapArg;
    if (mixLabels.length > 1) {
      filterParts.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=1[aout]`);
      mapArg = '[aout]';
    } else {
      mapArg = '[main]';
    }

    ffmpeg.setProgress(({ ratio }) => {
      const pct = Math.min(97, Math.round(15 + ratio * 82));
      setProgress(pct, `Encoding audio… ${pct}%`);
    });

    await ffmpeg.run(
      ...args,
      '-filter_complex', filterParts.join(';'),
      '-map', mapArg,
      '-c:a', 'libmp3lame', '-q:a', '2',
      'output.mp3'
    );

    setProgress(100, 'Done!');
    const data = ffmpeg.FS('readFile', 'output.mp3');
    const blob = new Blob([data.buffer], { type: 'audio/mpeg' });
    const url  = URL.createObjectURL(blob);
    const rawName = (document.getElementById('project-name').value || 'tech-house').trim();
    const safeName = rawName.replace(/[^a-zA-Z0-9_\-. ]/g, '').replace(/\s+/g, '-') || 'tech-house';
    const dlLink = document.getElementById('download-link');
    dlLink.href = url;
    dlLink.download = `${safeName}.mp3`;
    document.getElementById('download-result').classList.remove('hidden');
    dlLink.focus();
    try { dlLink.click(); } catch (_) {}

    const filesToClean = [`main.${ext}`, 'output.mp3'];
    for (let i = 0; i < bgmStack.length; i++) filesToClean.push(`bgm${i}.mp3`);
    for (let i = 0; i < sfxStack.length; i++) filesToClean.push(`sfx${i}.mp3`);
    filesToClean.forEach(f => { try { ffmpeg.FS('unlink', f); } catch (_) {} });

    setStatus(`Export complete — ${safeName}.mp3`);
    announce('Audio export complete. Download button focused.');
    toast('Audio export complete ✓', 'success');
  } catch (err) {
    console.error('[AUDIO EXPORT ERROR]', err);
    setStatus('Audio export failed: ' + (err.message || String(err)), true);
    toast('Audio export failed — see console', 'error');
  } finally {
    document.getElementById('export-btn').disabled = false;
    setTimeout(() => document.getElementById('progress-wrap').classList.add('hidden'), 1200);
  }
}

// ── MASTER EXPORT ENGINE ──────────────────────────────────────
async function runExport() {
  if (!mainVideoFile) { toast('No media loaded', 'error'); return; }
  if (!engineReady)   { toast('Engine not ready', 'error'); return; }

  // Audio-only projects export to MP3 through a dedicated, simpler path.
  if (mediaKind === 'audio') { return runAudioExport(); }

  setStatus('Preparing export…');
  document.getElementById('progress-wrap').classList.remove('hidden');
  document.getElementById('download-result').classList.add('hidden');
  document.getElementById('export-btn').disabled = true;
  setProgress(0, 'Writing files…');

  const useCrossfade = document.getElementById('crossfade-toggle').checked;

  try {
    ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(mainVideoFile));
    setProgress(8, 'Building filter graph…');

    const hasLogo      = !!assets.logo;
    const hasAudioSwap = !!assets.audioSwap;
    const noiseMode    = audioProcessing === 'noise';
    const muteMode     = audioProcessing === 'mute';
    // 'none' = keep original audio, no processing
    const noiseStrength = parseInt(document.getElementById('noise-strength')?.value || '3', 10);
    const hasBgm       = bgmStack.length > 0;
    const hasSfx       = sfxStack.length > 0;
    const hasIllu      = illuStack.length > 0;
    const hasBroll     = brollStack.length > 0;
    const hasCuts      = segments.length > 1;
    const hasAnyAsset  = hasLogo || hasAudioSwap || hasBgm || hasSfx || hasIllu || hasBroll || noiseMode || muteMode;

    // ── FAST COPY ──────────────────────────────────────────
    if (!hasAnyAsset && !hasCuts && segments.length === 1) {
      const seg = segments[0];
      setProgress(15, 'Stream copying…');
      ffmpeg.setProgress(({ ratio }) => setProgress(15 + Math.min(80, Math.round(ratio * 80)), 'Copying…'));
      await ffmpeg.run(
        '-ss', seg.s.toFixed(3), '-t', (seg.e - seg.s).toFixed(3), '-i', 'input.mp4',
        '-c', 'copy', '-movflags', '+faststart', 'output.mp4'
      );
    } else {
      // ── FULL RE-ENCODE ─────────────────────────────────
      setProgress(10, 'Building filter graph…');

      // Write assets
      if (hasLogo)      ffmpeg.FS('writeFile', 'logo.png',  await fetchFile(assets.logo));
      if (hasAudioSwap) ffmpeg.FS('writeFile', 'swap.mp3',  await fetchFile(assets.audioSwap));
      for (let i = 0; i < bgmStack.length; i++)   ffmpeg.FS('writeFile', `bgm${i}.mp3`,   await fetchFile(bgmStack[i].file));
      for (let i = 0; i < sfxStack.length; i++)   ffmpeg.FS('writeFile', `sfx${i}.mp3`,   await fetchFile(sfxStack[i].file));
      for (let i = 0; i < illuStack.length; i++)  ffmpeg.FS('writeFile', `illu${i}.png`,  await fetchFile(illuStack[i].file));
      for (let i = 0; i < brollStack.length; i++) ffmpeg.FS('writeFile', `broll${i}.mp4`, await fetchFile(brollStack[i].file));

      // Detect video audio
      const videoHasAudio = player.mozHasAudio !== undefined ? player.mozHasAudio
        : player.webkitAudioDecodedByteCount !== undefined ? player.webkitAudioDecodedByteCount > 0 : true;

      // Build args
      let args = [];
      if (hasCuts) {
        args = ['-i', 'input.mp4'];
      } else {
        const seg = segments[0];
        args = ['-ss', seg.s.toFixed(3), '-t', (seg.e - seg.s).toFixed(3), '-i', 'input.mp4'];
      }

      if (hasLogo)      args.push('-i', 'logo.png');
      for (let i = 0; i < illuStack.length; i++)  args.push('-i', `illu${i}.png`);
      for (let i = 0; i < bgmStack.length; i++)   args.push('-stream_loop', '-1', '-i', `bgm${i}.mp3`);
      for (let i = 0; i < sfxStack.length; i++)   args.push('-i', `sfx${i}.mp3`);
      if (hasAudioSwap) args.push('-stream_loop', '-1', '-i', 'swap.mp3');
      for (let i = 0; i < brollStack.length; i++) args.push('-i', `broll${i}.mp4`);

      // Index assignment
      let idx = 1;
      const logoIdx   = hasLogo      ? idx++ : -1;
      const illuIdx   = illuStack.map(() => idx++);
      const bgmIdx    = bgmStack.map(() => idx++);
      const sfxIdx    = sfxStack.map(() => idx++);
      const swapIdx   = hasAudioSwap ? idx++ : -1;
      const brollIdx  = brollStack.map(() => idx++);

      // Filter chain
      let filterParts = [];
      let vTag;

      if (hasCuts) {
        // ── Multi-segment concat (handles all cuts including auto-silence) ──
        // IMPORTANT: FFmpeg concat filter requires inputs interleaved as:
        //   [v0][a0][v1][a1]...concat=n=N:v=1:a=1
        // NOT all-video then all-audio. This was the bug causing silent failure.
        const concatInputs = []; // interleaved: v0,a0,v1,a1,...
        const hasAudio     = videoHasAudio && !muteMode;
        const aLabelsList  = [];

        segments.forEach((seg, i) => {
          let scaleF;
          if (aspect === 'portrait') {
            scaleF = `scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280`;
          } else if (aspect === 'blur-bg') {
            // For blur-bg with cuts we scale to portrait size; blur applied post-concat
            scaleF = `scale=720:1280`;
          } else {
            scaleF = `scale=1280:720`;
          }
          filterParts.push(`[0:v]trim=${seg.s.toFixed(3)}:${seg.e.toFixed(3)},setpts=PTS-STARTPTS,${scaleF}[vs${i}]`);
          concatInputs.push(`[vs${i}]`);

          if (hasAudio) {
            let af = `[0:a]atrim=${seg.s.toFixed(3)}:${seg.e.toFixed(3)},asetpts=PTS-STARTPTS`;
            if (useCrossfade && i > 0)                    af += `,afade=t=in:st=0:d=0.1`;
            if (useCrossfade && i < segments.length - 1)  af += `,afade=t=out:st=${Math.max(0, seg.e-seg.s-0.1).toFixed(2)}:d=0.1`;
            filterParts.push(`${af}[as${i}]`);
            concatInputs.push(`[as${i}]`);
            aLabelsList.push(`[as${i}]`);
          }
        });

        const n = segments.length;
        const concatStr = concatInputs.join('');
        if (hasAudio) {
          filterParts.push(`${concatStr}concat=n=${n}:v=1:a=1[vconcat][aconcat]`);
          vTag = '[vconcat]';
          aTag = '[aconcat]'; // aconcat is a filter output label
        } else {
          filterParts.push(`${concatStr}concat=n=${n}:v=1:a=0[vconcat]`);
          vTag = '[vconcat]';
          aTag = null;
        }

        // Apply blur-bg post-concat if needed
        if (aspect === 'blur-bg') {
          filterParts.push(`${vTag}split[bgraw][sharpraw]`);
          filterParts.push(`[bgraw]scale=1280:720,boxblur=20:6,setsar=1[bgblur]`);
          filterParts.push(`[bgblur][sharpraw]overlay=(W-w)/2:0[vblur]`);
          vTag = '[vblur]';
        }

      } else {
        // Single segment
        const seg = segments[0];
        if (aspect === 'portrait') {
          filterParts.push(`[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280[v0]`);
        } else if (aspect === 'blur-bg') {
          // Blurred background: scale original to fill 1280×720 with heavy blur,
          // then overlay the sharp portrait-cropped video centred on it
          filterParts.push(`[0:v]scale=1280:720,boxblur=20:6,setsar=1[bg]`);
          filterParts.push(`[0:v]scale=-2:720[sharp]`);
          filterParts.push(`[bg][sharp]overlay=(W-w)/2:0[v0]`);
        } else {
          filterParts.push(`[0:v]scale=1280:720[v0]`);
        }
        vTag = '[v0]';
      }

      // Logo overlay
      if (hasLogo) {
        filterParts.push(`[${logoIdx}:v]scale=120:-2,format=rgba[vlogo]`);
        filterParts.push(`${vTag}[vlogo]overlay=${getLogoOverlayExpr(logoPosition)}[vL]`);
        vTag = '[vL]';
      }

      // Illustration overlays (each on top of previous)
      illuStack.forEach((item, i) => {
        const t0    = Math.max(0, item.at - (hasCuts ? 0 : segments[0].s)).toFixed(2);
        const t1    = (parseFloat(t0) + item.duration).toFixed(2);
        const enable = `enable='between(t,${t0},${t1})'`;
        let scaleI, overlayE;
        switch (item.layout) {
          case 'fullscreen': scaleI = `scale=1280:720,format=rgba`; overlayE = `0:0`; break;
          case 'left-third': scaleI = `scale=426:-2,format=rgba`; overlayE = `0:(H-h)/2`; break;
          case 'right-third': scaleI = `scale=426:-2,format=rgba`; overlayE = `W-w:(H-h)/2`; break;
          default: scaleI = `scale=576:-2,format=rgba`; overlayE = `(W-w)/2:(H-h)/2`;
        }
        filterParts.push(`[${illuIdx[i]}:v]${scaleI}[vi${i}]`);
        filterParts.push(`${vTag}[vi${i}]overlay=${overlayE}:${enable}[vI${i}]`);
        vTag = `[vI${i}]`;
      });

      // B-Roll overlay (each layer on top, with layout support)
      brollStack.forEach((item, i) => {
        const t0     = Math.max(0, item.at - (hasCuts ? 0 : segments[0].s)).toFixed(2);
        const t1     = (parseFloat(t0) + item.duration).toFixed(2);
        const enable = `enable='between(t,${t0},${t1})'`;
        let scaleB, overlayB;
        switch (item.layout || 'fullscreen') {
          case 'left-third':
            scaleB   = `scale=426:-2,format=yuv420p`;
            overlayB = `0:(H-h)/2`; break;
          case 'right-third':
            scaleB   = `scale=426:-2,format=yuv420p`;
            overlayB = `W-w:(H-h)/2`; break;
          case 'center':
            scaleB   = `scale=576:-2,format=yuv420p`;
            overlayB = `(W-w)/2:(H-h)/2`; break;
          default: // fullscreen
            scaleB   = `scale=1280:720,format=yuv420p`;
            overlayB = `0:0`;
        }
        filterParts.push(`[${brollIdx[i]}:v]${scaleB}[vb${i}]`);
        filterParts.push(`${vTag}[vb${i}]overlay=${overlayB}:${enable}[vB${i}]`);
        vTag = `[vB${i}]`;
      });

      // Audio chain
      let aTag = null;
      const seg0    = hasCuts ? null : segments[0];
      const trimDur = seg0 ? (seg0.e - seg0.s) : segments.reduce((a,s) => a + (s.e - s.s), 0);

      if (muteMode) {
        aTag = null;
      } else if (noiseMode && videoHasAudio) {
        // anlmdn noise removal — strength 1–10 mapped to s parameter (1=0.001, 10=0.015)
        // s controls the denoising strength. Higher = more aggressive but may sound robotic.
        const noiseInput = hasCuts ? '[aconcat]' : '[0:a]';
        const s = (noiseStrength * 0.0015).toFixed(4);        // 0.0015 – 0.015
        const p = (noiseStrength * 0.0003).toFixed(4);        // 0.0003 – 0.003
        filterParts.push(`${noiseInput}anlmdn=s=${s}:p=${p}:r=${p}:m=15[anoise]`);
        aTag = '[anoise]';
      } else if (hasAudioSwap) {
        filterParts.push(`[${swapIdx}:a]atrim=duration=${trimDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=1.0[aswap]`);
        aTag = '[aswap]';
      } else if (hasCuts && videoHasAudio) {
        // [aconcat] already produced by concat filter above
        aTag = '[aconcat]';
      } else if (!hasCuts && videoHasAudio) {
        aTag = '0:a'; // direct stream reference (no brackets = stream specifier)
      } else {
        aTag = null;
      }

      // Mix BGM tracks — use duration=longest so BGM can extend beyond video
      if (hasBgm) {
        // Wrap current aTag into a labeled stream for mixing
        let mainALabel = null;
        if (aTag === '0:a') {
          filterParts.push(`[0:a]volume=1.0[amain]`);
          mainALabel = '[amain]';
        } else if (aTag && aTag !== null) {
          // Already a label like [aconcat], [anoise], [aswap]
          mainALabel = aTag;
        }

        const mixInputs = mainALabel ? [mainALabel] : [];

        bgmStack.forEach((item, i) => {
          const startMs = Math.round(item.startAt * 1000);
          // atrim duration = trimDur + extra time for BGM to continue
          // We use a generous duration so BGM isn't cut short
          const bgmDur = Math.max(trimDur, trimDur + 30); // allow up to 30s extension
          filterParts.push(`[${bgmIdx[i]}:a]atrim=duration=${bgmDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=${(item.volume/100).toFixed(2)},adelay=${startMs}|${startMs}[abgm${i}]`);
          mixInputs.push(`[abgm${i}]`);
        });

        if (mixInputs.length === 1) {
          // Only BGM, no main audio
          filterParts.push(`${mixInputs[0]}acopy[amixed]`);
        } else {
          // duration=longest lets BGM extend beyond the video if needed
          filterParts.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=2[amixed]`);
        }
        aTag = '[amixed]';
      }

      // Mix SFX
      if (hasSfx && aTag !== null) {
        // Wrap current aTag for mixing
        let sfxBaseLabel = aTag;
        if (aTag === '0:a') {
          filterParts.push(`[0:a]volume=1.0[apre]`);
          sfxBaseLabel = '[apre]';
        }
        const sfxLabels = [sfxBaseLabel];
        sfxStack.forEach((item, i) => {
          const delayMs = Math.max(0, Math.round((item.at - (seg0 ? seg0.s : 0)) * 1000));
          filterParts.push(`[${sfxIdx[i]}:a]adelay=${delayMs}|${delayMs},atrim=duration=${trimDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=${(item.volume/100).toFixed(2)}[asfx${i}]`);
          sfxLabels.push(`[asfx${i}]`);
        });
        filterParts.push(`${sfxLabels.join('')}amix=inputs=${sfxLabels.length}:duration=first:dropout_transition=1[afinal]`);
        aTag = '[afinal]';
      }

      const filterComplex = filterParts.join(';');
      ffmpeg.setProgress(({ ratio }) => {
        const pct = Math.min(97, Math.round(15 + ratio * 82));
        setProgress(pct, `Encoding… ${pct}%`);
        if (pct === 40 || pct === 70) announce(`Export ${pct}% complete.`);
      });

      // aTag is either:
      //   '0:a'   → direct stream specifier (no brackets) — use -map 0:a
      //   '[xxx]' → filter output label — use -map [xxx]
      //   null    → no audio output
      let audioArgs = [];
      if (aTag === '0:a') {
        audioArgs = ['-map', '0:a', '-c:a', 'aac', '-b:a', '192k'];
      } else if (aTag) {
        audioArgs = ['-map', aTag, '-c:a', 'aac', '-b:a', '192k'];
      }
      await ffmpeg.run(
        ...args,
        '-filter_complex', filterComplex,
        '-map', vTag,
        ...audioArgs,
        '-c:v', 'libx264', '-preset', preset, '-crf', '22',
        '-movflags', '+faststart', 'output.mp4'
      );
    }

    // ── Download ──────────────────────────────────────────────
    setProgress(100, 'Done!');
    const data    = ffmpeg.FS('readFile', 'output.mp4');
    const blob    = new Blob([data.buffer], { type: 'video/mp4' });
    const url     = URL.createObjectURL(blob);
    const rawName = (document.getElementById('project-name').value || 'tech-house').trim();
    const safeName = rawName.replace(/[^a-zA-Z0-9_\-. ]/g, '').replace(/\s+/g, '-') || 'tech-house';
    const dlLink  = document.getElementById('download-link');
    dlLink.href     = url;
    dlLink.download = `${safeName}.mp4`;
    document.getElementById('download-result').classList.remove('hidden');
    dlLink.focus();
    try { dlLink.click(); } catch (_) {}

    // Cleanup
    const filesToClean = ['input.mp4','logo.png','swap.mp3','output.mp4'];
    for (let i = 0; i < bgmStack.length; i++)   filesToClean.push(`bgm${i}.mp3`);
    for (let i = 0; i < sfxStack.length; i++)   filesToClean.push(`sfx${i}.mp3`);
    for (let i = 0; i < illuStack.length; i++)  filesToClean.push(`illu${i}.png`);
    for (let i = 0; i < brollStack.length; i++) filesToClean.push(`broll${i}.mp4`);
    filesToClean.forEach(f => { try { ffmpeg.FS('unlink', f); } catch (_) {} });

    setStatus(`Export complete — ${safeName}.mp4`);
    announce('Export complete. Download button focused.');
    toast('Export complete ✓', 'success');

  } catch (err) {
    console.error('[EXPORT ERROR]', err);
    setStatus('Export failed: ' + (err.message || String(err)), true);
    toast('Export failed — see console', 'error');
  } finally {
    document.getElementById('progress-wrap').classList.add('hidden');
    document.getElementById('export-btn').disabled = false;
    setProgress(0, 'Preparing…');
  }
}
