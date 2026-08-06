import { test, expect, type Locator, type Page } from '@playwright/test';
import { installTauriMock } from './tauri-mock';

/** Content width: the bordered box would report an extra pixel per side. */
async function width(locator: Locator): Promise<number> {
	return locator.evaluate(el => el.clientWidth);
}

/** Press the grip and walk the pointer, which is what the mousemove listener needs. */
async function dragBy(page: Page, grip: Locator, deltaX: number) {
	const box = await grip.boundingBox();
	if (!box) throw new Error('grip has no box');
	const y = box.y + box.height / 2;

	await page.mouse.move(box.x + box.width / 2, y);
	await page.mouse.down();
	for (const step of [0.34, 0.67, 1]) {
		await page.mouse.move(box.x + box.width / 2 + deltaX * step, y);
	}
	await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
	await installTauriMock(page);
	await page.goto('/');
});

test('left sidebar keeps a dragged width', async ({ page }) => {
	const sidebar = page.locator('.sidebar');
	const before = await width(sidebar);

	await dragBy(page, page.getByRole('button', { name: 'Resize sidebar' }), 120);

	expect(await width(sidebar)).toBeCloseTo(before + 120, -1);
});

test('left sidebar clamps at its minimum', async ({ page }) => {
	await dragBy(page, page.getByRole('button', { name: 'Resize sidebar' }), -400);

	expect(await width(page.locator('.sidebar'))).toBe(180);
});

test('models sidebar keeps a dragged width and the editor keeps the rest', async ({ page }) => {
	await page.getByTitle('Toggle Local Models & OCR').click();

	const panel = page.locator('.models-sidebar');
	const before = await width(panel);
	const editorBefore = await width(page.locator('.editor-section'));

	// Right-hand panel: dragging its grip left makes it wider.
	await dragBy(page, page.getByRole('button', { name: 'Resize models sidebar' }), -100);

	const after = await width(panel);
	expect(after).toBeCloseTo(before + 100, -1);
	expect(await width(page.locator('.editor-section'))).toBeCloseTo(editorBefore - 100, -1);
});

test('arrow keys resize the focused grip', async ({ page }) => {
	const sidebar = page.locator('.sidebar');
	const before = await width(sidebar);

	const grip = page.getByRole('button', { name: 'Resize sidebar' });
	await grip.focus();
	await grip.press('ArrowRight');
	await grip.press('ArrowRight');

	expect(await width(sidebar)).toBe(before + 32);
});

test('models panel scales with Ctrl+= zoom like the rest of the app', async ({ page }) => {
	await page.getByTitle('Toggle Local Models & OCR').click();

	const panel = page.locator('.models-panel');
	const fontBefore = await panel.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
	const widthBefore = await width(page.locator('.models-sidebar'));

	await page.keyboard.press('Control+Equal');
	await page.keyboard.press('Control+Equal');

	expect(await panel.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(fontBefore);
	expect(await width(page.locator('.models-sidebar'))).toBeGreaterThan(widthBefore);
});
