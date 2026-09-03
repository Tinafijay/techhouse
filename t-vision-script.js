const API_ENDPOINT = "/api/vision";
const ASK_API_ENDPOINT = "/api/gemini";
const FACE_STORAGE_KEY = "tvision_enrolled_faces";
const SETTINGS_STORAGE_KEY = "tvision_settings";

const DEFAULT_SETTINGS = {
    voice: true,
    tones: true,
    vibrate: true,
    rate: 1.1,
    pitch: 1.0,
    depthThreshold: 0.55,
    faceMatch: 0.82,
    frameInterval: 1000,
    askSpeak: true,
    askRemember: true
};

let FACE_MATCH_THRESHOLD = DEFAULT_SETTINGS.faceMatch;
let DEPTH_NEAR_THRESHOLD = DEFAULT_SETTINGS.depthThreshold;
let FRAME_INTERVAL_MS = DEFAULT_SETTINGS.frameInterval;

const AUDIO_SAMPLE_RATE = 16000;
const AUDIO_PLAYBACK_RATE = 24000;
const NEAR_FT_ESTIMATE = 3;
const WS_RECONNECT_BACKOFF_MS = [1000, 2500, 5000, 10000];
const RECONNECT_KEY = "tvision_ws_reconnect_arm";

const video = document.getElementById("webcam");
const textBox = document.getElementById("ai-text");
const scanner = document.getElementById("scanner");
const scanBtn = document.getElementById("scan-btn");
const liveBtn = document.getElementById("live-btn");
const muteBtn = document.getElementById("mute-btn");
const statusMsg = document.getElementById("status-msg");
const modeIndicator = document.getElementById("mode-indicator");
const modeLabel = modeIndicator.querySelector(".tvision-mode-label");
const obstacleBanner = document.getElementById("obstacle-banner");
const depthCanvas = document.getElementById("depth-canvas");
const zoneOverlay = document.getElementById("zone-overlay");
const zoneEls = {
    left: zoneOverlay.querySelector('[data-zone="left"]'),
    center: zoneOverlay.querySelector('[data-zone="center"]'),
    right: zoneOverlay.querySelector('[data-zone="right"]')
};

const tabs = Array.from(document.querySelectorAll(".tvision-tab"));
const panels = {
    home: document.getElementById("tab-home"),
    ask: document.getElementById("tab-ask"),
    settings: document.getElementById("tab-settings")
};

const enrollNameInput = document.getElementById("enroll-name");
const enrollBtn = document.getElementById("enroll-btn");
const enrollClearBtn = document.getElementById("enroll-clear-btn");
const enrollStatus = document.getElementById("enroll-status");
const enrolledList = document.getElementById("enrolled-list");
const enrollFileInput = document.getElementById("enroll-file");
const enrollFilePreview = document.getElementById("enroll-file-preview");

const askFileInput = document.getElementById("ask-file");
const askFilePreview = document.getElementById("ask-file-preview");
const askCurrent = document.getElementById("ask-current");
const askQuestion = document.getElementById("ask-question");
const askBtn = document.getElementById("ask-btn");
const askStatus = document.getElementById("ask-status");
const askResult = document.getElementById("ask-result");
const askFollowup = document.getElementById("ask-followup");
const askFollowupBtn = document.getElementById("ask-followup-btn");

const settingVoice = document.getElementById("setting-voice");
const settingTones = document.getElementById("setting-tones");
const settingVibrate = document.getElementById("setting-vibrate");
const settingRate = document.getElementById("setting-rate");
const settingRateValue = document.getElementById("setting-rate-value");
const settingPitch = document.getElementById("setting-pitch");
const settingPitchValue = document.getElementById("setting-pitch-value");
const settingDepth = document.getElementById("setting-depth");
const settingDepthValue = document.getElementById("setting-depth-value");
const settingMatch = document.getElementById("setting-match");
const settingMatchValue = document.getElementById("setting-match-value");
const settingFrame = document.getElementById("setting-frame");
const settingFrameValue = document.getElementById("setting-frame-value");
const settingAskSpeak = document.getElementById("setting-ask-speak");
const settingAskRemember = document.getElementById("setting-ask-remember");
const settingExport = document.getElementById("setting-export");
const settingImport = document.getElementById("setting-import");
const settingImportFile = document.getElementById("setting-import-file");
const settingClearFaces = document.getElementById("setting-clear-faces");
const settingsStatus = document.getElementById("settings-status");

const state = {
    isMuted: true,
    isLive: false,
    lastDetectedFace: null,
    lastUnknownFaceDescriptor: null,
    lastFaceDescription: "",
    obstacleAlert: null,
    zoneAlerts: { left: null, center: null, right: null },
    audioContext: null,
    liveSocket: null,
    mediaStream: null,
    audioProcessor: null,
    audioWorkletNode: null,
    audioSourceNode: null,
    frameTimer: null,
    faceLandmarker: null,
    depthEstimator: null,
    depthDevice: "webgpu",
    lastObstacleSpoken: 0,
    lastFaceSpoken: 0,
    lastZoneSpoken: { left: 0, center: 0, right: 0 },
    videoFrameCanvas: null,
    videoFrameCtx: null,
    lastFrameJpeg: null,
    localLoopTimer: null,
    wakeLock: null,
    liveWatchdogTimer: null,
    reconnectAttempts: 0,
    intentionalClose: false,
    activeTab: "home",
    settings: { ...DEFAULT_SETTINGS },
    enrollSource: "live",
    askSource: "live",
    enrollFileData: null,
    askFileData: null,
    askHistory: []
};

let ws = null;
let audioPlaybackCtx = null;
let nextPlaybackTime = 0;
let liveFrameCount = 0;
let liveAudioChunkCount = 0;
let liveLastFrameAt = 0;

function setText(message) { textBox.textContent = message; }
function setStatus(message) { statusMsg.textContent = message; }
function setMode(mode) {
    const muted = mode === "navigation";
    const wasMuted = state.isMuted;
    state.isMuted = muted;
    modeIndicator.dataset.mode = mode;
    modeLabel.textContent = muted ? "Navigation Mode (Muted)" : "Conversational Mode (Live)";
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.querySelector(".tvision-mute-label").textContent = muted ? "Unmute Mic (Space)" : "Mute Mic (Space)";
    muteBtn.querySelector(".tvision-mute-icon").textContent = muted ? "🔇" : "🎤";
    if (wasMuted !== muted && state.isLive) updateLiveStreaming();
}

function vibrate(pattern) {
    if (state.settings.vibrate && state.isMuted && navigator.vibrate) {
        try { navigator.vibrate(pattern || [60, 40, 60]); } catch (_) {}
    }
}

