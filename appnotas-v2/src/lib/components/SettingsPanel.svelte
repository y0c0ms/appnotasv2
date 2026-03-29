<script lang="ts">
    import { settingsStore } from '$lib/stores/settings';
    import { settingsOpen } from '$lib/stores/shortcuts';
    import { focusArea } from '$lib/stores/focus';
    import { invoke } from '@tauri-apps/api/core';
    import { open as openDialog, save as saveDialog, message } from '@tauri-apps/plugin-dialog';
    import { fade, slide } from 'svelte/transition';
    import { geminiService } from '../services/geminiService';
    import { onMount } from 'svelte';
    import { X, FolderOpen, Upload, Download } from 'lucide-svelte';

    // Shortcut names for display
    const shortcutNames: Record<string, string> = {
        'openPalette': 'Open Palette',
        'save': 'Save',
        'toggleMenus': 'Toggle Menus',
        'toggleChecklist': 'Toggle Checklist',
        'openSettings': 'Settings',
        'switchTabs': 'Switch Tabs',
        'focusLeft': 'Focus Left',
        'focusRight': 'Focus Right',
        'zoomIn': 'Zoom In',
        'zoomOut': 'Zoom Out',
        'aiTrigger': 'AI Trigger',
        'toggleTerminal': 'Toggle Terminal',
        'toggleOverlay': 'Toggle Overlay',
    };

    let recordingShortcut: string | null = null;
    let availableModels: string[] = ['gemini-2.5-flash'];
    let isLoadingModels = false;
    let isTestingModel = false;
    let modelFetchTimeout: ReturnType<typeof setTimeout>;

    onMount(() => {
        loadModels();
    });

    async function loadModels() {
        const apiKey = $settingsStore.geminiKey;
        if (!apiKey) return;
        
        isLoadingModels = true;
        try {
            const models = await geminiService.getAvailableModels(apiKey);
            if (models.length > 0) {
                availableModels = models;
                // If current pref is not in list (and not empty), maybe keep it or warn?
                // For now we just add it to list if handled by backend, but here we strictly list what api returns.
                // But we should ensure at least the current pref is valid or fallback?
            }
        } catch (e) {
            console.error('Failed to load models:', e);
        } finally {
            isLoadingModels = false;
        }
    }

    async function testConfiguration() {
        const apiKey = $settingsStore.geminiKey;
        const model = $settingsStore.aiModelPreference;
        
        if (!apiKey) {
            await message('Please enter an API Key first.', { title: 'Configuration Error', kind: 'error' });
            return;
        }

        isTestingModel = true;
        try {
            const success = await geminiService.validateModel(model);
            if (success) {
                await message(`Successfully connected to ${model}!`, { title: 'Configuration Verified', kind: 'info' });
            } else {
                await message(`Failed to verify ${model}. Check logs for details.`, { title: 'Verification Failed', kind: 'error' });
            }
        } catch (e) {
            await message(`Error validating configuration: ${e instanceof Error ? e.message : String(e)}`, { title: 'Error', kind: 'error' });
        } finally {
            isTestingModel = false;
        }
    }

    function handleKeyChange() {
        save();
        clearTimeout(modelFetchTimeout);
        modelFetchTimeout = setTimeout(() => {
             loadModels();
        }, 1000);
    }

    function startRecording(key: string) {
        recordingShortcut = key;
    }

    function captureKey(e: KeyboardEvent, key: string) {
        // Ignore modifier-only presses
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
        
        // Allow Escape to cancel
        if (e.key === 'Escape') {
            recordingShortcut = null;
            return;
        }

        e.preventDefault();

        // Build keybind string
        const parts: string[] = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.shiftKey) parts.push('Shift');
        if (e.altKey) parts.push('Alt');
        if (e.metaKey) parts.push('Meta');
        
        // Normalize key name
        let keyName = e.key;
        if (keyName === ' ') keyName = 'Space';
        if (keyName.length === 1) keyName = keyName.toUpperCase();
        
        parts.push(keyName);
        const newKeybind = parts.join('+');
        
        // Update settings
        settingsStore.update(s => ({
            ...s,
            keybinds: { ...s.keybinds, [key]: newKeybind }
        }));
        settingsStore.save();
        
        recordingShortcut = null;
    }

    async function exportSettings() {
        try {
            const currentSettings = $settingsStore;
            const content = JSON.stringify(currentSettings, null, 2);
            
            const selected = await saveDialog({
                filters: [{ name: 'Settings', extensions: ['txt', 'json'] }],
                defaultPath: 'appnotas_settings.txt',
                title: 'Export Settings'
            });

            if (selected) {
                await invoke('write_file', { path: selected, content });
                await message('Settings exported successfully!', { title: 'Export Success', kind: 'info' });
            }
        } catch (err) {
            console.error('Failed to export settings:', err);
            await message(`Failed to export settings: ${err}`, { title: 'Export Error', kind: 'error' });
        }
    }

    async function importSettings() {
        try {
            const selected = await openDialog({
                multiple: false,
                filters: [{ name: 'Settings', extensions: ['txt', 'json'] }],
                title: 'Import Settings'
            });

            if (selected && typeof selected === 'string') {
                const content = await invoke<string>('read_file', { path: selected });
                const imported = JSON.parse(content);
                
                // Simple validation check (should have some expected keys)
                if (imported && typeof imported === 'object' && ('keybinds' in imported || 'geminiKey' in imported)) {
                    // Merge with current state to ensure no missing keys if schema changed
                    settingsStore.update(current => ({
                        ...current,
                        ...imported
                    }));
                    await settingsStore.save();
                    
                    // Trigger manual directory update if it changed
                    if (imported.notesDirectory) {
                        window.dispatchEvent(new CustomEvent('notes-directory-changed', { detail: imported.notesDirectory }));
                    }
                    
                    await message('Settings imported and applied successfully!', { title: 'Import Success', kind: 'info' });
                } else {
                    throw new Error('Invalid settings file format.');
                }
            }
        } catch (err) {
            console.error('Failed to import settings:', err);
            await message(`Failed to import settings: ${err instanceof Error ? err.message : String(err)}`, { title: 'Import Error', kind: 'error' });
        }
    }

    async function selectDirectory() {
        try {
            const selected = await openDialog({
                directory: true,
                multiple: false,
                title: 'Select Notes Directory'
            });
            
            if (selected && typeof selected === 'string') {
                settingsStore.update(s => ({ ...s, notesDirectory: selected }));
                settingsStore.save();
                window.dispatchEvent(new CustomEvent('notes-directory-changed', { detail: selected }));
            }
        } catch (err) {
            console.error('Failed to select directory:', err);
        }
    }

    function close() {
        settingsOpen.set(false);
    }

    function save() {
        settingsStore.save();
    }

    $: settings = $settingsStore;

    let panelElement: HTMLElement;
    
    $: if ($focusArea === 'settings' && panelElement) {
        panelElement.focus();
    }
