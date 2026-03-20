const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({ log: true, corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js' });

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const player = document.getElementById('player');

// State: All layers
let files = { vid: null, img: null, bgm: null, sfx: null };
let markers = {
    trimS: 0, trimE: 0,
    imgS: 0, imgE: 5,
    sfxAt: 0
};

// --- HELPERS ---
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

// --- INITIALIZE ---
async function loadEngine() {
    notify("Engine warming up...");
    await ffmpeg.load();
    notify("Ready. Upload your Video to start.");
}
loadEngine();

// --- UPLOAD LOGIC ---
document.getElementById('vid-up').onchange = (e) => {
    files.vid = e.target.files[0];
    player.src = URL.createObjectURL(files.vid);
    player.onloadedmetadata = () => {
        markers.trimE = player.duration;
        document.getElementById('stat-vid').innerText = `Video: Loaded (${player.duration.toFixed(1)}s)`;
        document.getElementById('export-btn').disabled = false;
        notify("Video loaded.");
    };
};

document.getElementById('img-up').onchange = (e) => { 
    files.img = e.target.files[0]; 
    document.getElementById('stat-img').innerText = "Image: Loaded. Press G/H to place.";
    notify("Image uploaded."); 
};

document.getElementById('bgm-up').onchange = (e) => { 
    files.bgm = e.target.files[0]; 
    document.getElementById('stat-bgm').innerText = "Music: Loaded (Looping/Background)";
    notify("Background music loaded."); 
};

document.getElementById('sfx-up').onchange = (e) => { 
    files.sfx = e.target.files[0]; 
    document.getElementById('stat-sfx').innerText = "SFX: Loaded. Move seekhead and press M.";
    notify("Sound effect loaded."); 
};

// --- KEYBOARD LOGIC ---
window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    const t = player.currentTime;

    if (k === 'k' || e.code === 'Space') {
        e.preventDefault();
        player.paused ? player.play() : player.pause();
    }
    if (k === 'l') player.currentTime += 5;
    if (k === 'j') player.currentTime -= 5;

    // MARKERS
    if (k === 'i') { markers.trimS = t; playBeep(800); notify(`Trim Start: ${t.toFixed(1)}`); }
    if (k === 'o') { markers.trimE = t; playBeep(400); notify(`Trim End: ${t.toFixed(1)}`); }
    
    if (k === 'g') { markers.imgS = t; playBeep(1000); notify(`Image appears at: ${t.toFixed(1)}`); }
    if (k === 'h') { markers.imgE = t; playBeep(600); notify(`Image disappears at: ${t.toFixed(1)}`); }
    
    if (k === 'm') { markers.sfxAt = t; playBeep(1200); notify(`Sound Effect set at: ${t.toFixed(1)}`); }

    if (k === 'v') {
        notify(`Status: Trim ${markers.trimS.toFixed(1)} to ${markers.trimE.toFixed(1)}. SFX at ${markers.sfxAt.toFixed(1)}.`);
    }

    if (e.ctrlKey && k === 'x') { e.preventDefault(); runExport(); }
});

// --- RENDER ENGINE ---
async function runExport() {
    const btn = document.getElementById('export-btn');
    btn.disabled = true;
    document.getElementById('progress-container').classList.remove('hidden');
    notify("Starting Master Render...");

    try {
        // 1. Write files to FFmpeg Virtual Drive
        ffmpeg.FS('writeFile', 'v.mp4', await fetchFile(files.vid));
        let inputCount = 1;
        let inputs = ['-ss', markers.trimS.toString(), '-to', markers.trimE.toString(), '-i', 'v.mp4'];

        if (files.img) { ffmpeg.FS('writeFile', 'i.png', await fetchFile(files.img)); inputs.push('-i', 'i.png'); }
        if (files.bgm) { ffmpeg.FS('writeFile', 'b.mp3', await fetchFile(files.bgm)); inputs.push('-i', 'b.mp3'); }
        if (files.sfx) { ffmpeg.FS('writeFile', 's.mp3', await fetchFile(files.sfx)); inputs.push('-i', 's.mp3'); }

        // 2. Build Complex Filter
        // We shift timestamps relative to the trim start
        const relImgS = Math.max(0, markers.imgS - markers.trimS);
        const relImgE = Math.max(0, markers.imgE - markers.trimS);
        const relSfxAt = Math.max(0, markers.sfxAt - markers.trimS) * 1000; // ms for adelay

        let vFilter = '[0:v]'; 
        let aFilter = '[0:a]'; 
        let aStreams = ['[a0]'];

        // Denoise first?
        if (document.getElementById('denoise-check').checked) {
            aFilter = '[0:a]afftdn[a0];';
        } else {
            aFilter = '[0:a]copy[a0];'; // Placeholder
        }

        // Image Overlay (Input 1)
        if (files.img) {
            vFilter += `[1:v]overlay=10:10:enable='between(t,${relImgS},${relImgE})'[v1];`;
            vFilter = '[v1]';
        }

        // Audio Mixing
        let aMix = aFilter;
        let mixIndex = 1;
        if (files.img) mixIndex++; // skip image index

        if (files.bgm) {
            aMix += `[${mixIndex}:a]volume=0.3[abgm];`;
            aStreams.push('[abgm]');
            mixIndex++;
        }
        if (files.sfx) {
            aMix += `[${mixIndex}:a]volume=1.0,adelay=${relSfxAt}|${relSfxAt}[asfx];`;
            aStreams.push('[asfx]');
        }

        const finalAMix = `${aMix}${aStreams.join('')}amix=inputs=${aStreams.length}:duration=first[aout]`;

        // 3. RUN FFmpeg
        let fullArgs = [...inputs, '-filter_complex', `${vFilter}${finalAMix}`, '-map', '[v1]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'ultrafast', 'out.mp4'];
        
        // If no image, map original video
        if (!files.img) {
            fullArgs = [...inputs, '-filter_complex', finalAMix, '-map', '0:v', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'ultrafast', 'out.mp4'];
        }

        ffmpeg.setProgress(({ ratio }) => {
            const p = Math.floor(ratio * 100);
            document.getElementById('render-prog').value = p;
            document.getElementById('prog-text').innerText = `${p}% Rendered`;
        });

        await ffmpeg.run(...fullArgs);

        // 4. DOWNLOAD
        const data = ffmpeg.FS('readFile', 'out.mp4');
        const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));
        const a = document.createElement('a');
        a.href = url; a.download = 'pro-edit.mp4'; a.click();
        notify("Export Complete!");

    } catch (e) {
        notify("Render Error. Files might be too large for Chromebook RAM.");
        console.error(e);
    } finally {
        btn.disabled = false;
        document.getElementById('progress-container').classList.add('hidden');
    }
}