/**
 * Tech House Master Editor Pro - (v0.11 Proven Engine)
 * Upgraded with Multi-track Audio, Seeking, and Accessible Announcers.
 */

const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({ log: true, corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js' });

// DOM Elements
const player = document.getElementById('player');
const uploader = document.getElementById('uploader');
const statusDisp = document.getElementById('status-display');
const announcer = document.getElementById('announcer');
const exportBtn = document.getElementById('export-btn');
const modeBadge = document.getElementById('mode-badge');

// Application State
let mode = "TRIM"; // TRIM | OVERLAY | BGM | SFX
let videoFile = null;

// Trackers for all layered assets
const assets = {
    trim: { s: 0, e: 0 },
    img: { file: null, s: 0, e: 5 },
    bgm: { file: null, vol: 0.2 }, // BGM defaults to 20% volume so it doesn't overpower voice
    sfx: { file: null, s: 0, e: 2, vol: 0.8 }
};

// --- ACCESSIBILITY HELPERS ---
function announce(msg) {
    statusDisp.innerText = "Status: " + msg;
    announcer.innerText = msg; // Read securely by NVDA/VoiceOver
}

function formatTime(sec) {
    if (isNaN(sec)) return "00:00.000";
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(3);
    return `${m.toString().padStart(2, '0')}:${s.padStart(6, '0')}`;
}

function updateUI() {
    document.getElementById('lbl-trim').innerText = `${assets.trim.s.toFixed(2)}s to ${assets.trim.e.toFixed(2)}s`;
    if(assets.img.file) document.getElementById('lbl-img').innerText = `Active (${assets.img.s.toFixed(2)}s to ${assets.img.e.toFixed(2)}s)`;
    if(assets.bgm.file) document.getElementById('lbl-bgm').innerText = `Active (Vol: ${Math.round(assets.bgm.vol * 100)}%)`;
    if(assets.sfx.file) document.getElementById('lbl-sfx').innerText = `Active (${assets.sfx.s.toFixed(2)}s, Vol: ${Math.round(assets.sfx.vol * 100)}%)`;
}

// --- INITIALIZATION ---
async function init() {
    try {
        announce("Starting Proven Engine... Please wait.");
        await ffmpeg.load();
        announce("Tech House Engine Ready. Upload your main video to begin.");
    } catch (e) {
        announce("Engine Error. Please refresh the page.");
    }
}
init();

uploader.onchange = (e) => {
    videoFile = e.target.files[0];
    if (videoFile) {
        player.src = URL.createObjectURL(videoFile);
        player.style.display = "block";
        document.getElementById('main-upload-btn').blur(); 
        
        player.onloadedmetadata = () => {
            assets.trim.e = player.duration; // Default end point to video end
            updateUI();
            exportBtn.disabled = false;
            announce(`Video Loaded. Duration is ${player.duration.toFixed(1)} seconds. Use Space to play.`);
        };
    }
};

player.ontimeupdate = () => {
    document.getElementById('current-time').innerText = formatTime(player.currentTime);
};

// --- KEYBOARD CONTROLLER ---
window.addEventListener('keydown', (e) => {
    // Prevent inputs from stealing keystrokes
    if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON") return;
    
    const k = e.key.toLowerCase();
    const currTime = player.currentTime;

    // 1. PLAY / PAUSE
    if (e.code === 'Space') {
        e.preventDefault();
        if (player.paused) { player.play(); announce("Playing"); } 
        else { player.pause(); announce(`Paused at ${currTime.toFixed(2)} seconds`); }
    }

    // 2. SEEKING (Forward/Backward)
    if (e.code === 'ArrowRight') {
        e.preventDefault();
        const jump = e.shiftKey ? 1 : 10;
        player.currentTime = Math.min(player.duration, currTime + jump);
        announce(`Forward ${jump} seconds. Time is ${player.currentTime.toFixed(1)}`);
    }
    if (e.code === 'ArrowLeft') {
        e.preventDefault();
        const jump = e.shiftKey ? 1 : 10;
        player.currentTime = Math.max(0, currTime - jump);
        announce(`Rewind ${jump} seconds. Time is ${player.currentTime.toFixed(1)}`);
    }

    // 3. VOLUME CONTROL (For active modes)
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        if(mode === "BGM" || mode === "SFX") {
            e.preventDefault();
            const change = e.code === 'ArrowUp' ? 0.1 : -0.1;
            assets[mode.toLowerCase()].vol = Math.max(0, Math.min(1, assets[mode.toLowerCase()].vol + change));
            announce(`${mode} Volume set to ${Math.round(assets[mode.toLowerCase()].vol * 100)} percent.`);
            updateUI();
        }
    }

    // 4. SET TIMESTAMPS (S and E)
    if (k === 's') {
        if(mode === "BGM") return announce("Background Music covers the whole video. Press Enter to lock.");
        assets[mode.toLowerCase()].s = currTime;
        announce(`${mode} Start marked at ${currTime.toFixed(2)} seconds.`);
        updateUI();
    }
    if (k === 'e') {
        if(mode === "BGM") return;
        assets[mode.toLowerCase()].e = currTime;
        announce(`${mode} End marked at ${currTime.toFixed(2)} seconds.`);
        updateUI();
    }

    // 5. LOCK LAYER
    if (k === 'enter' && mode !== "TRIM") {
        mode = "TRIM";
        modeBadge.innerText = "TRIM MODE";
        announce("Layer Locked. Back to Main Trim Mode.");
    }

    // 6. ADD IMAGE OVERLAY (Ctrl+O)
    if (e.ctrlKey && k === 'o') {
        e.preventDefault();
        triggerFilePicker('image/*', (file) => {
            assets.img.file = file;
            mode = "OVERLAY"; modeBadge.innerText = "IMAGE OVERLAY MODE";
            announce("Image added. Press S and E to set when it appears, then Enter to lock.");
            updateUI();
        });
    }

    // 7. ADD BACKGROUND MUSIC (Ctrl+M)
    if (e.ctrlKey && k === 'm') {
        e.preventDefault();
        triggerFilePicker('audio/*', (file) => {
            assets.bgm.file = file;
            mode = "BGM"; modeBadge.innerText = "BGM MUSIC MODE";
            announce("Background Music added. Up and Down arrows change volume. Enter to lock.");
            updateUI();
        });
    }

    // 8. ADD SOUND EFFECT (Ctrl+F)
    if (e.ctrlKey && k === 'f') {
        e.preventDefault();
        triggerFilePicker('audio/*', (file) => {
            assets.sfx.file = file;
            mode = "SFX"; modeBadge.innerText = "SOUND EFFECT MODE";
            announce("Sound Effect added. Press S to mark exactly when it should play. Enter to lock.");
            updateUI();
        });
    }

    // 9. EXPORT (Ctrl+X)
    if (e.ctrlKey && k === 'x') {
        e.preventDefault();
        if (!videoFile) return announce("Upload a video first!");
        runExport(confirm("Click OK for Portrait TikTok/Reel size (9:16), or Cancel for normal Widescreen."));
    }
});

function triggerFilePicker(accept, callback) {
    const picker = document.createElement('input');
    picker.type = 'file'; picker.accept = accept;
    picker.onchange = (ev) => callback(ev.target.files[0]);
    picker.click();
}

// --- FFmpeg PROGRESS ---
ffmpeg.setProgress(({ ratio }) => {
    const pct = Math.floor(ratio * 100);
    document.getElementById('prog-bar').style.width = pct + '%';
    document.getElementById('prog-label').innerText = pct + '% Complete';
});

// --- MASTER EXPORT RENDERER ---
async function runExport(isPortrait) {
    if (assets.trim.e <= assets.trim.s) return announce("Error: Trim End point must be after Start point.");

    exportBtn.disabled = true;
    document.getElementById('prog-container').classList.remove('hidden');
    announce("Tech House Render Starting... DO NOT close the page.");

    try {
        // Load main video
        ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(videoFile));
        let args = ['-ss', assets.trim.s.toString(), '-to', assets.trim.e.toString(), '-i', 'input.mp4'];
        
        let inputIdx = 1;
        let vStream = '[0:v]';
        let audioStreams = ['[0:a]'];
        let vFilter = '', aFilter = '';

        // Portrait Resizing
        if (isPortrait) {
            vFilter += `${vStream}crop=ih*(9/16):ih,scale=720:1280[vbase];`;
            vStream = '[vbase]';
        }

        // Overlay Logic (Offsetting timeline mathematics!)
        if (assets.img.file) {
            ffmpeg.FS('writeFile', 'img.png', await fetchFile(assets.img.file));
            args.push('-i', 'img.png');
            
            // Subtract main video trim start to find correct relative start time
            const relStart = Math.max(0, assets.img.s - assets.trim.s);
            const relEnd = Math.max(0, assets.img.e - assets.trim.s);
            
            vFilter += `${vStream}[${inputIdx}:v]overlay=W-w-20:H-h-20:enable='between(t,${relStart},${relEnd})'[vout];`;
            vStream = '[vout]';
            inputIdx++;
        }

        // Audio 1: Background Music
        if (assets.bgm.file) {
            ffmpeg.FS('writeFile', 'bgm.mp3', await fetchFile(assets.bgm.file));
            args.push('-i', 'bgm.mp3');
            aFilter += `[${inputIdx}:a]volume=${assets.bgm.vol}[abgm];`;
            audioStreams.push('[abgm]');
            inputIdx++;
        }

        // Audio 2: Sound Effect (SFX)
        if (assets.sfx.file) {
            ffmpeg.FS('writeFile', 'sfx.mp3', await fetchFile(assets.sfx.file));
            args.push('-i', 'sfx.mp3');
            
            // Offset timeline math and convert to milliseconds for FFmpeg adelay filter
            const relStartMs = Math.max(0, assets.sfx.s - assets.trim.s) * 1000;
            
            aFilter += `[${inputIdx}:a]volume=${assets.sfx.vol},adelay=${relStartMs}|${relStartMs}[asfx];`;
            audioStreams.push('[asfx]');
            inputIdx++;
        }

        // Mix all audio tracks together (Main Video + BGM + SFX)
        if (audioStreams.length > 1) {
            aFilter += `${audioStreams.join('')}amix=inputs=${audioStreams.length}:duration=first:dropout_transition=2[aout]`;
        }

        // Apply filters if any exist
        if (vFilter || aFilter) {
            let fullComplex = [];
            if (vFilter) fullComplex.push(vFilter);
            if (aFilter) fullComplex.push(aFilter);
            
            args.push('-filter_complex', fullComplex.join(''));
            args.push('-map', vStream === '[0:v]' ? '0:v' : vStream); // Map video
            args.push('-map', audioStreams.length > 1 ? '[aout]' : '0:a'); // Map audio
        }

        // Output encoding parameters
        args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', 'output.mp4');

        await ffmpeg.run(...args);

        // Download result
        const data = ffmpeg.FS('readFile', 'output.mp4');
        const url = URL.createObjectURL(new Blob([data.buffer], {type: 'video/mp4'}));
        const a = document.createElement('a');
        a.href = url; a.download = `tech-house-pro-${Date.now()}.mp4`; a.click();

        announce("EXPORT COMPLETE! Your file is downloading.");
    } catch (err) {
        console.error(err);
        announce("EXPORT FAILED. Video may be too complex for browser memory.");
    } finally {
        document.getElementById('prog-container').classList.add('hidden');
        exportBtn.disabled = false;
    }
}