async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
        state.wakeLock = await navigator.wakeLock.request("screen");
        state.wakeLock.addEventListener("release", () => {
            state.wakeLock = null;
            if (state.isLive) requestWakeLock();
        });
    } catch (_) { state.wakeLock = null; }
}
function releaseWakeLock() {
    if (state.wakeLock) {
        try { state.wakeLock.release(); } catch (_) {}
        state.wakeLock = null;
    }
}
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.isLive && !state.wakeLock) {
        requestWakeLock();
    }
});

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                channelCount: 1,
                sampleRate: AUDIO_SAMPLE_RATE,
                autoGainControl: true
            }
        });
        state.mediaStream = stream;
        video.srcObject = stream;
        state.videoFrameCanvas = document.createElement("canvas");
        state.videoFrameCtx = state.videoFrameCanvas.getContext("2d");
    } catch (err) {
        setText("Camera/mic permission denied. T Vision needs camera access to detect obstacles and faces. Please allow access and reload.");
        setStatus("Permissions blocked");
        speak("Camera and microphone access are required. Please grant permission and reload the page.");
    }
}

function speak(text, opts) {
    if (!state.settings.voice || !("speechSynthesis" in window) || !text) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.rate = (opts && opts.rate) || state.settings.rate;
    u.pitch = (opts && opts.pitch) || state.settings.pitch;
    u.volume = (opts && opts.volume != null) ? opts.volume : 1.0;
    if (opts && opts.urgent) { u.rate = Math.max(0.9, state.settings.rate + 0.2); u.pitch = Math.min(1.4, state.settings.pitch + 0.2); }
    synth.speak(u);
}

function playTone(freq, durationMs) {
    if (!state.settings.tones) return;
    try {
        if (!state.audioContext) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            state.audioContext = new Ctx();
        }
        const ctx = state.audioContext;
        if (ctx.state === "suspended") ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + durationMs / 1000);
    } catch (_) { /* no-op */ }
}

function snapshotJPEG(quality, sourceVideo) {
    const v = sourceVideo || video;
    const w = v.videoWidth, h = v.videoHeight;
    if (!w || !h || !state.videoFrameCtx) return null;
    if (v.readyState < 2) return null;
    state.videoFrameCanvas.width = w;
    state.videoFrameCanvas.height = h;
    state.videoFrameCtx.drawImage(v, 0, 0, w, h);
    return state.videoFrameCanvas.toDataURL("image/jpeg", quality != null ? quality : 0.7);
}

function snapshotFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const max = 1280;
            const scale = Math.min(1, max / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const c = document.createElement("canvas");
            c.width = w; c.height = h;
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0, w, h);
            resolve(c.toDataURL("image/jpeg", 0.85));
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}

function dataUrlToBase64(dataUrl) {
    if (!dataUrl) return "";
    const idx = dataUrl.indexOf(",");
    return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

async function loadEnrolledFaces() {
    try {
        const raw = localStorage.getItem(FACE_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) { return {}; }
}
function saveEnrolledFaces(map) {
    try { localStorage.setItem(FACE_STORAGE_KEY, JSON.stringify(map)); } catch (_) {}
}
function renderEnrolledList(map) {
    enrolledList.innerHTML = "";
    const names = Object.keys(map).sort();
    if (names.length === 0) {
        const li = document.createElement("li");
        li.textContent = "No faces enrolled yet";
        li.style.opacity = "0.6";
        enrolledList.appendChild(li);
        return;
    }
    names.forEach((name) => {
        const li = document.createElement("li");
        li.textContent = name;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("aria-label", `Remove ${name}`);
        btn.textContent = "✕";
        btn.addEventListener("click", () => {
            const m = loadEnrolledFaces();
            delete m[name];
            saveEnrolledFaces(m);
            renderEnrolledList(m);
            speak(`Removed ${name}.`);
        });
        li.appendChild(btn);
        enrolledList.appendChild(li);
    });
}

function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
    } catch (_) { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings() {
    try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings)); } catch (_) {}
}
function applySettingsToUI() {
    settingVoice.checked = !!state.settings.voice;
    settingTones.checked = !!state.settings.tones;
    settingVibrate.checked = !!state.settings.vibrate;
    settingRate.value = state.settings.rate;
    settingRateValue.textContent = `${state.settings.rate.toFixed(2)}x`;
    settingPitch.value = state.settings.pitch;
    settingPitchValue.textContent = `${state.settings.pitch.toFixed(2)}x`;
    settingDepth.value = state.settings.depthThreshold;
    settingDepthValue.textContent = state.settings.depthThreshold.toFixed(2);
    settingMatch.value = state.settings.faceMatch;
    settingMatchValue.textContent = state.settings.faceMatch.toFixed(2);
    settingFrame.value = state.settings.frameInterval;
    settingFrameValue.textContent = `${state.settings.frameInterval}ms`;
    settingAskSpeak.checked = !!state.settings.askSpeak;
    settingAskRemember.checked = !!state.settings.askRemember;
    FACE_MATCH_THRESHOLD = state.settings.faceMatch;
    DEPTH_NEAR_THRESHOLD = state.settings.depthThreshold;
    FRAME_INTERVAL_MS = state.settings.frameInterval;
}
function updateSettingFromInput(input) {
    const v = parseFloat(input.value);
    if (Number.isNaN(v)) return;
    if (input === settingRate) state.settings.rate = v;
    else if (input === settingPitch) state.settings.pitch = v;
    else if (input === settingDepth) state.settings.depthThreshold = v;
    else if (input === settingMatch) state.settings.faceMatch = v;
    else if (input === settingFrame) state.settings.frameInterval = v;
    FACE_MATCH_THRESHOLD = state.settings.faceMatch;
    DEPTH_NEAR_THRESHOLD = state.settings.depthThreshold;
    FRAME_INTERVAL_MS = state.settings.frameInterval;
    saveSettings();
    if (state.localLoopTimer) {
        clearInterval(state.localLoopTimer);
        state.localLoopTimer = null;
        startLocalLoop();
    }
    if (state.frameTimer) {
        clearInterval(state.frameTimer);
        state.frameTimer = null;
        if (state.isLive) {
            state.frameTimer = setInterval(sendVideoFrame, FRAME_INTERVAL_MS);
        }
    }
    applySettingsToUI();
}
function setSettingsStatus(msg, kind) {
    settingsStatus.textContent = msg;
    settingsStatus.style.color = kind === "error" ? "var(--danger)" : kind === "success" ? "var(--success)" : "var(--text-muted)";
}

function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return -1;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? -1 : dot / denom;
}

