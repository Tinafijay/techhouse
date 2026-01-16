const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({ 
    log: true,
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
    announcer.innerText = "";
    setTimeout(() => { announcer.innerText = msg; }, 50);
    statusDisp.innerText = "Status: " + msg;
}

function formatToMinutes(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m} minute${m !== 1 ? 's' : ''}, ${s} second${s !== 1 ? 's' : ''}`;
}

async function init() {
    try {
        await ffmpeg.load();
        announce("Tech House Engine Ready.");
    } catch (e) {
        console.error(e);
        announce("Engine error. Please refresh.");
    }
}

init();

uploader.onchange = (e) => {
    videoFile = e.target.files[0];
    if (videoFile) {
        player.src = URL.createObjectURL(videoFile);
        exportBtn.disabled = false;
        announce("Video Loaded. Use Arrows to seek, S/E to trim.");
    }
};

player.ontimeupdate = () => {
    document.getElementById('current-time').innerText = "Time: " + formatToMinutes(player.currentTime);
};

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();

    // Space: Play/Pause
    if (e.code === 'Space') {
        e.preventDefault();
        player.paused ? player.play() : player.pause();
        announce(player.paused ? "Paused" : "Playing");
    }

    // Right Arrow: +10s (or +1s with Shift)
    else if (e.code === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 10;
        player.currentTime = Math.min(player.duration, player.currentTime + step);
        announce("Forward " + step + ". Now at " + formatToMinutes(player.currentTime));
    }

    // Left Arrow: -10s (or -1s with Shift)
    else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 10;
        player.currentTime = Math.max(0, player.currentTime - step);
        announce("Back " + step + ". Now at " + formatToMinutes(player.currentTime));
    }

    // S: Mark Start
    else if (k === 's') {
        startTime = player.currentTime;
        document.getElementById('start-val').innerText = formatToMinutes(startTime);
        announce("Start point saved.");
    }

    // E: Mark End
    else if (k === 'e') {
        endTime = player.currentTime;
        document.getElementById('end-val').innerText = formatToMinutes(endTime);
        announce("End point saved.");
    }

    // X: Export
    else if (k === 'x' && !exportBtn.disabled) {
        runExport();
    }
});

async function runExport() {
    if (startTime < 0 || endTime <= startTime) return announce("Set start and end points first.");
    
    exportBtn.disabled = true;
    announce("Processing High-Speed Export...");

    try {
        ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(videoFile));
        await ffmpeg.run('-ss', startTime.toString(), '-to', endTime.toString(), '-i', 'input.mp4', '-c', 'copy', 'output.mp4');

        const data = ffmpeg.FS('readFile', 'output.mp4');
        const url = URL.createObjectURL(new Blob([data.buffer], {type: 'video/mp4'}));
        const a = document.createElement('a');
        a.href = url;
        a.download = `tech-house-trim-${videoFile.name}`;
        a.click();

        announce("Done! Download starting.");
        exportBtn.disabled = false;
    } catch (err) {
        announce("Export failed. File may be too complex.");
        exportBtn.disabled = false; 
    }
}