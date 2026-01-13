const { jsPDF } = window.jspdf;
let camStream = null, flashOn = false, lastCoords = { lat: "Unknown", lng: "Unknown" }, tourStep = 0;

const tourSteps = [
    { tab: 'panel-scan', title: "Scanner", desc: "Scan food samples. Results appear here." },
    { tab: 'panel-settings', title: "API Setup", desc: "Enter your Gemini 3.0 key here." },
    { tab: 'panel-history', title: "Records", desc: "View GPS locations and export PDFs." }
];

window.onload = () => {
    document.getElementById('api-key').value = localStorage.getItem('th_key') || "";
    document.getElementById('sound-toggle').checked = localStorage.getItem('th_sound') !== 'false';
    document.getElementById('vibe-toggle').checked = localStorage.getItem('th_vibe') !== 'false';
    const savedTheme = localStorage.getItem('th_theme') || 'light';
    updateTheme(savedTheme);
    initCam();
    loadHistory();
    startGPS();
    if(!localStorage.getItem('tour_done')) startTour();
};

function startGPS() {
    navigator.geolocation.watchPosition(p => {
        lastCoords = { lat: p.coords.latitude.toFixed(5), lng: p.coords.longitude.toFixed(5) };
    }, null, { enableHighAccuracy: true });
}

async function initCam() {
    try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        document.getElementById('cam-feed').srcObject = camStream;
    } catch (e) { document.getElementById('status-text').innerText = "Cam Access Required."; }
}

async function processScan() {
    const key = localStorage.getItem('th_key');
    if(!key) return alert("Add API key in Settings!");

    // UNLOCK AUDIO/VIBE
    const chime = document.getElementById('vista-chime');
    chime.load();
    if(navigator.vibrate) navigator.vibrate(50);

    const status = document.getElementById('status-text');
    status.innerText = "Analyzing with Gemini 3.0...";

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
                { text: "Food safety scan: Detect visible toxins/spoilage. 1-sentence concise verdict." },
                { inline_data: { mime_type: "image/jpeg", data: b64 } }
            ]}]})
        });

        const data = await res.json();
        const verdict = data.candidates[0].content.parts[0].text;

        if(document.getElementById('sound-toggle').checked) {
            chime.currentTime = 0; chime.play().catch(() => {});
        }
        if(document.getElementById('vibe-toggle').checked && navigator.vibrate) navigator.vibrate(100);

        status.innerText = verdict;
        speak(verdict);
        saveReport(verdict);
    } catch (e) { status.innerText = "Scan Failed."; }
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
            <select class="input-field" style="color:var(--primary); font-weight:bold;" onchange="handleAction(this, ${i})">
                <option value="">Options...</option>
                <option value="share">Share Report</option>
                <option value="pdf">Download PDF</option>
                <option value="map">View Map</option>
                <option value="delete">Delete</option>
            </select>
        </div>`).join('') || "<p style='text-align:center'>No scans yet.</p>";
}

function handleAction(el, i) {
    const h = JSON.parse(localStorage.getItem('th_hist'));
    const item = h[i];
    const mapUrl = `http://google.com/maps?q=${item.lat},${item.lng}`;

    if(el.value === 'share' && navigator.share) {
        navigator.share({ title: 'Safety Report', text: `${item.txt} Loc: ${mapUrl}` });
    } else if(el.value === 'pdf') {
        const doc = new jsPDF();
        doc.text("TECH HOUSE SAFETY REPORT", 20, 20);
        doc.text(`Date: ${item.date}`, 20, 30);
        doc.text(`Location: ${item.lat}, ${item.lng}`, 20, 37);
        doc.text(doc.splitTextToSize(item.txt, 170), 20, 50);
        doc.save(`Report_${item.id}.pdf`);
    } else if(el.value === 'map') {
        window.open(mapUrl, '_blank');
    } else if(el.value === 'delete') {
        h.splice(i, 1); localStorage.setItem('th_hist', JSON.stringify(h)); loadHistory();
    }
    el.value = "";
}

function downloadFullPDF() {
    const h = JSON.parse(localStorage.getItem('th_hist') || '[]');
    const doc = new jsPDF();
    doc.text("Tech House - Full History", 20, 20);
    let y = 35;
    h.forEach(item => {
        if(y > 270) { doc.addPage(); y = 20; }
        doc.text(`${item.date} [${item.lat}, ${item.lng}]: ${item.txt}`, 20, y, { maxWidth: 170 });
        y += 15;
    });
    doc.save("Full_History.pdf");
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
    const select = document.getElementById('theme-select');
    if(select) select.value = val;
}

function saveKey() {
    localStorage.setItem('th_key', document.getElementById('api-key').value.trim());
    speak("Configuration Saved.");
}

function startTour() { tourStep = 0; document.getElementById('tour-overlay').style.display = 'flex'; updateTour(); }
function nextTourStep() { tourStep++; if(tourStep < tourSteps.length) updateTour(); else closeTour(); }
function updateTour() {
    const s = tourSteps[tourStep];
    document.getElementById('tour-title').innerText = s.title;
    document.getElementById('tour-desc').innerText = s.desc;
    switchTab(s.tab, document.getElementById('nav-' + s.tab.split('-')[1]));
}
function closeTour() { document.getElementById('tour-overlay').style.display = 'none'; localStorage.setItem('tour_done', 'true'); }
function speak(t) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(t)); }
function clearHistory() { if(confirm("Wipe all?")) { localStorage.removeItem('th_hist'); loadHistory(); } }