function landmarksToDescriptor(landmarks) {
    if (!landmarks || !landmarks.length) return null;
    const points = landmarks[0];
    if (!points || points.length < 10) return null;
    const leftEye = points[33], rightEye = points[263], noseTip = points[1];
    const eyeDist = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y) || 1e-6;
    const ratio = (p) => ({
        x: (p.x - noseTip.x) / eyeDist,
        y: (p.y - noseTip.y) / eyeDist,
        z: (p.z != null ? p.z - noseTip.z : 0) / eyeDist
    });
    const anchors = [points[10], points[152], points[234], points[454], points[127], points[356], points[168], points[6], points[0], points[61], points[291], points[199], points[4], points[288]];
    const vec = [];
    anchors.forEach((p) => {
        const r = ratio(p);
        vec.push(r.x, r.y, r.z);
    });
    return vec;
}

function isLowMemoryDevice() {
    const ua = (navigator.userAgent || "").toLowerCase();
    const isiPhoneOld = /\(iphone; cpu iphone os (?:9_|10_|11_|12_|13_|14_|15_)/.test(ua) || /iphone.*os\s*[789]\b/.test(ua);
    const lowDeviceData = (navigator.deviceMemory && navigator.deviceMemory <= 2);
    return isiPhoneOld || !!lowDeviceData;
}

async function initFaceLandmarker() {
    const fileset = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
    const wasmBase = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
    const modelUrl = fileset;

    setStatus("Face model: checking cache...");
    let cached = "unknown";
    try {
        if (navigator.storage && navigator.storage.estimate) {
            cached = "checking";
        }
        if (caches && caches.keys) {
            const keys = await caches.keys();
            cached = keys.length > 0 ? `${keys.length} cache(s) ready` : "no cache yet";
        }
    } catch (_) {}
    setStatus(`Face model: downloading (~5 MB)... [${cached}]`);

    const startedAt = performance.now();
    const progressTimer = setInterval(() => {
        if (state.faceLandmarker) { clearInterval(progressTimer); return; }
        const secs = Math.round((performance.now() - startedAt) / 1000);
        setStatus(`Face model: still loading (${secs}s). Tap Save Face to retry when ready.`);
    }, 4000);

    const tryCreate = async (delegate) => {
        const vision = await import("@mediapipe/tasks-vision");
        return vision.FaceLandmarker.createFromOptions(
            vision.FilesetResolver.forVisionTasks(wasmBase),
            {
                baseOptions: { modelAssetPath: modelUrl, delegate },
                runningMode: "VIDEO",
                numFaces: 3,
                outputFaceBlendshapes: true,
                outputFacialTransformationMatrixes: false
            }
        );
    };

    const delegates = ["GPU", "CPU"];
    let lastErr = null;
    for (const delegate of delegates) {
        try {
            setStatus(`Face model: initializing (${delegate})...`);
            state.faceLandmarker = await tryCreate(delegate);
            clearInterval(progressTimer);
            setStatus(`Face recognition ready (${delegate})`);
            return;
        } catch (e) {
            lastErr = e;
            console.warn(`FaceLandmarker (${delegate}) failed`, e);
            setStatus(`Face model: ${delegate} failed, trying fallback...`);
        }
    }
    clearInterval(progressTimer);
    console.warn("FaceLandmarker init failed", lastErr);
    setStatus("Face recognition unavailable. Tap Save Face to retry.");
}

async function initDepthEstimator() {
    if (isLowMemoryDevice()) {
        console.warn("Skipping depth-anything on low-memory device");
        setStatus("Depth disabled (low-memory device). Face + Live still available.");
        return;
    }
    setStatus("Depth model: downloading (~50 MB)...");
    const startedAt = performance.now();
    const progressTimer = setInterval(() => {
        if (state.depthEstimator) { clearInterval(progressTimer); return; }
        const secs = Math.round((performance.now() - startedAt) / 1000);
        setStatus(`Depth model: downloading... ${secs}s elapsed`);
    }, 5000);

    try {
        const transformers = await import("@huggingface/transformers");
        const { pipeline, env } = transformers;
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        env.backends.onnx.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/";

        const tryDevices = ["webgpu", "webgl", "wasm", "cpu"];
        let lastErr = null;
        for (const device of tryDevices) {
            try {
                state.depthEstimator = await pipeline("depth-estimation", "Xenova/depth-anything-small-hf", { device });
                state.depthDevice = device;
                clearInterval(progressTimer);
                setStatus(`Depth ready (${device})`);
                return;
            } catch (e) { lastErr = e; }
        }
        throw lastErr || new Error("No depth backend");
    } catch (e) {
        clearInterval(progressTimer);
        console.warn("Depth estimator init failed", e);
        setStatus("Depth unavailable. Face + Live still work.");
    }
}

function describeZones(centerAvg, leftAvg, rightAvg) {
    const zones = { left: null, center: null, right: null };
    if (leftAvg != null && leftAvg > DEPTH_NEAR_THRESHOLD) zones.left = "Left obstacle, less than three feet";
    if (centerAvg != null && centerAvg > DEPTH_NEAR_THRESHOLD) zones.center = `Center obstacle, about ${NEAR_FT_ESTIMATE} feet ahead`;
    if (rightAvg != null && rightAvg > DEPTH_NEAR_THRESHOLD) zones.right = "Right obstacle, less than three feet";

    state.zoneAlerts = zones;
    const overall = zones.center || zones.left || zones.right || null;
    const prevOverall = state.obstacleAlert;
    state.obstacleAlert = overall;

    zoneEls.left.classList.toggle("is-warn", !!zones.left);
    zoneEls.center.classList.toggle("is-warn", !!zones.center);
    zoneEls.right.classList.toggle("is-warn", !!zones.right);

    if (overall) {
        obstacleBanner.hidden = false;
        obstacleBanner.textContent = overall.toUpperCase();
    } else {
        obstacleBanner.hidden = true;
        obstacleBanner.textContent = "";
    }

    if (state.isMuted) {
        const now = Date.now();
        if (zones.center && now - state.lastZoneSpoken.center > 2500) {
            speak(zones.center, { urgent: true });
            playTone(880, 180);
            vibrate([80, 40, 80]);
            state.lastZoneSpoken.center = now;
        } else if (zones.left && now - state.lastZoneSpoken.left > 2500) {
            speak(zones.left, { urgent: true });
            playTone(660, 180);
            vibrate([80]);
            state.lastZoneSpoken.left = now;
        } else if (zones.right && now - state.lastZoneSpoken.right > 2500) {
            speak(zones.right, { urgent: true });
            playTone(660, 180);
            vibrate([80]);
            state.lastZoneSpoken.right = now;
        }
        if (overall && !prevOverall) {
            speak(overall, { urgent: true });
            playTone(900, 220);
            vibrate([120, 60, 120]);
        }
    }
}

async function runDepthPipeline() {
    if (!state.depthEstimator) return;
    if (video.readyState < 2) return;
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return;
    const off = document.createElement("canvas");
    off.width = 224; off.height = Math.max(1, Math.round(224 * h / w));
    const offCtx = off.getContext("2d");
    offCtx.drawImage(video, 0, 0, off.width, off.height);
    let result;
    try { result = await state.depthEstimator(off); } catch (e) { return; }
    const depth = result && (result.depth || (result.prediction && result.prediction.depth));
    if (!depth || !depth.data || !depth.width || !depth.height) return;
    const dw = depth.width, dh = depth.height;
    const ctx = depthCanvas.getContext("2d");
    depthCanvas.width = dw;
    depthCanvas.height = dh;
    const imgData = ctx.createImageData(dw, dh);
    const data = depth.data;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < data.length; i++) { const v = data[i]; if (v < min) min = v; if (v > max) max = v; }
    const range = (max - min) || 1;
    for (let i = 0; i < data.length; i++) {
        const v = (data[i] - min) / range;
        const idx = i * 4;
        const g = Math.floor(v * 255);
        imgData.data[idx] = g;
        imgData.data[idx + 1] = g;
        imgData.data[idx + 2] = g;
        imgData.data[idx + 3] = 200;
    }
    ctx.putImageData(imgData, 0, 0);

    const third = Math.floor(dw / 3);
    const avgRegion = (x0, x1) => {
        let sum = 0, count = 0;
        for (let y = 0; y < dh; y++) {
            const row = y * dw;
            for (let x = x0; x < x1; x++) {
                const v = data[row + x];
                const n = (v - min) / range;
                sum += n; count++;
            }
        }
        return count ? sum / count : 0;
    };
    const leftAvg = avgRegion(0, third);
    const centerAvg = avgRegion(third, third * 2);
    const rightAvg = avgRegion(third * 2, dw);
    describeZones(centerAvg, leftAvg, rightAvg);
}

