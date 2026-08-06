import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { settingsStore } from './settings';

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string;
	ocrText?: string;
	toolCalls?: unknown[];
	timestamp: number;
}

export interface ChatSession {
	id: string;
	title: string;
	model: string;
	createdAt: number;
	updatedAt: number;
	messages: ChatMessage[];
}

export interface OllamaToolCall {
	function: { name: string; arguments: unknown };
}

export interface OllamaMessage {
	role: string;
	content: string;
	tool_calls?: OllamaToolCall[];
}

interface OllamaStreamLine {
	message?: { content?: string; tool_calls?: OllamaToolCall[] };
}

/** Ollama streams NDJSON; a malformed line is skipped rather than aborting the turn. */
function parseStreamLine(line: string): OllamaStreamLine | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	try {
		return JSON.parse(trimmed) as OllamaStreamLine;
	} catch {
		return null;
	}
}

function parseToolArgs(raw: unknown): Record<string, unknown> {
	if (typeof raw === 'string') {
		try {
			return JSON.parse(raw) as Record<string, unknown>;
		} catch {
			return {};
		}
	}
	if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
	return {};
}

/** Bound on assistant→tool→assistant round trips, so a looping model can't hang the UI. */
const MAX_TOOL_ROUNDS = 4;

const STORAGE_KEY = 'appnotas_local_chat_sessions_v1';
const ACTIVE_SESSION_KEY = 'appnotas_local_chat_active_id';

const MCP_TOOLS = [
	{
		type: 'function',
		function: {
			name: 'list_notes',
			description: 'List or search all local notes in the AppNotas notes directory',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Optional text filter for note titles or body' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'read_note',
			description: 'Read the full content of a specific note file by path or filename',
			parameters: {
				type: 'object',
				properties: {
					path_or_id: { type: 'string', description: 'Filename or path of the note to read' }
				},
				required: ['path_or_id']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'create_note',
			description: 'Create a new note file with a title and Markdown content',
			parameters: {
				type: 'object',
				properties: {
					title: { type: 'string', description: 'Note title' },
					content: { type: 'string', description: 'Note body content in Markdown' }
				},
				required: ['title']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'run_ocr',
			description: 'Extract text from an image on the Windows clipboard or an image file path',
			parameters: {
				type: 'object',
				properties: {
					image_path: { type: 'string', description: 'Path to image file, or null to read Windows clipboard' }
				}
			}
		}
	}
];

const TOOL_NAMES: Record<string, true> = Object.fromEntries(
	MCP_TOOLS.map(t => [t.function.name, true])
);

/**
 * How much prior conversation is replayed to the model.
 *
 * Local models here run with an 8k context; a long transcript pushes the tool
 * advertisement out of the window (the model then answers "I have no access to
 * your files") and makes every prompt re-evaluation slower on CPU.
 */
const HISTORY_MESSAGES = 8;

/**
 * Tools are also described in the prompt, not just in the `tools` field.
 *
 * Ollama can only expose the `tools` field to models whose chat template renders
 * it; a locally registered GGUF with a plain template silently drops it. Stating
 * the contract in a system message is what actually makes the local MCP tools
 * reachable, and it stays in sync with `MCP_TOOLS` because it is generated here.
 */
const TOOL_SYSTEM_PROMPT = [
	'You are the assistant inside AppNotas and you can operate the user\'s local notes through tools.',
	'',
	'Available tools:',
	...MCP_TOOLS.map(t => {
		const params = Object.keys(t.function.parameters?.properties ?? {}).join(', ') || 'no arguments';
		return `- ${t.function.name}(${params}): ${t.function.description}`;
	}),
	'',
	'To call a tool, reply with ONLY this JSON object and nothing else:',
	'{"name": "<tool name>", "arguments": {<arguments>}}',
	'',
	'The result comes back as a tool message; then answer the user in plain prose using it.',
	'Never claim you cannot read local files — use the tools instead.'
].join('\n');

function asToolCall(value: unknown): OllamaToolCall | null {
	if (!value || typeof value !== 'object') return null;
	const obj = value as { name?: unknown; arguments?: unknown; parameters?: unknown };
	if (typeof obj.name !== 'string' || TOOL_NAMES[obj.name] !== true) return null;
	return { function: { name: obj.name, arguments: obj.arguments ?? obj.parameters ?? {} } };
}

/**
 * First balanced `{…}` block in `text`, parsed. Brace counting (string-aware) is
 * needed because the models wrap the object in prose or fences and a greedy or
 * lazy regex either overshoots or cuts nested objects in half.
 */
function firstJsonObject(text: string): unknown {
	const start = text.indexOf('{');
	if (start < 0) return undefined;

	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let i = start; i < text.length; i++) {
		const ch = text[i];

		if (inString) {
			if (escaped) escaped = false;
			else if (ch === '\\') escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}

		if (ch === '"') inString = true;
		else if (ch === '{') depth++;
		else if (ch === '}' && --depth === 0) {
			try {
				return JSON.parse(text.slice(start, i + 1));
			} catch {
				return undefined;
			}
		}
	}

	return undefined;
}

/**
 * Recover a tool call a model wrote as text.
 *
 * Ollama only fills `message.tool_calls` for models whose chat template renders
 * the tool-call tokens its parser looks for. A locally registered GGUF with a
 * plain template drops that, and the model instead writes
 * `{"name": …, "arguments": …}` into the answer — often followed by invented
 * results, since it has not seen the real ones yet. So: accept only objects
 * naming a known tool, and drop the rest of that message; the genuine answer is
 * produced in the follow-up round, after the tool result is fed back.
 */
export function extractTextToolCalls(content: string): { calls: OllamaToolCall[]; cleaned: string } {
	const fenced = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
	const candidate = asToolCall(firstJsonObject(fenced ? fenced[1] : content));

	return candidate ? { calls: [candidate], cleaned: '' } : { calls: [], cleaned: content };
}

function loadStoredSessions(): ChatSession[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed) && parsed.length > 0) return parsed;
		}
	} catch (e) {
		console.error('Failed to load chat sessions:', e);
	}
	const defaultSession: ChatSession = {
		id: 'sess_' + Date.now(),
		title: 'New Chat',
		model: 'qwen-coder-7b:latest',
		createdAt: Date.now(),
		updatedAt: Date.now(),
		messages: []
	};
	return [defaultSession];
}

