// ==========================
//  Accessible Video Editor
// ==========================

// --- Global state ---
let ffmpeg = null;
let files = {
    video: null,
    overlay: null,
    sfx: null,
    music: null
};
let videoDuration = 0;
let markers = { start: 0, end: 0 };

// Overlay settings
let overlay = {
    file: null,
    start: 0,
    duration: 5,
    position: 'top-right'
};

// SFX settings
let sfx = {
    file: null,
    start: 0,
    volume: 0.8
};

// Music settings
let music = {
    file: null,
    volume: 0.5
};

// DOM elements
const statusDiv = document.getElementById('status-bar');
const videoPlayer = document.getElementById('player');
const renderBtn = document.getElementById('render-btn');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('render-progress');
const progressText = document.getElementById('progress-text');
const trimModeCheck = document.getElementById('trim-mode-checkbox');
const statVideo = document.getElementById('stat-video');
const statMarkers = document.getElementById('stat-markers');
const statAction = document.getElementById('stat-action');

// Settings panels
const overlayPanel = document.getElementById('overlay-settings-panel');
const overlayStartInput = document.getElementById('overlay-start');
const overlayDurationInput = document.getElementById('overlay-duration');
const overlayPositionSelect = document.getElementById('overlay-position');
const overlayFilenameSpan = document.getElementById('overlay-filename');
const changeOverlayBtn = document.getElementById('change-overlay-image');
const removeOverlayBtn = document.getElementById('remove-overlay');

const sfxPanel = document.getElementById('sfx-settings-panel');
const sfxStartInput = document.getElementById('sfx-start');
const sfxVolumeInput = document.getElementById('sfx-volume');
const sfxFilenameSpan = document.getElementById('sfx-filename');
const changeSfxBtn = document.getElementById('change-sfx-file');
const removeSfxBtn = document.getElementById('remove-sfx');

const musicPanel = document.getElementById('music-settings-panel');
const musicVolumeInput = document.getElementById('music-volume');
const musicFilenameSpan = document.getElementById('music-filename');
const changeMusicBtn = document.getElementById('change-music-file');
const removeMusicBtn = document.getElementById('remove-music');

// --- Helper functions ---
function notify(msg, isError = false) {
    statusDiv.innerText = msg;
    statusDiv.style.borderLeftColor = isError ? '#f85149' : '#58a6ff';
    console.log(msg);
}

function updateStats() {
    if (files.video) {
        statVideo.innerText = `Video: ${videoDuration.toFixed(1)}s`;
    } else {
        statVideo.innerText = `Video: none`;
    }
    if (markers.start !== markers.end) {
        statMarkers.innerText = `Markers: ${markers.start.toFixed(1)}s → ${markers.end.toFixed(1)}s`;
    } else {
        statMarkers.innerText = `Markers: not set`;
    }
    const mode = trimModeCheck.checked ? 'Trim (keep selection)' : 'Cut (remove selection)';
    statAction.innerText = `Action: ${mode} (press Backspace to apply)`;
}

function playBeep(freq, duration = 0.1) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = 0.1;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

async function initFFmpeg() {
    if (ffmpeg) return ffmpeg;
    notify("Initializing video engine...");
    ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => console.log(message));
    ffmpeg.on('progress', ({ progress }) => {
        const percent = Math.round(progress * 100);
        progressBar.value = percent;
        progressText.innerText = `${percent}%`;
    });
    await ffmpeg.load();
    notify("Engine ready! Upload a video to begin.");
    return ffmpeg;
}

// --- File handling ---
async function fetchFile(file) {
    return new Uint8Array(await file.arrayBuffer());
}

// --- Overlay management ---
function showOverlayPanel(show) {
    if (show && overlay.file) {
        overlayPanel.classList.remove('hidden');
        overlayStartInput.value = overlay.start;
        overlayDurationInput.value = overlay.duration;
        overlayPositionSelect.value = overlay.position;
        overlayFilenameSpan.innerText = overlay.file.name;
    } else {
        overlayPanel.classList.add('hidden');
    }
}

function updateOverlay() {
    overlay.start = parseFloat(overlayStartInput.value);
    overlay.duration = parseFloat(overlayDurationInput.value);
    overlay.position = overlayPositionSelect.value;
    notify(`Overlay updated: start ${overlay.start}s, duration ${overlay.duration}s, position ${overlay.position}`);
}

overlayStartInput.addEventListener('change', updateOverlay);
overlayDurationInput.addEventListener('change', updateOverlay);
overlayPositionSelect.addEventListener('change', updateOverlay);

changeOverlayBtn.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        overlay.file = file;
        overlayFilenameSpan.innerText = file.name;
        showOverlayPanel(true);
        notify(`Overlay image loaded: ${file.name}`);
    };
    input.click();
};