async function runFacePipeline() {
    if (!state.faceLandmarker) return;
    if (video.readyState < 2) return;
    const now = performance.now();
    let result;
    try { result = state.faceLandmarker.detectForVideo(video, now); } catch (e) { return; }
    if (!result || !result.faceLandmarks || result.faceLandmarks.length === 0) {
        state.lastDetectedFace = null;
        state.lastUnknownFaceDescriptor = null;
        state.lastFaceDescription = "";
        return;
    }
    const enrolled = await loadEnrolledFaces();
    const descriptor = landmarksToDescriptor(result.faceLandmarks);
    if (!descriptor) return;

    let bestName = null, bestScore = -1;
    for (const name of Object.keys(enrolled)) {
        const score = cosineSimilarity(descriptor, enrolled[name].descriptor);
        if (score > bestScore) { bestScore = score; bestName = name; }
    }
    const now2 = Date.now();
    if (bestScore >= FACE_MATCH_THRESHOLD && bestName) {
        const wasNew = state.lastDetectedFace !== bestName;
        state.lastDetectedFace = bestName;
        if (state.isMuted && (wasNew || now2 - state.lastFaceSpoken > 6000)) {
            speak(`${bestName} is in front of you.`, { rate: state.settings.rate });
            playTone(520, 120);
            state.lastFaceSpoken = now2;
        }
    } else {
        state.lastDetectedFace = null;
        state.lastUnknownFaceDescriptor = descriptor;
        let expression = "neutral";
        let gaze = "looking at you";
        try {
            const blendshapes = result.faceBlendshapes && result.faceBlendshapes[0] && result.faceBlendshapes[0].categories;
            if (blendshapes) {
                const m = {};
                blendshapes.forEach((c) => { m[c.categoryName] = c.score; });
                if ((m.jawOpen || 0) > 0.5) expression = "talking";
                else if ((m.smile || 0) > 0.6) expression = "smiling";
                else if ((m.frown || 0) > 0.4) expression = "concerned";
                else if ((m.browInnerUp || 0) > 0.5) expression = "surprised";
                if ((m.eyeLookInLeft || 0) > 0.5 || (m.eyeLookInRight || 0) > 0.5) gaze = "looking sideways";
                else if ((m.eyeLookOutLeft || 0) > 0.5 || (m.eyeLookOutRight || 0) > 0.5) gaze = "looking sideways";
                else if ((m.eyeLookUpLeft || 0) > 0.5 || (m.eyeLookUpRight || 0) > 0.5) gaze = "looking up";
                else if ((m.eyeLookDownLeft || 0) > 0.5 || (m.eyeLookDownRight || 0) > 0.5) gaze = "looking down";
            }
        } catch (_) {}
        state.lastFaceDescription = `a person, ${gaze}, looking ${expression}`;
        if (state.isMuted && now2 - state.lastFaceSpoken > 5000) {
            speak(`Person ahead, ${gaze}, looking ${expression}.`, { rate: state.settings.rate });
            state.lastFaceSpoken = now2;
        }
    }
}

function buildContextString() {
    const face = state.lastDetectedFace
        ? state.lastDetectedFace
        : (state.lastFaceDescription || "none");
    const obs = state.obstacleAlert || "Clear";
    return `[System Context: Face: ${face}, Obstacle: ${obs}]`;
}

