const { jsPDF } = window.jspdf;
let camStream = null, lastCoords = { lat: 0, lng: 0 };
let currentStep = 0;
let deferredPrompt;

const vistaSound = new Audio('vista_startup.mp3'); 
const scanSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3');

// --- SMART TOUR ---
const tourSteps = [
    { title: "Tech House Welcome", desc: "Your pro-grade safety assistant is active." },
    { title: "Immersive Scanner", desc: "The scan tab uses a full-screen lens for maximum precision." },
    { title: "Security History", desc: "View logs and track exact locations via Google Maps." },
    { title: "System Settings", desc: "Manage your API key, audio, and device installation." }
];

window.onload = () => {
    document.getElementById('api-key').value = localStorage.getItem('th_key') || "";
    document.getElementById('toggle-sound').checked = localStorage.getItem('th_sound') !== 'false';
    document.getElementById('toggle-vibe').checked = localStorage.getItem('th_vibe') !== 'false';
    
    const theme = localStorage.getItem('th_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);

    initCam(); loadHistory(); startGPS();

    if (!localStorage.getItem('th_tour_completed')) {
        setTimeout(() => { nextTourStep(); }, 1500);
    }
};

// --- CORE SCANNING LOGIC ---
async function processScan() {
    const key = document.getElementById('api-key').value.trim();
    if (!key) return alert("API Key Required.");

    const video = document.getElementById('cam-feed');
    const canvas = document.getElementById('proc-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

    if(document.getElementById('toggle-sound').checked) scanSound.play();
    if(document.getElementById('toggle-vibe').checked) navigator.vibrate([100, 50, 100]);

    document.getElementById('status-text').innerText = "Analyzing...";

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [
                    { text: "Identify food and detect toxins. Professional tone." },
                    { inline_data: { mime_type: "image/jpeg", data: base64 } }
                ]}]
            })
        });

        const data = await res.json();
        const text = data.candidates[0].content.parts[0].text;
        
        document.getElementById('analysis-out').innerText = text;
        if(document.getElementById('toggle-sound').checked) vistaSound.play();
        speak(text);
        saveReport(text, canvas.toDataURL());
    } catch (e) {
        document.getElementById('status-text').innerText = "Scan Failed.";
    }
}

// --- HISTORY & GOOGLE MAPS ---
function loadHistory() {
    const list = document.getElementById('history-list');
    const h = JSON.parse(localStorage.getItem('th_hist') || '[]');
    list.innerHTML = h.length ? '' : '<p>No security logs.</p>';
    h.forEach((item, i) => {
        const card = document.createElement('div');
        card.className = 'card';
        // Logic for Google Maps Link
        const mapUrl = `https://www.google.com/maps?q=${item.lat},${item.lng}`;
        card.innerHTML = `
            <div class="card-header">
                <strong>${item.date}</strong>
                <button class="dot-btn" onclick="toggleMenu(${i})">⋮</button>
            </div>
            <div id="menu-${i}" class="menu-content">
                <button onclick="deleteItem(${i})">Delete</button>
            </div>
            <p>${item.txt}</p>
            <a href="${mapUrl}" target="_blank" class="maps-link">📍 View Location on Maps</a>
        `;
        list.appendChild(card);
    });
}

// ... Rest of UI Utils (switchTab, saveAllSettings, etc.) ...
function speak(t) { 
    window.speechSynthesis.cancel(); 
    const utterance = new SpeechSynthesisUtterance(t);
    utterance.lang = 'en-GB';
    window.speechSynthesis.speak(utterance); 
}

function saveReport(txt, img) {
    const h = JSON.parse(localStorage.getItem('th_hist') || '[]');
    h.unshift({ id: Date.now(), txt, img, lat: lastCoords.lat, lng: lastCoords.lng, date: new Date().toLocaleString() });
    localStorage.setItem('th_hist', JSON.stringify(h.slice(0, 30)));
    loadHistory();
}

async function initCam() { 
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    document.getElementById('cam-feed').srcObject = camStream;
}

function startGPS() { navigator.geolocation.watchPosition(p => { lastCoords = { lat: p.coords.latitude, lng: p.coords.longitude }; }); }