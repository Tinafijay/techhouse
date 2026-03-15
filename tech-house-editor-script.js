const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({ 
    log: true,
    // Using a specific version to match your HTML
    corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
});

const player = document.getElementById('player');
const uploader = document.getElementById('uploader');
const statusDisp = document.getElementById('status-display');
const announcer = document.getElementById('announcer');
const exportBtn = document.getElementById('export-btn');

let startTime = -1;
let endTime = -1;
let videoFile = null;

function announce(msg) {
    // Standard visual log
    statusDisp.innerText = "Status: " + msg;
    // Screen reader announcement
    announcer.innerText = msg;
}

function formatToMinutes(seconds) {
    if (seconds < 0) return "Not Set";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}m ${s}s`;
}

async function init() {
    try {
        await ffmpeg.load();
        announce("Tech House Engine Ready.");
    } catch (e) {
        announce("Engine error. Please refresh.");
    }
}

// Track Progress for accessibility
ffmpeg.setProgress(({ ratio }) => {
    const pct = Math.round(ratio * 100);
    if (pct > 0) announce(`Exporting: ${pct}% complete`);
});

init();

uploader.onchange = (e) => {
    videoFile = e.target.files[0];
    if (videoFile) {
        player.src = URL.createObjectURL(videoFile);
        exportBtn.disabled = false;
        announce("Video Loaded. Use Arrows to seek, S to mark start, E to mark end.");
    }
};

player.ontimeupdate = () => {
    document.getElementById('current-time').innerText = "Current Time: " + formatToMinutes(player.currentTime);
};

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    
    // Prevent scrolling with arrows/space while editing
    if (["ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();

    if (e.code === 'Space') {
        player.paused ? player.play() : player.pause();
        announce(player.paused ? "Paused" : "Playing");
    }
    else if (e.code === 'ArrowRight') {
        const step = e.shiftKey ? 1 : 10;
        player.currentTime = Math.min(player.duration, player.currentTime + step);
        announce(`Forward ${step}s. Position ${formatToMinutes(player.currentTime)}`);
    }
    else if (e.code === 'ArrowLeft') {
        const step = e.shiftKey ? 1 : 10;
        player.currentTime = Math.max(0, player.currentTime - step);
        announce(`Back ${step}s. Position ${formatToMinutes(player.currentTime)}`);
    }
    else if (k === 's') {
        startTime = player.currentTime;
        document.getElementById('start-val').innerText = formatToMinutes(startTime);
        announce(`Start point set at ${formatToMinutes(startTime)}`);
    }
    else if (k === 'e') {
        endTime = player.currentTime;
        document.getElementById('end-val').innerText = formatToMinutes(endTime);
        announce(`End point set at ${formatToMinutes(endTime)}`);
    }
    else if (k === 'x' && !exportBtn.disabled) {
        runExport();
    }
});

async function runExport() {
    if (startTime < 0 || endTime <= startTime) {
        return announce("Error: Set both start and end points first.");
    }
    
    exportBtn.disabled = true;
    announce("Starting High-Speed Export... please wait.");

    try {
        // Write the file to the virtual MEMFS (Memory File System)
        ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(videoFile));

        /* 
           -ss BEFORE -i is "Fast Seek" (very efficient)
           -c copy is "Stream Copy" (Zero CPU usage, just cutting)
        */
        await ffmpeg.run(
            '-ss', startTime.toString(), 
            '-to', endTime.toString(), 
            '-i', 'input.mp4', 
            '-c', 'copy', 
            'output.mp4'
        );

        const data = ffmpeg.FS('readFile', 'output.mp4');
        const url = URL.createObjectURL(new Blob([data.buffer], {type: 'video/mp4'}));
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `trimmed-${videoFile.name}`;
        a.click();

        announce("Export Successful! Download started.");
    } catch (err) {
        console.error(err);
        announce("Export failed. This usually happens if the file is too large for the browser RAM.");
    } finally {
        exportBtn.disabled = false;
        // Clean up memory
        try { ffmpeg.FS('unlink', 'input.mp4'); ffmpeg.FS('unlink', 'output.mp4'); } catch(e) {}
    }
}