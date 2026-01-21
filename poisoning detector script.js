const { jsPDF } = window.jspdf;
let camStream = null;
let lastCoords = { lat: 0, lng: 0 };

// AUDIO TRIGGER: Vista sound plays only on scan success
const vistaSound = new Audio('vista_startup.mp3'); 
const scanSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3');

window.onload = () => {
    // Apply Saved Theme immediately
    const theme = localStorage.getItem('th_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);

    // Initialize UI
    document.getElementById('api-key').value = localStorage.getItem('th_key') || "";
    document.getElementById('toggle-sound').checked = localStorage.getItem('th_sound') !== 'false';
    document.getElementById('toggle-vibe').checked = localStorage.getItem('th_vibe') !== 'false';
    if(document.getElementById('theme-select')) document.getElementById('theme-select').value = theme;

    initCam(); loadHistory(); startGPS();
};

function saveAllSettings() {
    const theme = document.getElementById('theme-select').value;
    localStorage.setItem('th_key', document.getElementById('api-key').value.trim());
    localStorage.setItem('th_sound', document.getElementById('toggle-sound').checked);
    localStorage.setItem('th_vibe', document.getElementById('toggle-vibe').checked);
    localStorage.setItem('th_theme', theme);
    
    // Switch theme instantly
    document.documentElement.setAttribute('data-theme', theme);
    alert("Settings and " + theme + " theme updated.");
}

async function processScan() {
    const key = document.getElementById('api-key').value.trim();
    if (!key) return alert("Please enter your API Key in Settings.");

    const video = document.getElementById('cam-feed');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];

    if(document.getElementById('toggle-sound').checked) scanSound.play();
    if(document.getElementById('toggle-vibe').checked) navigator.vibrate([100, 50, 100]);

    document.getElementById('status-text').innerText = "Analyzing security risks...";

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [
                    { text: "Detect toxins/poisoning in this food. Be concise and professional." },
                    { inline_data: { mime_type: "image/jpeg", data: base64 } }
                ]}]
            })
        });

        const data = await res.json();
        const text = data.candidates[0].content.parts[0].text;

        // PLAY VISTA STARTUP ON COMPLETION
        if(document.getElementById('toggle-sound').checked) vistaSound.play();
        
        document.getElementById('analysis-out').innerText = text;
        document.getElementById('status-text').innerText = "Scan Complete.";
        speak(text);
        saveReport(text, canvas.toDataURL());
    } catch (e) {
        document.getElementById('status-text').innerText = "Scan failed.";
    }
}

function switchTab(id, el) {
    document.querySelectorAll('.tab-pane').forEach(p => {
        p.style.display = 'none';
        p.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));

    const active = document.getElementById(id);
    if(active) {
        active.style.display = 'block';
        active.classList.add('active');
    }
    if(el) el.classList.add('active');
}

function loadHistory() {
    const list = document.getElementById('history-list');
    const h = JSON.parse(localStorage.getItem('th_hist') || '[]');
    list.innerHTML = h.length ? '' : '<p>No history found.</p>';
    
    h.forEach((item, i) => {
        const card = document.createElement('div');
        card.className = 'glass-card';
        // GOOGLE MAPS LINK
        const mapsUrl = `https://www.google.com/maps?q=${item.lat},${item.lng}`;
        
        card.innerHTML = `
            <strong>${item.date}</strong>
            <p>${item.txt}</p>
            <a href="${mapsUrl}" target="_blank" class="maps-link">📍 View Location on Maps</a>
        `;
        list.appendChild(card);
    });
}

async function initCam() { 
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    document.getElementById('cam-feed').srcObject = camStream;
}

function startGPS() { 
    navigator.geolocation.watchPosition(p => { 
        lastCoords = { lat: p.coords.latitude, lng: p.coords.longitude }; 
    }); 
}

function speak(t) { 
    window.speechSynthesis.cancel(); 
    const u = new SpeechSynthesisUtterance(t); u.lang = 'en-GB'; 
    window.speechSynthesis.speak(u); 
}

function saveReport(txt, img) {
    const h = JSON.parse(localStorage.getItem('th_hist') || '[]');
    h.unshift({ id: Date.now(), txt, img, lat: lastCoords.lat, lng: lastCoords.lng, date: new Date().toLocaleString() });
    localStorage.setItem('th_hist', JSON.stringify(h.slice(0, 30)));
    loadHistory();
}