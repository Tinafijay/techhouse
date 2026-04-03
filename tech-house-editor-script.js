const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({
    log: true,
    corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
});

const player = document.getElementById('player');
const status = document.getElementById('status-bar');
const progBar = document.getElementById('prog-bar');
const progText = document.getElementById('prog-text');

// Logic State
let videoFile = null;
let layers = {
    logo: null,    // Permanent
    temp: null,    // 3 seconds
    bgm: null,     // Music
    sfx: null      // Ding
};
let markers = { s: 0, e: 0, tempAt: 0, sfxAt: 0 };

function notify(msg) {
    status.innerText = msg;
    console.log(msg);
}

// 1. Initializing FFmpeg 0.11.0
async function init() {
    try {
        notify("Loading Engine (V0.11.0)...");
        await ffmpeg.load();
        notify("Ready. Load your video.");
    } catch (e) {
        notify("Error: Engine failed. Refresh page.");
    }
}
init();

// 2. Video Upload
document.getElementById('vid-in').onchange = (e) => {
    videoFile = e.target.files[0];
    if (videoFile) {
        player.src = URL.createObjectURL(videoFile);
        player.onloadedmetadata = () => {
            markers.e = player.duration;
            document.getElementById('info-vid').innerText = `Video: ${player.duration.toFixed(1)}s`;
            document.getElementById('render-btn').disabled = false;
            notify("Video Loaded.");
        };
    }
};

// 3. Layer Uploads
document.getElementById('browse-btn').onclick = () => document.getElementById('file-in').click();
document.getElementById('file-in').onchange = (e) => {
    const type = document.getElementById('layer-type').value;
    const file = e.target.files[0];
    if (!file) return;

    layers[type] = file;
    if (type === 'temp') markers.tempAt = player.currentTime;
    if (type === 'sfx') markers.sfxAt = player.currentTime;

    notify(`${type.toUpperCase()} layer updated at ${player.currentTime.toFixed(1)}s`);
    document.getElementById('info-layers').innerText = `Layers: ${Object.values(layers).filter(x => x).length}`;
};

// 4. Keyboard Navigation
window.onkeydown = (e) => {
    const k = e.key.toLowerCase();
    if (k === 's') { markers.s = player.currentTime; notify(`Start Set: ${markers.s.toFixed(1)}`); }
    if (k === 'e') { markers.e = player.currentTime; notify(`End Set: ${markers.e.toFixed(1)}`); }
    if (k === 'v') notify(`Status: Trim ${markers.s.toFixed(1)} to ${markers.e.toFixed(1)}`);
    if (k === ' ') { e.preventDefault(); player.paused ? player.play() : player.pause(); }
    if (e.ctrlKey && k === 'x') runExport();
};

player.ontimeupdate = () => {
    document.getElementById('time-display').innerText = player.currentTime.toFixed(2);
};

// 5. MASTER EXPORT ENGINE
async function runExport() {
    notify("Export started. Preparing files...");
    document.getElementById('prog-container').classList.remove('hidden');
    document.getElementById('render-btn').disabled = true;

    // A. Setup File System
    ffmpeg.FS('writeFile', 'main.mp4', await fetchFile(videoFile));
    let inputs = ['-ss', markers.s.toString(), '-to', markers.e.toString(), '-i', 'main.mp4'];
    let inputIdx = 1;

    // Add Inputs and keep track of indices
    const idx = { logo: -1, temp: -1, bgm: -1, sfx: -1 };
    
    if (layers.logo) { 
        ffmpeg.FS('writeFile', 'logo.png', await fetchFile(layers.logo)); 
        inputs.push('-i', 'logo.png'); idx.logo = inputIdx++; 
    }
    if (layers.temp) { 
        ffmpeg.FS('writeFile', 'temp.png', await fetchFile(layers.temp)); 
        inputs.push('-i', 'temp.png'); idx.temp = inputIdx++; 
    }
    if (layers.bgm) { 
        ffmpeg.FS('writeFile', 'bgm.mp3', await fetchFile(layers.bgm)); 
        inputs.push('-i', 'bgm.mp3'); idx.bgm = inputIdx++; 
    }
    if (layers.sfx) { 
        ffmpeg.FS('writeFile', 'sfx.mp3', await fetchFile(layers.sfx)); 
        inputs.push('-i', 'sfx.mp3'); idx.sfx = inputIdx++; 
    }

    // B. Build Filter Complex
    let vFilter = '[0:v]';
    let aFilter = '[0:a]';
    let aStreams = ['[a0]'];

    // 1. Aspect Ratio (Portrait/Landscape)
    const format = document.getElementById('export-format').value;
    if (format === 'portrait') {
        vFilter += `crop=ih*(9/16):ih,scale=720:1280[vscaled];`;
    } else {
        vFilter += `scale=1280:720[vscaled];`;
    }
    vFilter = '[vscaled]';

    // 2. Logo Overlay (Permanent)
    if (idx.logo !== -1) {
        vFilter += `[${idx.logo}:v]scale=150:-1[logo_small];${vFilter}[logo_small]overlay=W-w-20:20[vlogo];`;
        vFilter = '[vlogo]';
    }

    // 3. Illustration Overlay (Brief 3 seconds)
    if (idx.temp !== -1) {
        const start = Math.max(0, markers.tempAt - markers.s);
        vFilter += `[${idx.temp}:v]scale=400:-1[temp_scaled];${vFilter}[temp_scaled]overlay=(W-w)/2:(H-h)/2:enable='between(t,${start},${start+3})'[vtemp];`;
        vFilter = '[vtemp]';
    }

    // 4. Audio Mixing (BGM and SFX)
    aFilter = '[0:a]volume=1.0[a0];'; // Initialize base audio
    if (idx.bgm !== -1) {
        aFilter += `[${idx.bgm}:a]volume=0.2[abgm];`;
        aStreams.push('[abgm]');
    }
    if (idx.sfx !== -1) {
        const delay = Math.max(0, (markers.sfxAt - markers.s) * 1000);
        aFilter += `[${idx.sfx}:a]volume=1.0,adelay=${delay}|${delay}[asfx];`;
        aStreams.push('[asfx]');
    }

    let finalFilter = vFilter + aFilter;
    if (aStreams.length > 1) {
        finalFilter += `${aStreams.join('')}amix=inputs=${aStreams.length}:duration=first[aout]`;
    } else {
        finalFilter += `[a0]copy[aout]`;
    }

    // C. Run Command
    ffmpeg.setProgress(({ ratio }) => {
        const pct = Math.round(ratio * 100);
        progBar.style.width = pct + '%';
        progText.innerText = `Rendering: ${pct}%`;
    });

    try {
        await ffmpeg.run(
            ...inputs,
            '-filter_complex', finalFilter,
            '-map', vFilter.includes('vtemp') ? '[vtemp]' : (vFilter.includes('vlogo') ? '[vlogo]' : '[vscaled]'),
            '-map', '[aout]',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-c:a', 'aac',
            'output.mp4'
        );

        const data = ffmpeg.FS('readFile', 'output.mp4');
        const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));
        const a = document.createElement('a');
        a.href = url; a.download = `tech-house-${Date.now()}.mp4`; a.click();
        notify("EXPORT COMPLETE!");
    } catch (err) {
        notify("EXPORT FAILED. Video might be too large.");
        console.error(err);
    } finally {
        document.getElementById('render-btn').disabled = false;
        document.getElementById('prog-container').classList.add('hidden');
    }
}