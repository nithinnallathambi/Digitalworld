// generate.mts (Netlify Function, v2 API)
import { GoogleGenAI } from '@google/genai';
import type { Context } from '@netlify/functions';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

export default async (req: Request, context: Context) => {
    // Only allow POST
    if (req.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    try {
        if (!GEMINI_API_KEY) {
            return Response.json(
                { error: 'Server is missing GEMINI_API_KEY. Set it in Netlify Site settings > Environment variables.' },
                { status: 500 }
            );
        }

        const body = await req.json();
        const { prompt, imageBase64, audioBase64, mimeType } = body;

        if (!prompt || typeof prompt !== 'string') {
            return Response.json({ error: 'A "prompt" string is required.' }, { status: 400 });
        }

        // The system instruction forces the AI to output strictly structured JSON
        // with a conversational yet concise response, and strict A-F variable mapping.
        const systemInstruction = `
        You are an interactive digital logic engineering assistant. 
        Analyze the user's problem statement and design a logic circuit.
        
        RULES:
        1. Keep your English response extremely short, to the point, and conversational.
        2. Assign variables using ONLY letters A through F.
        3. Use ONLY these symbols for the expression: & (AND), | (OR), ~ (NOT), ^ (XOR).
        
        You MUST respond with a valid JSON object exactly like this:
        {
            "chat_response": "Here is the logic for your 3-input voter circuit.",
            "expression": "A & B | B & C | A & C",
            "mapping": { "A": "Temperature Sensor", "B": "Pressure Switch", "C": "Override" }
        }
        `;

        // Build the multimodal payload as Content parts
        const parts: any[] = [{ text: systemInstruction + "\n\nUser Request: " + prompt }];

        if (imageBase64) {
            parts.push({
                inlineData: { data: imageBase64, mimeType: (typeof mimeType === 'string' && mimeType) || 'image/jpeg' }
            });
        }

        if (audioBase64) {
            parts.push({
                inlineData: { data: audioBase64, mimeType: 'audio/mp3' }
            });
        }

        const result = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts }]
        });

        const responseText = result.text ?? '';

        // Strip out markdown code blocks if the AI wraps the JSON
        const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

        let parsed;
        try {
            parsed = JSON.parse(cleanJson);
        } catch {
            return Response.json(
                { error: 'The AI returned a response that could not be parsed. Please try rephrasing your prompt.' },
                { status: 502 }
            );
        }

        return Response.json(parsed);

    } catch (error: any) {
        console.error('AI Generation Error:', error);

        // Handle Token/Quota Limits gracefully without crashing
        const errMsg = (error?.message || '').toLowerCase();
        if (error?.status === 429 || errMsg.includes('quota') || errMsg.includes('token') || errMsg.includes('429')) {
            return Response.json(
                { error: 'Token limit exceeded or quota reached. Please report this to the admin or try a shorter prompt.' },
                { status: 429 }
            );
        }

        // Generic fallback error
        return Response.json(
            { error: 'The AI encountered a processing issue. Please refine your prompt and try again.' },
            { status: 500 }
        );
    }
};

// This is what makes the function reachable at /api/generate
// (instead of the default /.netlify/functions/generate)
export const config = {
    path: '/api/generate'
};
