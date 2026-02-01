<script lang="ts">
    import type { Editor } from '@tiptap/core';

    export let editor: Editor;
</script>

{#if editor}
    <div class="floating-menu">
        <button on:click={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</button>
        <button on:click={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
        <button on:click={() => editor.chain().focus().toggleBulletList().run()}>• List</button>
        <button on:click={() => editor.chain().focus().toggleTaskList().run()}>☑ Task</button>
    </div>
{/if}

<style>
    .floating-menu {
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
    }

    button:hover {
        background-color: #3a3a3a;
        color: #fff;
    }
</style>
