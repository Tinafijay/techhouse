const { jsPDF } = window.jspdf;
let camStream = null, lastCoords = { lat: 0, lng: 0 };

const vistaSound = new Audio('https://www.soundboard.com/handler/DownLoadTrack.ashx?cliptitle=Windows+Vista+Startup&filename=mt/mtyzndm5ndm5mtyzntm2_Xp3XfP9X_2bY.mp3');
const scanSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3');

window.onload = () => {
    // Load Settings
    document.getElementById('api-key').value = localStorage.getItem('th_key') || "";
    document.getElementById('toggle-sound').checked = localStorage.getItem('th_sound') !== 'false';
    document.getElementById('toggle-vibe').checked = localStorage.getItem('th_vibe') !== 'false';
    
    const theme = localStorage.getItem('th_theme') || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('theme-select').value = theme;

    if(localStorage.getItem('th_sound') !== 'false') {
        vistaSound.play().catch(() => console.log("Sound ready after first touch"));
    }

    initCam(); loadHistory(); startGPS();
};

async function initCam() {
    try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        document.getElementById('cam-feed').srcObject = camStream;
    } catch (e) { speak("Camera access is required for scanning."); }
}

function startGPS() {
    navigator.geolocation.watchPosition(p => {
        lastCoords = { lat: p.coords.latitude.toFixed(5), lng: p.coords.longitude.toFixed(5) };
    }, null, { enableHighAccuracy: true });
}

function saveAllSettings() {
    localStorage.setItem('th_key', document.getElementById('api-key').value.trim());
    localStorage.setItem('th_sound', document.getElementById('toggle-sound').checked);
    localStorage.setItem('th_vibe', document.getElementById('toggle-vibe').checked);
    localStorage.setItem('th_theme', document.getElementById('theme-select').value);
    
    document.documentElement.setAttribute('data-theme', document.getElementById('theme-select').value);
    if(document.getElementById('toggle-vibe').checked) navigator.vibrate(100);
    speak("Settings saved and applied.");
}

async function testConnection() {
    const key = document.getElementById('api-key').value.trim();
    if(!key) return speak("Please enter a key first.");
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
            method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] })
        });
        if(res.ok) speak("Connection successful."); else speak("Invalid key.");
    } catch (e) { speak("Network error."); }
}

async function processScan() {
    const key = localStorage.getItem('th_key');
    if(!key) return speak("Configure API key in settings first.");

    if(localStorage.getItem('th_vibe') !== 'false') navigator.vibrate(100);
    document.getElementById('status-text').innerText = "Analyzing visual safety...";
    
    const video = document.getElementById('cam-feed');
    const cvs = document.createElement("canvas");
    cvs.width = video.videoWidth; cvs.height = video.videoHeight;
    cvs.getContext("2d").drawImage(video, 0, 0);
    const b64 = cvs.toDataURL("image/jpeg");

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
            method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ contents: [{ parts: [
                { text: "Analyze this image for visual signs of spoilage, mold, or discoloration. Provide a 1-sentence verdict on food safety based only on visual cues." },
                { inline_data: { mime_type: "image/jpeg", data: b64.split(',')[1] } }
            ]}]})
        });
        const data = await res.json();
        const verdict = data.candidates[0].content.parts[0].text;
        
        if(localStorage.getItem('th_sound') !== 'false') scanSound.play();
        document.getElementById('status-text').innerText = verdict;
        speak(verdict);
        saveReport(verdict, b64);
    } catch (e) { speak("Analysis failed."); }
}

function saveReport(txt, img) {
    const h = JSON.parse(localStorage.getItem('th_hist') || '[]');
    h.unshift({ id: Date.now(), txt, img, lat: lastCoords.lat, lng: lastCoords.lng, date: new Date().toLocaleString() });
    localStorage.setItem('th_hist', JSON.stringify(h.slice(0, 30)));
    loadHistory();
}

function loadHistory() {
    const list = document.getElementById('history-list');
    const h = JSON.parse(localStorage.getItem('th_hist') || '[]');
    list.innerHTML = h.map((item, i) => `
        <div class="card">
            <div class="three-dot-menu">
                <button class="dot-btn" onclick="toggleMenu(${i})">⋮</button>
                <div id="menu-${i}" class="menu-content">
                    <button onclick="downloadPDF(${i})">Download PDF</button>
                    <button onclick="deleteItem(${i})" style="color:red">Delete</button>
                </div>
            </div>
            <img src="${item.img}" class="history-img">
            <p><strong>${item.txt}</strong></p>
            <a href="https://www.google.com/maps?q=${item.lat},${item.lng}" target="_blank" style="color:var(--primary); font-weight:bold;">📍 View Location</a>
        </div>
    `).join('') || "<p>No logs yet.</p>";
}

function toggleMenu(i) {
    const m = document.getElementById(`menu-${i}`);
    m.style.display = m.style.display === 'block' ? 'none' : 'block';
}

function downloadPDF(i) {
    const item = JSON.parse(localStorage.getItem('th_hist'))[i];
    const doc = new jsPDF();
    doc.text("TECH HOUSE SAFETY LOG", 20, 20);
    doc.addImage(item.img, 'JPEG', 20, 30, 80, 60);
    doc.text(`Date: ${item.date}`, 20, 100);
    doc.text(doc.splitTextToSize(`Verdict: ${item.txt}`, 170), 20, 110);
    doc.save(`TechHouse_Log_${item.id}.pdf`);
}

function generateFullReportPDF() {
    const h = JSON.parse(localStorage.getItem('th_hist') || '[]');
    if(!h.length) return speak("History is empty.");
    const doc = new jsPDF();
    doc.text("FULL SECURITY REPORT", 20, 20);
    let y = 30;
    h.forEach(item => {
        if(y > 270) { doc.addPage(); y = 20; }
        doc.setFontSize(10);
        doc.text(`${item.date}: ${item.txt.substring(0, 60)}...`, 20, y);
        y += 10;
    });
    doc.save("Full_Report.pdf");
}

function switchTab(id, el) {
    document.querySelectorAll('.tab-pane').forEach(p => { p.classList.remove('active'); p.setAttribute('aria-hidden', 'true'); });
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const active = document.getElementById(id);
    active.classList.add('active');
    active.setAttribute('aria-hidden', 'false');
    el.classList.add('active');
    speak(el.innerText + " tab active");
}

function toggleFlash() {
    if(!camStream) return;
    const isChecked = document.getElementById('flashlight-toggle').checked;
    camStream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: isChecked }] });
}

function deleteItem(i) {
    const h = JSON.parse(localStorage.getItem('th_hist'));
    h.splice(i, 1);
    localStorage.setItem('th_hist', JSON.stringify(h));
    loadHistory();
}

function speak(t) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(t)); }
function clearAll() { if(confirm("Wipe all logs?")) { localStorage.removeItem('th_hist'); loadHistory(); } }