<script lang="ts">
    import type { Editor } from '@tiptap/core';

    export let editor: Editor;
    export let mode: 'markdown' | 'code';
    export let onAITrigger: () => void;

    let bubbleMenuElement: HTMLElement;

    // We can't use 'use:editor.registerBubbleMenu' easily in a subcomponent 
    // without passing the element back or handling it differently.
    // However, TipTap's BubbleMenu extension can take a DOM element.
</script>

<div bind:this={bubbleMenuElement} class="bubble-menu-wrapper">
    {#if editor}
        <div class="bubble-menu">
            {#if mode === 'markdown'}
                <button
                    on:click={() => editor.chain().focus().toggleBold().run()}
                    class:active={editor.isActive('bold')}
                    title="Bold"
                >
                    <b>B</b>
                </button>
                <button
                    on:click={() => editor.chain().focus().toggleItalic().run()}
                    class:active={editor.isActive('italic')}
                    title="Italic"
                >
                    <i>I</i>
                </button>
                <button
                    on:click={() => editor.chain().focus().toggleStrike().run()}
                    class:active={editor.isActive('strike')}
                    title="Strikethrough"
                >
                    <s>S</s>
                </button>
            {/if}
            <button
                on:click={() => editor.chain().focus().toggleCode().run()}
                class:active={editor.isActive('code')}
                title="Inline Code"
            >
                {'<>'}
            </button>
            <button
                on:click={onAITrigger}
                title="AI Assistant (Ctrl+Shift+Enter)"
                class="ai-btn"
            >
                ✨
            </button>
        </div>
    {/if}
</div>

<style>
    .bubble-menu {
        display: flex;
        background-color: #2a2a2a;
        padding: 0.2rem;
        border-radius: 0.5rem;
        border: 1px solid #3a3a3a;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        gap: 2px;
    }

    button {
        background: none;
        border: none;
        color: #e0e0e0;
        padding: 0.4rem 0.6rem;
        border-radius: 0.3rem;
        cursor: pointer;
        font-size: 0.85rem;
        transition: background 0.2s, color 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 2rem;
    }

    button:hover {
        background-color: #3a3a3a;
        color: #fff;
    }

    button.active {
        background-color: #4a9eff;
        color: #fff;
    }

    .ai-btn {
        color: #4a9eff;
        font-size: 1rem;
    }
</style>
