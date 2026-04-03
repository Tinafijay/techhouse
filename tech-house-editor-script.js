const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({
    log: true,
    corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
});

const player = document.getElementById('player');
const status = document.getElementById('status-bar');

// App State
let mainVideoFile = null;
let assets = { logo: null, illustration: null, bgm: null, sfx: null };
let times = { s: 0, e: 0, illuAt: 0, sfxAt: 0 };

function updateStatus(msg) {
    status.innerText = msg;
    console.log("Status Update: " + msg);
}

// 1. Engine Load (Quietly in background)
async function initEngine() {
    try {
        await ffmpeg.load();
        updateStatus("Engine Ready.");
    } catch (e) {
        updateStatus("Engine Error. Please refresh.");
    }
}
initEngine();

// 2. Main Video Upload (FIXED: Loads instantly)
document.getElementById('main-upload-btn').onclick = () => document.getElementById('vid-uploader').click();
document.getElementById('vid-uploader').onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
        mainVideoFile = file;
        const url = URL.createObjectURL(file);
        player.src = url;
        player.load(); // Force browser to process video
        
        player.onloadedmetadata = () => {
            times.e = player.duration;
            document.getElementById('export-btn').disabled = false;
            updateStatus("Video Loaded. Duration: " + player.duration.toFixed(1) + "s");
        };
    }
};

// 3. Layer Uploads
document.getElementById('browse-layer-btn').onclick = () => document.getElementById('layer-uploader').click();
document.getElementById('layer-uploader').onchange = (e) => {
    const type = document.getElementById('layer-select').value;
    const file = e.target.files[0];
    if (!file) return;

    assets[type] = file;
    if (type === 'illustration') times.illuAt = player.currentTime;
    if (type === 'sfx') times.sfxAt = player.currentTime;

    updateStatus(`Added ${type.toUpperCase()} at current time.`);
    document.getElementById('lbl-layers').innerText = Object.values(assets).filter(a => a).length + " active layers";
};

// 4. Keyboard Shortcuts
window.onkeydown = (e) => {
    const k = e.key.toLowerCase();
    if (k === 's') { times.s = player.currentTime; updateStatus(`Start point: ${times.s.toFixed(1)}s`); }
    if (k === 'e') { times.e = player.currentTime; updateStatus(`End point: ${times.e.toFixed(1)}s`); }
    if (k === ' ') { e.preventDefault(); player.paused ? player.play() : player.pause(); }
    if (k === 'v') updateStatus(`Current: ${player.currentTime.toFixed(1)}s. Range: ${times.s.toFixed(1)} - ${times.e.toFixed(1)}`);
    if (e.ctrlKey && k === 'x') runExport();
};

player.ontimeupdate = () => {
    document.getElementById('time-display').innerText = player.currentTime.toFixed(2);
};

// 5. MASTER RENDER ENGINE
async function runExport() {
    updateStatus("Preparing render... please wait.");
    document.getElementById('prog-container').classList.remove('hidden');
    document.getElementById('export-btn').disabled = true;

    try {
        // Prepare Virtual Disk
        ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(mainVideoFile));
        
        let inputs = ['-ss', times.s.toString(), '-to', times.e.toString(), '-i', 'input.mp4'];
        let vTag = '[0:v]';
        let aTag = '[0:a]';
        let inputCount = 1;

        // Build Filter Complex dynamically
        let filterChain = "";
        
        // Portrait/Landscape Crop
        const isPortrait = document.getElementById('aspect-ratio').value === 'portrait';
        if (isPortrait) {
            filterChain += `${vTag}crop=ih*(9/16):ih,scale=720:1280[vcentered];`;
            vTag = '[vcentered]';
        } else {
            filterChain += `${vTag}scale=1280:720[vscaled];`;
            vTag = '[vscaled]';
        }

        // Permanent Logo
        if (assets.logo) {
            ffmpeg.FS('writeFile', 'logo.png', await fetchFile(assets.logo));
            inputs.push('-i', 'logo.png');
            filterChain += `[${inputCount}:v]scale=120:-1[lsmall];${vTag}[lsmall]overlay=W-w-20:20[vlogo];`;
            vTag = '[vlogo]';
            inputCount++;
        }

        // Illustration (Brief 3s)
        if (assets.illustration) {
            ffmpeg.FS('writeFile', 'illu.png', await fetchFile(assets.illustration));
            inputs.push('-i', 'illu.png');
            const start = Math.max(0, times.illuAt - times.s);
            filterChain += `[${inputCount}:v]scale=400:-1[ismall];${vTag}[ismall]overlay=(W-w)/2:(H-h)/2:enable='between(t,${start},${start+3})'[villu];`;
            vTag = '[villu]';
            inputCount++;
        }

        // Audio Mixing
        let aMix = `[0:a]volume=1.0[a_base];`;
        let aInputs = ['[a_base]'];

        if (assets.bgm) {
            ffmpeg.FS('writeFile', 'bgm.mp3', await fetchFile(assets.bgm));
            inputs.push('-i', 'bgm.mp3');
            aMix += `[${inputCount}:a]volume=0.2[bgm_v];`;
            aInputs.push('[bgm_v]');
            inputCount++;
        }

        if (assets.sfx) {
            ffmpeg.FS('writeFile', 'sfx.mp3', await fetchFile(assets.sfx));
            inputs.push('-i', 'sfx.mp3');
            const delay = Math.max(0, (times.sfxAt - times.s) * 1000);
            aMix += `[${inputCount}:a]volume=1.0,adelay=${delay}|${delay}[sfx_v];`;
            aInputs.push('[sfx_v]');
            inputCount++;
        }

        filterChain += aMix + aInputs.join('') + `amix=inputs=${aInputs.length}:duration=first[aout]`;

        // Execution
        ffmpeg.setProgress(({ ratio }) => {
            const pct = Math.round(ratio * 100);
            document.getElementById('prog-bar').style.width = pct + '%';
            document.getElementById('prog-label').innerText = `Processing: ${pct}%`;
        });

        await ffmpeg.run(
            ...inputs,
            '-filter_complex', filterChain,
            '-map', vTag,
            '-map', '[aout]',
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-c:a', 'aac',
            'output.mp4'
        );

        // Download
        const data = ffmpeg.FS('readFile', 'output.mp4');
        const url = URL.createObjectURL(new Blob([data.buffer], {type: 'video/mp4'}));
        const a = document.createElement('a');
        a.href = url; a.download = `tech-house-export.mp4`; a.click();
        
        updateStatus("Render Complete! File downloaded.");
    } catch (e) {
        updateStatus("Render Failed. Memory might be full.");
        console.error(e);
    } finally {
        document.getElementById('prog-container').classList.add('hidden');
        document.getElementById('export-btn').disabled = false;
    }
}