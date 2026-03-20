const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({ log: true, corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js' });

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const player = document.getElementById('player');

let files = { vid: null, img: null, bgm: null, sfx: null };
let markers = { start: 0, end: 0, imgS: 0, imgE: 5, sfxAt: 0, cutMode: false };

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
    notify("Warming up engine...");
    await ffmpeg.load();
    notify("Ready! Upload a video to begin.");
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

document.getElementById('img-up').onchange = (e) => { files.img = e.target.files; notify("Logo loaded."); };

// --- KEYBOARD ---
window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    const t = player.currentTime;
    const mode = document.getElementById('edit-mode').value;

    if (k === 'i') { markers.start = t; playBeep(400); notify(`Start: ${t.toFixed(1)}s`); }
    if (k === 'o') { markers.end = t; playBeep(600); notify(`End: ${t.toFixed(1)}s`); }
    
    if (e.key === 'Backspace') {
        markers.cutMode = true;
        document.getElementById('stat-action').innerText = "Action: Cut out selection";
        notify("Selected area marked for deletion.");
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
    const isTrim = document.getElementById('trim-check').checked;
    btn.disabled = true;
    document.getElementById('progress-container').classList.remove('hidden');
    notify("Exporting... please wait.");

    try {
        ffmpeg.FS('writeFile', 'v.mp4', await fetchFile(files.vid));
        let vFilter = "";
        let aFilter = "";

        if (isTrim) {
            vFilter = `[0:v]trim=start=${markers.start}:end=${markers.end},setpts=PTS-STARTPTS[v0];`;
            aFilter = `[0:a]atrim=start=${markers.start}:end=${markers.end},asetpts=PTS-STARTPTS[a0];`;
        } else if (markers.cutMode) {
            vFilter = `[0:v]select='not(between(t,${markers.start},${markers.end}))',setpts=N/FRAME_RATE/TB[v0];`;
            aFilter = `[0:a]aselect='not(between(t,${markers.start},${markers.end}))',asetpts=N/SR/TB[a0];`;
        } else {
            vFilter = `[0:v]null[v0];`;
            aFilter = `[0:a]anull[a0];`;
        }

        if (files.img) {
            ffmpeg.FS('writeFile', 'l.png', await fetchFile(files.img));
            vFilter += `[v0][1:v]overlay=W-w-10:10:enable='between(t,${markers.imgS},${markers.imgE})'[outv]`;
        } else {
            vFilter += `[v0]copy[outv]`;
        }

        const args = ['-i', 'v.mp4'];
        if (files.img) args.push('-i', 'l.png');
        
        await ffmpeg.run(...args, '-filter_complex', `${vFilter}${aFilter}amix=inputs=1[outa]`, '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'ultrafast', 'out.mp4');

        const data = ffmpeg.FS('readFile', 'out.mp4');
        const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));
        const a = document.createElement('a');
        a.href = url; a.download = 'vibe-render.mp4'; a.click();
        notify("Export finished!");
    } catch (err) {
        notify("Export failed. Check the console.");
        console.error(err);
    } finally {
        btn.disabled = false;
        document.getElementById('progress-container').classList.add('hidden');
    }
}