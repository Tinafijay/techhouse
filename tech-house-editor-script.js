const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({ log: true, corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js' });

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const player = document.getElementById('player');

let files = { vid: null, img: null, bgm: null, sfx: null };
let markers = {
    start: 0, end: 0,
    imgS: 0, imgE: 5,
    sfxAt: 0,
    logoPos: 'W-w-10:10' // Default top-right
};

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
    notify("Engine Ready!");
}
loadEngine();

// --- UPLOADS ---
document.getElementById('vid-up').onchange = (e) => {
    files.vid = e.target.files;
    player.src = URL.createObjectURL(files.vid);
    player.onloadedmetadata = () => {
        markers.end = player.duration;
        document.getElementById('stat-vid').innerText = `Video: ${player.duration.toFixed(1)}s`;
        document.getElementById('export-btn').disabled = false;
        notify("Video loaded.");
    };
};

document.getElementById('img-up').onchange = (e) => { files.img = e.target.files; notify("Logo loaded!"); };

// --- KEYBOARD ---
window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    const t = player.currentTime;

    if (k === 'i') { markers.start = t; playBeep(400); notify(`Point A set: ${t.toFixed(1)}`); }
    if (k === 'o') { markers.end = t; playBeep(600); notify(`Point B set: ${t.toFixed(1)}`); }
    
    // BACKSPACE TO DELETE PART
    if (e.key === 'Backspace') {
        notify(`Marked zone ${markers.start.toFixed(1)} to ${markers.end.toFixed(1)} for deletion.`);
        playBeep(200);
    }

    if (e.ctrlKey && k === 'i') {
        e.preventDefault();
        markers.imgS = t;
        markers.imgE = t + 5;
        notify("Logo set for 5 seconds.");
    }

    if (e.ctrlKey && k === 'x') { e.preventDefault(); runExport(); }
});

async function runExport() {
    const btn = document.getElementById('export-btn');
    const isTrim = document.getElementById('trim-mode-check').checked;
    btn.disabled = true;
    document.getElementById('progress-container').classList.remove('hidden');
    notify("Exporting... don't close the tab!");

    try {
        ffmpeg.FS('writeFile', 'v.mp4', await fetchFile(files.vid));
        
        let vFilter = "";
        let aFilter = "";

        if (isTrim) {
            // TRIM MODE: Only keep what's between I and O
            vFilter = `[0:v]trim=start=${markers.start}:end=${markers.end},setpts=PTS-STARTPTS[v0];`;
            aFilter = `[0:a]atrim=start=${markers.start}:end=${markers.end},asetpts=PTS-STARTPTS[a0];`;
        } else {
            // CUT MODE: Delete what's between I and O
            vFilter = `[0:v]select='not(between(t,${markers.start},${markers.end}))',setpts=N/FRAME_RATE/TB[v0];`;
            aFilter = `[0:a]aselect='not(between(t,${markers.start},${markers.end}))',asetpts=N/SR/TB[a0];`;
        }

        // Add Logo if present
        if (files.img) {
            ffmpeg.FS('writeFile', 'l.png', await fetchFile(files.img));
            vFilter += `[v0][1:v]overlay=${markers.logoPos}:enable='between(t,${markers.imgS},${markers.imgE})'[v1]`;
        } else {
            vFilter += `[v0]copy[v1]`;
        }

        const args = ['-i', 'v.mp4'];
        if (files.img) args.push('-i', 'l.png');
        
        await ffmpeg.run(...args, '-filter_complex', `${vFilter};${aFilter}`, '-map', '[v1]', '-map', '[a0]', '-c:v', 'libx264', '-preset', 'ultrafast', 'out.mp4');

        const data = ffmpeg.FS('readFile', 'out.mp4');
        const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));
        const a = document.createElement('a');
        a.href = url; a.download = 'vibe-render.mp4'; a.click();
        notify("Done!");
    } catch (err) {
        notify("Export failed. Check the console!");
        console.error(err);
    } finally {
        btn.disabled = false;
        document.getElementById('progress-container').classList.add('hidden');
    }
}