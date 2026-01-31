import { writable } from 'svelte/store';

export const commandPaletteOpen = writable(false);
export const saveRequested = writable(false);
export const colorChangeRequested = writable<string | null>(null);
export const codeInsertRequested = writable(false);
export const fileInsertRequested = writable(false);
export const listModeToggleRequested = writable(false);
export const settingsOpen = writable(false);

export function setupGlobalShortcuts() {
    if (typeof window === 'undefined') return;

    console.log('Setting up global shortcuts...');

    window.addEventListener('keydown', (e) => {
        // Ctrl+P - Open command palette
        if (e.ctrlKey && e.key === 'p') {
            e.preventDefault();
            console.log('Ctrl+P pressed! Toggling command palette');
            commandPaletteOpen.update((v) => !v);
        }

        // Ctrl+S - Save file
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            console.log('Ctrl+S pressed! Saving file');
            saveRequested.set(true);
            setTimeout(() => saveRequested.set(false), 100);
        }

        // Ctrl+1/2/3/4/5 - Change note color
        if (e.ctrlKey && ['1', '2', '3', '4', '5'].includes(e.key)) {
            e.preventDefault();
            const colors = ['default', 'red', 'yellow', 'green', 'blue'];
            const colorIndex = parseInt(e.key) - 1;
            console.log('Color change requested:', colors[colorIndex]);
            colorChangeRequested.set(colors[colorIndex]);
            setTimeout(() => colorChangeRequested.set(null), 100);
        }

        // Ctrl+L - Toggle checklist mode
        if (e.ctrlKey && e.key === 'l') {
            e.preventDefault();
            console.log('Ctrl+L pressed! Toggling checklist mode');
            listModeToggleRequested.set(true);
            setTimeout(() => listModeToggleRequested.set(false), 100);
        }

        // Escape - Close command palette and settings
        if (e.key === 'Escape') {
            commandPaletteOpen.set(false);
            settingsOpen.set(false);
        }
    });

    console.log('✅ Global shortcuts registered');
}
