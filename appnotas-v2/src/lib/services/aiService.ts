// Provider router. Keeps the same generateResponse(...) signature the rest of
// the app already uses, and dispatches to Claude (subscription) or Gemini (API
// key) based on the selected model. Both providers go through the Rust HTTP
// transport, so the corporate-proxy (Zscaler) TLS fix applies to either.

import { get } from 'svelte/store';
import { settingsStore } from '../stores/settings';
import { geminiService, type AIContent, type AIModel } from './geminiService';
import { claudeService, isClaudeModel } from './claudeService';

class AIService {
    async generateResponse(
        prompt: string,
        context: AIContent,
        modelOverride?: AIModel,
        appContext: 'notes' | 'tasks' = 'notes'
    ): Promise<string> {
        // Callers usually omit the model and rely on the saved preference;
        // resolve it here so we can pick the right provider.
        const model = modelOverride || get(settingsStore).aiModelPreference;

        if (isClaudeModel(model)) {
            return claudeService.generateResponse(prompt, context, model, appContext);
        }
        return geminiService.generateResponse(prompt, context, model, appContext);
    }
}

export const aiService = new AIService();
export type { AIContent, AIModel };
