const { jsPDF } = window.jspdf;
let camStream = null;
let lastCoords = { lat: 0, lng: 0 };
let currentStep = 0;
let deferredPrompt;

// AUDIO ASSETS
const vistaSound = new Audio('vista_startup.mp3'); // Completion Success Sound
const scanSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3');

// TOUR CONFIGURATION
const tourSteps = [
    { title: "Tech House Welcome", desc: "This is the Tech House Poisoning Detector. I am your safety assistant." },
    { title: "Immersive Scanner", desc: "The camera fills your screen for total focus. Align the item and press scan." },
    { title: "Secure History", desc: "All logs and GPS data are stored here. You can export a master PDF for your records." },
    { title: "System Settings", desc: "Enter your API key from AI Studio here to activate the detection engine." }
];

// SERVICE WORKER & INSTALL LOGIC
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js');
    });
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('install-btn-container');
    if (installBtn) installBtn.style.display = 'block';
});

window.onload = () => {
    // Load Saved Preferences
    document.getElementById('api-key').value = localStorage.getItem('th_key') || "";
    document.getElementById('toggle-sound').checked = localStorage.getItem('th_sound') !== 'false';
    document.getElementById('toggle-vibe').checked = localStorage.getItem('th_vibe') !== 'false';
    
    const theme = localStorage.getItem('th_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    if(document.getElementById('theme-select')) document.getElementById('theme-select').value = theme;

    initCam(); 
    loadHistory(); 
    startGPS();

    // Smart Tour Logic
    if (!localStorage.getItem('th_tour_completed')) {
        setTimeout(() => { nextTourStep(); }, 1500);
    }
};

async function installApp() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            document.getElementById('install-btn-container').style.display = 'none';
        }
        deferredPrompt = null;
    }
}

// --- SCANNING ENGINE ---
async function processScan() {
    const key = document.getElementById('api-key').value.trim();
    if (!key) return alert("System Key Required. Visit Settings to configure.");

    const video = document.getElementById('cam-feed');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

    // Initial Feedback (Vibe & Mixkit Sound)
    if(document.getElementById('toggle-vibe').checked) navigator.vibrate([100, 50, 100]);
    if(document.getElementById('toggle-sound').checked) scanSound.play();

    document.getElementById('status-text').innerText = "Analyzing security parameters...";

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: "Identify this food/drink and detect any signs of poisoning or toxins. Be brief and professional." },
                        { inline_data: { mime_type: "image/jpeg", data: base64 } }
                    ]
                }],
                generationConfig: { thinking_config: { thinking_level: "MINIMAL" } }
            })
        });

        const data = await res.json();
        const text = data.candidates[0].content.parts[0].text;
        
        document.getElementById('analysis-out').innerText = text;
        document.getElementById('status-text').innerText = "Scan Verified.";

        // SUCCESS TRIGGER: Vista Sound + Professional Voice
        if(document.getElementById('toggle-sound').checked) vistaSound.play();
        speak(text);
        
        saveReport(text, canvas.toDataURL());
    } catch (e) {
        document.getElementById('status-text').innerText = "API Error. Verify Key.";
    }
}

// --- PROFESSIONAL VOICE (UK) ---
function speak(t) { 
    window.speechSynthesis.cancel(); 
    const utterance = new SpeechSynthesisUtterance(t);
    utterance.lang = 'en-GB';
    utterance.rate = 1.05; 
    const voices = window.speechSynthesis.getVoices();
    const ukVoice = voices.find(v => v.lang === 'en-GB' || v.name.includes('UK'));
    if (ukVoice) utterance.voice = ukVoice;
    window.speechSynthesis.speak(utterance); 
}

// --- CONSOLIDATED MASTER PDF ---
async function downloadMasterHistory() {
    const h = JSON.parse(localStorage.getItem('th_hist') || '[]');
    if(h.length === 0) return alert("No history found.");
    
    const doc = new jsPDF();
    h.forEach((item, i) => {
        if (i > 0) doc.addPage();
        doc.addImage("Tech House logo.jpg", 'JPEG', 150, 10, 40, 40);
        doc.setFontSize(22);
        doc.setTextColor(0, 109, 58);
        doc.text("MASTER SECURITY LOG", 20, 25);
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text(`Record: ${item.date} | Lat: ${item.lat} Lng: ${item.lng}`, 20, 40);
        doc.addImage(item.img, 'JPEG', 20, 50, 120, 90);
        doc.text("Result:", 20, 155);
        doc.text(doc.splitTextToSize(item.txt, 170), 20, 165);
    });
    doc.save("TechHouse_Master_Log.pdf");
}

