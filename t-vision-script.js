(function () {
    "use strict";

    const API_ENDPOINT = "https://techhouse-2mte.vercel.app/api/gemini";

    const video = document.getElementById("webcam");
    const canvas = document.getElementById("hidden-canvas");
    const textBox = document.getElementById("ai-text");
    const scanner = document.getElementById("scanner");
    const scanBtn = document.getElementById("scan-btn");
    const statusMsg = document.getElementById("status-msg");

    const PROMPT = `You are T Vision, an AI assistant for a blind user.
Analyze the attached camera frame and respond with:
1. IMMEDIATE HAZARDS (steps, holes, vehicles, obstacles). If any are present, start your reply with the word "DANGER".
2. A brief description of the room, surroundings, people, and visible emotions.
Keep the response under 3 short sentences for fast reading.`;

    async function startCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment" }
            });
            video.srcObject = stream;
        } catch (err) {
            setText("Camera permission denied. Please allow camera access and reload.");
            setStatus("Camera blocked");
        }
    }

    function setText(message) {
        textBox.textContent = message;
    }

    function setStatus(message) {
        statusMsg.textContent = message;
    }

    function snapshot() {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (!width || !height) return null;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, width, height);
        return canvas.toDataURL("image/jpeg", 0.85);
    }

    async function callVisionAPI(imageDataUrl) {
        const payload = {
            prompt: PROMPT,
            image: imageDataUrl,
            mimeType: "image/jpeg"
        };

        const response = await fetch(API_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error("HTTP " + response.status);
        }

        const data = await response.json();
        if (typeof data === "string") return data;
        if (data && typeof data.text === "string") return data.text;
        if (data && typeof data.response === "string") return data.response;
        if (data && data.candidates && data.candidates[0] && data.candidates[0].content) {
            const parts = data.candidates[0].content.parts || [];
            return parts.map(function (p) { return p.text || ""; }).join(" ").trim();
        }
        return JSON.stringify(data);
    }

    function speak(text) {
        if (!("speechSynthesis" in window)) return;
        const synth = window.speechSynthesis;
        synth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        if (text.toUpperCase().includes("DANGER")) {
            utterance.rate = 1.4;
            utterance.pitch = 1.2;
        }
        synth.speak(utterance);
    }

    async function runVision() {
        scanBtn.disabled = true;
        textBox.classList.add("is-active");
        textBox.classList.remove("is-danger");
        setText("Processing vision...");
        setStatus("");
        scanner.hidden = false;

        const frame = snapshot();
        if (!frame) {
            finishWithError("Camera not ready. Wait a moment and try again.");
            return;
        }

        try {
            const responseText = await callVisionAPI(frame);
            const cleaned = (responseText || "I could not interpret the scene.").trim();

            textBox.classList.remove("is-active");
            if (cleaned.toUpperCase().includes("DANGER")) {
                textBox.classList.add("is-danger");
            } else {
                textBox.classList.remove("is-danger");
            }
            setText(cleaned);
            setStatus("Scan complete");
            speak(cleaned);
        } catch (err) {
            finishWithError("System error: " + (err && err.message ? err.message : "request failed"));
            return;
        }

        scanner.hidden = true;
        scanBtn.disabled = false;
    }

    function finishWithError(message) {
        textBox.classList.remove("is-active");
        scanner.hidden = true;
        scanBtn.disabled = false;
        setText(message);
        setStatus("Error");
    }

    scanBtn.addEventListener("click", runVision);
    startCamera();
})();
