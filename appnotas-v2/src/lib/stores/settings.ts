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
    lastActiveTaskId: string;
    aiModelPreference: string;
    zoomLevel: number;
    pinnedNoteIds: string[];
    autostart: boolean;
    defaultShell: string;
    selectedTaskFileId: string;
    editorFont: string;
}

const DEFAULT_SETTINGS: AppSettings = {
    showEditorMenus: true,
    customColors: {
        ctrl1: '#ff4a4a',
        ctrl2: '#4a9eff',
        ctrl3: '#4aff4a'
    },
    keybinds: {
        'openPalette': 'Ctrl+P',
        'save': 'Ctrl+S',
        'toggleMenus': 'Ctrl+K',
        'toggleChecklist': 'Ctrl+L',
        'openSettings': 'Ctrl+,',
        'switchTabs': 'Ctrl+Tab',
        'focusLeft': 'Ctrl+Shift+ArrowLeft',
        'focusRight': 'Ctrl+Shift+ArrowRight',
        'zoomIn': 'Ctrl+=',
        'zoomOut': 'Ctrl+-',
        'aiTrigger': 'Ctrl+Shift+Enter',
        'aiAccept': 'Ctrl+Shift+]',
        'aiReject': 'Ctrl+Shift+[',
        'toggleTerminal': 'Ctrl+`',
        'toggleOverlay': 'Ctrl+Shift+L',
    },
    geminiKey: '',
    notesDirectory: '',
    lastActiveNoteId: '',
    lastActiveTaskId: '',
    aiModelPreference: 'gemini-2.0-flash',
    zoomLevel: 1.0,
    pinnedNoteIds: [],
    autostart: false,
    defaultShell: 'powershell',
    selectedTaskFileId: '',
    editorFont: 'Inter'
};

let settingsPath = ''; 
let settingsInitialized = false;
let lastSyncedOverlay = '';
let lastSyncedMain = 'Ctrl+Shift+Space';

function createSettingsStore() {
    const { subscribe, set, update } = writable<AppSettings>(DEFAULT_SETTINGS);

    return {
        subscribe,
        set,
        update,
        init: async () => {
            try {
                // 1. Get the safe config path from Rust
                settingsPath = await invoke<string>('get_config_path');
                console.log('📂 Config path resolved:', settingsPath);

                // 2. Try to read the file
                const settingsJson = await invoke<string>('read_file', { path: settingsPath }).catch(() => null);
                
                if (settingsJson) {
                    try {
                        const loaded = JSON.parse(settingsJson);
                        set({
                            ...DEFAULT_SETTINGS,
                            ...loaded,
                            autostart: await isEnabled().catch(() => false)
                        });
                        console.log('✅ Settings loaded from disk');
                        
                        // Sync loaded shortcuts to Rust immediately on startup
                        if (loaded.keybinds?.toggleOverlay) {
                            const overlay = loaded.keybinds.toggleOverlay;
                            const main = 'Ctrl+Shift+Space';
                            lastSyncedOverlay = overlay;
                            lastSyncedMain = main;
                            await invoke('update_shortcuts', { 
                                overlay, 
                                main 
                            }).catch(err => console.error('Failed to sync shortcuts on startup:', err));
                        }

                        settingsInitialized = true;
                        return;
                    } catch (e) {
                        console.error('Failed to parse settings:', e);
                    }
                }

                // If we get here, no file was found or it was invalid
                console.log('Using default settings');
                set(DEFAULT_SETTINGS);
                settingsInitialized = true;
                
                // Save initial defaults to the new safe path
                await invoke('write_file', {
                    path: settingsPath,
                    content: JSON.stringify(DEFAULT_SETTINGS, null, 2)
                });
            } catch (err) {
                console.error('Critical failure in settings init:', err);
            }
        },
        save: async () => {
            if (!settingsPath) return;
            const current = get(settingsStore);
            try {
                await invoke('write_file', {
                    path: settingsPath,
                    content: JSON.stringify(current, null, 2)
                });
                
                // Sync shortcuts to Rust only if they changed
                const newOverlay = current.keybinds.toggleOverlay;
                const newMain = 'Ctrl+Shift+Space'; 
                
                if (newOverlay && (newOverlay !== lastSyncedOverlay || newMain !== lastSyncedMain)) {
                    await invoke('update_shortcuts', { 
                        overlay: newOverlay, 
                        main: newMain
                    }).then(() => {
                        lastSyncedOverlay = newOverlay;
                        lastSyncedMain = newMain;
                    }).catch(err => console.error('Failed to sync shortcuts to Rust:', err));
                }
            } catch (err) {
                console.error('Failed to save settings:', err);
            }
        },
        toggleMenus: () => {
            update(s => {
                const newSettings = { ...s, showEditorMenus: !s.showEditorMenus };
                return newSettings;
            });
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

            } catch (e) {
                console.error('Failed to toggle autostart:', e);
                // Revert UI state if system call failed
                settingsStore.update(s => ({ ...s, autostart: current.autostart }));
            }
        }
    };
}

export const settingsStore = createSettingsStore();

// Auto-save any change after initialization
settingsStore.subscribe(async (s) => {
    if (settingsInitialized) {
        console.log('💾 Auto-saving settings to:', settingsPath);
        await settingsStore.save();
    }
});
