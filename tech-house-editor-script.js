const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({ log: true, corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js' });

const player = document.getElementById('player');
const statusDisp = document.getElementById('status-display');
const announcer = document.getElementById('announcer');
const exportBtn = document.getElementById('export-btn');
const modeBadge = document.getElementById('mode-badge');

let mode = "TRIM"; 
let videoFile = null;

const assets = {
    trim: { s: 0, e: 0 },
    img: { file: null, s: 0, e: 5 },
    bgm: { file: null, vol: 0.2 },
    sfx: { file: null, s: 0, e: 2, vol: 0.8 }
};

// --- HELPERS ---
function announce(msg) {
    statusDisp.innerText = "Status: " + msg;
    announcer.innerText = msg;
}

function formatTime(sec) {
    if (isNaN(sec)) return "00:00.000";
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(3);
    return `${m.toString().padStart(2, '0')}:${s.padStart(6, '0')}`;
}

function updateUI() {
    document.getElementById('lbl-trim').innerText = `${assets.trim.s.toFixed(2)}s to ${assets.trim.e.toFixed(2)}s`;
    if(assets.img.file) document.getElementById('lbl-img').innerText = `Active (${assets.img.s.toFixed(2)}s to ${assets.img.e.toFixed(2)}s)`;
    if(assets.bgm.file) document.getElementById('lbl-bgm').innerText = `Active (Vol: ${Math.round(assets.bgm.vol * 100)}%)`;
    if(assets.sfx.file) document.getElementById('lbl-sfx').innerText = `Active (${assets.sfx.s.toFixed(2)}s, Vol: ${Math.round(assets.sfx.vol * 100)}%)`;
}

async function init() {
    try {
        announce("Starting Proven Engine... Please wait.");
        await ffmpeg.load();
        announce("Tech House Engine Ready. Upload your main video to begin.");
    } catch (e) {
        announce("Engine Error. Please refresh the page.");
    }
}
init();

// --- MAIN VIDEO UPLOAD ---
document.getElementById('uploader').onchange = (e) => {
    videoFile = e.target.files[0];
    if (videoFile) {
        player.src = URL.createObjectURL(videoFile);
        player.style.display = "block";
        document.getElementById('main-upload-btn').blur(); 
        
        player.onloadedmetadata = () => {
            assets.trim.e = player.duration; 
            updateUI();
            exportBtn.disabled = false;
            announce(`Video Loaded. Duration ${player.duration.toFixed(1)} seconds.`);
        };
    }
};

player.ontimeupdate = () => { document.getElementById('current-time').innerText = formatTime(player.currentTime); };

// --- DROPDOWN UPLOADER LOGIC ---
document.getElementById('btn-browse-track').onclick = () => {
    const trackType = document.getElementById('track-type').value;
    const uploader = document.getElementById('track-uploader');
    
    uploader.accept = (trackType === 'img') ? 'image/*' : 'audio/*';
    uploader.onchange = (e) => {
        const file = e.target.files[0];
        if(!file) return;

        if (trackType === 'img') {
            assets.img.file = file; mode = "OVERLAY"; modeBadge.innerText = "IMAGE OVERLAY MODE";
            announce("Image added. Press S and E to set when it appears, then Enter to lock.");
        } else if (trackType === 'bgm') {
            assets.bgm.file = file; mode = "BGM"; modeBadge.innerText = "BGM MUSIC MODE";
            announce("Background Music added. Up and Down arrows change volume. Enter to lock.");
        } else if (trackType === 'sfx') {
            assets.sfx.file = file; mode = "SFX"; modeBadge.innerText = "SOUND EFFECT MODE";
            announce("Sound Effect added. Press S to mark exactly when it should play. Enter to lock.");
        }
        document.getElementById('btn-browse-track').blur();
        updateUI();
    };
    uploader.click();
};

// --- KEYBOARD CONTROLLER ---
window.addEventListener('keydown', (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON" || e.target.tagName === "SELECT") return;
    
    const k = e.key.toLowerCase();
    const currTime = player.currentTime;

    if (e.code === 'Space') {
        e.preventDefault();
        if (player.paused) { player.play(); announce("Playing"); } 
        else { player.pause(); announce(`Paused at ${currTime.toFixed(2)}`); }
    }

    // SHIFT = 1 SECOND (Precise), NORMAL = 10 SECONDS (Fast)
    if (e.code === 'ArrowRight') {
        e.preventDefault();
        const jump = e.shiftKey ? 1 : 10;
        player.currentTime = Math.min(player.duration, currTime + jump);
        announce(`Seeked forward ${jump} ${jump === 1 ? 'second' : 'seconds'}.`);
    }
    if (e.code === 'ArrowLeft') {
        e.preventDefault();
        const jump = e.shiftKey ? 1 : 10;
        player.currentTime = Math.max(0, currTime - jump);
        announce(`Seeked backward ${jump} ${jump === 1 ? 'second' : 'seconds'}.`);
    }

    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        if(mode === "BGM" || mode === "SFX") {
            e.preventDefault();
            const change = e.code === 'ArrowUp' ? 0.1 : -0.1;
            assets[mode.toLowerCase()].vol = Math.max(0, Math.min(1, assets[mode.toLowerCase()].vol + change));
            announce(`${mode} Volume: ${Math.round(assets[mode.toLowerCase()].vol * 100)} percent.`);
            updateUI();
        }
    }

    if (k === 's') {
        if(mode === "BGM") return announce("BGM covers the whole video. Press Enter to lock.");
        assets[mode.toLowerCase()].s = currTime;
        announce(`${mode} Start marked at ${currTime.toFixed(2)}.`);
        updateUI();
    }
    if (k === 'e') {
        if(mode === "BGM") return;
        assets[mode.toLowerCase()].e = currTime;
        announce(`${mode} End marked at ${currTime.toFixed(2)}.`);
        updateUI();
    }

    if (k === 'enter' && mode !== "TRIM") {
        mode = "TRIM"; modeBadge.innerText = "TRIM MODE";
        announce("Layer Locked. Back to Main Trim Mode.");
    }

    if (e.ctrlKey && k === 'x') {
        e.preventDefault();
        if (!videoFile) return announce("Upload a video first!");
        runExport(confirm("Click OK for Portrait (9:16), or Cancel for Widescreen."));
    }
});

ffmpeg.setProgress(({ ratio }) => {
    const pct = Math.floor(ratio * 100);
    document.getElementById('prog-bar').style.width = pct + '%';
    document.getElementById('prog-label').innerText = pct + '% Complete';
});

// --- MASTER EXPORT RENDERER ---
async function runExport(isPortrait) {
    if (assets.trim.e <= assets.trim.s) return announce("Error: End point must be after Start point.");

    exportBtn.disabled = true;
    document.getElementById('prog-container').classList.remove('hidden');
    announce("Tech House Render Starting... computing pixels.");

    try {
        ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(videoFile));
        let args = ['-ss', assets.trim.s.toString(), '-to', assets.trim.e.toString(), '-i', 'input.mp4'];
        
        let inputIdx = 1;
        let vStream = '[0:v]';
        let audioStreams = [];
        let vFilter = '', aFilter = '';

        // 1. AUDIO DENOISE LOGIC (Restored!)
        if (document.getElementById('denoise-toggle').checked) {
            aFilter += `[0:a]afftdn[aden];`;
            audioStreams.push('[aden]');
        } else {
            audioStreams.push('[0:a]'); // Use original audio
        }

        // 2. VISUAL EFFECTS LOGIC (New!)
        const fx = document.getElementById('video-fx').value;
        if (fx === 'bw') { vFilter += `${vStream}hue=s=0[vfx];`; vStream = '[vfx]'; } 
        else if (fx === 'sepia') { vFilter += `${vStream}colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131[vfx];`; vStream = '[vfx]'; } 
        else if (fx === 'blur') { vFilter += `${vStream}boxblur=5:1[vfx];`; vStream = '[vfx]'; }

        // 3. PORTRAIT CROP
        if (isPortrait) {
            vFilter += `${vStream}crop=ih*(9/16):ih,scale=720:1280[vport];`;
            vStream = '[vport]';
        }

        // 4. IMAGE OVERLAY
        if (assets.img.file) {
            ffmpeg.FS('writeFile', 'img.png', await fetchFile(assets.img.file));
            args.push('-i', 'img.png');
            const relStart = Math.max(0, assets.img.s - assets.trim.s);
            const relEnd = Math.max(0, assets.img.e - assets.trim.s);
            vFilter += `${vStream}[${inputIdx}:v]overlay=W-w-20:H-h-20:enable='between(t,${relStart},${relEnd})'[vout];`;
            vStream = '[vout]';
            inputIdx++;
        }

        // 5. BACKGROUND MUSIC
        if (assets.bgm.file) {
            ffmpeg.FS('writeFile', 'bgm.mp3', await fetchFile(assets.bgm.file));
            args.push('-i', 'bgm.mp3');
            aFilter += `[${inputIdx}:a]volume=${assets.bgm.vol}[abgm];`;
            audioStreams.push('[abgm]');
            inputIdx++;
        }

        // 6. SOUND EFFECT
        if (assets.sfx.file) {
            ffmpeg.FS('writeFile', 'sfx.mp3', await fetchFile(assets.sfx.file));
            args.push('-i', 'sfx.mp3');
            const relStartMs = Math.max(0, assets.sfx.s - assets.trim.s) * 1000;
            aFilter += `[${inputIdx}:a]volume=${assets.sfx.vol},adelay=${relStartMs}|${relStartMs}[asfx];`;
            audioStreams.push('[asfx]');
            inputIdx++;
        }

        // Mix audio tracks
        if (audioStreams.length > 1) {
            aFilter += `${audioStreams.join('')}amix=inputs=${audioStreams.length}:duration=first:dropout_transition=2[aout]`;
        }

        // Apply Graph
        if (vFilter || aFilter) {
            let fullComplex = [];
            if (vFilter) fullComplex.push(vFilter);
            if (aFilter) fullComplex.push(aFilter);
            args.push('-filter_complex', fullComplex.join(''));
            args.push('-map', vStream === '[0:v]' ? '0:v' : vStream);
            args.push('-map', audioStreams.length > 1 ? '[aout]' : (document.getElementById('denoise-toggle').checked ? '[aden]' : '0:a'));
        }

        args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', 'output.mp4');

        await ffmpeg.run(...args);

        const data = ffmpeg.FS('readFile', 'output.mp4');
        const url = URL.createObjectURL(new Blob([data.buffer], {type: 'video/mp4'}));
        const a = document.createElement('a');
        a.href = url; a.download = `tech-house-pro-${Date.now()}.mp4`; a.click();

        announce("EXPORT COMPLETE! File downloaded.");
    } catch (err) {
        console.error(err);
        announce("EXPORT FAILED.");
    } finally {
        document.getElementById('prog-container').classList.add('hidden');
        exportBtn.disabled = false;
    }
}