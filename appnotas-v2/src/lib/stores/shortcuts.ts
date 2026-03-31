import { writable, get } from 'svelte/store';
import { focusArea, nextFocusArea, prevFocusArea } from './focus';
import { openFiles, terminalVisible } from './files';
import { settingsStore } from './settings';

export const commandPaletteOpen = writable(false);
export const saveRequested = writable(false);
export const colorChangeRequested = writable<string | null>(null);
export const codeInsertRequested = writable(false);
export const fileInsertRequested = writable(false);
export const listModeToggleRequested = writable(false);
export const settingsOpen = writable(false);
export const activeTab = writable<'notes' | 'files' | 'tasks'>('notes');

async function updateZoom(delta: number) {
    const settings = get(settingsStore);
    const newZoom = Math.max(0.5, Math.min(3.0, settings.zoomLevel + delta));
    settingsStore.update(s => ({ ...s, zoomLevel: newZoom }));
}

async function resetZoom() {
    settingsStore.update(s => ({ ...s, zoomLevel: 1.0 }));
}

/**
 * Parse a keybind string and check if it matches the keyboard event
 * Format: "Ctrl+Shift+P", "Ctrl+,", "Alt+Enter", etc.
 */
function matchesKeybind(e: KeyboardEvent, keybind: string): boolean {
    if (!keybind) return false;

    const parts = keybind.split('+');
    const key = parts[parts.length - 1]; // Last part is the key
    const modifiers = parts.slice(0, -1).map(m => m.toLowerCase());

    // Check modifiers
    const needsCtrl = modifiers.includes('ctrl') || modifiers.includes('control');
    const needsShift = modifiers.includes('shift');
    const needsAlt = modifiers.includes('alt');
    const needsMeta = modifiers.includes('meta') || modifiers.includes('cmd');

    if (e.ctrlKey !== needsCtrl) return false;
    if (e.shiftKey !== needsShift) return false;
    if (e.altKey !== needsAlt) return false;
    if (e.metaKey !== needsMeta) return false;

    const eventKey = e.key.toLowerCase();
    const bindKey = key.toLowerCase();

    // Handle special key names
    if (bindKey === 'arrowleft') return eventKey === 'arrowleft';
    if (bindKey === 'arrowright') return eventKey === 'arrowright';
    if (bindKey === 'arrowup') return eventKey === 'arrowup';
    if (bindKey === 'arrowdown') return eventKey === 'arrowdown';
    if (bindKey === 'enter') return eventKey === 'enter';
    if (bindKey === 'tab') return eventKey === 'tab';
    if (bindKey === 'escape') return eventKey === 'escape';
    if (bindKey === 'backspace') return eventKey === 'backspace';
    if (bindKey === 'space') return eventKey === ' ';

    return eventKey === bindKey;
}

