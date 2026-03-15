const { jsPDF } = window.jspdf;
let deferredPrompt, lastCoords = { lat: 0, lng: 0 };

// 1. SYSTEM INIT & ONBOARDING
window.onload = () => {
    const theme = localStorage.getItem('th_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('theme-select').value = theme;
    document.getElementById('api-key').value = localStorage.getItem('th_key') || "";
    document.getElementById('toggle-vibe').checked = localStorage.getItem('th_vibe') !== 'false';
    
    initCam(); 
    loadHistory(); 
    startGPS();
    checkOnboarding();
};

// --- ONBOARDING TOUR LOGIC ---
let currentStep = 0;
const tourSteps = [
    { title: "Welcome!", text: "Welcome to the Tech House Poisoning Detector. Let's take a quick tour." },
    { title: "📷 Scan Food", text: "Point your camera at any food item and click SCAN FOOD to analyze it for health and safety risks." },
    { title: "📜 History Log", text: "All your scans are saved offline securely. You can review them anytime or export them as PDFs." },
    { title: "⚙️ Setup Required", text: "Crucial Step: Go to SETTINGS and paste your Gemini API Key. The app needs this to think!" }
];

function checkOnboarding() {
    if (!localStorage.getItem('th_tour_done')) {
        document.getElementById('onboarding-modal').style.display = 'flex';
        showTourStep(0);
    }
}

function showTourStep(index) {
    document.getElementById('tour-title').innerText = tourSteps[index].title;
    document.getElementById('tour-text').innerText = tourSteps[index].text;
    document.getElementById('tour-step-counter').innerText = `${index + 1} / ${tourSteps.length}`;
    currentStep = index;
    if (index === tourSteps.length - 1) {
        document.querySelector('#onboarding-modal .main-btn').innerText = "FINISH";
    }
}

function nextTourStep() {
    if (currentStep < tourSteps.length - 1) {
        showTourStep(currentStep + 1);
    } else {
        localStorage.setItem('th_tour_done', 'true');
        document.getElementById('onboarding-modal').style.display = 'none';
    }
}

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

// 3. BRAINS (API)
async function processScan() {
    const key = document.getElementById('api-key').value.trim();
    if (!key) return alert("Please configure your system key in settings!");

    const video = document.getElementById('cam-feed');
    if (!video.srcObject) return alert("Camera is offline. Check permissions.");

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; 
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    
    const fullImageData = canvas.toDataURL('image/jpeg', 0.5); 
    const base64 = fullImageData.split(',')[1];

    if(document.getElementById('toggle-vibe').checked && navigator.vibrate) navigator.vibrate(50);
    document.getElementById('status-text').innerText = "SYSTEM ANALYZING...";
    document.getElementById('analysis-out').innerText = "Connecting to Gemini 3 Flash Preview...";

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                contents: [{ 
                    parts: [
                        { text: "Quickly identify any food poisoning or safety risks in this image. Keep it brief. British English." }, 
                        { inline_data: { mime_type: "image/jpeg", data: base64 } }
                    ] 
                }] 
            })
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error.message);

        const result = data.candidates[0].content.parts[0].text;
        
        document.getElementById('analysis-out').innerText = result;
        document.getElementById('status-text').innerText = "SCAN VERIFIED";
        
        saveReport(result, fullImageData);

    } catch (e) {
        document.getElementById('status-text').innerText = "SYSTEM OFFLINE";
        document.getElementById('analysis-out').innerText = "Error: " + e.message;
    }
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
    localStorage.setItem('th_vibe', document.getElementById('toggle-vibe').checked);
    alert("System Settings Updated, Boss.");
}

function switchTab(id, el) {
    document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).style.display = 'block';
    el.classList.add('active');
}

// 5. HELPER FUNCTIONS
async function initCam() {
    try {
        // We request video with a preference for the back camera
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        document.getElementById('cam-feed').srcObject = stream;
    } catch (err) {
        console.error("Camera access denied.", err);
        document.getElementById('status-text').innerText = "CAMERA OFFLINE";
    }
}

function startGPS() {
    if ("geolocation" in navigator) {
        // Optimized GPS parameters for faster, more accurate, and persistent tracking
        navigator.geolocation.watchPosition(
            (pos) => { 
                lastCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude }; 
            },
            (err) => console.warn("GPS Tracking Warning:", err.message),
            { 
                enableHighAccuracy: true, 
                maximumAge: 10000, // Reuse recent location data (up to 10s old) to save battery
                timeout: 27000     // Give the GPS chip up to 27s to lock onto satellites
            }
        );
    }
}

