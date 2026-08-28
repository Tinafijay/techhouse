const MODEL = "gemini-2.5-flash";

function buildContents(prompt, image, mimeType) {
    const parts = [];
    if (prompt) parts.push({ text: String(prompt) });
    if (image) {
        const cleaned = String(image).includes(",")
            ? String(image).split(",").pop()
            : String(image);
        parts.push({
            inlineData: { mimeType: mimeType || "image/jpeg", data: cleaned }
        });
    }
    return [{ role: "user", parts }];
}

function extractText(data) {
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
    return JSON.stringify(data);
}

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ error: "Method not allowed" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: "Server is missing GEMINI_API_KEY env var" });
    }

    const body = req.body || {};
    const prompt = body.prompt || body.text || "";
    const image = body.image || body.imageBase64 || null;
    const mimeType = body.mimeType || "image/jpeg";

    if (!prompt && !image) {
        return res.status(400).json({ error: "Missing prompt or image" });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

    try {
        const upstream = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: buildContents(prompt, image, mimeType)
            })
        });

        const data = await upstream.json().catch(() => ({}));

        if (!upstream.ok) {
            const message = (data && data.error && data.error.message) || `Upstream error ${upstream.status}`;
            return res.status(upstream.status).json({ error: message, details: data });
        }

        const text = extractText(data);
        return res.status(200).json({ text, model: MODEL });
    } catch (err) {
        return res.status(500).json({ error: "Proxy failure: " + (err && err.message ? err.message : String(err)) });
    }
};
