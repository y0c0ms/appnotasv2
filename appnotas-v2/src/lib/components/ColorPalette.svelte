<script lang="ts">
    import { onMount } from 'svelte';
    import { fade, scale } from 'svelte/transition';

    interface Props {
        onSelect?: (color: string) => void;
        onClose?: () => void;
    }

    let { onSelect = () => {}, onClose = () => {} }: Props = $props();

    const colors = [
        { id: 'default', label: 'Default theme', color: 'transparent' },
        { id: 'red', label: 'Google Red', color: '#ea4335' },
        { id: 'yellow', label: 'Google Yellow', color: '#fbbc04' },
        { id: 'green', label: 'Google Green', color: '#34a853' },
        { id: 'blue', label: 'Google Blue', color: '#4285f4' },
        { id: 'purple', label: 'Purple', color: '#b314e3' },
    ];

    let selectedIndex = $state(0);

    onMount(() => {
        // Focus trap or just simple handling
    });

    function selectColor(hex: string) {
        onSelect(hex);
        onClose();
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % colors.length;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = (selectedIndex - 1 + colors.length) % colors.length;
        } else if (e.key === 'Enter') {
            e.preventDefault();
            selectColor(colors[selectedIndex].id);
        } else if (e.key === 'Escape') {
            onClose();
        }
    }
</script>

<svelte:window on:keydown={handleKeyDown} />

<div 
    class="color-palette-overlay"
    onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    transition:fade={{ duration: 150 }}
    role="button"
    tabindex="0"
    onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
>
    <div 
        class="color-palette-modal"
        transition:scale={{ duration: 200, start: 0.96 }}
    >
        <div class="header">
            <h3>🎨 Note Background Color</h3>
            <p>Select a color to set the background of this note. This syncs across devices.</p>
        </div>

        <div class="color-list">
            {#each colors as item, i}
                <button 
                    class="color-item" 
                    class:selected={i === selectedIndex}
                    onclick={() => selectColor(item.id)}
                >
                    <div class="color-swatch" style="background-color: {item.id === 'default' ? '#333' : item.color};"></div>
                    <span class="color-label">{item.label}</span>
                </button>
            {/each}
        </div>
    </div>
</div>

<style>
    .color-palette-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        backdrop-filter: blur(2px);
    }

    .color-palette-modal {
        background: #1e1e1e;
        border: 1px solid #333;
        border-radius: 12px;
        padding: 1.5rem;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
        width: 100%;
        max-width: 400px;
    }

    .header h3 {
        margin: 0 0 0.5rem 0;
        color: #fff;
        font-size: 1.25rem;
    }

    .header p {
        margin: 0 0 1.5rem 0;
        color: #888;
        font-size: 0.9rem;
        line-height: 1.4;
    }

    .color-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .color-item {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 0.75rem 1rem;
        background: #2a2a2a;
        border: 1px solid transparent;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
        text-align: left;
        width: 100%;
    }

    .color-item:hover, .color-item.selected {
        background: #333;
        border-color: #4a9eff;
    }

    .color-item.selected {
        box-shadow: 0 0 0 2px rgba(74, 158, 255, 0.2);
    }

    .color-swatch {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.1);
    }

    .color-label {
        color: #ccc;
        font-weight: 500;
        font-size: 0.95rem;
    }

    .color-item.selected .color-label {
        color: #fff;
    }
</style>
