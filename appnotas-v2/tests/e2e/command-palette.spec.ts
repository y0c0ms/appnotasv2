import { test, expect, type Page } from '@playwright/test';
import { installTauriMock } from './tauri-mock';

// Typing `@` in a note opens the command palette. Each entry is routed from the
// palette to the editor by id, and a missing branch on either side is a command
// that logs "Command selected" and then silently does nothing — which is
// exactly how `@style` and `@image` were dead. One test per command that has an
// observable effect, so a broken route fails instead of going unnoticed.

async function openPalette(page: Page) {
	await page.locator('.note-item').first().click();
	await page.locator('[contenteditable="true"]').first().click();
	await page.keyboard.press('@');
	await expect(page.locator('.command-palette')).toBeVisible();
}

/** The settings the app last persisted, as the mocked `write_file` saw them. */
async function savedSettings(page: Page) {
	return await page.evaluate(() => {
		const writes = window.__E2E__.invocations.filter(
			i => i.cmd === 'write_file' && String(i.args.path).endsWith('appnotas-settings.json')
		);
		const last = writes[writes.length - 1];
		return last ? (JSON.parse(String(last.args.content)) as Record<string, unknown>) : null;
	});
}

test.beforeEach(async ({ page }) => {
	await installTauriMock(page);
	await page.goto('/');
});

test('@ opens the palette and Escape closes it without touching the note', async ({ page }) => {
	await openPalette(page);
	// The trigger key is swallowed, so no stray "@" is left behind to clean up.
	await expect(page.locator('[contenteditable="true"]').first()).not.toContainText('@');

	await page.locator('.search-input').press('Escape');

	await expect(page.locator('.command-palette')).toHaveCount(0);
});

test('@style toggles the editor formatting menus', async ({ page }) => {
	await openPalette(page);
	await expect.poll(async () => (await savedSettings(page))?.showEditorMenus).toBe(true);

	await page.locator('.command-item', { hasText: '@style' }).click();

	await expect(page.locator('.command-palette')).toHaveCount(0);
	await expect.poll(async () => (await savedSettings(page))?.showEditorMenus).toBe(false);
});

test('@tasks inserts a checklist into the note', async ({ page }) => {
	await openPalette(page);

	await page.locator('.command-item', { hasText: '@tasks' }).click();

	await expect(page.locator('[contenteditable="true"] [data-type="taskList"]')).toBeVisible();
});

test('@code drops the cursor into a code block', async ({ page }) => {
	await openPalette(page);

	await page.locator('.command-item', { hasText: '@code' }).click();

	await expect(page.locator('[contenteditable="true"] pre')).toBeVisible();
});
