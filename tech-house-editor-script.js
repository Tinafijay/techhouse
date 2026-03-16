/**
 * Tech House Master Editor Pro - Logic Engine (v0.12 Fixed)
 */

// THE BUG FIX: The new library uses window.FFmpegWASM and window.FFmpegUtil
const { FFmpeg } = window.FFmpegWASM;
const { fetchFile, toBlobURL } = window.FFmpegUtil;

const ffmpegInstance = new FFmpeg();

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
        announce("Initializing Engine (SSD Mode)...");
        await ffmpegInstance.load({
            coreURL: await toBlobURL('https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js', 'text/javascript'),
            wasmURL: await toBlobURL('https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm', 'application/wasm'),
        });
        announce("Tech House Engine Ready. Upload a video.");
    } catch (e) {
        console.error(e);
        announce("Engine Error. Ensure coi-serviceworker.js is loaded correctly.");
    }
}
init();

// --- FILE LOADING ---

uploader.onchange = (e) => {
    videoFile = e.target.files[0];
    if (videoFile) {
        const url = URL.createObjectURL(videoFile);
        player.src = url;
        player.load(); // Forces the browser to load the data
        player.style.display = "block"; // Unhides the video player
        
        // Prevents the Spacebar from opening the file picker again
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
        if (document.activeElement === uploader) uploader.blur(); // Stop button re-clicking
        
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

ffmpegInstance.on('progress', ({ ratio }) => {
    const pct = Math.floor(ratio * 100);
    if (progBar) progBar.style.width = pct + '%';
    if (progLabel) progLabel.innerText = pct + '% Complete';
    if (pct % 10 === 0) announce(`Processing: ${pct}%`);
});

// --- MASTER EXPORT ENGINE ---

async function runExport(isPortrait) {
    if (trimPoints.end <= trimPoints.start) {
        return alert("Error: Set your Start and End points correctly first.");
    }

    exportBtn.disabled = true;
    if (progContainer) progContainer.classList.remove('hidden');
    announce("Tech House Render Starting... resolving filters.");

    try {
        // Step 1: Write input video to virtual SSD
        await ffmpegInstance.writeFile('input.mp4', await fetchFile(videoFile));

        // Step 2: Build Filter Complex
        const duration = trimPoints.end - trimPoints.start;
        const fadeOutStart = Math.max(0, duration - 1); // Ensure fade doesn't crash on short clips
        
        // Automatic Fading (1s in, 1s out)
        let vFilter = `fade=t=in:st=0:d=1,fade=t=out:st=${fadeOutStart}:d=1`;
        let aFilter = `afade=t=in:st=0:d=1,afade=t=out:st=${fadeOutStart}:d=1`;

        // Portrait Mode Logic
        if (isPortrait) {
            vFilter += `,crop=ih*(9/16):ih,scale=720:1280`;
        }

        // Overlay Logic
        let args =['-ss', trimPoints.start.toString(), '-to', trimPoints.end.toString(), '-i', 'input.mp4'];

        if (overlayFile) {
            await ffmpegInstance.writeFile('image.png', await fetchFile(overlayFile));
            args.push('-i', 'image.png');
            // Overlay at bottom right corner (20px gap) with timed enable window
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
        
        // Encoder optimization for Dell Chromebook 11 (Celeron Processor)
        args.push(
            '-c:v', 'libx264', 
            '-preset', 'ultrafast', 
            '-c:a', 'aac', 
            'output.mp4'
        );

        // Execute Render
        await ffmpegInstance.exec(args);

        // Step 3: Fetch result and download
        const data = await ffmpegInstance.readFile('output.mp4');
        const url = URL.createObjectURL(new Blob([data.buffer], {type: 'video/mp4'}));
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `tech-house-edit-${Date.now()}.mp4`;
        a.click();

        announce("✅ MASTERPIECE COMPLETE!");
    } catch (err) {
        console.error(err);
        announce("❌ EXPORT FAILED. Make sure your browser has enough storage.");
    } finally {
        // Memory Cleanup (Crucial for 4GB RAM)
        if (progContainer) progContainer.classList.add('hidden');
        exportBtn.disabled = false;
        try {
            await ffmpegInstance.deleteFile('input.mp4');
            if (overlayFile) await ffmpegInstance.deleteFile('image.png');
            await ffmpegInstance.deleteFile('output.mp4');
        } catch (e) { /* ignore cleanup errors */ }
    }
}