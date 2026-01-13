const { jsPDF } = window.jspdf;
let camStream = null, lastCoords = { lat: "Unknown", lng: "Unknown" }, tourStep = 0, isAutoplay = false, deferredPrompt = null;

const tourSteps = [
    { tab: 'panel-scan', title: "Scanner", desc: "This is the core. Align any food or substance here and let the Gemini 3.0 Flash engine analyze it for toxins." },
    { tab: 'panel-history', title: "Logs", desc: "Access your past scans and generate professional PDF reports with the Tech House logo and GPS timestamps." },
    { tab: 'panel-settings', title: "Configuration", desc: "Paste your API key here. You can get a free key at Google AI Studio in just 60 seconds." },
    { tab: 'panel-settings', title: "Quick Access", desc: "For the best experience, click 'Install App' in Settings to add Tech House to your home screen." }
];

window.onload = () => {
    // PWA Install Logic
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault(); deferredPrompt = e;
        document.getElementById('pwa-install-btn').style.display = 'block';
    });

    document.getElementById('pwa-install-btn').onclick = async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') document.getElementById('pwa-install-btn').style.display = 'none';
            deferredPrompt = null;
        }
    };

    // Initialize State
    document.getElementById('api-key').value = localStorage.getItem('th_key') || "";
    document.getElementById('sound-toggle').checked = localStorage.getItem('th_h_sound') !== 'false';
    document.getElementById('haptic-toggle').checked = localStorage.getItem('th_haptic') !== 'false';
    updateTheme(localStorage.getItem('th_theme') || 'light');

    initCam(); loadHistory(); startGPS();
    if (!localStorage.getItem('tour_done')) {
        document.getElementById('tour-overlay').style.display = 'flex';
        runTourStep();
    }
};

// --- TAB FIX (Total Separation) ---
function switchTab(id, el) {
    const panes = document.querySelectorAll('.tab-pane');
    const btns = document.querySelectorAll('.tab-btn');
    
    panes.forEach(p => { p.style.display = 'none'; p.classList.remove('active'); });
    btns.forEach(b => b.classList.remove('active'));

    const target = document.getElementById(id);
    target.style.display = 'block';
    target.classList.add('active');
    if (el) el.classList.add('active');
}

// --- TOUR ENGINE ---
function startTour(auto = false) { isAutoplay = auto; tourStep = 0; runTourStep(); }
function nextTourStep() { if (tourStep < tourSteps.length - 1) { tourStep++; runTourStep(); } else { closeTour(); } }
function runTourStep() {
    const step = tourSteps[tourStep];
    switchTab(step.tab, document.getElementById('nav-' + step.tab.split('-')[1]));
    document.getElementById('tour-title').innerText = step.title;
    document.getElementById('tour-desc').innerText = step.desc;
    document.getElementById('tour-primary-btn').innerText = (tourStep === tourSteps.length - 1) ? "FINISH" : "NEXT";
    
    window.speechSynthesis.cancel();
    const msg = new SpeechSynthesisUtterance(step.desc);
    if (isAutoplay) {
        msg.onend = () => { if (tourStep < tourSteps.length - 1) setTimeout(nextTourStep, 1000); else setTimeout(closeTour, 1500); };
    }
    window.speechSynthesis.speak(msg);
}
function closeTour() { window.speechSynthesis.cancel(); document.getElementById('tour-overlay').style.display = 'none'; localStorage.setItem('tour_done', 'true'); switchTab('panel-scan', document.getElementById('nav-scan')); }

// --- SCANNER ---
async function processScan() {
    const key = localStorage.getItem('th_key');
    if(!key) { switchTab('panel-settings', document.getElementById('nav-settings')); return alert("Get your API key at AI Studio and paste it in Settings!"); }
    const chime = document.getElementById('vista-chime');
    chime.load(); if(navigator.vibrate) navigator.vibrate(50);
    const status = document.getElementById('status-text');
    status.innerText = "Analyzing...";
    try {
        const video = document.getElementById('cam-feed');
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);
        const b64 = canvas.toDataURL("image/jpeg").split(",")[1];
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: "Safety analysis: Detect visible poisoning/spoilage. 1-sentence." }, { inline_data: { mime_type: "image/jpeg", data: b64 } }]}]})
        });
        const data = await res.json();
        const verdict = data.candidates[0].content.parts[0].text;
        if(document.getElementById('sound-toggle').checked) { chime.currentTime = 0; chime.play().catch(() => {}); }
        if(document.getElementById('haptic-toggle').checked) navigator.vibrate([100, 50, 100]);
        status.innerText = verdict; speak(verdict); saveReport(verdict);
    } catch (e) { status.innerText = "System Error."; }
}

// --- LOGO PDF ---
function generatePDF(item) {
    const doc = new jsPDF();
    const img = new Image(); img.src = 'Tech House logo.jpg';
    img.onload = () => {
        doc.addImage(img, 'JPEG', 15, 10, 20, 20);
        doc.setFont("helvetica", "bold"); doc.text("TECH HOUSE SAFETY REPORT", 40, 22);
        doc.setFontSize(10); doc.setFont("helvetica", "normal");
        doc.text(`Date: ${item.date} | Loc: ${item.lat}, ${item.lng}`, 15, 40);
        doc.line(15, 45, 195, 45); doc.text(doc.splitTextToSize(item.txt, 170), 15, 55);
        doc.save(`Report_${item.id}.pdf`);
    };
}

// --- UTILS ---
function startGPS() { navigator.geolocation.watchPosition(p => { lastCoords = { lat: p.coords.latitude.toFixed(5), lng: p.coords.longitude.toFixed(5) }; }); }
async function initCam() { try { camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); document.getElementById('cam-feed').srcObject = camStream; } catch (e) { document.getElementById('status-text').innerText = "Cam Access Denied."; } }
function saveReport(txt) { const h = JSON.parse(localStorage.getItem('th_hist') || '[]'); h.unshift({ id: Date.now(), txt, date: new Date().toLocaleString(), lat: lastCoords.lat, lng: lastCoords.lng }); localStorage.setItem('th_hist', JSON.stringify(h.slice(0, 50))); loadHistory(); }
function loadHistory() {
    const list = document.getElementById('history-list');
    const h = JSON.parse(localStorage.getItem('th_hist') || '[]');
    list.innerHTML = h.map((item, i) => `
        <div class="card">
            <small>${item.date} | 📍 ${item.lat}, ${item.lng}</small>
            <p><strong>${item.txt}</strong></p>
            <button class="secondary-btn" style="width:100%" onclick='generatePDF(${JSON.stringify(item)})'>Get PDF Report</button>
            <button onclick="deleteItem(${i})" style="border:none; background:none; color:red; margin-top:10px; cursor:pointer;">Delete</button>
        </div>`).join('') || "<p style='text-align:center'>No scans yet.</p>";
}
function deleteItem(i) { const h = JSON.parse(localStorage.getItem('th_hist')); h.splice(i, 1); localStorage.setItem('th_hist', JSON.stringify(h)); loadHistory(); }
function updateTheme(val) { document.body.setAttribute('data-theme', val); localStorage.setItem('th_theme', val); }
function updateToggles() { localStorage.setItem('th_h_sound', document.getElementById('sound-toggle').checked); localStorage.setItem('th_haptic', document.getElementById('haptic-toggle').checked); }
function saveKey() { localStorage.setItem('th_key', document.getElementById('api-key').value.trim()); alert("Key Saved!"); }
function speak(t) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(t)); }
function clearHistory() { if(confirm("Wipe all results?")) { localStorage.removeItem('th_hist'); loadHistory(); } }