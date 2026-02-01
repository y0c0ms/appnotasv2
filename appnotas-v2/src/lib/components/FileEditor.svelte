<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { saveRequested } from '$lib/stores/shortcuts';
	import { focusArea } from '$lib/stores/focus';
	import TipTapEditor from './TipTapEditor.svelte';
	import AIPalette from './AIPalette.svelte';

	export let content: string;
	export let language: string = 'markdown';
	export let onSave: ((content: string) => void) | null = null;
	export let onModified: ((modified: boolean) => void) | null = null;
	export let handleFileClick: (path: string) => void = () => {};

	let editor: any;
	let textContent = content;
	let initialContent = content;
	let isModified = false;
	let showAIPalette = false;
	let aiContext: any = null;

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

	// Auto-focus editor when focusArea switches to 'editor'
	$: if ($focusArea === 'editor' && editor) {
		const tiptap = editor.getEditor();
		if (tiptap && !tiptap.isFocused) {
			tiptap.commands.focus();
		}
	}

	function handleContentUpdate(markdown: string) {
		textContent = markdown;
	}

	$: mode = language === 'markdown' ? ('markdown' as const) : ('code' as const);
</script>

<div class="file-editor" class:focused={$focusArea === 'editor'}>
	<div class="editor-container">
		<TipTapEditor
			bind:this={editor}
			content={content}
			{mode}
			{language}
			onUpdate={handleContentUpdate}
			onAITrigger={(ctx) => {
				aiContext = ctx;
				showAIPalette = true;
			}}
			onFileClick={handleFileClick}
			placeholder="Start editing file..."
		/>
	</div>
</div>

{#if showAIPalette && aiContext}
	<AIPalette 
		context={aiContext}
		editor={editor?.getEditor()}
		on:close={() => (showAIPalette = false)}
	/>
{/if}

<style>
	.file-editor {
		height: 100%;
		display: flex;
		flex-direction: column;
		background: #0d1117;
		transition: outline 0.15s ease;
		overflow: hidden;
	}

	.file-editor.focused {
		outline: none;
		box-shadow: inset 0 0 0 1px rgba(74, 158, 239, 0.4);
	}

	.editor-container {
		flex: 1;
		overflow: auto;
		background: #0d1117;
	}

	:global(.file-editor .tiptap-container) {
		padding: 1.5rem;
		min-height: 100%;
	}
</style>
