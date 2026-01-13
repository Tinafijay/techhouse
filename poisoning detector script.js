const { jsPDF } = window.jspdf;
let camStream = null, videoTrack = null, torchActive = false;
let lastCoords = { lat: "0", lng: "0" }, tourStep = 0, isAutoplay = false, deferredPrompt = null;

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

const tourSteps = [
    { tab: 'panel-scan', title: "Detector", desc: "Align the sample. Gemini 3.0 analyzes contaminants instantly." },
    { tab: 'panel-history', title: "Logs", desc: "Your results are stored here. Export them as PDF reports." },
    { tab: 'panel-settings', title: "Setup", desc: "Paste your API key here (Get it in 60s at Google AI Studio)." },
    { tab: 'panel-settings', title: "Install", desc: "Use the 'Install' button for easy access from your home screen." }
];

window.onload = () => {
    // PWA Prompt for Android
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });

    document.getElementById('install-btn').onclick = () => {
        if (isIOS()) document.getElementById('ios-guide').style.display = 'flex';
        else if (deferredPrompt) deferredPrompt.prompt();
        else alert("To install: Use your browser menu and tap 'Add to Home Screen'.");
    };

    // State Restoration
    document.getElementById('api-key').value = localStorage.getItem('th_key') || "";
    document.getElementById('sound-toggle').checked = localStorage.getItem('th_h_sound') !== 'false';
    document.getElementById('haptic-toggle').checked = localStorage.getItem('th_haptic') !== 'false';
    
    initCam(); loadHistory(); startGPS();
    if (!localStorage.getItem('tour_done')) {
        document.getElementById('tour-overlay').style.display = 'flex';
        runTourStep();
    }
};

// --- FLASHLIGHT (Android/Chrome) ---
async function toggleTorch() {
    if (!videoTrack) return;
    try {
        torchActive = !torchActive;
        await videoTrack.applyConstraints({ advanced: [{ torch: torchActive }] });
    } catch (e) { console.log("Torch not supported on this device."); }
}

// --- SCANNING ---
async function processScan() {
    const key = localStorage.getItem('th_key');
    if(!key) { switchTab('panel-settings', document.getElementById('nav-settings')); return alert("Add API Key first!"); }
    
    const status = document.getElementById('status-text');
    status.innerText = "Processing scan...";
    
    try {
        const video = document.getElementById('cam-feed');
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);
        const b64 = canvas.toDataURL("image/jpeg").split(",")[1];
        
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: "Detect toxins. One sentence verdict." }, { inline_data: { mime_type: "image/jpeg", data: b64 } }]}]})
        });
        const data = await res.json();
        const verdict = data.candidates[0].content.parts[0].text;
        
        status.innerText = verdict; // Updates on page for screen reader
        
        if(document.getElementById('sound-toggle').checked) document.getElementById('vista-chime').play();
        if(document.getElementById('haptic-toggle').checked && navigator.vibrate) navigator.vibrate([100, 50, 100]);
        
        saveReport(verdict);
        speak(verdict);
    } catch (e) { status.innerText = "Error: Check API Key/Connection."; }
}

// --- HISTORY LOGIC (THE FIX) ---
function saveReport(txt) {
    const h = JSON.parse(localStorage.getItem('th_hist') || '[]');
    h.unshift({ id: Date.now(), txt, date: new Date().toLocaleString(), lat: lastCoords.lat, lng: lastCoords.lng });
    localStorage.setItem('th_hist', JSON.stringify(h.slice(0, 50)));
    loadHistory();
}

function loadHistory() {
    const list = document.getElementById('history-list');
    const h = JSON.parse(localStorage.getItem('th_hist') || '[]');
    list.innerHTML = ""; // Clear existing
    
    if (h.length === 0) {
        list.innerHTML = "<p style='text-align:center; opacity:0.5;'>No scan history yet.</p>";
        return;
    }

    h.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = "card";
        card.innerHTML = `
            <small>${item.date} | 📍 ${item.lat}</small>
            <p><strong>${item.txt}</strong></p>
            <button class="secondary-btn" style="width:100%" id="pdf-${index}">Download PDF</button>
            <button style="border:none; color:red; background:none; margin-top:10px;" id="del-${index}">Delete</button>
        `;
        list.appendChild(card);
        
        // Safe button binding
        document.getElementById(`pdf-${index}`).onclick = () => generatePDF(item);
        document.getElementById(`del-${index}`).onclick = () => { h.splice(index, 1); localStorage.setItem('th_hist', JSON.stringify(h)); loadHistory(); };
    });
}

function generatePDF(item) {
    const doc = new jsPDF();
    const img = new Image(); img.src = 'Tech House logo.jpg';
    img.onload = () => {
        doc.addImage(img, 'JPEG', 15, 10, 20, 20);
        doc.text("TECH HOUSE SAFETY REPORT", 40, 22);
        doc.setFontSize(10);
        doc.text(`Result: ${item.txt}`, 15, 45, {maxWidth: 170});
        doc.save(`SafetyReport_${item.id}.pdf`);
    };
}

// --- SYSTEM UTILS ---
function switchTab(id, el) {
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    if (el) el.classList.add('active');
}

async function initCam() {
    try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        document.getElementById('cam-feed').srcObject = camStream;
        videoTrack = camStream.getVideoTracks()[0];
        const caps = videoTrack.getCapabilities();
        if (caps.torch) document.getElementById('torch-btn').style.display = 'block';
    } catch (e) { document.getElementById('status-text').innerText = "Cam Error."; }
}

function startGPS() { navigator.geolocation.watchPosition(p => { lastCoords = { lat: p.coords.latitude.toFixed(4), lng: p.coords.longitude.toFixed(4) }; }); }
function saveKey() { localStorage.setItem('th_key', document.getElementById('api-key').value.trim()); alert("Saved!"); }
function speak(t) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(t)); }
function clearHistory() { if(confirm("Clear all?")) { localStorage.removeItem('th_hist'); loadHistory(); } }
// Tour Logic
function nextTourStep() { if (tourStep < tourSteps.length - 1) { tourStep++; runTourStep(); } else { closeTour(); } }
function runTourStep() {
    const s = tourSteps[tourStep];
    switchTab(s.tab, document.getElementById('nav-' + s.tab.split('-')[1]));
    document.getElementById('tour-title').innerText = s.title;
    document.getElementById('tour-desc').innerText = s.desc;
    document.getElementById('tour-primary-btn').innerText = (tourStep === tourSteps.length - 1) ? "FINISH" : "NEXT";
}
function closeTour() { document.getElementById('tour-overlay').style.display='none'; localStorage.setItem('tour_done', 'true'); switchTab('panel-scan', document.getElementById('nav-scan')); }