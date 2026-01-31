<script lang="ts">
    import { settingsStore } from '$lib/stores/settings';
    import { settingsOpen } from '$lib/stores/shortcuts';
    import { open as openDialog } from '@tauri-apps/plugin-dialog';
    import { fade, slide } from 'svelte/transition';

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
</script>

<div class="settings-panel" transition:slide={{ axis: 'x', duration: 300 }}>
    <div class="settings-header">
        <h2>Settings</h2>
        <button class="close-btn" on:click={close}>✕</button>
    </div>

    <div class="settings-content">
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
        </section>

        <section>
            <h3>Custom Text Colors</h3>
            <p class="hint">Colors used for Ctrl+1, Ctrl+2, and Ctrl+3</p>
            <div class="color-grid">
                <div class="color-item">
                    <label>Ctrl+1</label>
                    <input type="color" bind:value={$settingsStore.customColors.ctrl1} on:change={save} />
                </div>
                <div class="color-item">
                    <label>Ctrl+2</label>
                    <input type="color" bind:value={$settingsStore.customColors.ctrl2} on:change={save} />
                </div>
                <div class="color-item">
                    <label>Ctrl+3</label>
                    <input type="color" bind:value={$settingsStore.customColors.ctrl3} on:change={save} />
                </div>
            </div>
        </section>

        <section>
            <h3>File System</h3>
            <div class="setting-item column">
                <label>Notes Directory</label>
                <div class="dir-picker">
                    <span class="dir-path" title={$settingsStore.notesDirectory}>
                        {$settingsStore.notesDirectory || 'No directory selected'}
                    </span>
                    <button class="btn-picker" on:click={selectDirectory}>📁 Browse</button>
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
                    on:blur={save}
                    class="text-input"
                />
            </div>
            <p class="hint">Used for future AI-powered writing assistance</p>
        </section>

        <section>
            <h3>Shortcuts</h3>
            <ul class="shortcut-list">
                <li><span>Open Palette</span> <kbd>Ctrl+P</kbd></li>
                <li><span>Toggle Menus</span> <kbd>Ctrl+K</kbd></li>
                <li><span>Checklist</span> <kbd>Ctrl+L</kbd></li>
                <li><span>Save Note</span> <kbd>Ctrl+S</kbd></li>
                <li><span>Settings</span> <kbd>Ctrl+,</kbd></li>
            </ul>
        </section>
    </div>

    <div class="settings-footer">
        <p>AppNotas v2.0-beta</p>
    </div>
</div>

<style>
    .settings-panel {
        width: 350px;
        height: 100%;
        background: #1e1e1e;
        border-left: 1px solid #333;
        display: flex;
        flex-direction: column;
        color: #e0e0e0;
        z-index: 100;
        box-shadow: -4px 0 20px rgba(0,0,0,0.3);
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

    .shortcut-list {
        list-style: none;
        padding: 0;
        margin: 0;
    }

    .shortcut-list li {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.6rem 0;
        border-bottom: 1px solid #2a2a2a;
        font-size: 0.9rem;
    }

    .shortcut-list kbd {
        background: #333;
        color: #fff;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 0.75rem;
        font-family: 'Fira Code', monospace;
        box-shadow: 0 2px 0 #000;
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
