<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { saveRequested } from '$lib/stores/shortcuts';
	import { focusArea } from '$lib/stores/focus';
	import { settingsStore } from '$lib/stores/settings';
	import TipTapEditor from './TipTapEditor.svelte';
	import CodeMirrorEditor from './CodeMirrorEditor.svelte';
	import AIPalette from './AIPalette.svelte';

	export let content: string;
	export let language: string = 'markdown';
	export let onSave: ((content: string) => void) | null = null;
	export let onModified: ((modified: boolean) => void) | null = null;
	export let handleFileClick: (path: string) => void = () => {};

	let tiptapEditor: any;
	let codeMirrorEditor: any;
	let textContent = content;
	let initialContent = content;
	let isModified = false;
	let showAIPalette = false;
	let aiContext: any = null;

	// Determine if this is a code file or markdown
	$: isCodeFile = language !== 'markdown';
    
    $: console.log(`[FileEditor] Language: ${language}, isCodeFile: ${isCodeFile}`);

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
	$: if ($focusArea === 'editor') {
		if (isCodeFile && codeMirrorEditor) {
			codeMirrorEditor.focus();
		} else if (!isCodeFile && tiptapEditor) {
			const tiptap = tiptapEditor.getEditor();
			if (tiptap && !tiptap.isFocused) {
				tiptap.commands.focus();
			}
		}
	}

	function handleContentUpdate(newContent: string) {
		textContent = newContent;
	}

	function handleCodeMirrorAI(ctx: { text: string; fullContent: string; selectionRange?: { from: number; to: number } }) {
		aiContext = {
			text: ctx.text,
			images: [],
			drawings: [],
			fullFileContent: ctx.fullContent,
			cmSelectionRange: ctx.selectionRange // Pass captured selection range
		};
		showAIPalette = true;
	}

	function handleTipTapAI(ctx: any, editorInst: any) {
		aiContext = {
			...ctx,
			fullFileContent: textContent,
            editor: editorInst // Attach editor instance for AIPalette
		};
		showAIPalette = true;
	}

</script>

	<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
	<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
	<div 
		class="file-editor" 
		class:focused={$focusArea === 'editor'}
		on:click={() => focusArea.set('editor')}
		on:keydown={() => focusArea.set('editor')}
		role="region"
		aria-label="File Editor"
		tabindex="0"
	>
	<div class="editor-container" style="font-size: {$settingsStore.zoomLevel}rem; line-height: 1.6;">
		{#if isCodeFile}
			<CodeMirrorEditor
				bind:this={codeMirrorEditor}
				content={content}
				{language}
				onUpdate={handleContentUpdate}
				onSave={save}
				onAITrigger={handleCodeMirrorAI}
			/>
		{:else}
			<TipTapEditor
				bind:this={tiptapEditor}
				content={content}
				mode="markdown"
				{language}
				onUpdate={handleContentUpdate}
				onAITrigger={handleTipTapAI}
				onFileClick={handleFileClick}
				placeholder="Start editing file..."
			/>
		{/if}
	</div>
</div>

{#if showAIPalette && aiContext}
	<AIPalette 
		context={aiContext}
		editor={isCodeFile ? null : tiptapEditor?.getEditor()}
		codeMirrorEditor={isCodeFile ? codeMirrorEditor : null}
		on:close={() => (showAIPalette = false)}
	/>
{/if}

<style>
	.file-editor {
		height: 100%;
		display: flex;
		flex-direction: column;
		background: #0d1117;
		transition: border 0.15s ease;
		overflow: hidden;
		border: 2px solid transparent;
		box-sizing: border-box;
	}

	.file-editor.focused {
		border: 2px solid #4a9eff;
	}

	.editor-container {
		flex: 1;
		height: 100%;
		overflow: visible; 
		position: relative;
        /* create stacking context for absolute children */
        z-index: 1;
	}

	:global(.file-editor .tiptap-container) {
		padding: 1.5rem;
		min-height: 100%;
	}
</style>
