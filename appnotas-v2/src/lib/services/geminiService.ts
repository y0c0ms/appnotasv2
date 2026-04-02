import { GoogleGenerativeAI } from "@google/generative-ai";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { Part } from "@google/generative-ai";
import { get } from "svelte/store";
import { settingsStore } from "../stores/settings";

// --- Connectivity Fix for Corporate/Restricted Environments ---
// We use the Tauri HTTP plugin's fetch to bypass CORS and organizational proxies.
// This handles requests in the Rust backend instead of the browser frontend.
const fetch = tauriFetch as any;

export type AIModel = string;

export interface AIContent {
    text?: string;
    images?: string[]; // Base64 or URL
    drawings?: string[]; // Data URLs (PNG)
}

class GeminiService {
    private genAI: GoogleGenerativeAI | null = null;

    private init() {
        const apiKey = get(settingsStore).geminiKey;
        if (!apiKey) {
            console.error("[GeminiService] No API Key found in settings!");
            throw new Error("Gemini API Key not found in settings.");
        }
        console.log("[GeminiService] Initializing Gemini client with configured API key.");
        this.genAI = new GoogleGenerativeAI(apiKey);
    }

    async generateResponse(
        prompt: string, 
        context: AIContent, 
        modelOverride?: AIModel,
        appContext: 'notes' | 'tasks' = 'notes'
    ): Promise<string> {
        console.log(`[GeminiService] Generating response using model: ${modelOverride || 'default'} for context: ${appContext}...`);
        this.init();
        if (!this.genAI) throw new Error("Failed to initialize Gemini AI.");

        const settings = get(settingsStore);
        const modelName = modelOverride || settings.aiModelPreference;
        if (!modelName) throw new Error("AI Model preference not configured.");

        const model = this.genAI.getGenerativeModel({ model: modelName });
        console.log(`[GeminiService] Model initialized: ${modelName}`);

        const parts: (string | Part)[] = [];

        // Context-aware System Instruction
        const notesSystemPrompt = `You are an AI assistant for a note-taking app and code editor. 
- Provide ONLY the direct result of the user's instruction. 
- Do NOT include any introductory or concluding remarks.
- Return content in raw Markdown format suitable for direct insertion into a TipTap editor.
- For code: Ensure consistent indentation (default to 2 spaces).`;

        const tasksSystemPrompt = `You are an AI task assistant.
- Provide ONLY a checklist/task list response.
- Do NOT include any headers (#), introductory text, or concluding remarks.
- Every single line MUST start with "- [ ] " (for unchecked) or "- [x] " (for checked).
- Do NOT return plain paragraphs or code blocks unless they are part of a task item.
- Return ONLY raw task list content.`;

        parts.push(`System Instruction: ${appContext === 'tasks' ? tasksSystemPrompt : notesSystemPrompt}\n\n`);

        // 1. Add context text first if it exists
        if (context.text) {
            parts.push(`Context text from ${appContext === 'tasks' ? 'tasks' : 'note'}:\n${context.text}\n\n`);
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
            const text = response.text();
            console.log(`[GeminiService] Response generated successfully (${text.length} chars).`);
            return text;
        } catch (error) {
            console.error("[GeminiService] API Error:", error);
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

    async getAvailableModels(apiKey: string): Promise<string[]> {
        if (!apiKey) return [];
        try {
            console.log(`[GeminiService] Fetching models via Tauri HTTP plugin...`);
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
                method: 'GET',
                connectTimeout: 30000
            });
            if (!response.ok) throw new Error(`Failed to fetch models: ${response.statusText}`);

            const data = await response.json();
            if (!data.models) return [];

            return data.models
                .filter((m: any) =>
                    m.name.includes('gemini') &&
                    m.supportedGenerationMethods?.includes('generateContent')
                )
                .map((m: any) => m.name.replace('models/', ''))
                .sort();
        } catch (e) {
            console.error("[GeminiService] Failed to load models:", e);
            throw e;
        }
    }

    async validateModel(modelName: string): Promise<boolean> {
        this.init();
        if (!this.genAI) return false;

        try {
            console.log(`[GeminiService] Validating model: ${modelName}`);
            const model = this.genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent("Hello");
            const response = await result.response;
            return !!response.text();
        } catch (e) {
            console.error("[GeminiService] Model validation failed:", e);
            throw e;
        }
    }
}

export const geminiService = new GeminiService();
