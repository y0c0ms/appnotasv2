import { test, expect } from '@playwright/test';
import { installTauriMock, queueStreamReply, setChunkDelay, tokens } from './tauri-mock';

const TOOL_CALL = '{"name": "list_notes", "arguments": {}}';
const ASSISTANT = '.chat-bubble.assistant';
const USER = '.chat-bubble.user';

test.beforeEach(async ({ page }) => {
	await installTauriMock(page);
	await page.goto('/');
	await page.getByTitle('Toggle Local Models & OCR').click();
	await expect(page.getByPlaceholder('Ask local LLM...')).toBeVisible();
});

test('renders assistant tokens as they arrive instead of one final blob', async ({ page }) => {
	await setChunkDelay(page, 300);
	await queueStreamReply(page, tokens('Sure, ', 'here are ', 'the numbers: ', '1 2 3'));

	await page.getByPlaceholder('Ask local LLM...').fill('count to three');
	await page.getByTitle('Send').click();

	// Partial text must be on screen before the turn finishes.
	const bubble = page.locator(ASSISTANT).last();
	await expect(bubble).toContainText('Sure,');
	await expect(bubble).not.toContainText('1 2 3');

	await expect(bubble).toContainText('Sure, here are the numbers: 1 2 3');
	await expect(page.locator('.status-bar')).toHaveText('Ready.');
});

test('runs an MCP tool the model requested as text, then answers from its result', async ({ page }) => {
	// Round 1: the model writes the call as text (no native tool_calls) and invents
	// a result. Round 2: the real answer, after the tool output is fed back.
	await queueStreamReply(page, tokens(TOOL_CALL, '\n\nHere are your notes:\n1. Invented'));
	await queueStreamReply(page, tokens('You have 2 notes: BeefPrime and OIDC Fabio.'));

	await page.getByPlaceholder('Ask local LLM...').fill('list my notes');
	await page.getByTitle('Send').click();

	const bubble = page.locator(ASSISTANT).last();
	await expect(bubble).toContainText('Executing tool');
	await expect(bubble).toContainText('list_notes');
	// The tool really ran: the note titles come from the mocked Rust command.
	await expect(bubble).toContainText('BeefPrime');
	await expect(bubble).toContainText('You have 2 notes');
	// The fabricated pre-tool result never reaches the user.
	await expect(bubble).not.toContainText('Invented');

	const commands = await page.evaluate(() => window.__E2E__.invocations.map(i => i.cmd));
	expect(commands).toContain('list_notes_files');
	expect(commands.filter(c => c === 'ai_stream')).toHaveLength(2);
});

test('queues a message sent mid-stream and runs it when the turn ends', async ({ page }) => {
	await setChunkDelay(page, 400);
	await queueStreamReply(page, tokens('first ', 'answer ', 'done'));
	await queueStreamReply(page, tokens('second answer'));

	const input = page.getByPlaceholder('Ask local LLM...');
	await input.fill('first question');
	await page.getByTitle('Send').click();

	await input.fill('second question');
	await page.getByTitle('Queue this message').click();
	await expect(page.locator('.queue-bar')).toContainText('Queued (1)');

	await expect(page.locator(USER).last()).toHaveText(/second question/);
	await expect(page.locator(ASSISTANT).last()).toContainText('second answer');
	await expect(page.locator('.queue-bar')).toHaveCount(0);
});

test('reads the clipboard while a response is still streaming', async ({ page }) => {
	await setChunkDelay(page, 400);
	await queueStreamReply(page, tokens('slow ', 'answer ', 'still ', 'going'));

	await page.getByPlaceholder('Ask local LLM...').fill('anything');
	await page.getByTitle('Send').click();

	const clipboardButton = page.getByRole('button', { name: 'Read Clipboard' });
	await expect(clipboardButton).toBeEnabled();
	await clipboardButton.click();

	await expect(page.locator('.ocr-preview')).toContainText('SERVICEDESK TICKET 13369711');
});
