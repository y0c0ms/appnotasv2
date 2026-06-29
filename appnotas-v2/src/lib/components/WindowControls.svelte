<script lang="ts">
    import { onMount } from 'svelte';
    import { Minus, Square, Copy, X } from 'lucide-svelte';

    let { showAll = true, onClose = null } = $props();
    let window: any;
    let isMaximized = $state(false);

    onMount(() => {
        let unlisten: (() => void) | undefined;

        (async () => {
            const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
            window = getCurrentWebviewWindow();

            isMaximized = await window.isMaximized();
            unlisten = await window.onResized(async () => {
                isMaximized = await window.isMaximized();
            });
        })();

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
        <button class="control-btn" onclick={minimize} title="Minimize">
            <Minus size={16} />
        </button>

        <button class="control-btn" onclick={toggleMaximize} title={isMaximized ? 'Restore' : 'Maximize'}>
            {#if isMaximized}
                <Copy size={14} />
            {:else}
                <Square size={14} />
            {/if}
        </button>
    {/if}

    <button class="control-btn close" onclick={handleClose} title="Close">
        <X size={16} />
    </button>
</div>

<style>
    .window-controls {
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 0 0.4rem 0 0.2rem;
    }

    /* Match the toolbar's .btn-icon aesthetic: rounded, same idle colour, soft hover. */
    .control-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        background: none;
        border: none;
        border-radius: 6px;
        color: #8b949e;
        cursor: pointer;
        transition: all 0.15s;
    }

    .control-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
    }

    /* Keep the familiar red close affordance, but rounded to fit the theme. */
    .control-btn.close:hover {
        background: #e81123;
        color: #fff;
    }
</style>
