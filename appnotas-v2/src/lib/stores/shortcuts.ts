import { writable, get } from 'svelte/store';
import { focusArea, nextFocusArea, prevFocusArea } from './focus';
import { openFiles } from './files';
import { settingsStore } from './settings';

export const commandPaletteOpen = writable(false);
export const saveRequested = writable(false);
export const colorChangeRequested = writable<string | null>(null);
export const codeInsertRequested = writable(false);
export const fileInsertRequested = writable(false);
export const listModeToggleRequested = writable(false);
export const settingsOpen = writable(false);
export const activeTab = writable<'notes' | 'files'>('notes');

async function updateZoom(delta: number) {
    const settings = get(settingsStore);
    const newZoom = Math.max(0.5, Math.min(3.0, settings.zoomLevel + delta));
    settingsStore.update(s => ({ ...s, zoomLevel: newZoom }));
}

async function resetZoom() {
    settingsStore.update(s => ({ ...s, zoomLevel: 1.0 }));
}

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

        // Ctrl+1/2/3/4/5/0 - Change note color
        if (e.ctrlKey && ['1', '2', '3', '4', '5', '0'].includes(e.key)) {
            e.preventDefault();
            const colors: Record<string, string> = {
                '1': 'red',
                '2': 'yellow',
                '3': 'green',
                '4': 'blue',
                '5': 'purple',
                '0': 'default'
            };
            const color = colors[e.key];
            console.log('Color change requested:', color);
            colorChangeRequested.set(color);
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

        // Ctrl+Left - Move focus area left
        if (e.ctrlKey && e.key === 'ArrowLeft') {
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

            console.log('Ctrl+Left pressed! Moving focus from', current, 'to', next);
            focusArea.set(next);
        }

        // Ctrl+Right - Move focus area right
        if (e.ctrlKey && e.key === 'ArrowRight') {
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

            console.log('Ctrl+Right pressed! Moving focus from', current, 'to', next);
            focusArea.set(next);
        }

        // Ctrl++ or Ctrl+= - Zoom In
        if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
            e.preventDefault();
            updateZoom(0.1);
        }

        // Ctrl+- - Zoom Out
        if (e.ctrlKey && e.key === '-') {
            e.preventDefault();
            updateZoom(-0.1);
        }

        // Ctrl+0 - Reset Zoom
        if (e.ctrlKey && e.key === '0') {
            e.preventDefault();
            resetZoom();
        }

        // Escape - Close command palette and settings
        if (e.key === 'Escape') {
            commandPaletteOpen.set(false);
            settingsOpen.set(false);
        }
    });

    console.log('✅ Global shortcuts registered');
}
