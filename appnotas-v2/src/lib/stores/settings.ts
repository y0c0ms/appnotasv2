import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export interface AppSettings {
    showEditorMenus: boolean;
    customColors: {
        ctrl1: string;
        ctrl2: string;
        ctrl3: string;
    };
    keybinds: Record<string, string>;
    geminiKey: string;
    notesDirectory: string;
    lastActiveNoteId: string;
}

const DEFAULT_SETTINGS: AppSettings = {
    showEditorMenus: true,
    customColors: {
        ctrl1: '#ff4a4a',
        ctrl2: '#4a9eff',
        ctrl3: '#4aff4a'
    },
    keybinds: {
        'toggleMenus': 'Control+k',
        'openSettings': 'Control+,',
        'newNote': 'Control+n',
        'search': 'Control+f'
    },
    geminiKey: '',
    notesDirectory: '',
    lastActiveNoteId: ''
};

function createSettingsStore() {
    const { subscribe, set, update } = writable<AppSettings>(DEFAULT_SETTINGS);

    return {
        subscribe,
        set,
        update,
        init: async () => {
            try {
                const settingsJson = await invoke<string>('read_file', { path: '.settings.json' });
                if (settingsJson) {
                    const loaded = JSON.parse(settingsJson);
                    set({ ...DEFAULT_SETTINGS, ...loaded });
                }
            } catch (err) {
                console.log('No settings file found, using defaults');
                // Create default settings file
                await invoke('write_file', {
                    path: '.settings.json',
                    content: JSON.stringify(DEFAULT_SETTINGS, null, 2)
                });
            }
        },
        save: async () => {
            const current = get(settingsStore);
            try {
                await invoke('write_file', {
                    path: '.settings.json',
                    content: JSON.stringify(current, null, 2)
                });
            } catch (err) {
                console.error('Failed to save settings:', err);
            }
        },
        toggleMenus: () => {
            update(s => {
                const newSettings = { ...s, showEditorMenus: !s.showEditorMenus };
                return newSettings;
            });
            settingsStore.save();
        }
    };
}

export const settingsStore = createSettingsStore();