removeOverlayBtn.onclick = () => {
    overlay.file = null;
    showOverlayPanel(false);
    notify("Overlay removed.");
};

// --- SFX management ---
function showSfxPanel(show) {
    if (show && sfx.file) {
        sfxPanel.classList.remove('hidden');
        sfxStartInput.value = sfx.start;
        sfxVolumeInput.value = sfx.volume;
        sfxFilenameSpan.innerText = sfx.file.name;
    } else {
        sfxPanel.classList.add('hidden');
    }
}

function updateSfx() {
    sfx.start = parseFloat(sfxStartInput.value);
    sfx.volume = parseFloat(sfxVolumeInput.value);
    notify(`SFX updated: start ${sfx.start}s, volume ${sfx.volume}`);
}

sfxStartInput.addEventListener('change', updateSfx);
sfxVolumeInput.addEventListener('change', updateSfx);

changeSfxBtn.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        sfx.file = file;
        sfxFilenameSpan.innerText = file.name;
        showSfxPanel(true);
        notify(`SFX loaded: ${file.name}`);
    };
    input.click();
};

removeSfxBtn.onclick = () => {
    sfx.file = null;
    showSfxPanel(false);
    notify("SFX removed.");
};

// --- Music management ---
function showMusicPanel(show) {
    if (show && music.file) {
        musicPanel.classList.remove('hidden');
        musicVolumeInput.value = music.volume;
        musicFilenameSpan.innerText = music.file.name;
    } else {
        musicPanel.classList.add('hidden');
    }
}

function updateMusic() {
    music.volume = parseFloat(musicVolumeInput.value);
    notify(`Music volume set to ${music.volume}`);
}

musicVolumeInput.addEventListener('change', updateMusic);

changeMusicBtn.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        music.file = file;
        musicFilenameSpan.innerText = file.name;
        showMusicPanel(true);
        notify(`Music loaded: ${file.name}`);
    };
    input.click();
};

removeMusicBtn.onclick = () => {
    music.file = null;
    showMusicPanel(false);
    notify("Music removed.");
};

// --- Video upload ---
const videoFilenameSpan = document.getElementById('video-filename');
document.getElementById('upload-video-btn').onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        files.video = file;
        videoFilenameSpan.innerText = file.name;
        const url = URL.createObjectURL(file);
        videoPlayer.src = url;
        await new Promise(resolve => {
            videoPlayer.onloadedmetadata = () => {
                videoDuration = videoPlayer.duration;
                markers.end = videoDuration;
                updateStats();
                notify(`Video loaded: ${videoDuration.toFixed(1)} seconds`);
                renderBtn.disabled = false;
                resolve();
            };
        });
    };
    input.click();
};

// --- Keyboard shortcuts ---
window.addEventListener('keydown', (e) => {
    // Ignore if typing in input/select
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

    const key = e.key;
    const currentTime = videoPlayer.currentTime;

    // S = set start marker
    if (key === 's' || key === 'S') {
        markers.start = currentTime;
        if (markers.start > markers.end) markers.end = markers.start;
        updateStats();
        playBeep(400);
        notify(`Start marker set at ${currentTime.toFixed(1)}s`);
        e.preventDefault();
    }
    // E = set end marker
    else if (key === 'e' || key === 'E') {
        markers.end = currentTime;
        if (markers.end < markers.start) markers.start = markers.end;
        updateStats();
        playBeep(600);
        notify(`End marker set at ${currentTime.toFixed(1)}s`);
        e.preventDefault();
    }
    // Backspace = apply trim/cut (we just notify; actual effect happens on export)
    else if (key === 'Backspace') {
        if (markers.start !== markers.end) {
            notify(`Trim/Cut will be applied on export. Current mode: ${trimModeCheck.checked ? 'Trim (keep selection)' : 'Cut (remove selection)'}`);
            playBeep(200);
        } else {
            notify("No markers set. Use S and E to set start/end.");
        }
        e.preventDefault();
    }
    // Ctrl+O = add logo (5s, top-right)
    else if ((e.ctrlKey || e.metaKey) && (key === 'o' || key === 'O')) {
        e.preventDefault();
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e2) => {
            const file = e2.target.files[0];
            if (!file) return;
            overlay.file = file;
            overlay.start = videoPlayer.currentTime;
            overlay.duration = 5;
            overlay.position = 'top-right';
            showOverlayPanel(true);
            overlayStartInput.value = overlay.start;
            overlayDurationInput.value = overlay.duration;
            overlayPositionSelect.value = overlay.position;
            notify(`Logo added at ${overlay.start}s, duration 5s, position top-right.`);
        };
        input.click();
    }
    // Ctrl+I = add image overlay (2s, full screen)
    else if ((e.ctrlKey || e.metaKey) && (key === 'i' || key === 'I')) {
        e.preventDefault();
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e2) => {
            const file = e2.target.files[0];
            if (!file) return;
            overlay.file = file;
            overlay.start = videoPlayer.currentTime;
            overlay.duration = 2;
            overlay.position = 'fullscreen';
            showOverlayPanel(true);
            overlayStartInput.value = overlay.start;
            overlayDurationInput.value = overlay.duration;
            overlayPositionSelect.value = overlay.position;
            notify(`Image overlay added at ${overlay.start}s, duration 2s, full screen.`);
        };
        input.click();
    }
    // Ctrl+F = add SFX
    else if ((e.ctrlKey || e.metaKey) && (key === 'f' || key === 'F')) {
        e.preventDefault();
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*';
        input.onchange = async (e2) => {
            const file = e2.target.files[0];
            if (!file) return;
            sfx.file = file;
            sfx.start = videoPlayer.currentTime;
            sfx.volume = 0.8;
            showSfxPanel(true);
            sfxStartInput.value = sfx.start;
            sfxVolumeInput.value = sfx.volume;
            notify(`SFX added at ${sfx.start}s.`);
        };
        input.click();
    }
    // Ctrl+M = add background music
    else if ((e.ctrlKey || e.metaKey) && (key === 'm' || key === 'M')) {
        e.preventDefault();
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*';
        input.onchange = async (e2) => {
            const file = e2.target.files[0];
            if (!file) return;
            music.file = file;
            music.volume = 0.5;
            showMusicPanel(true);
            musicVolumeInput.value = music.volume;
            notify(`Background music loaded.`);
        };
        input.click();
    }
    // Ctrl+X = render
    else if ((e.ctrlKey || e.metaKey) && (key === 'x' || key === 'X')) {
        e.preventDefault();
        if (!files.video) {
            notify("No video loaded.", true);
            return;
        }
        runExport();
    }
});

