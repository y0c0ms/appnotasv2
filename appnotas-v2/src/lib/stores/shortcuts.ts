import { writable, get } from 'svelte/store';
import { focusArea, nextFocusArea, prevFocusArea } from './focus';
import { openFiles } from './files';

export const commandPaletteOpen = writable(false);
export const saveRequested = writable(false);
export const colorChangeRequested = writable<string | null>(null);
export const codeInsertRequested = writable(false);
export const fileInsertRequested = writable(false);
export const listModeToggleRequested = writable(false);
export const settingsOpen = writable(false);
export const activeTab = writable<'notes' | 'files'>('notes');

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

        // Ctrl+K - Toggle editor menus
        if (e.ctrlKey && e.key === 'k') {
            e.preventDefault();
            console.log('Ctrl+K pressed! Toggling editor menus');
            // We'll handle this in the main app to keep shortcuts.ts generic
            const event = new CustomEvent('toggle-editor-menus');
            window.dispatchEvent(event);
        }

        // Ctrl+, - Open settings
        if (e.ctrlKey && e.key === ',') {
            e.preventDefault();
            console.log('Ctrl+, pressed! Opening settings');
            settingsOpen.update(v => !v);
        }

        // Ctrl+Tab - Switch sidebar tabs
        if (e.ctrlKey && e.key === 'Tab') {
            e.preventDefault();
            activeTab.update(t => t === 'notes' ? 'files' : 'notes');
            focusArea.set('list');
            console.log('Ctrl+Tab pressed! Switching sidebar tab and focusing list');
        }

        // Alt+Left - Move focus area left
        if (e.altKey && e.key === 'ArrowLeft') {
            e.preventDefault();
            const current = get(focusArea);
            let next = prevFocusArea(current);

            // Skip file-tabs if not relevant
            if (next === 'file-tabs') {
                const tab = get(activeTab);
                const files = get(openFiles);
                if (tab !== 'files' || files.length === 0) {
                    next = prevFocusArea(next);
                }
            }

            console.log('Alt+Left pressed! Moving focus from', current, 'to', next);
            focusArea.set(next);
        }

        // Alt+Right - Move focus area right
        if (e.altKey && e.key === 'ArrowRight') {
            e.preventDefault();
            const current = get(focusArea);
            let next = nextFocusArea(current);

            // Skip file-tabs if not relevant
            if (next === 'file-tabs') {
                const tab = get(activeTab);
                const files = get(openFiles);
                if (tab !== 'files' || files.length === 0) {
                    next = nextFocusArea(next);
                }
            }

            console.log('Alt+Right pressed! Moving focus from', current, 'to', next);
            focusArea.set(next);
        }

        // Escape - Close command palette and settings
        if (e.key === 'Escape') {
            commandPaletteOpen.set(false);
            settingsOpen.set(false);
        }
    });

    console.log('✅ Global shortcuts registered');
}
