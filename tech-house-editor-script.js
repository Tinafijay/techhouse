/**
 * Tech House Master Editor Pro - (v0.11 Proven Engine)
 */

const { createFFmpeg, fetchFile } = FFmpeg;

const ffmpegInstance = createFFmpeg({ 
    log: true,
    corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
});

// DOM Elements
const player = document.getElementById('player');
const uploader = document.getElementById('uploader');
const statusDisp = document.getElementById('status-display');
const announcer = document.getElementById('announcer');
const exportBtn = document.getElementById('export-btn');
const progContainer = document.getElementById('prog-container');
const progBar = document.getElementById('prog-bar');
const progLabel = document.getElementById('prog-label');
const modeBadge = document.getElementById('mode-badge');
const taskPanel = document.getElementById('task-panel');

// State Management
let videoFile = null;
let overlayFile = null;
let mode = "TRIM"; // "TRIM" or "OVERLAY"
let trimPoints = { start: 0, end: 0 };
let overlayPoints = { start: 0, end: 5 };

// --- HELPERS ---

function announce(msg) {
    if (statusDisp) statusDisp.innerText = "Status: " + msg;
    if (announcer) announcer.innerText = msg;
}

function formatTime(seconds) {
    if (isNaN(seconds)) return "00:00:00.000";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = (seconds % 60).toFixed(3);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.padStart(6, '0')}`;
}

function updateUI() {
    const target = (mode === "TRIM") ? trimPoints : overlayPoints;
    const sInput = document.getElementById('manual-s');
    const eInput = document.getElementById('manual-e');
    if (sInput) sInput.value = target.start.toFixed(3);
    if (eInput) eInput.value = target.end.toFixed(3);
}

// --- ENGINE INITIALIZATION ---

async function init() {
    try {
        announce("Starting Proven Engine (v0.11)...");
        await ffmpegInstance.load();
        announce("Tech House Engine Ready. Upload a video.");
    } catch (e) {
        console.error(e);
        announce("Engine Error. Please refresh the page.");
    }
}
init();

// --- FILE LOADING & SPACEBAR FIX ---

uploader.onchange = (e) => {
    videoFile = e.target.files[0];
    if (videoFile) {
        // Load the video into the player
        const url = URL.createObjectURL(videoFile);
        player.src = url;
        player.style.display = "block"; // Make video visible
        
        // BUG FIX: Remove keyboard focus from the "Choose File" button
        // so that pressing Space doesn't open the file picker again.
        uploader.blur(); 
        
        if (exportBtn) exportBtn.disabled = false;
        announce("Video Loaded. Use Space to play, S/E to trim.");
    }
};

// --- KEYBOARD CONTROLLER ---

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();

    // 1. SPACE: Purely Play/Pause Logic
    if (e.code === 'Space') {
        e.preventDefault(); // Stop page scrolling
        if (document.activeElement === uploader) uploader.blur(); 
        
        if (player.paused) {
            player.play();
            announce("Playing");
        } else {
            player.pause();
            announce("Paused");
        }
    }

    // 2. CTRL + O: Illustration Mode
    if (e.ctrlKey && k === 'o') {
        e.preventDefault();
        const picker = document.createElement('input');
        picker.type = 'file'; 
        picker.accept = 'image/*';
        picker.onchange = (ev) => {
            overlayFile = ev.target.files[0];
            mode = "OVERLAY";
            taskPanel.classList.remove('hidden');
            modeBadge.innerText = "OVERLAY MODE";
            announce("Image Selected. Use S/E to set duration, then ENTER to save.");
        };
        picker.click();
    }

    // 3. S & E: Context-Sensitive Trimming
    if (k === 's') {
        if (mode === "TRIM") {
            trimPoints.start = player.currentTime;
            announce(`Trim Start: ${trimPoints.start.toFixed(2)}s`);
        } else {
            overlayPoints.start = player.currentTime;
            announce(`Overlay Start: ${overlayPoints.start.toFixed(2)}s`);
        }
        updateUI();
    }

    if (k === 'e') {
        if (mode === "TRIM") {
            trimPoints.end = player.currentTime;
            announce(`Trim End: ${trimPoints.end.toFixed(2)}s`);
        } else {
            overlayPoints.end = player.currentTime;
            announce(`Overlay End: ${overlayPoints.end.toFixed(2)}s`);
        }
        updateUI();
    }

    // 4. ENTER: Lock Overlay & Return to Trim Mode
    if (k === 'enter' && mode === "OVERLAY") {
        mode = "TRIM";
        taskPanel.classList.add('hidden');
        modeBadge.innerText = "TRIM MODE";
        announce("Overlay Timing Locked. Back to Trim Mode.");
    }

    // 5. CTRL + X: Master Export
    if (e.ctrlKey && k === 'x') {
        e.preventDefault();
        if (!videoFile) return announce("Upload a video first!");
        
        const isPortrait = confirm("Click OK for Portrait (9:16) or CANCEL for Landscape (16:9).");
        runExport(isPortrait);
    }
});

// Update timer readout
player.ontimeupdate = () => {
    const timeDisplay = document.getElementById('current-time');
    if (timeDisplay) timeDisplay.innerText = formatTime(player.currentTime);
};

// --- PROGRESS TRACKING ---

ffmpegInstance.setProgress(({ ratio }) => {
    const pct = Math.floor(ratio * 100);
    if (progBar) progBar.style.width = pct + '%';
    if (progLabel) progLabel.innerText = pct + '% Complete';
});

// --- MASTER EXPORT ENGINE ---

async function runExport(isPortrait) {
    if (trimPoints.end <= trimPoints.start) {
        return alert("Error: Set your Start and End points correctly first.");
    }

    exportBtn.disabled = true;
    if (progContainer) progContainer.classList.remove('hidden');
    announce("Tech House Render Starting... computing pixels.");

    try {
        // Step 1: Write input video to MEMFS
        ffmpegInstance.FS('writeFile', 'input.mp4', await fetchFile(videoFile));

        // Step 2: Build Filter Complex
        const duration = trimPoints.end - trimPoints.start;
        const fadeOutStart = Math.max(0, duration - 1); 
        
        // Fading (1s in, 1s out)
        let vFilter = `fade=t=in:st=0:d=1,fade=t=out:st=${fadeOutStart}:d=1`;
        let aFilter = `afade=t=in:st=0:d=1,afade=t=out:st=${fadeOutStart}:d=1`;

        if (isPortrait) {
            vFilter += `,crop=ih*(9/16):ih,scale=720:1280`;
        }

        let args =['-ss', trimPoints.start.toString(), '-to', trimPoints.end.toString(), '-i', 'input.mp4'];

        // Overlay Logic
        if (overlayFile) {
            ffmpegInstance.FS('writeFile', 'image.png', await fetchFile(overlayFile));
            args.push('-i', 'image.png');
            vFilter = `[0:v]${vFilter}[vbase]; [vbase][1:v]overlay=W-w-20:H-h-20:enable='between(t,${overlayPoints.start - trimPoints.start},${overlayPoints.end - trimPoints.start})'`;
        }

        // Denoise logic
        const denoiseToggle = document.getElementById('denoise-toggle');
        if (denoiseToggle && denoiseToggle.checked) {
            aFilter = `afftdn,${aFilter}`;
        }

        // Final Command Assembly
        args.push('-filter_complex', vFilter);
        args.push('-af', aFilter);
        
        // Optimizer for Celeron Processor
        args.push(
            '-c:v', 'libx264', 
            '-preset', 'ultrafast', 
            '-c:a', 'aac', 
            'output.mp4'
        );

        // Execute Render using the v0.11 spread operator
        await ffmpegInstance.run(...args);

        // Step 3: Fetch result and download
        const data = ffmpegInstance.FS('readFile', 'output.mp4');
        const url = URL.createObjectURL(new Blob([data.buffer], {type: 'video/mp4'}));
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `tech-house-pro-${Date.now()}.mp4`;
        a.click();

        announce("✅ EXPORT COMPLETE!");
    } catch (err) {
        console.error(err);
        announce("❌ EXPORT FAILED.");
    } finally {
        // Memory Cleanup (Crucial for preventing ChromeOS crash on next video)
        if (progContainer) progContainer.classList.add('hidden');
        exportBtn.disabled = false;
        try {
            ffmpegInstance.FS('unlink', 'input.mp4');
            if (overlayFile) ffmpegInstance.FS('unlink', 'image.png');
            ffmpegInstance.FS('unlink', 'output.mp4');
        } catch (e) { /* ignore cleanup errors */ }
    }
}