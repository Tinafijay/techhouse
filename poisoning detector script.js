const { jsPDF } = window.jspdf;
let deferredPrompt, lastCoords = { lat: 0, lng: 0 };
const vistaSound = new Audio('vista_startup.mp3');

// 1. SYSTEM INIT
window.onload = () => {
    const theme = localStorage.getItem('th_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('theme-select').value = theme;
    document.getElementById('api-key').value = localStorage.getItem('th_key') || "";
    document.getElementById('toggle-sound').checked = localStorage.getItem('th_sound') !== 'false';
    document.getElementById('toggle-vibe').checked = localStorage.getItem('th_vibe') !== 'false';
    
    initCam(); loadHistory(); startGPS();
};

// 2. PWA & INSTALL
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredPrompt = e;
    document.getElementById('install-btn-container').style.display = 'block';
});

async function installApp() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') document.getElementById('install-btn-container').style.display = 'none';
        deferredPrompt = null;
    }
}

// 3. BRAINS (API & SPEECH)
async function processScan() {
    const key = document.getElementById('api-key').value.trim();
    if (!key) return speak("Please configure your system key, mate.");

    const video = document.getElementById('cam-feed');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const base64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];

    if(document.getElementById('toggle-vibe').checked) navigator.vibrate(50);
    document.getElementById('status-text').innerText = "SYSTEM ANALYZING...";

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
            method: 'POST',
            body: JSON.stringify({ contents: [{ parts: [{ text: "Quickly identify any food poisoning or safety risks in this image. British English." }, { inline_data: { mime_type: "image/jpeg", data: base64 } }] }] })
        });

        const data = await res.json();
        const result = data.candidates[0].content.parts[0].text;
        
        if(document.getElementById('toggle-sound').checked) vistaSound.play();
        document.getElementById('analysis-out').innerText = result;
        document.getElementById('status-text').innerText = "SCAN VERIFIED";
        speak(result);
        saveReport(result, canvas.toDataURL());
    } catch (e) {
        document.getElementById('status-text').innerText = "SYSTEM OFFLINE";
        speak("Connection failed. Check your link, init?");
    }
}

function speak(text) {
    if (!document.getElementById('toggle-sound').checked) return;
    const msg = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    msg.voice = voices.find(v => v.lang.includes('GB')) || voices[0];
    speechSynthesis.speak(msg);
}

function testConnection() {
    const status = navigator.onLine ? "Online" : "Offline";
    alert(`System Status: ${status}\nGPS: ${lastCoords.lat.toFixed(4)}, ${lastCoords.lng.toFixed(4)}`);
}

// 4. PREFERENCES & NAVIGATION
function saveAllSettings() {
    const theme = document.getElementById('theme-select').value;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('th_theme', theme);
    localStorage.setItem('th_key', document.getElementById('api-key').value);
    localStorage.setItem('th_sound', document.getElementById('toggle-sound').checked);
    localStorage.setItem('th_vibe', document.getElementById('toggle-vibe').checked);
    alert("System Settings Updated, Boss.");
}

function switchTab(id, el) {
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).style.display = 'block';
    el.classList.add('active');
}

// (Helper functions for initCam, startGPS, saveReport, loadHistory would follow here)