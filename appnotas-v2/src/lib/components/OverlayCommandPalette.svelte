<script lang="ts">
    import { createEventDispatcher, onMount } from 'svelte';

    const dispatch = createEventDispatcher();

    const commands = [
        { id: 'file', label: '@file', description: 'Link to a file', icon: '📁' },
        { id: 'ai', label: '@AI', description: 'AI Task Assistant', icon: '✨' }
    ];

    let selectedIndex = $state(0);
    let inputElement = $state<HTMLInputElement>();

    onMount(() => {
        // Auto-focus logic or handling input
    });

    function selectCommand(commandId: string) {
        dispatch('select', { id: commandId });
    }

    export function handleKey(e: KeyboardEvent) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % commands.length;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = (selectedIndex - 1 + commands.length) % commands.length;
        } else if (e.key === 'Enter') {
            e.preventDefault();
            selectCommand(commands[selectedIndex].id);
        } else if (e.key === 'Escape') {
            dispatch('close');
        }
    }
</script>

<div class="overlay-palette">
    <div class="command-list">
        {#each commands as command, i}
            <button 
                class="command-item" 
                class:selected={i === selectedIndex}
                onclick={() => selectCommand(command.id)}
                onmouseenter={() => selectedIndex = i}
            >
                <span class="command-icon">{command.icon}</span>
                <div class="command-text">
                    <div class="command-label">{command.label}</div>
                    <div class="command-description">{command.description}</div>
                </div>
            </button>
        {/each}
    </div>
</div>

<style>
    .overlay-palette {
        background: #1a1a2e;
        border: 1px solid rgba(160, 77, 255, 0.4);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
        width: 280px;
        overflow: hidden;
        backdrop-filter: blur(10px);
    }

    .command-list {
        padding: 6px;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .command-item {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        background: transparent;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        text-align: left;
        color: #e6edf3;
        transition: all 0.2s;
    }

    .command-item:hover, .command-item.selected {
        background: rgba(160, 77, 255, 0.2);
        color: #fff;
    }

    .command-item.selected {
        box-shadow: inset 0 0 0 1px rgba(160, 77, 255, 0.5);
    }

    .command-icon {
        font-size: 1.25rem;
        width: 24px;
        display: flex;
        justify-content: center;
    }

    .command-text {
        flex: 1;
        display: flex;
        flex-direction: column;
    }

    .command-label {
        font-weight: 600;
        font-size: 0.85rem;
    }

    .command-description {
        font-size: 0.7rem;
        opacity: 0.6;
    }
</style>
