import { GoogleGenAI } from "@google/genai";

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method Not Allowed' });
        return;
    }

    const apiKey = process.env.GEMINI_API_KEY; 

    if (!apiKey) {
        res.status(500).json({ error: 'Server configuration error: API Key not set.' });
        return;
    }

    try {
        const { imageBase64 } = req.body;

        if (!imageBase64) {
             res.status(400).json({ error: 'Missing imageBase64 in request body.' });
             return;
        }

        const ai = new GoogleGenAI({ apiKey });

        const imagePart = {
            inlineData: {
                data: imageBase64,
                mimeType: "image/png",
            },
        };

        const prompt = "Analyze this food item for signs of spoilage, mold, or contamination. Respond with a verdict: 'Safe' or 'Not Safe', and a brief, easy-to-read explanation. For example: 'Verdict: Not Safe. Explanation: There are visible patches of green mold on the surface.' If no food is detected, respond: 'Verdict: Cannot Analyze. Explanation: Please ensure a clear image of the food item is visible.'";

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [imagePart, { text: prompt }] }],
        });

        res.status(200).json(response);

    } catch (error) {
        console.error("Gemini API Error:", error);
        res.status(500).json({ error: { message: `Internal server error: ${error.message}` } });
    }
}
