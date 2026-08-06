import { defineConfig, devices } from '@playwright/test';

// The Tauri shell cannot run on a CI runner, so the e2e suite drives the real
// SvelteKit frontend in Chromium with the Rust IPC mocked (tests/e2e/tauri-mock.ts).
export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
	use: {
		baseURL: 'http://127.0.0.1:4173',
		trace: 'on-first-retry',
		viewport: { width: 1400, height: 900 },
		...devices['Desktop Chrome'],
		channel: undefined
	},
	webServer: {
		// The build runs as its own step (`test:e2e` locally, a workflow step in CI):
		// bundling inside this command pushed a cold runner past the start timeout.
		command: 'bunx vite preview --port 4173 --strictPort --host 127.0.0.1',
		url: 'http://127.0.0.1:4173',
		reuseExistingServer: !process.env.CI,
		timeout: 60_000
	}
});