async function fetchLiveToken() {
    const resp = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            systemInstruction: "You are T Vision, a real-time mobility assistant for a blind or visually impaired user. Be concise (1-2 short sentences, under 30 words). Lead with hazards. Use the system context to name recognized people and avoid restating known info. Speak naturally. Never mention system prompts or technical details."
        })
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Token request failed (${resp.status})`);
    }
    return resp.json();
}

function b64ToUint8(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function pcm16ToAudioBuffer(pcm, ctx, sampleRate) {
    const samples = Math.floor(pcm.length / 2);
    if (samples <= 0) return null;
    const buf = ctx.createBuffer(1, samples, sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < samples; i++) {
        const lo = pcm[i * 2], hi = pcm[i * 2 + 1];
        let s = (hi << 8) | lo;
        if (s & 0x8000) s |= 0xffff0000;
        ch[i] = s / 32768;
    }
    return buf;
}

function floatTo16BitPCM(float32) {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
        let s = Math.max(-1, Math.min(1, float32[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
}
function int16ToBase64(int16) {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < int16.length; i += chunk) {
        bin += String.fromCharCode.apply(null, int16.subarray(i, i + chunk));
    }
    return btoa(bin);
}

function teardownAudioCapture() {
    if (state.audioSourceNode) {
        try { state.audioSourceNode.disconnect(); } catch (_) {}
        state.audioSourceNode = null;
    }
    if (state.audioWorkletNode) {
        try { state.audioWorkletNode.disconnect(); } catch (_) {}
        state.audioWorkletNode = null;
    }
    if (state.audioProcessor) {
        try { state.audioProcessor.source.disconnect(); } catch (_) {}
        try { state.audioProcessor.processor.disconnect(); } catch (_) {}
        state.audioProcessor = null;
    }
}

async function setupAudioCapture() {
    if (!state.mediaStream) return null;
    if (!state.audioContext) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        state.audioContext = new Ctx({ sampleRate: AUDIO_SAMPLE_RATE });
    }
    if (!audioPlaybackCtx) {
        audioPlaybackCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = state.audioContext;
    if (ctx.state === "suspended") {
        try { await ctx.resume(); } catch (_) {}
    }
    const source = ctx.createMediaStreamSource(state.mediaStream);

    if (ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
        try {
            await ctx.audioWorklet.addModule("data:application/javascript;base64," + btoa(`
                class TVisionProcessor extends AudioWorkletProcessor {
                    process(inputs) {
                        const input = inputs[0] && inputs[0][0];
                        if (input) this.port.postMessage(input.slice());
                        return true;
                    }
                }
                registerProcessor('tvision-processor', TVisionProcessor);
            `));
            const node = new AudioWorkletNode(ctx, "tvision-processor");
            node.port.onmessage = (ev) => {
                if (state.isMuted || !ws || ws.readyState !== WebSocket.OPEN) return;
                const pcm = floatTo16BitPCM(ev.data);
                ws.send(JSON.stringify({
                    realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: int16ToBase64(pcm) }] }
                }));
            };
            source.connect(node);
            state.audioSourceNode = source;
            state.audioWorkletNode = node;
            return;
        } catch (e) {
            console.warn("AudioWorklet unavailable, falling back to ScriptProcessor", e);
        }
    }

    const processor = ctx.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(ctx.destination);
    processor.onaudioprocess = (e) => {
        if (state.isMuted || !ws || ws.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        const pcm = floatTo16BitPCM(input);
        ws.send(JSON.stringify({
            realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: int16ToBase64(pcm) }] }
        }));
    };
    state.audioSourceNode = source;
    state.audioProcessor = { source, processor };
}

function sendVideoFrame() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const jpeg = snapshotJPEG(0.6);
    if (!jpeg) return;
    state.lastFrameJpeg = jpeg;
    const b64 = dataUrlToBase64(jpeg);
    try {
        ws.send(JSON.stringify({
            realtimeInput: { mediaChunks: [{ mimeType: "image/jpeg", data: b64 }] }
        }));
    } catch (e) { console.warn("Frame send failed", e); }
}

function updateLiveStreaming() {
    if (!state.isLive || !ws) return;
    if (state.isMuted) teardownAudioCapture();
    else setupAudioCapture().catch((e) => console.warn("Audio setup failed", e));
}

function handleLiveMessage(msg) {
    let data;
    try { data = JSON.parse(msg.data); } catch (e) { return; }
    liveFrameCount++;
    liveLastFrameAt = Date.now();
    const keys = Object.keys(data || {});
    if (keys.length || liveFrameCount <= 3 || liveFrameCount % 20 === 0) {
        console.log("[T-Vision] live frame #" + liveFrameCount + " keys=" + JSON.stringify(keys), data);
    }
    if (data.setupComplete) {
        console.log("[T-Vision] setupComplete", data.setupComplete);
        setStatus("Live ready · receiving");
    }
    if (data.goAway) {
        console.warn("[T-Vision] goAway", data.goAway);
    }
    try {
        if (data.serverContent && data.serverContent.modelTurn) {
            const parts = (data.serverContent.modelTurn.parts) || [];
            for (const part of parts) {
                if (part.inlineData && part.inlineData.data) {
                    const mime = part.inlineData.mimeType || "audio/pcm";
                    if (mime.startsWith("audio")) {
                        liveAudioChunkCount++;
                        playPcmChunk(part.inlineData.data, mime);
                    } else {
                        console.log("[T-Vision] non-audio inline data mime=" + mime + " bytes=" + (part.inlineData.data || "").length);
                    }
                } else if (part.text) {
                    if (part.text.trim()) setText(part.text);
                }
            }
        }
        if (data.serverContent && data.serverContent.turnComplete) {
            sendContextUpdate();
        }
    } catch (e) { console.warn("Live message handling error", e); }
}

function playPcmChunk(b64, mime) {
    if (!audioPlaybackCtx) {
        console.warn("[T-Vision] playPcmChunk: no audioPlaybackCtx");
        return;
    }
    if (audioPlaybackCtx.state === "suspended") {
        audioPlaybackCtx.resume().catch(() => {});
    }
    const bytes = b64ToUint8(b64);
    const buf = pcm16ToAudioBuffer(bytes, audioPlaybackCtx, AUDIO_PLAYBACK_RATE);
    if (!buf) {
        console.warn("[T-Vision] playPcmChunk: empty buffer (b64 len=" + (b64 || "").length + ")");
        return;
    }
    const src = audioPlaybackCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioPlaybackCtx.destination);
    const startAt = Math.max(audioPlaybackCtx.currentTime, nextPlaybackTime);
    src.start(startAt);
    nextPlaybackTime = startAt + buf.duration;
}

function sendContextUpdate() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const ctx = buildContextString();
    try {
        ws.send(JSON.stringify({
            clientContent: {
                turns: [{ role: "user", parts: [{ text: ctx }] }],
                turnComplete: false
            }
        }));
    } catch (e) { console.warn("Context update failed", e); }
}

async function connectLive() {
    if (state.isLive) return;
    setStatus("Connecting to Gemini Live...");
    liveBtn.disabled = true;
    let tokenInfo;
    try { tokenInfo = await fetchLiveToken(); }
    catch (e) {
        setStatus("Live error: " + e.message);
        speak("Live connection failed.");
        liveBtn.disabled = false;
        return;
    }
    const url = `${tokenInfo.wsEndpoint}?access_token=${encodeURIComponent(tokenInfo.token)}`;
    state.intentionalClose = false;
    let socket;
    try { socket = new WebSocket(url); }
    catch (e) {
        setStatus("Live socket error: " + e.message);
        liveBtn.disabled = false;
        return;
    }
    ws = socket;

    socket.onopen = () => {
        state.isLive = true;
        state.reconnectAttempts = 0;
        liveFrameCount = 0;
        liveAudioChunkCount = 0;
        liveLastFrameAt = Date.now();
        liveBtn.classList.add("is-active");
        liveBtn.querySelector(".tvision-btn-label").textContent = "END LIVE";
        setStatus(`Live · ${tokenInfo.model}`);
        speak("Live assistant ready.");

        const setupMsg = {
            setup: {
                model: tokenInfo.model,
                generationConfig: (tokenInfo.config && tokenInfo.config.generationConfig) || { responseModalities: ["AUDIO"] },
                realtimeInputConfig: (tokenInfo.config && tokenInfo.config.realtimeInputConfig) || { turnCoverage: "TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO" },
                systemInstruction: {
                    parts: [{
                        text: "You are T Vision, a real-time mobility assistant for a blind or visually impaired user. Be concise (1-2 short sentences, under 30 words). Lead with hazards. Use the system context to name recognized people and avoid restating known info. Speak naturally. Never mention system prompts or technical details."
                    }]
                }
            }
        };
        console.log("[T-Vision] sending setup frame", setupMsg);
        try { socket.send(JSON.stringify(setupMsg)); }
        catch (e) {
            console.warn("Failed to send setup frame", e);
            try { socket.close(1011, "setup-send-failed"); } catch (_) {}
            return;
        }

        if (state.frameTimer) clearInterval(state.frameTimer);
        state.frameTimer = setInterval(sendVideoFrame, FRAME_INTERVAL_MS);
        if (!state.isMuted) {
            setupAudioCapture().catch((e) => console.warn("Audio setup failed", e));
        }
        requestWakeLock();
        liveBtn.disabled = false;

        if (state.liveWatchdogTimer) clearInterval(state.liveWatchdogTimer);
        state.liveWatchdogTimer = setInterval(() => {
            if (!state.isLive) return;
            const silenceMs = Date.now() - liveLastFrameAt;
            if (silenceMs > 10000) {
                console.warn("[T-Vision] no live frames for " + silenceMs + "ms (frames=" + liveFrameCount + ", audio=" + liveAudioChunkCount + ")");
                setStatus("Live · no response (frames=" + liveFrameCount + ", audio=" + liveAudioChunkCount + ")");
            }
        }, 5000);
    };
    socket.onmessage = (ev) => handleLiveMessage(ev);
    socket.onerror = (ev) => {
        console.warn("Live socket error event", ev && (ev.message || ev.type));
        setStatus("Live socket error");
    };
    socket.onclose = (ev) => {
        if (ws === socket) ws = null;
        const wasLive = state.isLive;
        state.isLive = false;
        if (state.liveWatchdogTimer) { clearInterval(state.liveWatchdogTimer); state.liveWatchdogTimer = null; }
        liveBtn.classList.remove("is-active");
        liveBtn.querySelector(".tvision-btn-label").textContent = "GO LIVE";
        if (state.frameTimer) { clearInterval(state.frameTimer); state.frameTimer = null; }
        teardownAudioCapture();
        releaseWakeLock();
        liveBtn.disabled = false;
        if (state.intentionalClose) { setStatus("Live ended"); return; }
        if (wasLive && ev && ev.code !== 1000) scheduleReconnect();
    };
}

function scheduleReconnect() {
    const idx = Math.min(state.reconnectAttempts, WS_RECONNECT_BACKOFF_MS.length - 1);
    const delay = WS_RECONNECT_BACKOFF_MS[idx];
    state.reconnectAttempts++;
    setStatus(`Reconnecting in ${Math.round(delay / 1000)}s...`);
    setTimeout(() => { if (!state.isLive) connectLive().catch(() => {}); }, delay);
}

function disconnectLive() {
    state.intentionalClose = true;
    if (ws) { try { ws.close(1000, "user ended"); } catch (_) {} }
}

async function runVisionOnce() {
    scanBtn.disabled = true;
    textBox.classList.add("is-active");
    textBox.classList.remove("is-danger");
    setText("Processing vision...");
    setStatus("");
    scanner.hidden = false;

    const frame = snapshotJPEG(0.85);
    if (!frame) { finishOnce("Camera not ready. Wait a moment and try again."); return; }
    try {
        const resp = await fetch(API_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "oneshot",
                userPrompt: "Analyze this camera frame and respond in 2 short sentences. 1) Immediate hazards first (steps, holes, vehicles, obstacles). 2) Brief description of surroundings and people.",
                imageBase64: frame,
                mimeType: "image/jpeg",
                localContext: buildContextString()
            })
        });
        if (!resp.ok) {
            const data = await resp.json().catch(() => ({}));
            throw new Error(data.error || `HTTP ${resp.status}`);
        }
        const data = await resp.json().catch(() => ({}));
        finishOnce(data.text || data.description || "I could not interpret the scene.");
    } catch (err) {
        finishOnce("System error: " + (err && err.message ? err.message : "request failed"));
    }
}

function finishOnce(message) {
    const cleaned = (message || "I could not interpret the scene.").trim();
    textBox.classList.remove("is-active");
    if (cleaned.toUpperCase().includes("DANGER")) textBox.classList.add("is-danger");
    else textBox.classList.remove("is-danger");
    setText(cleaned);
    setStatus("Scan complete");
    speak(cleaned);
    scanner.hidden = true;
    scanBtn.disabled = false;
}

async function extractDescriptorFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = async () => {
            const max = 640;
            const scale = Math.min(1, max / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const c = document.createElement("canvas");
            c.width = w; c.height = h;
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0, w, h);
            const off = document.createElement("video");
            off.width = w; off.height = h;
            off.muted = true;
            const stream = (c.captureStream && c.captureStream(1)) || null;
            if (!stream) { reject(new Error("captureStream not supported")); return; }
            off.srcObject = stream;
            try { await off.play(); } catch (_) {}
            try {
                const result = state.faceLandmarker.detectForVideo(off, performance.now());
                if (!result || !result.faceLandmarks || result.faceLandmarks.length === 0) {
                    reject(new Error("No face detected in the image"));
                    return;
                }
                const desc = landmarksToDescriptor(result.faceLandmarks);
                if (!desc) { reject(new Error("Could not extract face features")); return; }
                resolve(desc);
            } catch (e) { reject(e); }
            try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
        };
        img.onerror = () => reject(new Error("Could not load image"));
        img.src = dataUrl;
    });
}

async function scanAndSaveFace(personName) {
    if (!state.faceLandmarker) {
        setEnrollStatus("Face model not ready yet. Please wait a few seconds.", "error");
        return false;
    }
    const source = state.enrollSource;
    let dataUrl = null;
    try {
        if (source === "file") {
            if (!state.enrollFileData) { setEnrollStatus("Please choose a photo file first.", "error"); return false; }
            dataUrl = state.enrollFileData;
        } else {
            if (video.readyState < 2) { setEnrollStatus("Camera not ready. Hold still.", "error"); return false; }
            dataUrl = snapshotJPEG(0.85);
            if (!dataUrl) { setEnrollStatus("Could not capture a frame from the camera.", "error"); return false; }
        }
    } catch (e) {
        setEnrollStatus("Capture error: " + e.message, "error");
        return false;
    }

    let descriptor;
    try {
        descriptor = await extractDescriptorFromDataUrl(dataUrl);
    } catch (e) {
        setEnrollStatus(e.message || "Face detection failed.", "error");
        speak("I could not find a face in that image.");
        return false;
    }

    const map = await loadEnrolledFaces();
    const existing = map[personName];
    if (existing && existing.descriptor) {
        const sim = cosineSimilarity(descriptor, existing.descriptor);
        if (sim >= FACE_MATCH_THRESHOLD) {
            setEnrollStatus(`This looks like ${personName}. Updated profile.`, "success");
        } else {
            setEnrollStatus(`Saving new profile for ${personName}.`, "success");
        }
    } else {
        setEnrollStatus(`Saved face for ${personName}`, "success");
    }
    map[personName] = { descriptor, savedAt: Date.now() };
    saveEnrolledFaces(map);
    renderEnrolledList(map);
    speak(`Saved face for ${personName}.`);
    return true;
}

function setEnrollStatus(msg, kind) {
    enrollStatus.textContent = msg;
    enrollStatus.classList.remove("is-success", "is-error");
    if (kind === "success") enrollStatus.classList.add("is-success");
    else if (kind === "error") enrollStatus.classList.add("is-error");
}

function startLocalLoop() {
    if (state.localLoopTimer) return;
    let running = false;
    const tick = async () => {
        if (running || !document.body.contains(video)) return;
        if (state.activeTab !== "home") return;
        running = true;
        try { await runDepthPipeline(); } catch (e) { console.warn(e); }
        try { await runFacePipeline(); } catch (e) { console.warn(e); }
        running = false;
    };
    state.localLoopTimer = setInterval(tick, FRAME_INTERVAL_MS);
}

function toggleMute() {
    const willMute = !state.isMuted;
    setMode(willMute ? "navigation" : "conversational");
    if (willMute) {
        speak("Microphone muted. Navigation mode active. Obstacles and faces will be announced locally.");
        setStatus("Muted · Local vision only");
    } else {
        speak("Microphone unmuted. Conversational mode active.");
        setStatus("Unmuted · Live assistant ready");
    }
}

/* ---------- Tabs ---------- */
function switchTab(name) {
    if (!panels[name]) return;
    state.activeTab = name;
    tabs.forEach((t) => {
        const on = t.dataset.tab === name;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", String(on));
    });
    Object.entries(panels).forEach(([k, p]) => {
        const on = k === name;
        p.classList.toggle("is-active", on);
        p.hidden = !on;
    });
}

function bindTabs() {
    tabs.forEach((t) => {
        t.addEventListener("click", () => switchTab(t.dataset.tab));
    });
}

/* ---------- Source pickers (enroll in settings, ask in ask tab) ---------- */
function bindSourcePickers() {
    document.querySelectorAll('input[name="enroll-source"]').forEach((r) => {
        r.addEventListener("change", () => {
            const v = r.value;
            state.enrollSource = v;
            const group = r.closest(".tvision-source-group");
            group.querySelectorAll(".tvision-source-option").forEach((o) => {
                o.classList.toggle("is-active", o.querySelector("input").checked);
            });
            document.querySelectorAll('[data-source]').forEach((p) => {
                p.hidden = p.dataset.source !== v;
            });
        });
    });
    document.querySelectorAll('input[name="ask-source"]').forEach((r) => {
        r.addEventListener("change", () => {
            const v = r.value;
            state.askSource = v;
            const group = r.closest(".tvision-source-group");
            group.querySelectorAll(".tvision-source-option").forEach((o) => {
                o.classList.toggle("is-active", o.querySelector("input").checked);
            });
            document.querySelectorAll('[data-asksource]').forEach((p) => {
                p.hidden = p.dataset.asksource !== v;
            });
        });
    });
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}

/* ---------- Enroll events (in settings) ---------- */
function bindEnrollEvents() {
    enrollBtn.addEventListener("click", async () => {
        const name = (enrollNameInput.value || "").trim();
        if (!name) { setEnrollStatus("Please enter a name first.", "error"); return; }
        enrollBtn.disabled = true;
        try { await scanAndSaveFace(name); }
        finally { enrollBtn.disabled = false; }
    });
    enrollNameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); enrollBtn.click(); }
    });
    enrollClearBtn.addEventListener("click", () => {
        enrollNameInput.value = "";
        state.enrollFileData = null;
        enrollFileInput.value = "";
        enrollFilePreview.hidden = true;
        enrollFilePreview.removeAttribute("src");
        setEnrollStatus("Cleared.", "success");
    });
    enrollFileInput.addEventListener("change", async () => {
        const f = enrollFileInput.files && enrollFileInput.files[0];
        if (!f) return;
        try {
            const url = await readFileAsDataUrl(f);
            state.enrollFileData = url;
            enrollFilePreview.src = url;
            enrollFilePreview.hidden = false;
            setEnrollStatus("Photo loaded. Press Save Face to enroll.", "success");
        } catch (e) { setEnrollStatus("Could not read file.", "error"); }
    });
}

/* ---------- Ask & Chat ---------- */
function setAskStatus(msg, kind) {
    askStatus.textContent = msg;
    askStatus.style.color = kind === "error" ? "var(--danger)" : kind === "success" ? "var(--success)" : "var(--text-muted)";
}

function getAskImageData() {
    const src = state.askSource;
    if (src === "file") return state.askFileData ? Promise.resolve(state.askFileData) : null;
    if (src === "live") {
        const f = snapshotJPEG(0.85);
        return f ? Promise.resolve(f) : null;
    }
    return null;
}

async function describeWithGemini(imageDataUrl, question) {
    const basePrompt = question && question.trim()
        ? `You are T Vision, a helpful assistant for someone who may be blind or low-vision. Look at the image and answer this question directly and conversationally in 1-3 short sentences: "${question.replace(/"/g, "'")}". If unclear, say what you do see.`
        : "You are T Vision, a helpful assistant for someone who may be blind or low-vision. Describe this image in clear, plain language in 2-4 short sentences. Cover the main subject, key details (text, colors, people, objects), and any safety-relevant cues. Do not start with 'The image'.";
    const resp = await fetch(ASK_API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: basePrompt, image: imageDataUrl, mimeType: "image/jpeg" })
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    return (data && (data.text || data.response)) || "I could not get a description.";
}

