import { describe, it, expect } from 'vitest';
import { extractTextToolCalls } from '../src/lib/stores/localChatStore';

// Local models registered from a plain GGUF template never fill Ollama's
// `message.tool_calls`; they write the call into the answer text. If this parsing
// regresses, every MCP tool in the Models panel silently stops firing.
describe('extractTextToolCalls', () => {
	it('recovers a bare tool call object', () => {
		const { calls, cleaned } = extractTextToolCalls('{"name": "list_notes", "arguments": {}}');

		expect(calls).toHaveLength(1);
		expect(calls[0].function.name).toBe('list_notes');
		expect(calls[0].function.arguments).toEqual({});
		expect(cleaned).toBe('');
	});

	it('recovers a fenced tool call with nested arguments', () => {
		const content = 'Sure.\n```json\n{\n "name": "create_note",\n "arguments": {"title": "Release", "content": "{ok}"}\n}\n```';

		const { calls } = extractTextToolCalls(content);

		expect(calls).toHaveLength(1);
		expect(calls[0].function.arguments).toEqual({ title: 'Release', content: '{ok}' });
	});

	it('drops results the model invented before the tool ran', () => {
		const content = '{"name": "list_notes", "arguments": {}}\n\nHere are your notes:\n1. Note 1\n2. Note 2';

		const { calls, cleaned } = extractTextToolCalls(content);

		expect(calls).toHaveLength(1);
		expect(cleaned).toBe('');
	});

	it('accepts `parameters` as an alias for `arguments`', () => {
		const { calls } = extractTextToolCalls('{"name": "read_note", "parameters": {"path_or_id": "a.md"}}');

		expect(calls[0].function.arguments).toEqual({ path_or_id: 'a.md' });
	});

	it('ignores JSON that does not name a known tool', () => {
		const content = '{"name": "rm_rf", "arguments": {"path": "/"}}';

		const { calls, cleaned } = extractTextToolCalls(content);

		expect(calls).toEqual([]);
		expect(cleaned).toBe(content);
	});

	it('leaves ordinary answers untouched, including code blocks', () => {
		const content = 'Use a struct:\n```rust\nstruct Foo { bar: u8 }\n```';

		const { calls, cleaned } = extractTextToolCalls(content);

		expect(calls).toEqual([]);
		expect(cleaned).toBe(content);
	});
});
