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
        // with a conversational yet concise response, and a strict A-F variable mapping.
        const systemInstruction = `
        You are an interactive digital logic engineering assistant. 
        Analyze the user's problem statement and design a logic circuit.
        
        RULES:
        1. Keep your English response extremely short, to the point, and conversational.
        2. Assign variables using ONLY letters A through F.
        3. The "expression" field must use ONLY these characters: letters A-F, spaces,
           ( and ) for grouping, & for AND, | for OR, ~ for NOT (prefix form, e.g. ~A),
           and ^ for XOR. Do NOT use word forms (AND/OR/NOT/XOR), *, +, !, NAND, NOR,
           XNOR, or any other notation — only & | ~ ^ ( ).
        4. Use parentheses to make operator precedence unambiguous whenever more than
           one operator type is combined, e.g. (A & B) | (~C ^ D).
        `;

        // Build the multimodal payload as Content parts
        const parts: any[] = [{ text: "User Request: " + prompt }];

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
            contents: [{ role: 'user', parts }],
            config: {
                systemInstruction,
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'OBJECT',
                    properties: {
                        chat_response: { type: 'STRING' },
                        // Restrict the expression to exactly the allowed character set.
                        expression: {
                            type: 'STRING',
                            pattern: '^[A-F()&|~^ ]+$'
                        },
                        mapping: {
                            type: 'OBJECT',
                            properties: {
                                A: { type: 'STRING' }, B: { type: 'STRING' }, C: { type: 'STRING' },
                                D: { type: 'STRING' }, E: { type: 'STRING' }, F: { type: 'STRING' }
                            }
                        }
                    },
                    required: ['chat_response', 'expression', 'mapping'],
                    propertyOrdering: ['chat_response', 'expression', 'mapping']
                }
            }
        });

        const responseText = result.text ?? '';

        let parsed;
        try {
            parsed = JSON.parse(responseText);
        } catch {
            return Response.json(
                { error: 'The AI returned a response that could not be parsed. Please try rephrasing your prompt.' },
                { status: 502 }
            );
        }

        // Belt-and-braces server-side validation: reject anything outside the
        // allowed (), &, |, ~ alphabet even if the model slips up.
        const allowedExpr = /^[A-F()&|~^\s]+$/;
        if (typeof parsed.expression !== 'string' || !allowedExpr.test(parsed.expression)) {
            return Response.json(
                { error: 'The AI produced an expression using unsupported symbols. Please try rephrasing your prompt.' },
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