function loadActiveSessionId(sessions: ChatSession[]): string {
	if (typeof window === 'undefined') return sessions[0]?.id || '';
	try {
		const saved = localStorage.getItem(ACTIVE_SESSION_KEY);
		if (saved && sessions.some(s => s.id === saved)) return saved;
	} catch (e) {}
	return sessions[0]?.id || '';
}

function createLocalChatStore() {
	const initialSessions = loadStoredSessions();
	const initialActiveId = loadActiveSessionId(initialSessions);

	const sessionsStore = writable<ChatSession[]>(initialSessions);
	const activeIdStore = writable<string>(initialActiveId);
	const isStreamingStore = writable<boolean>(false);

	sessionsStore.subscribe(sessions => {
		if (typeof window !== 'undefined') {
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
			} catch (e) {}
		}
	});

	activeIdStore.subscribe(id => {
		if (typeof window !== 'undefined') {
			try {
				localStorage.setItem(ACTIVE_SESSION_KEY, id);
			} catch (e) {}
		}
	});

	async function executeToolCall(toolName: string, args: Record<string, unknown>): Promise<string> {
		console.info(`⚡ [Tool Call] Executing '${toolName}' with args:`, JSON.stringify(args));
		const notesDir = get(settingsStore).notesDirectory || 'C:/Users/manuesantos/OneDrive - Grupo Jerónimo Martins/Documents/notes';

		try {
			if (toolName === 'list_notes') {
				const notes = await invoke<Array<{ id: string; title: string; path?: string }>>('list_notes_files', {
					directory: notesDir,
					includeContent: false
				});
				const query = (args.query as string)?.toLowerCase();
				const filtered = query
					? notes.filter(n => n.title.toLowerCase().includes(query) || n.id.toLowerCase().includes(query))
					: notes;
				return JSON.stringify(filtered.slice(0, 15).map(n => ({ id: n.id, title: n.title, path: n.path })));
			}
			
			if (toolName === 'read_note') {
				const pathOrId = args.path_or_id as string;
				const fullPath = pathOrId.includes('/') || pathOrId.includes('\\')
					? pathOrId
					: `${notesDir}/${pathOrId}`;
				const content = await invoke<string>('read_file', { path: fullPath });
				return content;
			}

			if (toolName === 'create_note') {
				const title = (args.title as string) || 'Untitled Note';
				const content = (args.content as string) || '';
				const note = await invoke<{ id: string; path?: string }>('create_note_file', {
					directory: notesDir,
					title
				});
				if (content && note.path) {
					await invoke('save_note_to_file', { path: note.path, content });
				}
				return `Successfully created note '${title}' (ID: ${note.id})`;
			}

			if (toolName === 'run_ocr') {
				const imgPath = args.image_path ? String(args.image_path) : null;
				const extracted = await invoke<string>('run_ocr', { imagePath: imgPath });
				return extracted || 'No text detected.';
			}

			return `Unknown tool: ${toolName}`;
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`❌ [Tool Call Error] '${toolName}':`, msg);
			return `Tool Execution Error: ${msg}`;
		}
	}

	function mutateLastAssistant(sessionId: string, next: (content: string) => string) {
		sessionsStore.update(sessions =>
			sessions.map(s => {
				if (s.id !== sessionId) return s;
				const msgs = [...s.messages];
				const lastIdx = msgs.length - 1;
				if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
					msgs[lastIdx] = { ...msgs[lastIdx], content: next(msgs[lastIdx].content) };
				}
				return { ...s, messages: msgs, updatedAt: Date.now() };
			})
		);
	}

	/**
	 * One model turn: tokens land in the UI as they arrive over `ai-stream-chunk`,
	 * then the accumulated body returned by the command is used as the source of
	 * truth for the message text and any tool calls.
	 */
	async function streamTurn(sessionId: string, model: string, messages: OllamaMessage[]) {
		const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const session = get(sessionsStore).find(s => s.id === sessionId);
		const last = session?.messages[session.messages.length - 1];
		const base = last?.role === 'assistant' ? last.content : '';

		const unlisten = await listen<{ id: string; chunk: string }>('ai-stream-chunk', evt => {
			if (evt.payload.id !== requestId) return;
			const token = parseStreamLine(evt.payload.chunk)?.message?.content;
			if (token) mutateLastAssistant(sessionId, c => c + token);
		});

		try {
			const full = await invoke<string>('ai_stream', {
				req: {
					id: requestId,
					url: 'http://localhost:11434/api/chat',
					body: JSON.stringify({ model, messages, tools: MCP_TOOLS, stream: true })
				}
			});

			let content = '';
			const toolCalls: OllamaToolCall[] = [];
			for (const line of full.split('\n')) {
				const json = parseStreamLine(line);
				if (!json) continue;
				if (json.message?.content) content += json.message.content;
				if (json.message?.tool_calls) toolCalls.push(...json.message.tool_calls);
			}

			if (toolCalls.length === 0) {
				const textual = extractTextToolCalls(content);
				if (textual.calls.length > 0) {
					toolCalls.push(...textual.calls);
					content = textual.cleaned;
				}
			}

			// A chunk event can still be in flight when the command resolves, so the
			// live text is replaced rather than trusted.
			mutateLastAssistant(sessionId, () => base + content);
			return { content, toolCalls };
		} finally {
			unlisten();
		}
	}

	return {
		sessions: sessionsStore,
		activeId: activeIdStore,
		isStreaming: isStreamingStore,

		createSession: (model = 'qwen-coder-7b:latest') => {
			const newSess: ChatSession = {
				id: 'sess_' + Date.now(),
				title: 'New Chat',
				model,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				messages: []
			};
			sessionsStore.update(s => [newSess, ...s]);
			activeIdStore.set(newSess.id);
			return newSess;
		},

		deleteSession: (id: string) => {
			sessionsStore.update(s => {
				const filtered = s.filter(x => x.id !== id);
				if (filtered.length === 0) {
					const fallback: ChatSession = {
						id: 'sess_' + Date.now(),
						title: 'New Chat',
						model: 'qwen-coder-7b:latest',
						createdAt: Date.now(),
						updatedAt: Date.now(),
						messages: []
					};
					activeIdStore.set(fallback.id);
					return [fallback];
				}
				if (get(activeIdStore) === id) {
					activeIdStore.set(filtered[0].id);
				}
				return filtered;
			});
		},

		clearActiveMessages: () => {
			const currentId = get(activeIdStore);
			sessionsStore.update(sessions =>
				sessions.map(s => {
					if (s.id === currentId) {
						return { ...s, messages: [], title: 'New Chat', updatedAt: Date.now() };
					}
					return s;
				})
			);
		},

		updateLastAssistantToken: (sessionId: string, token: string) => {
			mutateLastAssistant(sessionId, c => c + token);
		},

		streamOllamaChat: async (sessionId: string, model: string, promptText: string, ocrText?: string) => {
			isStreamingStore.set(true);

			let fullPrompt = promptText;
			if (ocrText) {
				fullPrompt = promptText
					? `${promptText}\n\n--- EXTRACTED OCR TEXT ---\n${ocrText}`
					: `Analyze & format this extracted OCR text:\n\n--- EXTRACTED OCR TEXT ---\n${ocrText}`;
			}

			const currentSessions = get(sessionsStore);
			const session = currentSessions.find(s => s.id === sessionId);
			const existingHistory = session ? session.messages : [];

			const userMsg: ChatMessage = {
				id: 'msg_' + Date.now(),
				role: 'user',
				content: fullPrompt,
				ocrText,
				timestamp: Date.now()
			};

			const assistantMsg: ChatMessage = {
				id: 'msg_' + (Date.now() + 1),
				role: 'assistant',
				content: '',
				timestamp: Date.now()
			};

			sessionsStore.update(sessions =>
				sessions.map(s => {
					if (s.id === sessionId) {
						const msgs = [...s.messages, userMsg, assistantMsg];
						let title = s.title;
						if (s.title === 'New Chat') {
							title = promptText.slice(0, 30).trim() || (ocrText ? 'OCR Document' : 'Chat');
						}
						return { ...s, messages: msgs, title, model, updatedAt: Date.now() };
					}
					return s;
				})
			);

			console.info(`🤖 [Local AI] Starting stream with model '${model}' (Session: ${sessionId})`);

			const apiMessages: OllamaMessage[] = [
				{ role: 'system', content: TOOL_SYSTEM_PROMPT },
				...existingHistory.slice(-HISTORY_MESSAGES).map(m => ({ role: m.role, content: m.content })),
				{ role: 'user', content: fullPrompt }
			];

			try {
				// Assistant → tool → assistant: the tool result is fed back so the
				// model reports what it did instead of the raw JSON being the answer.
				for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
					const turn = await streamTurn(sessionId, model, apiMessages);
					if (turn.toolCalls.length === 0) break;

					apiMessages.push({
						role: 'assistant',
						content: turn.content,
						tool_calls: turn.toolCalls
					});

					for (const tc of turn.toolCalls) {
						const toolName = tc.function?.name || 'unknown';
						const toolArgs = parseToolArgs(tc.function?.arguments);
						mutateLastAssistant(sessionId, c => `${c}\n\n⚡ *Executing tool* \`${toolName}\`\n`);

						const toolResult = await executeToolCall(toolName, toolArgs);
						mutateLastAssistant(sessionId, c => `${c}\`\`\`json\n${toolResult}\n\`\`\`\n\n`);
						apiMessages.push({ role: 'tool', content: toolResult });
					}
				}
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`❌ [Local AI Error] Stream failed:`, msg);
				mutateLastAssistant(sessionId, c => `${c}\n\n[Stream Error: ${msg}]`);
			} finally {
				isStreamingStore.set(false);
			}
		}
	};
}

export const localChatStore = createLocalChatStore();