// --- Touch buttons for actions ---
document.getElementById('set-start-btn').addEventListener('click', () => {
    markers.start = videoPlayer.currentTime;
    if (markers.start > markers.end) markers.end = markers.start;
    updateStats();
    playBeep(400);
    notify(`Start marker set at ${markers.start.toFixed(1)}s`);
});
document.getElementById('set-end-btn').addEventListener('click', () => {
    markers.end = videoPlayer.currentTime;
    if (markers.end < markers.start) markers.start = markers.end;
    updateStats();
    playBeep(600);
    notify(`End marker set at ${markers.end.toFixed(1)}s`);
});
document.getElementById('add-logo-btn').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        overlay.file = file;
        overlay.start = videoPlayer.currentTime;
        overlay.duration = 5;
        overlay.position = 'top-right';
        showOverlayPanel(true);
        overlayStartInput.value = overlay.start;
        overlayDurationInput.value = overlay.duration;
        overlayPositionSelect.value = overlay.position;
        notify(`Logo added at ${overlay.start}s, duration 5s, position top-right.`);
    };
    input.click();
});
document.getElementById('add-image-btn').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        overlay.file = file;
        overlay.start = videoPlayer.currentTime;
        overlay.duration = 2;
        overlay.position = 'fullscreen';
        showOverlayPanel(true);
        overlayStartInput.value = overlay.start;
        overlayDurationInput.value = overlay.duration;
        overlayPositionSelect.value = overlay.position;
        notify(`Image overlay added at ${overlay.start}s, duration 2s, full screen.`);
    };
    input.click();
});
document.getElementById('add-sfx-btn').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        sfx.file = file;
        sfx.start = videoPlayer.currentTime;
        sfx.volume = 0.8;
        showSfxPanel(true);
        sfxStartInput.value = sfx.start;
        sfxVolumeInput.value = sfx.volume;
        notify(`SFX added at ${sfx.start}s.`);
    };
    input.click();
});
document.getElementById('add-music-btn').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        music.file = file;
        music.volume = 0.5;
        showMusicPanel(true);
        musicVolumeInput.value = music.volume;
        notify(`Background music loaded.`);
    };
    input.click();
});
document.getElementById('render-btn').addEventListener('click', () => {
    if (!files.video) {
        notify("No video loaded.", true);
        return;
    }
    runExport();
});

