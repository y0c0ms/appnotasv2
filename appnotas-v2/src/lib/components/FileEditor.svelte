<script lang="ts">
	import { onMount } from 'svelte';
	import { EditorView, basicSetup } from 'codemirror';
	import { javascript } from '@codemirror/lang-javascript';
	import { markdown } from '@codemirror/lang-markdown';
	import { python } from '@codemirror/lang-python';
	import { rust } from '@codemirror/lang-rust';
	import { html } from '@codemirror/lang-html';
	import { css } from '@codemirror/lang-css';
	import { json } from '@codemirror/lang-json';
	import { saveRequested } from '$lib/stores/shortcuts';

	export let content: string;
	export let language: string = 'text';
	export let onSave: ((content: string) => void) | null = null;
	export let onModified: ((modified: boolean) => void) | null = null;

	let editorContainer: HTMLElement;
	let editor: EditorView;
	let initialContent = content;

	// Watch for Ctrl+S
	$: if ($saveRequested && editor) {
		save();
	}

	onMount(() => {
		console.log('📝 FileEditor mounting with:', { 
			language, 
			contentLength: content.length,
			contentPreview: content.substring(0, 100)
		});
		
		// CRITICAL: Clear container completely to prevent stale content
		if (editorContainer) {
			editorContainer.innerHTML = '';
			// Force reflow to ensure DOM is clean
			void editorContainer.offsetHeight;
		}
		
		const extensions = [basicSetup];

		// Add language support
		if (language === 'javascript') {
			extensions.push(javascript());
		} else if (language === 'typescript') {
			extensions.push(javascript({ typescript: true }));
		} else if (language === 'markdown') {
			extensions.push(markdown());
		} else if (language === 'python') {
			extensions.push(python());
		} else if (language === 'rust') {
			extensions.push(rust());
		} else if (language === 'html') {
			extensions.push(html());
		} else if (language === 'css') {
			extensions.push(css());
		} else if (language === 'json') {
			extensions.push(json());
		}

		console.log('🎨 Creating CodeMirror editor with content length:', content.length);
		
		editor = new EditorView({
			doc: content,
			extensions,
			parent: editorContainer
		});

		console.log('✅ CodeMirror editor created, doc length:', editor.state.doc.length);
		
		// Force a view update on next tick (fixes Python/CSS rendering)
		queueMicrotask(() => {
			if (editor) {
				editor.requestMeasure();
				console.log('🔄 Forced view refresh');
			}
		});
		
		initialContent = content;

		// Track modifications
		const checkModified = () => {
			if (onModified && editor) {
				const current = editor.state.doc.toString();
				onModified(current !== initialContent);
			}
		};

		const timer = setInterval(checkModified, 500);

		return () => {
			console.log('🗑️ FileEditor unmounting');
			clearInterval(timer);
			editor?.destroy();
		};
	});

	export function getContent(): string {
		return editor?.state.doc.toString() || '';
	}

	export function save() {
		if (onSave && editor) {
			const currentContent = getContent();
			onSave(currentContent);
			initialContent = currentContent;
			if (onModified) onModified(false);
		}
	}
</script>

<div class="file-editor">
	<div class="editor-container" bind:this={editorContainer} data-editor-key={Math.random()}></div>
	{#if onSave}
		<button class="save-button" on:click={save}>Save (Ctrl+S)</button>
	{/if}
</div>

<style>
	.file-editor {
		height: 100%;
		display: flex;
		flex-direction: column;
		position: relative;
	}

	.editor-container {
		flex: 1;
		overflow: auto;
	}

	.editor-container :global(.cm-editor) {
		height: 100%;
		font-size: 14px;
		font-family: 'Consolas', 'Monaco', monospace;
	}

	.editor-container :global(.cm-scroller) {
		overflow: auto;
	}

	.save-button {
		position: absolute;
		bottom: 1rem;
		right: 1rem;
		padding: 0.5rem 1rem;
		background: #4a9eff;
		color: #fff;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-weight: 500;
		transition: background 0.15s;
	}

	.save-button:hover {
		background: #3a8eef;
	}
</style>
