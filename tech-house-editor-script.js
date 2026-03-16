const { FFmpeg } = ffmpeg;
const { fetchFile, toBlobURL } = FFmpegUtil;

const ffmpegInstance = new FFmpeg();
const player = document.getElementById('player');
const uploader = document.getElementById('uploader');
const statusDisp = document.getElementById('status-display');
const exportBtn = document.getElementById('export-btn');

let videoFile = null;
let overlayFile = null;
let mode = "TRIM";
let trimPoints = { start: 0, end: 0 };
let overlayPoints = { start: 0, end: 5 };

function announce(msg) {
    statusDisp.innerText = "Status: " + msg;
    document.getElementById('announcer').innerText = msg;
}

async function init() {
    try {
        await ffmpegInstance.load({
            coreURL: await toBlobURL('https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js', 'text/javascript'),
            wasmURL: await toBlobURL('https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm', 'application/wasm'),
        });
        announce("Engine Ready. Upload a video to start.");
    } catch (e) {
        announce("Initialization Failed. Check coi-serviceworker.js");
    }
}
init();

uploader.onchange = (e) => {
    videoFile = e.target.files[0];
    if (videoFile) {
        const url = URL.createObjectURL(videoFile);
        player.src = url;
        player.style.display = "block";
        exportBtn.disabled = false;
        // Move focus away from button so Space works correctly
        uploader.blur(); 
        announce("Video Loaded. Use Space to play, S/E to trim.");
    }
};

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();

    // FIXED SPACEBAR: If focused on uploader, blur it and play video instead
    if (e.code === 'Space') {
        e.preventDefault();
        if (document.activeElement === uploader) uploader.blur();
        player.paused ? player.play() : player.pause();
    }

    // Ctrl + O: Overlay
    if (e.ctrlKey && k === 'o') {
        e.preventDefault();
        const picker = document.createElement('input');
        picker.type = 'file'; picker.accept = 'image/*';
        picker.onchange = (ev) => {
            overlayFile = ev.target.files[0];
            mode = "OVERLAY";
            document.getElementById('task-panel').classList.remove('hidden');
            document.getElementById('mode-badge').innerText = "OVERLAY MODE";
            announce("Image Ready. Set Start (S) and End (E) for the image.");
        };
        picker.click();
    }

    if (k === 's') {
        if (mode === "TRIM") trimPoints.start = player.currentTime;
        else overlayPoints.start = player.currentTime;
        updateUI();
    }

    if (k === 'e') {
        if (mode === "TRIM") trimPoints.end = player.currentTime;
        else overlayPoints.end = player.currentTime;
        updateUI();
    }

    if (k === 'enter' && mode === "OVERLAY") {
        mode = "TRIM";
        document.getElementById('task-panel').classList.add('hidden');
        document.getElementById('mode-badge').innerText = "TRIM MODE";
        announce("Overlay timing saved.");
    }

    if (e.ctrlKey && k === 'x') {
        e.preventDefault();
        runExport(confirm("Press OK for Portrait (9:16), Cancel for Landscape."));
    }
});

function updateUI() {
    const target = (mode === "TRIM") ? trimPoints : overlayPoints;
    document.getElementById('manual-s').value = target.start.toFixed(3);
    document.getElementById('manual-e').value = target.end.toFixed(3);
}

player.ontimeupdate = () => {
    document.getElementById('current-time').innerText = player.currentTime.toFixed(3);
};

ffmpegInstance.on('progress', ({ ratio }) => {
    const pct = Math.floor(ratio * 100);
    document.getElementById('prog-bar').style.width = pct + '%';
    document.getElementById('prog-label').innerText = pct + '%';
});

async function runExport(portrait) {
    if (trimPoints.end <= trimPoints.start) return alert("Set valid Start/End points!");
    
    exportBtn.disabled = true;
    document.getElementById('prog-container').classList.remove('hidden');
    announce("Exporting... this may take a moment.");

    await ffmpegInstance.writeFile('in.mp4', await fetchFile(videoFile));
    
    let vFilter = `fade=t=in:st=0:d=1,fade=t=out:st=${trimPoints.end - trimPoints.start - 1}:d=1`;
    if (portrait) vFilter += `,crop=ih*(9/16):ih,scale=720:1280`;

    if (overlayFile) {
        await ffmpegInstance.writeFile('img.png', await fetchFile(overlayFile));
        vFilter = `[0:v]${vFilter}[vbase]; [vbase][1:v]overlay=W-w-20:H-h-20:enable='between(t,${overlayPoints.start - trimPoints.start},${overlayPoints.end - trimPoints.start})'`;
    }

    const args = ['-ss', trimPoints.start.toString(), '-to', trimPoints.end.toString(), '-i', 'in.mp4'];
    if (overlayFile) args.push('-i', 'img.png');
    
    args.push('-filter_complex', vFilter);

    let aFilter = `afade=t=in:st=0:d=1,afade=t=out:st=${trimPoints.end - trimPoints.start - 1}:d=1`;
    if (document.getElementById('denoise-toggle').checked) aFilter = "afftdn," + aFilter;
    
    args.push('-af', aFilter, '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', 'out.mp4');

    await ffmpegInstance.exec(args);

    const data = await ffmpegInstance.readFile('out.mp4');
    const url = URL.createObjectURL(new Blob([data.buffer], {type: 'video/mp4'}));
    const a = document.createElement('a');
    a.href = url;
    a.download = `techhouse_export.mp4`;
    a.click();

    document.getElementById('prog-container').classList.add('hidden');
    exportBtn.disabled = false;
    announce("Success! Download started.");
    
    await ffmpegInstance.deleteFile('in.mp4');
    if (overlayFile) await ffmpegInstance.deleteFile('img.png');
}