// --- HISTORY & STORAGE LOGIC ---
function saveReport(result, imageData) {
    let history = JSON.parse(localStorage.getItem('th_history') || '[]');
    const newReport = {
        id: Date.now(),
        date: new Date().toLocaleString(),
        result: result,
        image: imageData,
        lat: lastCoords.lat || 0,
        lng: lastCoords.lng || 0
    };
    history.unshift(newReport); 
    localStorage.setItem('th_history', JSON.stringify(history));
    loadHistory(); 
}

function loadHistory() {
    const history = JSON.parse(localStorage.getItem('th_history') || '[]');
    const list = document.getElementById('history-list');
    
    if (history.length === 0) {
        list.innerHTML = "<div class='glass-card'>No security logs found in system.</div>";
        return;
    }
    
    list.innerHTML = history.map(item => {
        const safeLat = item.lat || 0;
        const safeLng = item.lng || 0;
        
        return `
        <div class="glass-card" style="margin-bottom:20px;">
            <div style="font-size:0.8rem; opacity:0.7; margin-bottom:10px;">
                <strong>${item.date}</strong><br>
                GPS: ${safeLat.toFixed(4)}, ${safeLng.toFixed(4)}
            </div>
            <img src="${item.image}" style="width:100%; border-radius:8px; border:1px solid rgba(255,255,255,0.2);" alt="Scan Image">
            <p style="font-size:0.9rem; margin:10px 0;">${item.result}</p>
            
            <select onchange="handleHistoryAction(this, ${item.id})" class="input-field" style="margin:0; padding:10px; font-weight:bold;">
                <option value="">⚙️ Options...</option>
                <option value="maps">🗺️ View on Map</option>
                <option value="pdf">📄 Download as PDF</option>
                <option value="delete">🗑️ Delete Report</option>
            </select>
        </div>
        `;
    }).join('');
}

function handleHistoryAction(selectEl, id) {
    const action = selectEl.value;
    selectEl.value = ""; // Reset dropdown
    
    if (action === 'delete') deleteReport(id);
    if (action === 'pdf') exportSinglePDF(id);
    if (action === 'maps') openGoogleMaps(id);
}

function openGoogleMaps(id) {
    const history = JSON.parse(localStorage.getItem('th_history') || '[]');
    const item = history.find(h => h.id === id);
    
    if (!item || (!item.lat && !item.lng)) {
        return alert("No valid GPS data available for this scan.");
    }

    // Opens a new tab directly to the Google Maps coordinates
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}`;
    window.open(mapsUrl, '_blank');
}

function deleteReport(id) {
    if(!confirm("Are you sure you want to delete this scan?")) return;
    let history = JSON.parse(localStorage.getItem('th_history') || '[]');
    history = history.filter(h => h.id !== id);
    localStorage.setItem('th_history', JSON.stringify(history));
    loadHistory();
}

function clearHistory() {
    if(confirm("CRITICAL WARNING: Wipe all security logs?")) {
        localStorage.removeItem('th_history');
        loadHistory();
    }
}

// --- PDF GENERATION LOGIC ---
async function exportSinglePDF(id) {
    const history = JSON.parse(localStorage.getItem('th_history') || '[]');
    const item = history.find(h => h.id === id);
    if (!item) return;
    
    const safeLat = item.lat || 0;
    const safeLng = item.lng || 0;

    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Tech House - Security Report", 10, 20);
    doc.setFontSize(10);
    doc.text(`Date: ${item.date}`, 10, 30);
    doc.text(`Location: ${safeLat}, ${safeLng}`, 10, 35);
    
    try { doc.addImage(item.image, 'JPEG', 10, 45, 180, 100); } catch(e) {}
    
    const splitText = doc.splitTextToSize(item.result, 180);
    doc.text(splitText, 10, 155);
    doc.save(`TH_Report_${item.id}.pdf`);
}

async function exportAllPDF() {
    const history = JSON.parse(localStorage.getItem('th_history') || '[]');
    if (history.length === 0) return alert("System log is empty. Nothing to export.");
    
    const doc = new jsPDF();
    
    for (let i = 0; i < history.length; i++) {
        if (i > 0) doc.addPage();
        const item = history[i];
        
        const safeLat = item.lat || 0;
        const safeLng = item.lng || 0;

        doc.setFontSize(16);
        doc.text("Tech House - Full System Log", 10, 20);
        doc.setFontSize(10);
        doc.text(`Log #${i+1} | Date: ${item.date}`, 10, 30);
        doc.text(`Location: ${safeLat}, ${safeLng}`, 10, 35);
        
        try { doc.addImage(item.image, 'JPEG', 10, 45, 180, 100); } catch(e) {}
        
        const splitText = doc.splitTextToSize(item.result, 180);
        doc.text(splitText, 10, 155);
    }
    doc.save("TH_Full_History_Report.pdf");
}