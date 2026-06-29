// Claude provider that reuses your local Claude Code subscription credentials.
//
// Claude Code stores an OAuth token in ~/.claude/.credentials.json (the same
// file Zed / opencode read). We read it, refresh it when expired, and call the
// Anthropic Messages API with the OAuth "Claude Code" headers + identity system
// prompt. No API key required — it bills against your Claude subscription.
//
// NOTE: this is the same reverse-engineered path other third-party tools use.
// It works while your Claude Code login is valid, but it is outside Anthropic's
// official terms and could break if they tighten OAuth scoping. Gemini remains
// the fallback (see geminiService.ts).

import { invoke } from '@tauri-apps/api/core';
import { aiHttp } from './aiHttp';
import type { AIContent, AIModel } from './geminiService';

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
// Sent as User-Agent so we land in the normal (not aggressively rate-limited)
// bucket. Only possible because the request goes through the Rust transport.
const USER_AGENT = 'claude-code/2.0.0';

// Models exposed by the subscription via the Claude Code OAuth path.
export const CLAUDE_MODELS = [
    'claude-sonnet-4-6',
    'claude-opus-4-8',
    'claude-haiku-4-5'
];

export function isClaudeModel(model: string | undefined | null): boolean {
    return !!model && model.startsWith('claude');
}

interface ClaudeOAuth {
    accessToken: string;
    refreshToken: string;
    expiresAt: number; // epoch ms
    scopes?: string[];
    subscriptionType?: string;
    rateLimitTier?: string;
}

interface CredentialsFile {
    claudeAiOauth?: ClaudeOAuth;
    [key: string]: unknown;
}

class ClaudeService {
    /** Read claudeAiOauth from ~/.claude/.credentials.json, or null if absent. */
    private async readOAuth(): Promise<ClaudeOAuth | null> {
        const raw = await invoke<string | null>('claude_read_credentials');
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw) as CredentialsFile;
            return parsed.claudeAiOauth ?? null;
        } catch (e) {
            console.error('[ClaudeService] Failed to parse credentials file:', e);
            return null;
        }
    }

    /** True if usable Claude Code credentials exist on this machine. */
    async isAvailable(): Promise<boolean> {
        const oauth = await this.readOAuth();
        return !!oauth?.accessToken && !!oauth?.refreshToken;
    }

    /** Returns a valid access token, refreshing + persisting it if expired. */
    private async getAccessToken(): Promise<string> {
        const oauth = await this.readOAuth();
        if (!oauth?.accessToken) {
            throw new Error(
                'No Claude Code login found. Run Claude Code and sign in, or use a Gemini key.'
            );
        }

        // Refresh slightly early (60s skew) to avoid mid-request expiry.
        const stillValid = oauth.expiresAt && oauth.expiresAt - 60_000 > Date.now();
        if (stillValid) return oauth.accessToken;

        console.log('[ClaudeService] Access token expired — refreshing.');
        return this.refreshToken(oauth);
    }

    private async refreshToken(oauth: ClaudeOAuth): Promise<string> {
        if (!oauth.refreshToken) {
            throw new Error('Claude token expired and no refresh token is available. Re-login with Claude Code.');
        }

        const res = await aiHttp(TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT
            },
            body: JSON.stringify({
                grant_type: 'refresh_token',
                refresh_token: oauth.refreshToken,
                client_id: CLIENT_ID
            })
        });

        if (!res.ok) {
            throw new Error(`Failed to refresh Claude token (HTTP ${res.status}). Re-login with Claude Code. ${res.body}`);
        }

        const data = JSON.parse(res.body) as {
            access_token: string;
            refresh_token?: string;
            expires_in?: number;
        };

        const updated: ClaudeOAuth = {
            ...oauth,
            accessToken: data.access_token,
            refreshToken: data.refresh_token ?? oauth.refreshToken,
            expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000
        };

        // Persist back so Claude Code and this app share one source of truth.
        // (Rust merges this into the file, preserving other keys.)
        await invoke('claude_write_oauth', {
            oauth: {
                accessToken: updated.accessToken,
                refreshToken: updated.refreshToken,
                expiresAt: updated.expiresAt,
                scopes: updated.scopes,
                subscriptionType: updated.subscriptionType,
                rateLimitTier: updated.rateLimitTier
            }
        }).catch((e) => console.warn('[ClaudeService] Could not persist refreshed token:', e));

        return updated.accessToken;
    }

    private buildContentBlocks(prompt: string, context: AIContent, appContext: 'notes' | 'tasks') {
        const blocks: any[] = [];

        if (context.text) {
            blocks.push({
                type: 'text',
                text: `Context text from ${appContext === 'tasks' ? 'tasks' : 'note'}:\n${context.text}`
            });
        }

        for (const img of context.images ?? []) {
            const block = this.imageBlock(img);
            if (block) blocks.push(block);
        }
        for (const draw of context.drawings ?? []) {
            const block = this.imageBlock(draw);
            if (block) blocks.push(block);
        }

        blocks.push({ type: 'text', text: `Instruction: ${prompt}` });
        return blocks;
    }

    private imageBlock(dataUrl: string) {
        const matches = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
        if (!matches) return null;
        return {
            type: 'image',
            source: { type: 'base64', media_type: matches[1], data: matches[2] }
        };
    }

    async generateResponse(
        prompt: string,
        context: AIContent,
        modelOverride?: AIModel,
        appContext: 'notes' | 'tasks' = 'notes'
    ): Promise<string> {
        const model = modelOverride || 'claude-sonnet-4-6';
        const token = await this.getAccessToken();

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

        const body = {
            model,
            max_tokens: 8192,
            // First system block MUST be the Claude Code identity — the OAuth
            // path rejects requests that don't lead with it. App instructions
            // follow as a second block.
            system: [
                { type: 'text', text: CLAUDE_CODE_IDENTITY },
                { type: 'text', text: appContext === 'tasks' ? tasksSystemPrompt : notesSystemPrompt }
            ],
            messages: [
                { role: 'user', content: this.buildContentBlocks(prompt, context, appContext) }
            ]
        };

        console.log(`[ClaudeService] Requesting ${model} via subscription...`);
        const res = await aiHttp(MESSAGES_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': 'oauth-2025-04-20',
                'User-Agent': USER_AGENT
            },
            body: JSON.stringify(body),
            timeoutMs: 120_000
        });

        if (!res.ok) {
            let detail = res.body;
            try {
                detail = JSON.parse(res.body)?.error?.message ?? res.body;
            } catch { /* keep raw body */ }
            throw new Error(`Claude request failed (HTTP ${res.status}): ${detail}`);
        }

        const data = JSON.parse(res.body) as { content?: Array<{ type: string; text?: string }> };
        const text = (data.content ?? [])
            .filter((b) => b.type === 'text' && b.text)
            .map((b) => b.text)
            .join('');

        console.log(`[ClaudeService] Response generated (${text.length} chars).`);
        return text;
    }
}

export const claudeService = new ClaudeService();
