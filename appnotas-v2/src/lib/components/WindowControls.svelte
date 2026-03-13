<script lang="ts">
    import { onMount } from 'svelte';

    let { showAll = true, onClose = null } = $props();
    let window: any;
    let isMaximized = $state(false);

    onMount(async () => {
        // Dynamic import to avoid SSR issues and ensure we only run in Tauri
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        window = getCurrentWebviewWindow();
        
        // Listen for maximize events to update the icon
        const unlisten = await window.onResized(async () => {
            isMaximized = await window.isMaximized();
        });

        return () => {
            if (unlisten) unlisten();
        };
    });

    function minimize() {
        if (window) window.minimize();
    }

    async function toggleMaximize() {
        if (window) {
            await window.toggleMaximize();
            isMaximized = await window.isMaximized();
        }
    }

    function handleClose() {
        if (onClose) {
            onClose();
        } else if (window) {
            window.close();
        }
    }
</script>

<div class="window-controls">
    {#if showAll}
        <button class="control-btn minimize" onclick={minimize} title="Minimize">
            <svg width="12" height="12" viewBox="0 0 12 12" style="display: block;">
                <rect x="2" y="5.5" width="8" height="1.2" fill="currentColor" />
            </svg>
        </button>
        
        <button class="control-btn maximize" onclick={toggleMaximize} title={isMaximized ? "Restore" : "Maximize"}>
            {#if isMaximized}
                <svg width="12" height="12" viewBox="0 0 12 12" style="display: block;">
                    <path d="M3 5v4h4V5H3zm1 1h2v2H4V6z" fill="currentColor" />
                    <path d="M5 3v1h4v4h1V3H5z" fill="currentColor" />
                </svg>
            {:else}
                <svg width="12" height="12" viewBox="0 0 12 12" style="display: block;">
                    <rect x="3" y="3" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.2" />
                </svg>
            {/if}
        </button>
    {/if}

    <button class="control-btn close" onclick={handleClose} title="Close">
        <svg width="12" height="12" viewBox="0 0 12 12" style="display: block;">
            <path d="M3 3l6 6m0-6L3 9" stroke="currentColor" fill="none" stroke-width="1.2" stroke-linecap="round" />
        </svg>
    </button>
</div>

<style>
    .window-controls {
        display: flex;
        height: 100%;
        align-items: stretch;
    }

    .control-btn {
        width: 46px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        color: #888;
        cursor: pointer;
        transition: all 0.1s;
        margin: 0;
    }

    .control-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
    }

    .control-btn.close:hover {
        background: #e81123;
        color: #fff;
    }

    svg {
        shape-rendering: crispEdges;
    }
</style>
