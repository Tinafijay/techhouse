const ONESHOT_MODEL = "gemini-2.5-flash";

const LIVE_MODEL_DEFAULT = "models/gemini-2.5-flash-native-audio-latest";
const LIVE_FALLBACK_MODELS = [
    "models/gemini-2.5-flash-native-audio-preview-09-2025",
    "models/gemini-2.0-flash-live-preview-04-09"
];

const LIVE_WS_ENDPOINT =
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const TOKEN_TTL_MINUTES = 30;

function setCors(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        let size = 0;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                req.destroy();
                reject(new Error("payload too large"));
                return;
            }
            data += chunk;
        });
        req.on("end", () => {
            if (!data) return resolve({});
            try { resolve(JSON.parse(data)); } catch (e) { reject(new Error("Invalid JSON body")); }
        });
        req.on("error", reject);
    });
}

function extractImageBase64(body) {
    if (!body) return null;
    if (typeof body.imageBase64 === "string" && body.imageBase64) {
        const v = body.imageBase64;
        return v.includes(",") ? v.split(",").pop() : v;
    }
    if (typeof body.image === "string" && body.image) {
        const v = body.image;
        return v.includes(",") ? v.split(",").pop() : v;
    }
    if (typeof body.imageBase64Data === "string" && body.imageBase64Data) return body.imageBase64Data;
    return null;
}

function extractText(body, keys) {
    if (!body) return "";
    for (const k of keys) {
        if (typeof body[k] === "string" && body[k]) return body[k];
    }
    return "";
}

function buildOneshotContents(prompt, imageBase64, mimeType) {
    const parts = [];
    if (prompt) parts.push({ text: String(prompt) });
    if (imageBase64) {
        parts.push({
            inlineData: {
                mimeType: mimeType || "image/jpeg",
                data: imageBase64
            }
        });
    }
    return [{ role: "user", parts }];
}

function extractTextFromGemini(data) {
    if (!data) return "";
    if (typeof data === "string") return data;
    if (typeof data.text === "string") return data.text;
    if (typeof data.response === "string") return data.response;
    const candidates = data.candidates || (data.result && data.result.candidates);
    if (candidates && candidates[0]) {
        const parts = (candidates[0].content && candidates[0].content.parts) || [];
        const text = parts.map((p) => p.text || "").join(" ").trim();
        if (text) return text;
    }
    return "";
}

async function runOneshot(apiKey, body) {
    const imageBase64 = extractImageBase64(body);
    if (!imageBase64) {
        const err = new Error("Missing imageBase64 (or image) data");
        err.status = 400;
        throw err;
    }
    const userPrompt = extractText(body, ["userPrompt", "prompt", "text"]) || "Describe the visual path ahead briefly.";
    const localContext = extractText(body, ["localContext", "context"]);
    const mimeType = body.mimeType || "image/jpeg";

    const systemPrompt = "You are T-Vision, an automated visual assistant for a visually impaired user. Keep your answers under 20 words, immediate, direct, and focused on safety, obstacles, and navigation.";
    const combinedPrompt = localContext
        ? `${systemPrompt}\n[Local System Events: ${localContext}]\nUser Query: ${userPrompt}`
        : `${systemPrompt}\nUser Query: ${userPrompt}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${ONESHOT_MODEL}:generateContent?key=${apiKey}`;
    const requestPayload = {
        contents: buildOneshotContents(combinedPrompt, imageBase64, mimeType)
    };

    let upstream;
    try {
        upstream = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestPayload)
        });
    } catch (e) {
        const err = new Error("Upstream fetch failed: " + (e && e.message ? e.message : String(e)));
        err.status = 502;
        throw err;
    }

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
        const message = (data && data.error && data.error.message) || `Upstream error ${upstream.status}`;
        const err = new Error(message);
        err.status = upstream.status;
        err.details = data;
        throw err;
    }
    const text = extractTextFromGemini(data) || "No response generated.";
    return { text, description: text, model: ONESHOT_MODEL };
}

async function issueEphemeralToken(apiKey, model) {
    const tokenUrl = `https://generativelanguage.googleapis.com/v1beta/auth_tokens?key=${apiKey}`;
    const now = Date.now();
    const resp = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            uses: 1,
            expireTime: new Date(now + TOKEN_TTL_MINUTES * 60 * 1000).toISOString(),
            newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
            bidiGenerateContentSetup: {
                model: typeof model === "string" && model.startsWith("models/") ? model : `models/${model}`
            }
        })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        const message = (data && data.error && data.error.message) || `Token error ${resp.status}`;
        const err = new Error(message);
        err.status = resp.status;
        err.details = data;
        throw err;
    }
    const token = (data && (data.token || data.name)) || null;
    if (!token) {
        const err = new Error("Token endpoint returned no token field");
        err.status = 502;
        err.details = data;
        throw err;
    }
    console.log("[vision] issued ephemeral token for model=" + model + " len=" + token.length);
    return token;
}

module.exports = async function handler(req, res) {
    setCors(res);

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST, OPTIONS");
        return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    let body;
    try { body = await readBody(req); }
    catch (e) {
        return res.status(400).json({ error: e && e.message ? e.message : "Invalid JSON body" });
    }

    const action = body && body.action;
    const hasImage = !!(body && (body.imageBase64 || body.image));
    if (action === "oneshot" || hasImage) {
        if (!hasImage) {
            return res.status(400).json({ error: "Missing imageBase64 (or image) data" });
        }
        if (!apiKey) {
            return res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });
        }
        try {
            const out = await runOneshot(apiKey, body);
            return res.status(200).json({ ok: true, ...out });
        } catch (e) {
            return res.status(e.status || 500).json({ error: e.message, details: e.details });
        }
    }

    if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });
    }

    const requestedModel = (body && body.model) || LIVE_MODEL_DEFAULT;
    const normalizeModel = (m) => (typeof m === "string" && m.startsWith("models/") ? m : `models/${m}`);
    const candidates = [requestedModel, ...LIVE_FALLBACK_MODELS.filter((m) => m !== requestedModel)].map(normalizeModel);
    const errors = [];
    for (const model of candidates) {
        try {
            const token = await issueEphemeralToken(apiKey, model);
            if (token) {
                return res.status(200).json({
                    ok: true,
                    token,
                    model
                });
            }
        } catch (e) {
            errors.push({ model, status: e.status || 500, message: e.message, details: e.details });
            if (e.status && e.status < 500) break;
        }
    }

    return res.status(500).json({
        error: "Could not issue Live API token for any candidate model",
        attempts: errors
    });
};