</script>

<div 
    class="settings-panel" 
    transition:slide={{ axis: 'x', duration: 300 }}
    tabindex="0"
    role="dialog"
    aria-label="Settings"
    bind:this={panelElement}
    on:focus={() => focusArea.set('settings')}
>
    <div class="settings-header">
        <h2>Settings</h2>
        <button class="close-btn" on:click={close}><X size={18} /></button>
    </div>

    <div class="settings-content">
        <section>
            <h3>General</h3>
            <div class="setting-item">
                <span>Run on Startup</span>
                <label class="switch">
                    <input type="checkbox" checked={$settingsStore.autostart} on:change={() => settingsStore.toggleAutostart()} />
                    <span class="slider"></span>
                </label>
            </div>
            <p class="hint">Automatically launch AppNotas when you log in</p>
        </section>

        <section>
            <h3>Editor</h3>
            <div class="setting-item">
                <span>Show Formatting Menus</span>
                <label class="switch">
                    <input type="checkbox" bind:checked={$settingsStore.showEditorMenus} on:change={save} />
                    <span class="slider"></span>
                </label>
            </div>
            <p class="hint">Toggle Bubble and Floating menus (also via Ctrl+K)</p>
            <div class="setting-item column" style="margin-top: 1rem;">
                <label for="font-pref">Editor Font</label>
                <select 
                    id="font-pref"
                    bind:value={$settingsStore.editorFont} 
                    on:change={save}
                    class="text-input select-input"
                >
                    <option value="Inter">Inter (Sans Serif)</option>
                    <option value="Roboto">Roboto (Sans Serif)</option>
                    <option value="Space Grotesk">Space Grotesk (Modern)</option>
                    <option value="'Fira Code', monospace">Fira Code (Monospace)</option>
                    <option value="system-ui">System Default</option>
                </select>
            </div>
        </section>

        <section>
            <h3>Custom Text Colors</h3>
            <p class="hint">Colors used for Ctrl+1, Ctrl+2, and Ctrl+3</p>
            <div class="color-grid">
                <div class="color-item">
                    <label for="color-ctrl1">Ctrl+1</label>
                    <input id="color-ctrl1" type="color" bind:value={$settingsStore.customColors.ctrl1} on:change={save} />
                </div>
                <div class="color-item">
                    <label for="color-ctrl2">Ctrl+2</label>
                    <input id="color-ctrl2" type="color" bind:value={$settingsStore.customColors.ctrl2} on:change={save} />
                </div>
                <div class="color-item">
                    <label for="color-ctrl3">Ctrl+3</label>
                    <input id="color-ctrl3" type="color" bind:value={$settingsStore.customColors.ctrl3} on:change={save} />
                </div>
            </div>
        </section>

        <section>
            <h3>File System</h3>
            <div class="setting-item column">
                <span class="label">Notes Directory</span>
                <div class="dir-picker">
                    <span class="dir-path" title={$settingsStore.notesDirectory}>
                        {$settingsStore.notesDirectory || 'No directory selected'}
                    </span>
                    <button class="btn-picker" on:click={selectDirectory}>
                        <div style="display: flex; gap: 0.5rem; align-items: center; justify-content: center;"><FolderOpen size={16} /> Browse</div>
                    </button>
                </div>
            </div>
            <p class="hint">Where your .md notes and files are stored</p>
        </section>

        <section>
            <h3>AI Configuration</h3>
            <div class="setting-item column">
                <label for="gemini-key">Gemini API Key</label>
                <input 
                    id="gemini-key"
                    type="password" 
                    placeholder="Enter your Gemini key..." 
                    bind:value={$settingsStore.geminiKey} 
                    on:input={handleKeyChange}
                    class="text-input"
                />
            </div>
            <div class="setting-item column" style="margin-top: 1rem;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <label for="model-pref">Model Preference</label>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        {#if isLoadingModels}
                            <span class="loading-text">Loading models...</span>
                        {/if}
                        <button class="btn-secondary small" on:click={testConfiguration} disabled={isTestingModel}>
                            {isTestingModel ? 'Testing...' : 'Test Config'}
                        </button>
                    </div>
                </div>
                <select 
                    id="model-pref"
                    bind:value={$settingsStore.aiModelPreference} 
                    on:change={save}
                    class="text-input select-input"
                    disabled={isLoadingModels}
                >
                    {#if availableModels.length === 0}
                         <option value="gemini-2.5-flash">Default (Gemini 2.5 Flash)</option>
                    {/if}
                    {#each availableModels as model}
                        <option value={model}>{model}</option>
                    {/each}
                </select>
            </div>
            <div class="setting-item column" style="margin-top: 1rem;">
                <label for="shell-pref">Default Terminal Shell</label>
                <select 
                    id="shell-pref"
                    bind:value={$settingsStore.defaultShell} 
                    on:change={save}
                    class="text-input select-input"
                >
                    <option value="powershell">PowerShell</option>
                    <option value="cmd">Command Prompt</option>
                    <option value="gitbash">Git Bash</option>
                    <option value="wsl">WSL (Ubuntu)</option>
                    <option value="bash">Bash (Unix/Linux)</option>
                    <option value="zsh">Zsh (Unix/Linux)</option>
                </select>
            </div>
            <p class="hint">Recommended hierarchy: Flash > Pro > Flash Lite</p>
        </section>

        <section>
            <h3>Keyboard Shortcuts</h3>
            <p class="hint">Click a shortcut to change it. Press your new key combination.</p>
            <div class="shortcuts-editor">
                {#each Object.entries(shortcutNames) as [key, label]}
                    <div class="shortcut-row">
                        <span class="shortcut-label">{label}</span>
                        <button 
                            class="shortcut-key" 
                            class:recording={recordingShortcut === key}
                            on:click={() => startRecording(key)}
                            on:keydown|stopPropagation={(e) => recordingShortcut === key && captureKey(e, key)}
                        >
                            {#if recordingShortcut === key}
                                <span class="recording-indicator">Press keys...</span>
                            {:else}
                                {$settingsStore.keybinds[key] || 'Not set'}
                            {/if}
                        </button>
                    </div>
                {/each}
            </div>
        </section>

        <section>
            <h3>Data Management</h3>
            <p class="hint">Export or import your settings (shortcuts, AI keys, etc.)</p>
            <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
                <button class="btn-picker" style="flex: 1;" on:click={exportSettings}>
                    <div style="display: flex; gap: 0.5rem; align-items: center; justify-content: center;"><Upload size={16} /> Export Settings</div>
                </button>
                <button class="btn-picker" style="flex: 1;" on:click={importSettings}>
                    <div style="display: flex; gap: 0.5rem; align-items: center; justify-content: center;"><Download size={16} /> Import Settings</div>
                </button>
            </div>
        </section>
    </div>

    <div class="settings-footer">
        <p>AppNotas v2.0-beta</p>
    </div>
</div>

<style>
    .settings-panel {
        position: fixed; /* Changed from relative/flex item to fixed overlay */
        top: 0;
        right: 0;
        bottom: 0;
        width: 350px;
        background: #1e1e1e;
        border-left: 1px solid #333;
        display: flex;
        flex-direction: column;
        color: #e0e0e0;
        z-index: 1000; /* Increased z-index */
        box-shadow: -4px 0 20px rgba(0,0,0,0.3);
        outline: none;
    }

    .settings-content::-webkit-scrollbar {
        width: 8px;
    }

    .settings-content::-webkit-scrollbar-track {
        background: #1e1e1e;
    }

    .settings-content::-webkit-scrollbar-thumb {
        background: #333;
        border-radius: 4px;
        border: 2px solid #1e1e1e;
    }

    .settings-content::-webkit-scrollbar-thumb:hover {
        background: #444;
    }

    .settings-header {
        padding: 1.5rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #333;
    }

    .settings-header h2 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 600;
        color: #fff;
    }

    .close-btn {
        background: none;
        border: none;
        color: #888;
        font-size: 1.25rem;
        cursor: pointer;
        padding: 0.5rem;
        border-radius: 4px;
        transition: background 0.2s, color 0.2s;
    }

    .close-btn:hover {
        background: rgba(255,255,255,0.05);
        color: #fff;
    }

    .settings-content {
        flex: 1;
        overflow-y: auto;
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 2rem;
        height: 100%; /* Explicit height */
        box-sizing: border-box;
    }

    section h3 {
        margin: 0 0 1rem 0;
        font-size: 0.9rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #666;
        font-weight: 700;
    }

    .setting-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
    }

    .setting-item.column {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.5rem;
    }

    .hint {
        font-size: 0.75rem;
        color: #666;
        margin: 0.25rem 0 0.5rem 0;
        line-height: 1.4;
    }

    .text-input {
        width: 100%;
        padding: 0.6rem 0.8rem;
        background: #121212;
        border: 1px solid #333;
        border-radius: 6px;
        color: #fff;
        font-size: 0.9rem;
        outline: none;
        transition: border-color 0.2s;
    }

    .text-input:focus {
        border-color: #4a9eff;
    }

    .btn-secondary {
        background: #21262d;
        color: #c9d1d9;
        border: 1px solid #30363d;
        padding: 0.5rem 1rem;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.9rem;
        transition: all 0.2s;
    }

    .btn-secondary:hover {
        background: #30363d;
        border-color: #8b949e;
        color: #fff;
    }

    .btn-secondary.small {
        padding: 0.2rem 0.5rem;
        font-size: 0.8rem;
    }

    .loading-text {
        font-size: 0.8rem;
        color: #8b949e;
        margin-right: 0.5rem;
    }

    .dir-picker {
        display: flex;
        width: 100%;
        gap: 0.5rem;
        align-items: center;
    }

    .dir-path {
        flex: 1;
        padding: 0.6rem 0.8rem;
        background: #121212;
        border: 1px solid #333;
        border-radius: 6px;
        color: #888;
        font-size: 0.85rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .btn-picker {
        padding: 0.6rem 1rem;
        background: #333;
        border: 1px solid #444;
        border-radius: 6px;
        color: #fff;
        font-size: 0.85rem;
        cursor: pointer;
        transition: background 0.2s;
        white-space: nowrap;
    }

    .btn-picker:hover {
        background: #444;
        border-color: #555;
    }

    .color-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1rem;
        margin-top: 0.5rem;
    }

    .color-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
    }

    .color-item label {
        font-size: 0.75rem;
        color: #888;
    }

    .color-item input[type="color"] {
        width: 100%;
        height: 35px;
        border: 1px solid #333;
        border-radius: 4px;
        background: none;
        cursor: pointer;
    }

    /* Shortcuts Editor */
    .shortcuts-editor {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .shortcut-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem 0;
        border-bottom: 1px solid #2a2a2a;
    }

    .shortcut-label {
        font-size: 0.9rem;
        color: #ccc;
    }

    .shortcut-key {
        padding: 0.4rem 0.8rem;
        background: #333;
        border: 1px solid #444;
        border-radius: 4px;
        color: #fff;
        font-size: 0.75rem;
        font-family: 'Fira Code', monospace;
        cursor: pointer;
        transition: all 0.2s;
        min-width: 100px;
        text-align: center;
    }

    .shortcut-key:hover {
        background: #3a3a3a;
        border-color: #4a9eff;
    }

    .shortcut-key.recording {
        background: #2d3a4f;
        border-color: #4a9eff;
        box-shadow: 0 0 8px rgba(74, 158, 255, 0.4);
        animation: pulse 1s infinite;
    }

    .recording-indicator {
        color: #4a9eff;
        font-style: italic;
    }

    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
    }

    /* Switch styling */
    .switch {
        position: relative;
        display: inline-block;
        width: 40px;
        height: 20px;
    }

    .switch input {
        opacity: 0;
        width: 0;
        height: 0;
    }

    .slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: #333;
        transition: .4s;
        border-radius: 20px;
    }

    .slider:before {
        position: absolute;
        content: "";
        height: 14px;
        width: 14px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        transition: .4s;
        border-radius: 50%;
    }

    input:checked + .slider {
        background-color: #4a9eff;
    }

    input:checked + .slider:before {
        transform: translateX(20px);
    }

    .settings-footer {
        padding: 1rem;
        text-align: center;
        border-top: 1px solid #333;
        font-size: 0.7rem;
        color: #444;
    }
</style>
