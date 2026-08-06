import type { Page } from '@playwright/test';

export interface E2EBridge {
	/** Every `invoke` the app made, in order. */
	invocations: Array<{ cmd: string; args: Record<string, unknown> }>;
	/** Push a Tauri event to whatever the app is listening for. */
	emit(event: string, payload: unknown): void;
	/** NDJSON scripts consumed by successive `ai_stream` calls. */
	streamReplies: string[][];
	/** Pause between streamed chunks; raise it to assert mid-stream states. */
	chunkDelayMs: number;
}
declare global {
	interface Window {
		__E2E__: E2EBridge;
	}
}

/**
 * Browser-side stand-in for the Tauri IPC bridge.
 *
 * The UI talks to Rust exclusively through `window.__TAURI_INTERNALS__`, so the
 * whole frontend — chat streaming, the tool loop, the sidebars — runs in plain
 * Chromium once that object exists. Installed via `addInitScript`, so it is in
 * place before any app module executes.
 */
export async function installTauriMock(page: Page, notesDir = 'C:/notes') {
	await page.addInitScript((dir: string) => {
		type Handler = (message: { event: string; id: number; payload: unknown }) => void;

		const callbacks = new Map<number, Handler>();
		const listeners: Array<{ event: string; handlerId: number }> = [];
		const invocations: Array<{ cmd: string; args: Record<string, unknown> }> = [];
		const streamReplies: string[][] = [];
		const bridge = { invocations, emit, streamReplies, chunkDelayMs: 15 };
		let nextCallbackId = 1;

		const notes = [
			{ id: 'beefprime.md', title: 'BeefPrime', path: `${dir}/beefprime.md` },
			{ id: 'oidc.md', title: 'OIDC Fabio', path: `${dir}/oidc.md` }
		];

		function emit(event: string, payload: unknown) {
			for (const listener of listeners) {
				if (listener.event !== event) continue;
				callbacks.get(listener.handlerId)?.({ event, id: listener.handlerId, payload });
			}
		}

		function streamRequestId(args: Record<string, unknown>): string {
			const req = args.req;
			if (req && typeof req === 'object' && 'id' in req && typeof req.id === 'string') return req.id;
			return '';
		}

		async function invoke(cmd: string, args: Record<string, unknown> = {}) {
			invocations.push({ cmd, args });

			if (cmd === 'plugin:event|listen') {
				if (typeof args.event === 'string' && typeof args.handler === 'number') {
					listeners.push({ event: args.event, handlerId: args.handler });
				}
				return listeners.length;
			}
			if (cmd === 'plugin:event|unlisten') return null;

			if (cmd === 'ai_stream') {
				const id = streamRequestId(args);
				const lines = streamReplies.shift() ?? [
					JSON.stringify({ message: { role: 'assistant', content: 'mock reply' }, done: true })
				];
				for (const line of lines) {
					emit('ai-stream-chunk', { id, chunk: line });
					// Yield to the event loop so each token paints; that is exactly what
					// the streaming assertions observe.
					const { promise, resolve } = Promise.withResolvers<void>();
					setTimeout(resolve, bridge.chunkDelayMs);
					await promise;
				}
				return lines.join('\n');
			}

			if (cmd === 'list_ollama_models') return ['qwen-coder-7b:latest', 'llama3.2-3b:latest'];
			if (cmd === 'list_notes_files') return notes;
			if (cmd === 'read_note' || cmd === 'read_file') return '# BeefPrime\n\nnote body';
			if (cmd === 'create_note_file') return { id: 'new.md', title: 'New', path: `${dir}/new.md` };
			if (cmd === 'run_ocr') return 'SERVICEDESK TICKET 13369711';
			if (cmd === 'get_config_path') return `${dir}/appnotas-settings.json`;

			return null;
		}

		Object.defineProperty(window, '__TAURI_INTERNALS__', {
			value: {
				invoke,
				transformCallback(callback: Handler) {
					const id = nextCallbackId++;
					callbacks.set(id, callback);
					return id;
				},
				metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
				convertFileSrc: (path: string) => path
			},
			writable: false
		});

		Object.defineProperty(window, '__E2E__', {
			value: bridge,
			writable: false
		});
	}, notesDir);
}

/** Queue the NDJSON lines the next `ai_stream` call streams back. */
export async function queueStreamReply(page: Page, chunks: Array<Record<string, unknown>>) {
	const lines = chunks.map(chunk => JSON.stringify(chunk));
	await page.evaluate(queued => window.__E2E__.streamReplies.push(queued), lines);
}

/** Slow the mock stream so mid-stream states (queue chip, partial text) are observable. */
export async function setChunkDelay(page: Page, ms: number) {
	await page.evaluate(delay => {
		window.__E2E__.chunkDelayMs = delay;
	}, ms);
}

/** Assistant tokens, shaped the way Ollama streams them. */
export function tokens(...parts: string[]): Array<Record<string, unknown>> {
	return parts.map((content, index) => ({
		message: { role: 'assistant', content },
		done: index === parts.length - 1
	}));
}