export function setupGlobalShortcuts() {
    if (typeof window === 'undefined') return;

    console.log('Setting up global shortcuts...');

    // Use capture phase to intercept events before they reach editors
    window.addEventListener('keydown', (e) => {
        const keybinds = get(settingsStore).keybinds;

        // Open command palette
        if (matchesKeybind(e, keybinds.openPalette)) {
            e.preventDefault();
            console.log('Command palette toggled');
            commandPaletteOpen.update((v) => !v);
            return;
        }

        // Save file
        if (matchesKeybind(e, keybinds.save)) {
            e.preventDefault();
            saveRequested.set(true);
            setTimeout(() => saveRequested.set(false), 100);
            return;
        }

        // Ctrl+1/2/3/4/5/0 - Change note color (hardcoded for simplicity)
        if (e.ctrlKey && !e.shiftKey && ['1', '2', '3', '4', '5', '0'].includes(e.key)) {
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
            return;
        }

        // Toggle checklist mode
        if (matchesKeybind(e, keybinds.toggleChecklist)) {
            e.preventDefault();
            console.log('Toggle checklist');
            listModeToggleRequested.set(true);
            setTimeout(() => listModeToggleRequested.set(false), 100);
            return;
        }

        // Toggle editor menus
        if (matchesKeybind(e, keybinds.toggleMenus)) {
            e.preventDefault();
            console.log('Toggle editor menus');
            const event = new CustomEvent('toggle-editor-menus');
            window.dispatchEvent(event);
            return;
        }

        // Open settings
        if (matchesKeybind(e, keybinds.openSettings)) {
            e.preventDefault();
            console.log('Toggle settings');
            settingsOpen.update(v => !v);
            return;
        }

        // Switch sidebar tabs
        if (matchesKeybind(e, keybinds.switchTabs)) {
            e.preventDefault();
            activeTab.update(t => {
                if (t === 'notes') return 'files';
                if (t === 'files') return 'tasks';
                return 'notes';
            });
            focusArea.set('list');
            console.log('Switched sidebar tab');
            return;
        }

        // Move focus area left
        if (matchesKeybind(e, keybinds.focusLeft)) {
            e.preventDefault();
            e.stopPropagation();
            const current = get(focusArea);
            const tab = get(activeTab);
            console.log('[Shortcuts] Focus left triggered, current:', current, 'tab:', tab);

            if (current === 'settings') {
                focusArea.update(() => 'editor');
                return;
            }

            let next = prevFocusArea(current);

            // Convert 'search' placeholder to actual search area based on tab
            if (next === 'search' as any) {
                next = tab === 'files' ? 'file-search' : 'note-search';
            }

            // Skip file-tabs if not on files tab or no files open
            if (next === 'file-tabs') {
                const files = get(openFiles);
                if (tab !== 'files' || files.length === 0) {
                    next = prevFocusArea(next);
                }
            }

            // Skip terminal and terminal-tabs if terminal is hidden
            if (next === 'terminal' || next === 'terminal-tabs') {
                if (!get(terminalVisible)) {
                    next = prevFocusArea(next);
                }
            }

            // Final search check in case skipping landed us on 'search'
            if (next === 'search' as any) {
                next = tab === 'files' ? 'file-search' : 'note-search';
            }

            console.log('[Shortcuts] Focus changing to:', next);
            focusArea.set(next);
            return;
        }

        // Move focus area right
        if (matchesKeybind(e, keybinds.focusRight)) {
            e.preventDefault();
            e.stopPropagation();
            const current = get(focusArea);
            const tab = get(activeTab);
            console.log('[Shortcuts] Focus right triggered, current:', current, 'tab:', tab);

            if (current === 'editor' && get(settingsOpen)) {
                focusArea.set('settings');
                return;
            }

            let next = nextFocusArea(current);

            // Convert 'search' placeholder to actual search area based on tab
            if (next === 'search' as any) {
                next = tab === 'files' ? 'file-search' : 'note-search';
            }

            // Skip file-tabs if not on files tab or no files open
            if (next === 'file-tabs') {
                const files = get(openFiles);
                if (tab !== 'files' || files.length === 0) {
                    next = nextFocusArea(next);
                }
            }

            // Skip terminal and terminal-tabs if terminal is hidden
            if (next === 'terminal' || next === 'terminal-tabs') {
                if (!get(terminalVisible)) {
                    next = nextFocusArea(next);
                }
            }

            // Final search check in case skipping landed us on 'search'
            if (next === 'search' as any) {
                next = tab === 'files' ? 'file-search' : 'note-search';
            }

            console.log('[Shortcuts] Focus changing to:', next);
            focusArea.set(next);
            return;
        }

        // Zoom In
        if (matchesKeybind(e, keybinds.zoomIn)) {
            e.preventDefault();
            updateZoom(0.1);
            return;
        }

        // Zoom Out
        if (matchesKeybind(e, keybinds.zoomOut)) {
            e.preventDefault();
            updateZoom(-0.1);
            return;
        }

        // Toggle terminal (works on both tabs)
        if (matchesKeybind(e, keybinds.toggleTerminal)) {
            e.preventDefault();
            console.log('Toggle terminal');
            terminalVisible.update(v => !v);
            return;
        }

        // AI Trigger (global)
        if (matchesKeybind(e, keybinds.aiTrigger)) {
            e.preventDefault();
            console.log('[Shortcuts] Global AI trigger detected');
            const event = new CustomEvent('app:ai-trigger');
            window.dispatchEvent(event);
            return;
        }

        // AI Accept (global)
        if (matchesKeybind(e, keybinds.aiAccept)) {
            e.preventDefault();
            console.log('[Shortcuts] Global AI accept detected');
            const event = new CustomEvent('app:ai-accept');
            window.dispatchEvent(event);
            return;
        }

        // AI Reject (global)
        if (matchesKeybind(e, keybinds.aiReject)) {
            e.preventDefault();
            console.log('[Shortcuts] Global AI reject detected');
            const event = new CustomEvent('app:ai-reject');
            window.dispatchEvent(event);
            return;
        }

        // Escape - Close command palette and settings (always available)
        if (e.key === 'Escape') {
            commandPaletteOpen.set(false);
            settingsOpen.set(false);
        }
    }, { capture: true }); // Capture phase to intercept before editors

    console.log('✅ Global shortcuts registered');
}
