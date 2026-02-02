import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';

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
    aiModelPreference: 'gemini-2.5-flash' | 'gemini-2.5-pro' | 'gemini-2.5-flash-lite';
    zoomLevel: number;
    pinnedNoteIds: string[];
    autostart: boolean;
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
    lastActiveNoteId: '',
    aiModelPreference: 'gemini-2.5-flash',
    zoomLevel: 1.0,
    pinnedNoteIds: [],
    autostart: false
};

function createSettingsStore() {
    const { subscribe, set, update } = writable<AppSettings>(DEFAULT_SETTINGS);

    return {
        subscribe,
        set,
        update,
        init: async () => {
            try {
                // 1. Load settings file
                const settingsJson = await invoke<string>('read_file', { path: '.settings.json' });
                let loaded: Partial<AppSettings> = {};
                if (settingsJson) {
                    loaded = JSON.parse(settingsJson);
                }

                // 2. Sync with real system autostart state
                let autostartState = false;
                try {
                    autostartState = await isEnabled();
                    console.log('🔄 System Autostart Status:', autostartState);
                } catch (e) {
                    console.warn('Failed to check autostart status:', e);
                }

                // Merge: defaults < loaded < autostart state (System truth wins)
                set({
                    ...DEFAULT_SETTINGS,
                    ...loaded,
                    autostart: autostartState
                });

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
        },
        toggleAutostart: async () => {
            const current = get(settingsStore);
            const newState = !current.autostart;

            try {
                if (newState) {
                    await enable();
                    console.log('✅ Autostart enabled');
                } else {
                    await disable();
                    console.log('🚫 Autostart disabled');
                }

                settingsStore.update(s => ({ ...s, autostart: newState }));
                await settingsStore.save();

            } catch (e) {
                console.error('Failed to toggle autostart:', e);
                // Revert UI state if system call failed
                settingsStore.update(s => ({ ...s, autostart: current.autostart }));
            }
        }
    };
}

export const settingsStore = createSettingsStore();
