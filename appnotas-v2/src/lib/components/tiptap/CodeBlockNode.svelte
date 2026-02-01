<script lang="ts">
	import { NodeViewWrapper, NodeViewContent } from 'svelte-tiptap';
	import { onMount } from 'svelte';

	export let node: any;
	export let updateAttributes: (attrs: any) => void;
	export let extension: any;

	let languages = extension.options.lowlight.listLanguages();
    
    // Ensure common languages are top of list/available
    if (!languages.includes('typescript')) languages.push('typescript');
    languages.sort();

	let selectedLanguage = node.attrs.language || 'plaintext';
    let copyState = 'Copy';
    let lineCount = 1;

	$: if (node.attrs.language !== selectedLanguage) {
		selectedLanguage = node.attrs.language || 'plaintext';
	}
    
    // Reactive line count based on content
    $: if (node.content) {
        // Count newlines in text content
        // TipTap nodes don't always expose raw text content reactively in 'node', 
        // so we might rely on the editor update cycle or content size
        const text = node.textContent || '';
        lineCount = text.split('\n').length;
    }

	function handleLanguageChange(event: Event) {
		const select = event.target as HTMLSelectElement;
		updateAttributes({ language: select.value });
	}

    function copyCode() {
        const code = node.textContent;
        navigator.clipboard.writeText(code);
        copyState = 'Copied!';
        setTimeout(() => copyState = 'Copy', 2000);
    }
</script>

<NodeViewWrapper class="code-block-wrapper">
	<div class="code-block-header">
		<div class="lang-selector-group">
            <select class="language-select" value={selectedLanguage} on:change={handleLanguageChange}>
                <option value="plaintext">Plain Text</option>
                {#each languages as lang}
                    <option value={lang}>{lang}</option>
                {/each}
            </select>
        </div>
        <button class="copy-btn" on:click={copyCode}>
            {#if copyState === 'Copied!'}
                ✓ Copied
            {:else}
                📋 Copy
            {/if}
        </button>
	</div>
    
    <div class="code-block-body">
        <div class="line-numbers" aria-hidden="true">
            {#each Array(lineCount) as _, i}
                <span>{i + 1}</span>
            {/each}
        </div>
        <pre><NodeViewContent as="code" /></pre>
    </div>
</NodeViewWrapper>

<style>
	.code-block-wrapper {
		background: #0d1117;
		border: 1px solid #30363d;
		border-radius: 8px;
		margin: 1.5rem 0;
		overflow: hidden;
        position: relative;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
	}

	.code-block-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 1rem;
		background: #161b22;
		border-bottom: 1px solid #30363d;
        user-select: none;
	}
    
    .lang-selector-group {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

	.language-select {
		background: #21262d;
		color: #c9d1d9;
		border: 1px solid #30363d;
		font-size: 0.8rem;
        font-family: 'Inter', sans-serif;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        outline: none;
        transition: border-color 0.2s;
	}

    .language-select:hover {
        border-color: #8b949e;
    }

    .language-select:focus {
        border-color: #58a6ff;
    }
    
    .copy-btn {
        background: transparent;
        border: 1px solid transparent;
        color: #8b949e;
        font-size: 0.8rem;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .copy-btn:hover {
        background: #21262d;
        color: #c9d1d9;
    }
    
    /* Code Body Layout */
    .code-block-body {
        display: flex;
        /* Matches 'JetBrains Mono', 'Fira Code' metrics below */
        font-family: 'JetBrains Mono', 'Fira Code', monospace; 
        font-size: 0.9em;
        line-height: 1.6;
        background: #0d1117; /* Darker background for contrast */
    }

    .line-numbers {
        display: flex;
        flex-direction: column;
        padding: 1rem 0.5rem 1rem 0;
        text-align: right;
        min-width: 2.5rem;
        background: #0d1117;
        border-right: 1px solid #30363d;
        color: #484f58;
        user-select: none;
    }
    
    .line-numbers span {
        display: block;
        padding-right: 0.5rem;
    }

	pre {
		flex: 1;
		background: transparent;
		color: #c9d1d9;
		padding: 1rem;
		margin: 0;
		overflow-x: auto;
        font-family: inherit; /* Inherit font settings from body parent */
        font-size: inherit;
        line-height: inherit;
        white-space: pre; 
	}
    
    /* Ensure TipTap's standard styling for code content is reset/handled */
    :global(.code-block-wrapper pre code) {
        background: none !important;
        padding: 0 !important;
        color: inherit !important;
        font-family: inherit !important;
        display: block; /* Ensure block layout for code lines */
    }
</style>
