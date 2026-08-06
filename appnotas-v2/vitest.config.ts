import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
    plugins: [svelte({ hot: !process.env.VITEST })],
    test: {
        globals: true,
        environment: 'jsdom',
        // tests/e2e is Playwright's; its specs throw if vitest collects them.
        exclude: ['node_modules/**', 'tests/e2e/**'],
    },
    resolve: {
        alias: {
            $lib: '/src/lib',
        },
    },
});
