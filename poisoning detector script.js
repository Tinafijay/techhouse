const { jsPDF } = window.jspdf;
let camStream = null, lastCoords = { lat: "Unknown", lng: "Unknown" }, tourStep = 0, isAutoplay = false;

const tourSteps = [
    { tab: 'panel-scan', title: "1. Precision Scanner", desc: "Align the food sample in the viewport. Gemini 3.0 Flash will detect contaminants instantly." },
    { tab: 'panel-history', title: "2. Secure Logs", desc: "Every scan is saved here with GPS data. You can export these as PDF reports featuring the Tech House logo." },
    { tab: 'panel-settings', title: "3. Configuration", desc: "Toggle the Vista chime, haptic feedback, or themes here." }
];

window.onload = () => {
    document.getElementById('api-key').value = localStorage.getItem('th_key') || "";
    document.getElementById('sound-toggle').checked = localStorage.getItem('th_h_sound') !== 'false';
    document.getElementById('haptic-toggle').checked = localStorage.getItem('th_haptic') !== 'false';
    updateTheme(localStorage.getItem('th_theme') || 'light');
    initCam(); loadHistory(); startGPS();
    if (!localStorage.getItem('tour_done')) setTimeout(() => { document.getElementById('tour-overlay').style.display = 'flex'; }, 1000);
};

// --- LOGO PDF GENERATOR ---
function generatePDF(item) {
    const doc = new jsPDF();
    const logo = new Image();
    logo.src = 'Tech House logo.jpg';
    
    logo.onload = () => {
        // Add Logo to PDF (x, y, width, height)
        doc.addImage(logo, 'JPEG', 15, 10, 25, 25);
        doc.setFont("helvetica", "bold");
        doc.text("TECH HOUSE SAFETY REPORT", 45, 25);
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.text(`Timestamp: ${item.date}`, 15, 45);
        doc.text(`Location: ${item.lat}, ${item.lng}`, 15, 52);
        doc.line(15, 57, 195, 57);
        doc.setFontSize(12);
        doc.text("Analysis Result:", 15, 67);
        doc.text(doc.splitTextToSize(item.txt, 170), 15, 75);
        doc.save(`TechHouse_Report_${item.id}.pdf`);
    };
}

// --- TOUR ENGINE ---
function startTour(auto = false) { isAutoplay = auto; tourStep = 0; runTourStep(); }
function runTourStep() {
    const step = tourSteps[tourStep];
    switchTab(step.tab, document.getElementById('nav-' + step.tab.split('-')[1]));
    document.getElementById('tour-title').innerText = step.title;
    document.getElementById('tour-desc').innerText = step.desc;
    document.getElementById('tour-next-btn').innerText = (tourStep === tourSteps.length - 1) ? "FINISH" : "NEXT";
    window.speechSynthesis.cancel();
    const msg = new SpeechSynthesisUtterance(step.desc);
    if (isAutoplay) { msg.onend = () => { if (tourStep < tourSteps.length - 1) setTimeout(() => { tourStep++; runTourStep(); }, 1200); else setTimeout(closeTour, 1500); }; }
    window.speechSynthesis.speak(msg);
}

function manualNext() { if (tourStep < tourSteps.length - 1) { tourStep++; runTourStep(); } else { closeTour(); } }
function closeTour() { window.speechSynthesis.cancel(); document.getElementById('tour-overlay').style.display = 'none'; localStorage.setItem('tour_done', 'true'); switchTab('panel-scan', document.getElementById('nav-scan')); }

// --- SCAN LOGIC ---
async function processScan() {
    const key = localStorage.getItem('th_key');
    if(!key) return alert("Enter API Key in Settings!");
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
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [
                { text: "Detect toxins/spoilage. One sentence verdict." },
                { inline_data: { mime_type: "image/jpeg", data: b64 } }
            ]}]})
        });
        const data = await res.json();
        const verdict = data.candidates[0].content.parts[0].text;
        if(document.getElementById('sound-toggle').checked) { chime.currentTime = 0; chime.play().catch(() => {}); }
        if(document.getElementById('haptic-toggle').checked && navigator.vibrate) navigator.vibrate([100, 50, 100]);
        status.innerText = verdict; speak(verdict); saveReport(verdict);
    } catch (e) { status.innerText = "Error."; }
}

// --- UTILS ---
function startGPS() { navigator.geolocation.watchPosition(p => { lastCoords = { lat: p.coords.latitude.toFixed(5), lng: p.coords.longitude.toFixed(5) }; }); }
async function initCam() { try { camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); document.getElementById('cam-feed').srcObject = camStream; } catch (e) { document.getElementById('status-text').innerText = "Cam Error."; } }
function saveReport(txt) { const h = JSON.parse(localStorage.getItem('th_hist') || '[]'); h.unshift({ id: Date.now(), txt, date: new Date().toLocaleString(), lat: lastCoords.lat, lng: lastCoords.lng }); localStorage.setItem('th_hist', JSON.stringify(h.slice(0, 50))); loadHistory(); }
function loadHistory() {
    const list = document.getElementById('history-list');
    const h = JSON.parse(localStorage.getItem('th_hist') || '[]');
    list.innerHTML = h.map((item, i) => `
        <div class="card">
            <small>${item.date} | 📍 ${item.lat}, ${item.lng}</small>
            <p><strong>${item.txt}</strong></p>
            <button class="secondary-btn" style="width:100%" onclick='generatePDF(${JSON.stringify(item)})'>Download PDF Report</button>
            <button class="secondary-btn" style="width:100%; margin-top:5px; border:none; color:red;" onclick="deleteItem(${i})">Delete</button>
        </div>`).join('') || "<p style='text-align:center'>No records.</p>";
}
function deleteItem(i) { const h = JSON.parse(localStorage.getItem('th_hist')); h.splice(i, 1); localStorage.setItem('th_hist', JSON.stringify(h)); loadHistory(); }
function switchTab(id, el) { document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active')); document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active')); document.getElementById(id).classList.add('active'); if(el) el.classList.add('active'); }
function updateTheme(val) { document.body.setAttribute('data-theme', val); localStorage.setItem('th_theme', val); }
function updateToggles() { localStorage.setItem('th_h_sound', document.getElementById('sound-toggle').checked); localStorage.setItem('th_haptic', document.getElementById('haptic-toggle').checked); }
function saveKey() { localStorage.setItem('th_key', document.getElementById('api-key').value.trim()); alert("Config Saved!"); }
function speak(t) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(t)); }
function clearHistory() { if(confirm("Clear logs?")) { localStorage.removeItem('th_hist'); loadHistory(); } }