// --- Export function (main processing) ---
async function runExport() {
    renderBtn.disabled = true;
    progressContainer.classList.remove('hidden');
    progressBar.value = 0;
    progressText.innerText = '0%';
    notify("Processing video... this may take a while.");

    try {
        const ff = await initFFmpeg();

        // Write video
        const videoData = await fetchFile(files.video);
        ff.FS('writeFile', 'input.mp4', videoData);

        let inputs = ['input.mp4'];
        let filterComplex = '';
        let inputIndex = 1; // next input index

        // --- Video trimming/cutting (applied on export) ---
        let videoFilter = '';
        let audioFilter = '';
        if (markers.start !== markers.end) {
            if (trimModeCheck.checked) {
                // Trim: keep only the selected segment
                videoFilter = `[0:v]trim=start=${markers.start}:end=${markers.end},setpts=PTS-STARTPTS[v0]`;
                audioFilter = `[0:a]atrim=start=${markers.start}:end=${markers.end},asetpts=PTS-STARTPTS[a0]`;
            } else {
                // Cut: remove the selected segment
                videoFilter = `[0:v]select='not(between(t,${markers.start},${markers.end}))',setpts=N/FRAME_RATE/TB[v0]`;
                audioFilter = `[0:a]aselect='not(between(t,${markers.start},${markers.end}))',asetpts=N/SR/TB[a0]`;
            }
        } else {
            videoFilter = `[0:v]null[v0]`;
            audioFilter = `[0:a]anull[a0]`;
        }
        filterComplex = `${videoFilter};${audioFilter}`;

        // --- Overlay (image) ---
        let hasOverlay = false;
        if (overlay.file) {
            const imgData = await fetchFile(overlay.file);
            ff.FS('writeFile', 'overlay.png', imgData);
            // Build overlay filter
            let overlayFilter = '';
            if (overlay.position === 'fullscreen') {
                // Scale image to exactly match video dimensions (stretch to fill)
                overlayFilter = `[v0][${inputIndex}:v]scale2ref=iw:ih[ov][vid];[vid][ov]overlay=0:0[outv]`;
                // But we need to ensure correct linking: we'll use the scale2ref method.
                // Alternative: scale image to video size and overlay at 0,0.
                // Let's do: scale2ref to get image scaled to video, then overlay.
                filterComplex += `;[v0][${inputIndex}:v]scale2ref=iw:ih[img_scaled][v_main];[v_main][img_scaled]overlay=0:0[outv]`;
            } else {
                // Determine position coordinates
                let x = 10, y = 10;
                switch (overlay.position) {
                    case 'top-right': x = 'W-w-10'; y = 10; break;
                    case 'bottom-left': x = 10; y = 'H-h-10'; break;
                    case 'bottom-right': x = 'W-w-10'; y = 'H-h-10'; break;
                    default: // top-left
                        x = 10; y = 10;
                }
                const start = overlay.start;
                const end = overlay.start + overlay.duration;
                overlayFilter = `[v0][${inputIndex}:v]overlay=${x}:${y}:enable='between(t,${start},${end})'[outv]`;
                filterComplex += `;${overlayFilter}`;
            }
            inputs.push('overlay.png');
            hasOverlay = true;
            inputIndex++;
        }
        if (!hasOverlay) {
            filterComplex += `;[v0]copy[outv]`;
        }

        // --- Audio processing: original audio, music, SFX ---
        let audioStreams = ['[a0]'];
        let audioMixInputs = [];

        // Background music
        if (music.file) {
            const musicData = await fetchFile(music.file);
            ff.FS('writeFile', 'bgm.mp3', musicData);
            // Volume and duration matching: we'll mix using amix with longest duration
            filterComplex += `;[${inputIndex}:a]volume=${music.volume},apad=whole_dur=${videoDuration}[bgm]`;
            audioStreams.push('[bgm]');
            audioMixInputs.push('bgm');
            inputs.push('bgm.mp3');
            inputIndex++;
        }

        // SFX
        if (sfx.file) {
            const sfxData = await fetchFile(sfx.file);
            ff.FS('writeFile', 'sfx.mp3', sfxData);
            const delayMs = sfx.start * 1000;
            filterComplex += `;[${inputIndex}:a]adelay=${delayMs}|${delayMs},volume=${sfx.volume}[sfx_delayed]`;
            audioStreams.push('[sfx_delayed]');
            audioMixInputs.push('sfx_delayed');
            inputs.push('sfx.mp3');
            inputIndex++;
        }

        // Combine all audio tracks
        if (audioMixInputs.length > 0) {
            const allInputs = ['[a0]', ...audioMixInputs.map(s => `[${s}]`)];
            filterComplex += `;${allInputs.join('')}amix=inputs=${allInputs.length}:duration=longest[outa]`;
        } else {
            filterComplex += `;[a0]anull[outa]`;
        }

        // Build ffmpeg arguments
        const args = [...inputs.flatMap(i => ['-i', i]), '-filter_complex', filterComplex, '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', 'output.mp4'];

        console.log("FFmpeg args:", args);
        await ff.run(...args);

        const data = ff.FS('readFile', 'output.mp4');
        const blob = new Blob([data.buffer], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'edited_video.mp4';
        a.click();
        URL.revokeObjectURL(url);
        notify("Export complete!");
    } catch (err) {
        console.error(err);
        notify("Export failed: " + err.message, true);
    } finally {
        renderBtn.disabled = false;
        progressContainer.classList.add('hidden');
    }
}

// Initial load
initFFmpeg();