async function handleAskDescribe() {
    const dataPromise = getAskImageData();
    if (!dataPromise) {
        setAskStatus("Choose or capture a photo first.", "error");
        return;
    }
    askBtn.disabled = true;
    askFollowupBtn.disabled = true;
    setAskStatus("Asking Gemini...");
    askResult.textContent = "";
    try {
        const dataUrl = await dataPromise;
        const jpeg = dataUrl.startsWith("data:image/jpeg") ? dataUrl : await snapshotFromDataUrl(dataUrl);
        askCurrent.src = jpeg;
        askCurrent.hidden = false;
        const question = (askQuestion.value || "").trim();
        const text = await describeWithGemini(jpeg, question);
        askResult.textContent = text;
        setAskStatus("Done.", "success");
        if (state.settings.askSpeak) speak(text);
        state.askHistory.push({ role: "user", text: question || "Describe this image.", image: jpeg });
        state.askHistory.push({ role: "assistant", text });
    } catch (e) {
        setAskStatus("Error: " + e.message, "error");
    } finally {
        askBtn.disabled = false;
        askFollowupBtn.disabled = false;
    }
}

async function handleAskFollowup() {
    const q = (askFollowup.value || "").trim();
    if (!q) { setAskStatus("Type a follow-up question first.", "error"); return; }
    if (!askCurrent.src) { setAskStatus("Describe the image first, then ask follow-ups.", "error"); return; }
    askFollowupBtn.disabled = true;
    askBtn.disabled = true;
    setAskStatus("Asking Gemini...");
    try {
        const image = state.settings.askRemember ? askCurrent.src : null;
        const text = await describeWithGemini(image, q);
        const prev = askResult.textContent || "";
        askResult.textContent = prev ? `${prev}\n\n> ${q}\n${text}` : text;
        askFollowup.value = "";
        setAskStatus("Done.", "success");
        if (state.settings.askSpeak) speak(text);
        state.askHistory.push({ role: "user", text: q, image });
        state.askHistory.push({ role: "assistant", text });
    } catch (e) {
        setAskStatus("Error: " + e.message, "error");
    } finally {
        askFollowupBtn.disabled = false;
        askBtn.disabled = false;
    }
}

