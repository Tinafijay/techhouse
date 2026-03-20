const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({ log: true, corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js' });

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const player = document.getElementById('player');

let files = { vid: null, img: null, bgm: null, sfx: null };
let markers = {
    trimS: 0, trimE: 0,
    imgS: 0, imgE: 5,
    sfxAt: 0,
    logoCorner: 'top-right'
};

const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function notify(msg) {
    document.getElementById('announcer').innerText = msg;
    document.getElementById('status-bar').innerText = msg;
}

function playBeep(f) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = f;
    g.gain.value = 0.1;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.1);
}

async function loadEngine() {
    notify("Warming up FFmpeg engine...");
    await ffmpeg.load();
    notify("Engine Ready. Upload a video!");
}
loadEngine();

// --- UPLOADS ---
document.getElementById('vid-up').onchange = (e) => {
    files.vid = e.target.files;
    player.src = URL.createObjectURL(files.vid);
    player.onloadedmetadata = () => {
        markers.trimE = player.duration;
        document.getElementById('stat-vid').innerText = `Video: ${player.duration.toFixed(1)}s`;
        document.getElementById('export-btn').disabled = false;
        notify("Video loaded.");
    };
};

document.getElementById('img-up').onchange = (e) => { 
    files.img = e.target.files; 
    notify("Image/Logo loaded. Use Ctrl+I to place."); 
};

// --- SHORTCUTS ---
window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    const mode = document.getElementById('edit-mode').value;

    // Standard Play/Pause
    if (k === 'k' || e.code === 'Space') {
        e.preventDefault();
        player.paused ? player.play() : player.pause();
    }

    // Logic by Mode
    if (mode === 'trim') {
        if (k === 'i') { markers.trimS = player.currentTime; playBeep(400); notify(`Start: ${markers.trimS.toFixed(1)}`); }
        if (k === 'o') { markers.trimE = player.currentTime; playBeep(600); notify(`End: ${markers.trimE.toFixed(1)}`); }
    }

    if (mode === 'logo' || e.ctrlKey && k === 'i') {
        if (e.ctrlKey && k === 'i') {
            e.preventDefault();
            markers.imgS = player.currentTime;
            markers.imgE = player.currentTime + 5;
            notify("Logo start set for 5 seconds.");
        }
        if (k === 'l') {
            const idx = (corners.indexOf(markers.logoCorner) + 1) % 4;
            markers.logoCorner = corners[idx];
            document.getElementById('stat-pos').innerText = `Logo Position: ${markers.logoCorner}`;
            notify(`Position: ${markers.logoCorner}`);
        }
    }

    if (k === 'm' && mode === 'sfx') {
        markers.sfxAt = player.currentTime;
        playBeep(1000);
        notify(`SFX set at ${markers.sfxAt.toFixed(1)}`);
    }

    if (e.ctrlKey && k === 'x') { e.preventDefault(); runExport(); }
});

async function runExport() {
    const btn = document.getElementById('export-btn');
    btn.disabled = true;
    document.getElementById('progress-container').classList.remove('hidden');
    notify("Mastering your video...");

    try {
        ffmpeg.FS('writeFile', 'v.mp4', await fetchFile(files.vid));
        let inputs = ['-ss', markers.trimS.toString(), '-to', markers.trimE.toString(), '-i', 'v.mp4'];
        
        // Position Math
        const posMap = {
            'top-left': '10:10',
            'top-right': 'W-w-10:10',
            'bottom-left': '10:H-h-10',
            'bottom-right': 'W-w-10:H-h-10'
        };

        let vFilter = '[0:v]';
        const isPortrait = document.getElementById('format-mode').value === 'portrait';
        if (isPortrait) vFilter += `crop=ih*(9/16):ih[v0];[v0]`;
        else vFilter += `copy[v0];[v0]`;

        if (files.img) {
            ffmpeg.FS('writeFile', 'logo.png', await fetchFile(files.img));
            inputs.push('-i', 'logo.png');
            vFilter += `[1:v]overlay=${posMap[markers.logoCorner]}:enable='between(t,${markers.imgS - markers.trimS},${markers.imgE - markers.trimS})'[v1]`;
        } else {
            vFilter += `null[v1]`;
        }

        // Simple audio mix logic
        let aFilter = '[0:a]amix=inputs=1[aout]'; 

        await ffmpeg.run(...inputs, '-filter_complex', `${vFilter};${aFilter}`, '-map', '[v1]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'ultrafast', 'out.mp4');

        const data = ffmpeg.FS('readFile', 'out.mp4');
        const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));
        const a = document.createElement('a');
        a.href = url; a.download = 'vibe-edit.mp4'; a.click();
        notify("Export finished! Check downloads.");
    } catch (err) {
        notify("Error during export. Check console.");
        console.error(err);
    } finally {
        btn.disabled = false;
        document.getElementById('progress-container').classList.add('hidden');
    }
}