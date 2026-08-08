import { describe, it, expect } from 'vitest';
import { chatRequestBody, StreamDecoder, type ModelTarget } from '../src/lib/services/localRuntimes';

const OLLAMA: ModelTarget = {
	runtimeId: 'ollama',
	label: 'Ollama',
	api: 'ollama',
	chatUrl: 'http://127.0.0.1:11434/api/chat',
	model: 'qwen-coder-7b:latest'
};

const OPENAI: ModelTarget = {
	runtimeId: 'llamacpp',
	label: 'llama.cpp',
	api: 'openai',
	chatUrl: 'http://127.0.0.1:8080/v1/chat/completions',
	model: 'qwen2.5-coder-7b'
};

function decode(decoder: StreamDecoder, lines: string[]): string {
	return lines.map(line => decoder.push(line)).join('');
}

describe('StreamDecoder, Ollama NDJSON', () => {
	it('concatenates content deltas and keeps native tool calls', () => {
		const decoder = new StreamDecoder('ollama');

		const text = decode(decoder, [
			JSON.stringify({ message: { content: 'Hello ' } }),
			JSON.stringify({ message: { content: 'world' } }),
			JSON.stringify({
				message: { content: '', tool_calls: [{ function: { name: 'list_notes', arguments: {} } }] }
			}),
			'not json at all'
		]);

		expect(text).toBe('Hello world');
		expect(decoder.toolCalls()).toEqual([
			{ function: { name: 'list_notes', arguments: {} } }
		]);
	});
});

describe('StreamDecoder, OpenAI server-sent events', () => {
	it('reads content out of data frames and ignores framing noise', () => {
		const decoder = new StreamDecoder('openai');

		const text = decode(decoder, [
			': keep-alive comment',
			'',
			`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hi ' } }] })}`,
			`data: ${JSON.stringify({ choices: [{ delta: { content: 'there' } }] })}`,
			'data: [DONE]'
		]);

		expect(text).toBe('Hi there');
		expect(decoder.toolCalls()).toEqual([]);
	});

	// The whole reason this is a stateful decoder: the OpenAI API splits a
	// single tool call across many frames, and the arguments arrive as raw JSON
	// fragments that only parse once concatenated.
	it('reassembles a tool call whose name and arguments arrive in fragments', () => {
		const decoder = new StreamDecoder('openai');

		decode(decoder, [
			`data: ${JSON.stringify({
				choices: [
					{ delta: { tool_calls: [{ index: 0, id: 'call_abc', function: { name: 'read_', arguments: '' } }] } }
				]
			})}`,
			`data: ${JSON.stringify({
				choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'note' } }] } }]
			})}`,
			`data: ${JSON.stringify({
				choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path_or_id"' } }] } }]
			})}`,
			`data: ${JSON.stringify({
				choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ': "a.md"}' } }] } }]
			})}`,
			'data: [DONE]'
		]);

		expect(decoder.toolCalls()).toEqual([
			{ id: 'call_abc', function: { name: 'read_note', arguments: { path_or_id: 'a.md' } } }
		]);
	});

	it('keeps parallel tool calls apart and in index order', () => {
		const decoder = new StreamDecoder('openai');

		decode(decoder, [
			`data: ${JSON.stringify({
				choices: [
					{
						delta: {
							tool_calls: [
								{ index: 1, id: 'b', function: { name: 'read_note', arguments: '{}' } },
								{ index: 0, id: 'a', function: { name: 'list_notes', arguments: '{}' } }
							]
						}
					}
				]
			})}`
		]);

		expect(decoder.toolCalls().map(call => call.function.name)).toEqual(['list_notes', 'read_note']);
	});
});

describe('chatRequestBody', () => {
	it('omits the tools field entirely when a server rejected it', () => {
		const body = JSON.parse(chatRequestBody(OPENAI, [{ role: 'user', content: 'hi' }], null));

		expect(body).not.toHaveProperty('tools');
		expect(body.stream).toBe(true);
		expect(body.model).toBe('qwen2.5-coder-7b');
	});

	it('sends OpenAI tool arguments as a JSON string and pairs results by id', () => {
		const body = JSON.parse(
			chatRequestBody(
				OPENAI,
				[
					{
						role: 'assistant',
						content: '',
						toolCalls: [{ id: 'call_abc', function: { name: 'list_notes', arguments: { query: 'x' } } }]
					},
					{ role: 'tool', content: '[]', toolCallId: 'call_abc' }
				],
				[]
			)
		);

		expect(body.messages[0].tool_calls[0]).toEqual({
			id: 'call_abc',
			type: 'function',
			function: { name: 'list_notes', arguments: '{"query":"x"}' }
		});
		expect(body.messages[1].tool_call_id).toBe('call_abc');
	});

	it('sends Ollama tool arguments as an object and no tool_call_id', () => {
		const body = JSON.parse(
			chatRequestBody(
				OLLAMA,
				[
					{
						role: 'assistant',
						content: '',
						toolCalls: [{ id: 'call_abc', function: { name: 'list_notes', arguments: { query: 'x' } } }]
					},
					{ role: 'tool', content: '[]', toolCallId: 'call_abc' }
				],
				[]
			)
		);

		expect(body.messages[0].tool_calls[0]).toEqual({
			function: { name: 'list_notes', arguments: { query: 'x' } }
		});
		expect(body.messages[1]).not.toHaveProperty('tool_call_id');
	});
});