// --- UI UTILS & NAVIGATION ---
function switchTab(id, el) {
    // Hide all sections
    document.querySelectorAll('.tab-pane').forEach(p => {
        p.style.display = 'none';
        p.classList.remove('active');
    });
    // Reset buttons
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));

    // Show the selected section
    const activePane = document.getElementById(id);
    if(activePane) {
        activePane.style.display = 'block';
        activePane.classList.add('active');
    }
    if(el) el.classList.add('active');
    
    speak(id.replace('panel-', '') + " section active");
}

function saveAllSettings() {
    localStorage.setItem('th_key', document.getElementById('api-key').value.trim());
    localStorage.setItem('th_sound', document.getElementById('toggle-sound').checked);
    localStorage.setItem('th_vibe', document.getElementById('toggle-vibe').checked);
    localStorage.setItem('th_theme', document.getElementById('theme-select').value);
    document.documentElement.setAttribute('data-theme', document.getElementById('theme-select').value);
    alert("System Settings Updated.");
}

async function initCam() { 
    try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        document.getElementById('cam-feed').srcObject = camStream;
    } catch (e) {
        console.error("Camera Init Failed", e);
    }
}

function startGPS() { 
    navigator.geolocation.watchPosition(p => { 
        lastCoords = { lat: p.coords.latitude, lng: p.coords.longitude }; 
    }); 
}

function toggleFlash() { 
    if(camStream) {
        const track = camStream.getVideoTracks()[0];
        track.applyConstraints({ advanced: [{ torch: document.getElementById('flashlight-toggle').checked }] });
    }
}

function loadHistory() {
    const list = document.getElementById('history-list');
    const h = JSON.parse(localStorage.getItem('th_hist') || '[]');
    list.innerHTML = h.length ? '' : '<p>No security logs found.</p>';
    
    h.forEach((item, i) => {
        const card = document.createElement('div');
        card.className = 'glass-card';
        // GOOGLE MAPS LINK
        const mapUrl = `https://www.google.com/maps?q=${item.lat},${item.lng}`;
        
        card.innerHTML = `
            <div class="card-header">
                <strong>${item.date}</strong>
                <button class="dot-btn" onclick="toggleMenu(${i})">⋮</button>
            </div>
            <div id="menu-${i}" class="menu-content" style="display:none;">
                <button onclick="deleteItem(${i})" style="color:red;">Wipe Record</button>
            </div>
            <p>${item.txt}</p>
            <a href="${mapUrl}" target="_blank" class="maps-link">📍 View on Google Maps</a>
        `;
        list.appendChild(card);
    });
}

function saveReport(txt, img) {
    const h = JSON.parse(localStorage.getItem('th_hist') || '[]');
    h.unshift({ 
        id: Date.now(), 
        txt, 
        img, 
        lat: lastCoords.lat, 
        lng: lastCoords.lng, 
        date: new Date().toLocaleString() 
    });
    localStorage.setItem('th_hist', JSON.stringify(h.slice(0, 30)));
    loadHistory();
}

function deleteItem(i) {
    const h = JSON.parse(localStorage.getItem('th_hist'));
    h.splice(i, 1);
    localStorage.setItem('th_hist', JSON.stringify(h));
    loadHistory();
}

function toggleMenu(i) {
    const m = document.getElementById(`menu-${i}`);
    m.style.display = m.style.display === 'block' ? 'none' : 'block';
}

function nextTourStep() {
    const overlay = document.getElementById('tour-overlay');
    if(!overlay) return;
    overlay.style.display = 'flex';
    if (currentStep < tourSteps.length) {
        const step = tourSteps[currentStep];
        document.getElementById('tour-title').innerText = step.title;
        document.getElementById('tour-desc').innerText = step.desc;
        speak(`${step.title}. ${step.desc}`);
        currentStep++;
    } else {
        closeTour();
    }
}

function closeTour() {
    const overlay = document.getElementById('tour-overlay');
    if(overlay) overlay.style.display = 'none';
    localStorage.setItem('th_tour_completed', 'true');
    currentStep = 0;
}

function restartTour() {
    localStorage.removeItem('th_tour_completed');
    currentStep = 0;
    nextTourStep();
}