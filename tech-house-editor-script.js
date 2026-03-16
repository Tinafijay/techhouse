const { FFmpeg } = ffmpeg;
const { fetchFile, toBlobURL } = FFmpegUtil;

const ffmpegInstance = new FFmpeg();

const player = document.getElementById('player');
const uploader = document.getElementById('uploader');
const statusDisp = document.getElementById('status-display');
const announcer = document.getElementById('announcer');
const exportBtn = document.getElementById('export-btn');

// State Variables
let videoFile = null;
let overlayFile = null;
let mode = "TRIM"; // Options: "TRIM", "OVERLAY"
let trimPoints = { start: 0, end: 0 };
let overlayPoints = { start: 0, end: 5 };

function announce(msg) {
    statusDisp.innerText = "Status: " + msg;
    announcer.innerText = msg;
}

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = (seconds % 60).toFixed(3);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.padStart(6, '0')}`;
}

// 1. Initialize v0.12 Engine
async function init() {
    try {
        await ffmpegInstance.load({
            coreURL: await toBlobURL('https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js', 'text/javascript'),
            wasmURL: await toBlobURL('https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm', 'application/wasm'),
        });
        announce("Tech House Engine Ready (v0.12 SSD Mode).");
    } catch (e) {
        announce("Engine Error. Please check COI headers.");
    }
}
init();

// Progress Listener
ffmpegInstance.on('progress', ({ ratio }) => {
    const pct = Math.floor(ratio * 100);
    document.getElementById('prog-bar').style.width = pct + '%';
    document.getElementById('prog-label').innerText = pct + '% Processing...';
});

uploader.onchange = (e) => {
    videoFile = e.target.files[0];
    if (videoFile) {
        player.src = URL.createObjectURL(videoFile);
        exportBtn.disabled = false;
        announce("Video Loaded. S/E to trim, Ctrl+O for Image.");
    }
};

player.ontimeupdate = () => {
    document.getElementById('current-time').innerText = formatTime(player.currentTime);
};

// 2. Keyboard Controller
window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();

    // Space: Play/Pause
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        player.paused ? player.play() : player.pause();
    }

    // Ctrl + O: Trigger Overlay Mode
    if (e.ctrlKey && k === 'o') {
        e.preventDefault();
        const picker = document.createElement('input');
        picker.type = 'file'; picker.accept = 'image/*';
        picker.onchange = (ev) => {
            overlayFile = ev.target.files[0];
            mode = "OVERLAY";
            document.getElementById('task-panel').classList.remove('hidden');
            document.getElementById('mode-badge').innerText = "OVERLAY MODE";
            announce("Image selected. S/E to set duration, ENTER to save.");
        };
        picker.click();
    }

    // S: Set Start
    if (k === 's' && e.target.tagName !== 'INPUT') {
        if (mode === "TRIM") trimPoints.start = player.currentTime;
        else overlayPoints.start = player.currentTime;
        updateUI();
        announce("Start point set.");
    }

    // E: Set End
    if (k === 'e' && e.target.tagName !== 'INPUT') {
        if (mode === "TRIM") trimPoints.end = player.currentTime;
        else overlayPoints.end = player.currentTime;
        updateUI();
        announce("End point set.");
    }

    // Enter: Confirm Overlay and go back to Trim
    if (k === 'enter' && mode === "OVERLAY") {
        mode = "TRIM";
        document.getElementById('task-panel').classList.add('hidden');
        document.getElementById('mode-badge').innerText = "TRIM MODE";
        announce("Overlay timing saved. Back to Trim mode.");
    }

    // Ctrl + X: Export Flow
    if (e.ctrlKey && k === 'x') {
        e.preventDefault();
        const portrait = confirm("Click OK for Portrait (9:16) or Cancel for Landscape.");
        runExport(portrait);
    }
});

function updateUI() {
    const sInput = document.getElementById('manual-s');
    const eInput = document.getElementById('manual-e');
    if (mode === "TRIM") {
        sInput.value = trimPoints.start.toFixed(3);
        eInput.value = trimPoints.end.toFixed(3);
    } else {
        sInput.value = overlayPoints.start.toFixed(3);
        eInput.value = overlayPoints.end.toFixed(3);
    }
}

// 3. The Master Render
async function runExport(isPortrait) {
    if (trimPoints.end <= trimPoints.start) return alert("Set Start/End points correctly!");

    exportBtn.disabled = true;
    document.getElementById('prog-container').classList.remove('hidden');
    announce("Exporting... resolving pixels.");

    try {
        await ffmpegInstance.writeFile('input.mp4', await fetchFile(videoFile));

        // Start Building Command
        // We use -ss and -to for the initial cut
        let filter = `fade=t=in:st=0:d=1,fade=t=out:st=${trimPoints.end - trimPoints.start - 1}:d=1`;
        let args = ['-ss', trimPoints.start.toString(), '-to', trimPoints.end.toString(), '-i', 'input.mp4'];

        if (isPortrait) {
            filter += `,crop=ih*(9/16):ih,scale=720:1280`;
        }

        if (overlayFile) {
            await ffmpegInstance.writeFile('overlay.png', await fetchFile(overlayFile));
            args.push('-i', 'overlay.png');
            // Overlay with enable window relative to the new trimmed start
            filter = `[0:v]${filter}[base]; [base][1:v]overlay=W-w-20:H-h-20:enable='between(t,${overlayPoints.start - trimPoints.start},${overlayPoints.end - trimPoints.start})'`;
        }

        // Finalize filters
        args.push('-filter_complex', filter);

        // Audio Filters
        let aFilter = `afade=t=in:st=0:d=1,afade=t=out:st=${trimPoints.end - trimPoints.start - 1}:d=1`;
        if (document.getElementById('denoise-toggle').checked) {
            aFilter = "afftdn," + aFilter;
        }
        args.push('-af', aFilter);

        // Hardware optimization for Chromebook 11
        args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', 'output.mp4');

        await ffmpegInstance.exec(args);

        const data = await ffmpegInstance.readFile('output.mp4');
        const url = URL.createObjectURL(new Blob([data.buffer], {type: 'video/mp4'}));
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `techhouse_pro_edit.mp4`;
        a.click();

        announce("Masterpiece Exported!");
    } catch (err) {
        announce("Error: " + err.message);
    } finally {
        exportBtn.disabled = false;
        document.getElementById('prog-container').classList.add('hidden');
        // Clean up SSD space
        await ffmpegInstance.deleteFile('input.mp4');
        if (overlayFile) await ffmpegInstance.deleteFile('overlay.png');
    }
}