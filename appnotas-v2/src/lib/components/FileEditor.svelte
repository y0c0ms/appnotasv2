<script lang="ts">
	import { onMount } from 'svelte';
	import { saveRequested } from '$lib/stores/shortcuts';
	import { focusArea } from '$lib/stores/focus';
	import hljs from 'highlight.js';

	export let content: string;
	export let onSave: ((content: string) => void) | null = null;
	export let onModified: ((modified: boolean) => void) | null = null;

	let textContent = content;
	let initialContent = content;
	let isModified = false;

	// Watch for Ctrl+S
	$: if ($saveRequested) {
		save();
	}

	$: {
		isModified = textContent !== initialContent;
		if (onModified) {
			onModified(isModified);
		}
	}

	function save() {
		if (onSave && isModified) {
			onSave(textContent);
			initialContent = textContent;
			isModified = false;
		}
	}

	let textarea: HTMLTextAreaElement;

	// Auto-focus textarea when focusArea switches to 'editor'
	$: if ($focusArea === 'editor' && textarea) {
		if (document.activeElement !== textarea) {
			textarea.focus();
		}
	}

	function handleInput(e: any) {
		textContent = e.target.value;
	}
</script>

<div class="file-editor" class:focused={$focusArea === 'editor'}>
	<textarea
		bind:this={textarea}
		bind:value={textContent}
		on:input={handleInput}
		class="editor-textarea"
		spellcheck="false"
		placeholder="Start editing..."
	></textarea>
</div>

<style>
	.file-editor {
		height: 100%;
		background: #0d1117;
		transition: outline 0.15s ease;
	}

	.file-editor.focused {
		outline: 2px solid #4a9eff;
		outline-offset: -2px;
	}

	.editor-textarea {
		width: 100%;
		height: 100%;
		padding: 1.5rem;
		background: #0d1117;
		color: #e0e0e0;
		border: none;
		outline: none;
		font-family: 'Fira Code', 'Courier New', Consolas, monospace;
		font-size: 0.95rem;
		line-height: 1.6;
		resize: none;
		tab-size: 4;
	}
</style>
