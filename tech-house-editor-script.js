const { FFmpeg } = window.FFmpegWASM;
const { fetchFile, toBlobURL } = window.FFmpegUtil;

let ffmpeg = null;
const player = document.getElementById('player');
const status = document.getElementById('status-bar');
const announcer = document.getElementById('status-bar'); // Accessible live region

// Assets State
let files = { vid: null, img: null, bgm: null, sfx: null };
let markers = { s: 0, e: 0, sfxAt: 0, imgAt: 0 };

function notify(msg) {
    status.innerText = msg;
    console.log(msg);
}

function playBeep(freq) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.value = 0.1;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.1);
}

// 1. Initialize Engine
async function init() {
    ffmpeg = new FFmpeg();
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    notify("Downloading Engine...");
    
    await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    
    notify("Ready. Upload video.");
}
init();

// 2. Handle Uploads
document.getElementById('vid-in').onchange = (e) => {
    files.vid = e.target.files[0];
    player.src = URL.createObjectURL(files.vid);
    player.onloadedmetadata = () => {
        markers.e = player.duration;
        document.getElementById('l-vid').innerText = files.vid.name;
        document.getElementById('render-btn').disabled = false;
        notify("Video Ready.");
    };
};

document.getElementById('file-in').onchange = (e) => {
    const type = document.getElementById('track-type').value;
    const file = e.target.files[0];
    if(!file) return;

    if(type === 'img') { 
        files.img = file; 
        markers.imgAt = player.currentTime;
        document.getElementById('l-img').innerText = `Logo at ${markers.imgAt.toFixed(1)}s`;
    } else if(type === 'bgm') {
        files.bgm = file;
        document.getElementById('l-aud').innerText = "BGM Added";
    } else {
        files.sfx = file;
        markers.sfxAt = player.currentTime;
        document.getElementById('l-aud').innerText = `SFX at ${markers.sfxAt.toFixed(1)}s`;
    }
    notify(`${type.toUpperCase()} layer updated.`);
};

// 3. Accessibility & Keyboard
window.onkeydown = (e) => {
    if(e.target.tagName === "INPUT") return;
    const k = e.key.toLowerCase();
    
    if(k === 's') { markers.s = player.currentTime; playBeep(800); notify(`Start: ${markers.s.toFixed(1)}`); }
    if(k === 'e') { markers.e = player.currentTime; playBeep(400); notify(`End: ${markers.e.toFixed(1)}`); }
    if(k === 'v') { notify(`Time: ${player.currentTime.toFixed(1)}. Start: ${markers.s.toFixed(1)}, End: ${markers.e.toFixed(1)}`); }
    if(k === ' ') { e.preventDefault(); player.paused ? player.play() : player.pause(); }
    
    if(e.ctrlKey && k === 'x') runExport();
};

player.ontimeupdate = () => {
    document.getElementById('time-readout').innerText = player.currentTime.toFixed(2);
};

// 4. THE RENDER ENGINE
async function runExport() {
    notify("Render starting... please wait.");
    document.getElementById('prog-container').classList.remove('hidden');

    // Write primary video
    await ffmpeg.writeFile('input.mp4', await fetchFile(files.vid));
    
    let filter = '';
    let inputs = ['-i', 'input.mp4'];
    let vMap = '[0:v]';
    let aMap = '[0:a]';

    // A. TRIM/CUT Logic
    const isCutMode = document.getElementById('cut-mode').checked;
    if(isCutMode) {
        // Remove the middle
        filter += `[0:v]select='not(between(t,${markers.s},${markers.e}))',setpts=N/FRAME_RATE/TB[v_base];`;
        filter += `[0:a]aselect='not(between(t,${markers.s},${markers.e}))',asetpts=N/SR/TB[a_base];`;
    } else {
        // Keep only the selection
        filter += `[0:v]trim=start=${markers.s}:end=${markers.e},setpts=PTS-STARTPTS[v_base];`;
        filter += `[0:a]atrim=start=${markers.s}:end=${markers.e},asetpts=PTS-STARTPTS[a_base];`;
    }
    vMap = '[v_base]';
    aMap = '[a_base]';

    // B. IMAGE LAYER
    if(files.img) {
        await ffmpeg.writeFile('img.png', await fetchFile(files.img));
        inputs.push('-i', 'img.png');
        filter += `${vMap}[1:v]overlay=10:10:enable='between(t,${markers.imgAt},${markers.imgAt+5})'[v_img];`;
        vMap = '[v_img]';
    }

    // C. AUDIO LAYERS (Mixing)
    let audioInputs = [aMap];
    if(files.bgm) {
        await ffmpeg.writeFile('bgm.mp3', await fetchFile(files.bgm));
        inputs.push('-i', 'bgm.mp3');
        filter += `[${inputs.length/2 - 0.5}:a]volume=0.3[bgm_v];`;
        audioInputs.push('[bgm_v]');
    }
    if(files.sfx) {
        await ffmpeg.writeFile('sfx.mp3', await fetchFile(files.sfx));
        inputs.push('-i', 'sfx.mp3');
        const delay = Math.max(0, (markers.sfxAt - markers.s) * 1000);
        filter += `[${inputs.length/2 - 0.5}:a]adelay=${delay}|${delay}[sfx_v];`;
        audioInputs.push('[sfx_v]');
    }

    if(audioInputs.length > 1) {
        filter += `${audioInputs.join('')}amix=inputs=${audioInputs.length}:duration=first[a_final]`;
        aMap = '[a_final]';
    }

    // D. EXECUTE
    ffmpeg.on('progress', ({ progress }) => {
        const p = Math.round(progress * 100);
        document.getElementById('prog-bar').style.width = p + '%';
        document.getElementById('prog-label').innerText = p + '%';
    });

    try {
        await ffmpeg.exec([
            ...inputs,
            '-filter_complex', filter,
            '-map', vMap,
            '-map', aMap,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            'output.mp4'
        ]);

        const data = await ffmpeg.readFile('output.mp4');
        const url = URL.createObjectURL(new Blob([data.buffer], {type: 'video/mp4'}));
        const a = document.createElement('a');
        a.href = url; a.download = "tech-house-edit.mp4"; a.click();
        notify("Export Successful!");
    } catch (err) {
        notify("Export Error. Check console.");
        console.error(err);
    }
}