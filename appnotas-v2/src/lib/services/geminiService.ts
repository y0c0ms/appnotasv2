import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Part } from "@google/generative-ai";
import { get } from "svelte/store";
import { settingsStore } from "../stores/settings";

export type AIModel = 'gemini-2.5-flash' | 'gemini-2.5-pro' | 'gemini-2.5-flash-lite';

export interface AIContent {
    text?: string;
    images?: string[]; // Base64 or URL
    drawings?: string[]; // Data URLs (PNG)
}

class GeminiService {
    private genAI: GoogleGenerativeAI | null = null;

    private init() {
        const apiKey = get(settingsStore).geminiKey;
        if (!apiKey) throw new Error("Gemini API Key not found in settings.");
        this.genAI = new GoogleGenerativeAI(apiKey);
    }

    async generateResponse(prompt: string, context: AIContent, modelOverride?: AIModel): Promise<string> {
        this.init();
        if (!this.genAI) throw new Error("Failed to initialize Gemini AI.");

        const settings = get(settingsStore);
        const modelName = modelOverride || settings.aiModelPreference || 'gemini-2.5-flash';

        const model = this.genAI.getGenerativeModel({ model: modelName });

        const parts: (string | Part)[] = [];

        // System instruction to ensure direct response
        parts.push(`System Instruction: You are an AI assistant for a note-taking app and code editor. 
- Provide ONLY the direct result of the user's instruction. 
- Do NOT provide multiple options and do NOT ask the user to choose. 
- Do NOT include any introductory or concluding remarks (e.g., "Here is the refactored code").
- For code: Ensure consistent indentation (default to 2 spaces). Prioritize efficiency, readability, and modern best practices for the detected language.
- Return content in raw Markdown format suitable for direct insertion into a TipTap editor.\n\n`);

        // 1. Add context text first if it exists
        if (context.text) {
            parts.push(`Context text from note:\n${context.text}\n\n`);
        }

        // 2. Add images/drawings
        if (context.images) {
            for (const img of context.images) {
                parts.push(this.formatImagePart(img));
            }
        }

        if (context.drawings) {
            for (const draw of context.drawings) {
                parts.push(this.formatImagePart(draw));
            }
        }

        // 3. Add the user instruction at the end
        parts.push(`Instruction: ${prompt}`);

        try {
            const result = await model.generateContent(parts);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error("Gemini API Error:", error);
            throw new Error(`Failed to get response from ${modelName}. ${error instanceof Error ? error.message : ''}`);
        }
    }

    private formatImagePart(dataUrl: string): Part {
        // Extract base64 and mime type from data URL
        const matches = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
        if (!matches) {
            throw new Error("Invalid image format provided to AI.");
        }

        return {
            inlineData: {
                data: matches[2],
                mimeType: matches[1]
            }
        };
    }
}

export const geminiService = new GeminiService();