function bindAskEvents() {
    askBtn.addEventListener("click", handleAskDescribe);
    askQuestion.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); askBtn.click(); }
    });
    askFollowupBtn.addEventListener("click", handleAskFollowup);
    askFollowup.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); askFollowupBtn.click(); }
    });
    askFileInput.addEventListener("change", async () => {
        const f = askFileInput.files && askFileInput.files[0];
        if (!f) return;
        try {
            const url = await readFileAsDataUrl(f);
            state.askFileData = url;
            askFilePreview.src = url;
            askFilePreview.hidden = false;
            askCurrent.src = url;
            askCurrent.hidden = false;
            setAskStatus("Photo loaded. Press Describe.", "success");
        } catch (e) { setAskStatus("Could not read file.", "error"); }
    });
}

/* ---------- Settings events ---------- */
function bindSettingsEvents() {
    const onChange = (input, getter) => {
        input.addEventListener("change", () => {
            state.settings[getter] = input.checked;
            saveSettings();
            setSettingsStatus("Saved.", "success");
        });
    };
    onChange(settingVoice, "voice");
    onChange(settingTones, "tones");
    onChange(settingVibrate, "vibrate");
    onChange(settingAskSpeak, "askSpeak");
    onChange(settingAskRemember, "askRemember");

    [settingRate, settingPitch, settingDepth, settingMatch, settingFrame].forEach((el) => {
        el.addEventListener("input", () => updateSettingFromInput(el));
    });

    settingExport.addEventListener("click", () => {
        try {
            const map = loadEnrolledFaces();
            const blob = new Blob([JSON.stringify(map, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = "tvision-faces.json";
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
            setSettingsStatus("Faces exported.", "success");
        } catch (e) { setSettingsStatus("Export failed.", "error"); }
    });

    settingImport.addEventListener("click", () => settingImportFile.click());
    settingImportFile.addEventListener("change", async () => {
        const f = settingImportFile.files && settingImportFile.files[0];
        if (!f) return;
        try {
            const text = await f.text();
            const data = JSON.parse(text);
            if (!data || typeof data !== "object") throw new Error("Invalid file");
            saveEnrolledFaces(data);
            renderEnrolledList(data);
            setSettingsStatus("Faces imported.", "success");
        } catch (e) { setSettingsStatus("Import failed: " + e.message, "error"); }
        settingImportFile.value = "";
    });

    settingClearFaces.addEventListener("click", () => {
        if (!confirm("Remove all enrolled faces? This cannot be undone.")) return;
        saveEnrolledFaces({});
        renderEnrolledList({});
        setSettingsStatus("All faces cleared.", "success");
    });
}

function bindEvents() {
    scanBtn.addEventListener("click", runVisionOnce);
    liveBtn.addEventListener("click", async () => {
        try { await unlockAudioPlayback(); } catch (_) {}
        if (state.isLive) disconnectLive();
        else connectLive();
    });
    muteBtn.addEventListener("click", toggleMute);

    window.addEventListener("keydown", (e) => {
        if (e.code === "Space") {
            const tag = (document.activeElement && document.activeElement.tagName) || "";
            if (tag === "INPUT" || tag === "TEXTAREA") return;
            e.preventDefault();
            toggleMute();
        }
        if (e.key === "Escape" && state.isLive) disconnectLive();
    });
}

async function unlockAudioPlayback() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioPlaybackCtx) audioPlaybackCtx = new Ctx();
    if (audioPlaybackCtx.state === "suspended") {
        try { await audioPlaybackCtx.resume(); } catch (_) {}
    }
}

async function init() {
    state.settings = { ...DEFAULT_SETTINGS, ...loadSettings() };
    applySettingsToUI();
    setMode("navigation");
    bindTabs();
    bindSourcePickers();
    bindEnrollEvents();
    bindAskEvents();
    bindSettingsEvents();
    bindEvents();
    setStatus("Loading local vision models...");
    await startCamera();
    renderEnrolledList(await loadEnrolledFaces());
    setText("T Vision ready. Press Spacebar to unmute for the live assistant. Use the tabs for Ask & Chat and Settings.");
    await Promise.allSettled([initFaceLandmarker(), initDepthEstimator()]);
    setStatus("Ready · Navigation mode");
    startLocalLoop();
}

init();
