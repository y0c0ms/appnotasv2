/**
 * Talking to whichever local model server the user happens to run.
 *
 * Ollama is one option among several, and not the fastest: llama.cpp's
 * `llama-server`, LM Studio, vLLM, Jan, KoboldCpp and TabbyAPI all serve the
 * same models, and all of them speak the OpenAI HTTP API. So there are exactly
 * two protocols to support, and everything protocol-specific - endpoint paths,
 * request shape, stream framing, tool-call encoding - lives in this module.
 * The store and the UI above it stay protocol-free.
 */

export type LocalApi = 'ollama' | 'openai';

/** A model server that answered discovery. Mirrors the Rust `LocalRuntime`. */
export interface LocalRuntime {
	id: string;
	label: string;
	baseUrl: string;
	api: LocalApi;
	chatUrl: string;
	models: string[];
}

/** Where a single turn is sent: which server, which protocol, which model. */
export interface ModelTarget {
	runtimeId: string;
	label: string;
	api: LocalApi;
	chatUrl: string;
	model: string;
}

export interface ToolCall {
	id?: string;
	function: { name: string; arguments: unknown };
}

/** A conversation entry in protocol-neutral form. */
export interface WireMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	toolCalls?: ToolCall[];
	/** Which call this message answers. Required by the OpenAI API. */
	toolCallId?: string;
}

function toWire(api: LocalApi, message: WireMessage): Record<string, unknown> {
	const base: Record<string, unknown> = { role: message.role, content: message.content };

	if (api === 'ollama') {
		if (message.toolCalls?.length) {
			base.tool_calls = message.toolCalls.map(call => ({
				function: { name: call.function.name, arguments: call.function.arguments }
			}));
		}
		return base;
	}

	if (message.toolCalls?.length) {
		base.tool_calls = message.toolCalls.map((call, index) => ({
			id: call.id ?? `call_${index}`,
			type: 'function',
			function: {
				name: call.function.name,
				// The OpenAI API carries tool arguments as a JSON string.
				arguments:
					typeof call.function.arguments === 'string'
						? call.function.arguments
						: JSON.stringify(call.function.arguments ?? {})
			}
		}));
	}
	// The OpenAI API rejects a tool result that does not say which call it
	// answers; servers that do not care ignore the field.
	if (message.role === 'tool') {
		base.tool_call_id = message.toolCallId ?? 'call_0';
	}
	return base;
}

/**
 * Body for a streamed chat completion. `tools` is omitted entirely when null,
 * which is how a server that rejects tool definitions gets retried.
 */
export function chatRequestBody(
	target: ModelTarget,
	messages: WireMessage[],
	tools: unknown[] | null
): string {
	const body: Record<string, unknown> = {
		model: target.model,
		messages: messages.map(message => toWire(target.api, message)),
		stream: true
	};
	if (tools) body.tools = tools;
	return JSON.stringify(body);
}

/**
 * Assembles one response out of the raw lines the transport emits.
 *
 * Both protocols are line-framed but differ in every other respect: Ollama
 * sends bare NDJSON objects with the whole delta in `message`, while the
 * OpenAI API sends Server-Sent Events whose tool-call arguments arrive as
 * JSON *fragments* spread over many lines and keyed by index. That
 * fragmentation is why this is a stateful decoder rather than a pure
 * per-line function.
 */
export class StreamDecoder {
	private readonly api: LocalApi;
	/** OpenAI tool calls under assembly, keyed by their stream index. */
	private readonly partial = new Map<number, { id?: string; name: string; args: string }>();
	/** Ollama delivers each tool call whole, so they need no assembly. */
	private readonly complete: ToolCall[] = [];

	constructor(api: LocalApi) {
		this.api = api;
	}

	/** Feed one raw line; returns the assistant text it contained, if any. */
	push(line: string): string {
		const trimmed = line.trim();
		if (!trimmed) return '';
		return this.api === 'ollama' ? this.pushOllama(trimmed) : this.pushOpenAi(trimmed);
	}

	private pushOllama(line: string): string {
		const json = safeParse<{ message?: { content?: string; tool_calls?: ToolCall[] } }>(line);
		if (!json?.message) return '';
		if (json.message.tool_calls) this.complete.push(...json.message.tool_calls);
		return json.message.content ?? '';
	}

	private pushOpenAi(line: string): string {
		if (!line.startsWith('data:')) return '';
		const payload = line.slice(5).trim();
		if (!payload || payload === '[DONE]') return '';

		const json = safeParse<{
			choices?: Array<{
				delta?: {
					content?: string;
					tool_calls?: Array<{
						index?: number;
						id?: string;
						function?: { name?: string; arguments?: string };
					}>;
				};
			}>;
		}>(payload);

		const delta = json?.choices?.[0]?.delta;
		if (!delta) return '';

		for (const call of delta.tool_calls ?? []) {
			const index = call.index ?? 0;
			const slot = this.partial.get(index) ?? { name: '', args: '' };
			if (call.id) slot.id = call.id;
			// Name and arguments both arrive in pieces across lines.
			if (call.function?.name) slot.name += call.function.name;
			if (call.function?.arguments) slot.args += call.function.arguments;
			this.partial.set(index, slot);
		}

		return delta.content ?? '';
	}

	/** Tool calls assembled from every line fed so far. */
	toolCalls(): ToolCall[] {
		const assembled = [...this.partial.entries()]
			.sort(([left], [right]) => left - right)
			.filter(([, slot]) => slot.name)
			.map(([, slot]) => ({
				id: slot.id,
				function: { name: slot.name, arguments: safeParse<unknown>(slot.args) ?? {} }
			}));
		return [...this.complete, ...assembled];
	}
}

function safeParse<T>(raw: string): T | null {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}
