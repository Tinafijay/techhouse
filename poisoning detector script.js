const { jsPDF } = window.jspdf;
let camStream = null;
let lastCoords = { lat: "Unknown", lng: "Unknown" };
let tourStep = 0;
let isAutoplay = false;

const tourSteps = [
    { tab: 'panel-scan', title: "1. Precision Scanner", desc: "This is your main hub. Align any food sample in the viewport and tap Analyze. Our Gemini 3.0 Flash brain will check for toxins." },
    { tab: 'panel-history', title: "2. Secure Records", desc: "Every scan is saved here with a GPS coordinate. From here, you can generate PDF reports or share findings with authorities." },
    { tab: 'panel-settings', title: "3. System Setup", desc: "In settings, you can paste your API key, toggle the Windows Vista chime, and switch to our Midnight Tech House theme." }
];

window.onload = () => {
    // Restore Saved Data
    document.getElementById('api-key').value = localStorage.getItem('th_key') || "";
    document.getElementById('sound-toggle').checked = localStorage.getItem('th_sound') !== 'false';
    document.getElementById('vibe-toggle').checked = localStorage.getItem('th_vibe') !== 'false';
    updateTheme(localStorage.getItem('th_theme') || 'light');

    initCam();
    loadHistory();
    startGPS();

    // Trigger Tour for first-timers
    if (!localStorage.getItem('tour_done')) {
        setTimeout(() => { document.getElementById('tour-overlay').style.display = 'flex'; }, 1000);
    }
};

// --- THE INTUITIVE TOUR ENGINE ---
function startTour(auto = false) {
    isAutoplay = auto;
    tourStep = 0;
    runTourStep();
}

function runTourStep() {
    const step = tourSteps[tourStep];
    const btn = document.getElementById('tour-next-btn');
    
    // Switch the UI tab to match the explanation
    switchTab(step.tab, document.getElementById('nav-' + step.tab.split('-')[1]));
    
    document.getElementById('tour-title').innerText = step.title;
    document.getElementById('tour-desc').innerText = step.desc;
    
    // Change button text on last step
    btn.innerText = (tourStep === tourSteps.length - 1) ? "FINISH & START" : "NEXT STEP";

    // Speech Engine
    window.speechSynthesis.cancel();
    const msg = new SpeechSynthesisUtterance(step.desc);
    msg.rate = 0.95;

    if (isAutoplay) {
        msg.onend = () => {
            if (tourStep < tourSteps.length - 1) {
                setTimeout(() => { tourStep++; runTourStep(); }, 1200);
            } else {
                setTimeout(closeTour, 1500);
            }
        };
    }
    window.speechSynthesis.speak(msg);
}

function manualNext() {
    if (tourStep < tourSteps.length - 1) {
        tourStep++;
        runTourStep();
    } else {
        closeTour();
    }
}

function closeTour() {
    window.speechSynthesis.cancel();
    document.getElementById('tour-overlay').style.display = 'none';
    localStorage.setItem('tour_done', 'true');
    // Snap back to Scanner Home
    switchTab('panel-scan', document.getElementById('nav-scan'));
}

// --- CORE LOGIC (GEMINI & VISTA SOUND) ---
async function processScan() {
    const key = localStorage.getItem('th_key');
    if(!key) return alert("Please enter API Key in Settings!");

    const chime = document.getElementById('vista-chime');
    chime.load(); // Prime audio engine
    if(navigator.vibrate) navigator.vibrate(50);

    const status = document.getElementById('status-text');
    status.innerText = "Gemini 3.0 Flash Analyzing...";

    try {
        const video = document.getElementById('cam-feed');
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);
        const b64 = canvas.toDataURL("image/jpeg").split(",")[1];

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [
                { text: "Food safety: Detect visible poisoning/spoilage. 1-sentence verdict." },
                { inline_data: { mime_type: "image/jpeg", data: b64 } }
            ]}]})
        });

        const data = await res.json();
        const verdict = data.candidates[0].content.parts[0].text;

        if(document.getElementById('sound-toggle').checked) {
            chime.currentTime = 0; chime.play().catch(() => {});
        }
        
        status.innerText = verdict;
        speak(verdict);
        saveReport(verdict);
    } catch (e) { status.innerText = "Connection Error."; }
}

function startGPS() {
    navigator.geolocation.watchPosition(p => {
        lastCoords = { lat: p.coords.latitude.toFixed(5), lng: p.coords.longitude.toFixed(5) };
    }, null, { enableHighAccuracy: true });
}

async function initCam() {
    try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        document.getElementById('cam-feed').srcObject = camStream;
    } catch (e) { document.getElementById('status-text').innerText = "Cam Error."; }
}

function saveReport(txt) {
    const h = JSON.parse(localStorage.getItem('th_hist') || '[]');
    h.unshift({ id: Date.now(), txt, date: new Date().toLocaleString(), lat: lastCoords.lat, lng: lastCoords.lng });
    localStorage.setItem('th_hist', JSON.stringify(h.slice(0, 50)));
    loadHistory();
}

function loadHistory() {
    const list = document.getElementById('history-list');
    const h = JSON.parse(localStorage.getItem('th_hist') || '[]');
    list.innerHTML = h.map((item, i) => `
        <div class="card">
            <small>${item.date} | 📍 ${item.lat}, ${item.lng}</small>
            <p><strong>${item.txt}</strong></p>
            <select class="input-field" style="color:var(--primary); font-weight:bold" onchange="handleAction(this, ${i})">
                <option value="">Actions...</option>
                <option value="share">Share</option>
                <option value="pdf">Save PDF</option>
                <option value="delete">Delete</option>
            </select>
        </div>`).join('') || "<p style='text-align:center'>History Empty.</p>";
}

function handleAction(el, i) {
    const h = JSON.parse(localStorage.getItem('th_hist'));
    const item = h[i];
    if(el.value === 'share' && navigator.share) {
        navigator.share({ title: 'Safety Report', text: item.txt });
    } else if(el.value === 'pdf') {
        const doc = new jsPDF();
        doc.text("SAFETY REPORT", 20, 20);
        doc.text(`Result: ${item.txt}`, 20, 40, {maxWidth: 170});
        doc.save(`Report_${item.id}.pdf`);
    } else if(el.value === 'delete') {
        h.splice(i, 1); localStorage.setItem('th_hist', JSON.stringify(h)); loadHistory();
    }
    el.value = "";
}

function switchTab(id, el) {
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active'); 
    if(el) el.classList.add('active');
}

function updateTheme(val) {
    document.body.setAttribute('data-theme', val);
    localStorage.setItem('th_theme', val);
}

function saveKey() {
    localStorage.setItem('th_key', document.getElementById('api-key').value.trim());
    alert("Saved!");
}

function speak(t) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(t)); }
function clearHistory() { if(confirm("Wipe all?")) { localStorage.removeItem('th_hist'); loadHistory(); } }