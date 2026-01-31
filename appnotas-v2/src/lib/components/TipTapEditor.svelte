<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Editor } from '@tiptap/core';
	import BubbleMenu from '@tiptap/extension-bubble-menu';
	import FloatingMenu from '@tiptap/extension-floating-menu';
	import StarterKit from '@tiptap/starter-kit';
	import Placeholder from '@tiptap/extension-placeholder';
	import TaskList from '@tiptap/extension-task-list';
	import TaskItem from '@tiptap/extension-task-item';
	import CharacterCount from '@tiptap/extension-character-count';
	import { Markdown } from 'tiptap-markdown';
	import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
	import Image from '@tiptap/extension-image';
	import { FileLink } from '../tiptap/extensions/FileLink';
	import { Drawing } from '../tiptap/extensions/Drawing';
	import { all, createLowlight } from 'lowlight';
	import { settingsStore } from '$lib/stores/settings';
	import { get } from 'svelte/store';

	const lowlight = createLowlight(all);

	// Props
	export let content: string = '';
	export let onUpdate: (content: string) => void = () => {};
	export let onCommandTrigger: () => void = () => {};
	export let onFileClick: (path: string) => void = () => {};
	export let placeholder: string = 'Start writing...';

	let element: HTMLElement;
	let editor: Editor;
	let updateTimer: ReturnType<typeof setTimeout>;
	let bubbleMenuElement: HTMLElement;
	let floatingMenuElement: HTMLElement;

	onMount(() => {
		editor = new Editor({
			element: element,
			extensions: [
				StarterKit.configure({
					heading: { levels: [1, 2, 3] },
					codeBlock: false
				}),
				Placeholder.configure({ placeholder }),
				Markdown.configure({
					html: true,
					linkify: true,
					tightLists: true
				}),
				CodeBlockLowlight.configure({ lowlight }),
				FileLink.configure({
					onFileClick,
					HTMLAttributes: { class: 'file-link-widget' }
				}),
				Image.configure({
					allowBase64: true,
					HTMLAttributes: { class: 'tiptap-image' }
				}),
				Drawing,
				TaskList,
				TaskItem.configure({ nested: true }),
				BubbleMenu.configure({
					pluginKey: 'bubbleMenu',
					shouldShow: ({ state, from, to }) => {
						const { showEditorMenus } = get(settingsStore);
						return showEditorMenus && from !== to;
					},
				}),
				FloatingMenu.configure({
					pluginKey: 'floatingMenu',
					shouldShow: ({ state }) => {
						const { showEditorMenus } = get(settingsStore);
						const { $from } = state.selection;
						return showEditorMenus && 
							   $from.parent.type.name === 'paragraph' && 
							   $from.parent.content.size === 0;
					},
				}),
				CharacterCount
			],
			content,
			editorProps: {
				attributes: { class: 'tiptap-editor' },
				handleKeyDown: (view, event) => {
					if (event.key === '@') {
						onCommandTrigger();
						return true;
					}
					return false;
				}
			},
			onUpdate: ({ editor }) => {
				// Throttle updates for efficiency (especially with long texts)
				clearTimeout(updateTimer);
				updateTimer = setTimeout(() => {
					const markdown = (editor.storage.markdown as any).getMarkdown();
					onUpdate(markdown);
				}, 500);
			}
		});
	});

	onDestroy(() => {
		clearTimeout(updateTimer);
		if (editor) editor.destroy();
	});

	// Reactive content update
	$: if (editor && content !== undefined) {
		const currentMarkdown = (editor.storage.markdown as any).getMarkdown();
		if (currentMarkdown !== content) {
			editor.commands.setContent(content, false);
		}
	}

	// Expose editor instance for parent component
	export function getEditor() {
		return editor;
	}
</script>

<div class="tiptap-wrapper">
	{#if editor && $settingsStore.showEditorMenus}
		<div use:editor.registerBubbleMenu={{ element: bubbleMenuElement }} class="bubble-menu">
			<button
				on:click={() => editor.chain().focus().toggleBold().run()}
				class:active={editor.isActive('bold')}
			>
				<b>B</b>
			</button>
			<button
				on:click={() => editor.chain().focus().toggleItalic().run()}
				class:active={editor.isActive('italic')}
			>
				<i>I</i>
			</button>
			<button
				on:click={() => editor.chain().focus().toggleStrike().run()}
				class:active={editor.isActive('strike')}
			>
				<s>S</s>
			</button>
			<button
				on:click={() => editor.chain().focus().toggleCode().run()}
				class:active={editor.isActive('code')}
			>
				{'<>'}
			</button>
		</div>

		<div use:editor.registerFloatingMenu={{ element: floatingMenuElement }} class="floating-menu">
			<button on:click={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</button>
			<button on:click={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
			<button on:click={() => editor.chain().focus().toggleBulletList().run()}>• List</button>
			<button on:click={() => editor.chain().focus().toggleTaskList().run()}>☑ Task</button>
		</div>
	{/if}

	<div bind:this={element} class="tiptap-container"></div>
	
	{#if editor}
		<div class="editor-stats">
			{editor.storage.characterCount.characters()} chars
		</div>
	{/if}
</div>

<!-- Bindable elements for menus -->
<div bind:this={bubbleMenuElement} style="display: none"></div>
<div bind:this={floatingMenuElement} style="display: none"></div>


<style>
	.tiptap-wrapper {
		position: relative;
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.tiptap-container {
		flex: 1;
		width: 100%;
		overflow: auto;
	}

	.bubble-menu, .floating-menu {
		display: flex;
		background-color: #2a2a2a;
		padding: 0.2rem;
		border-radius: 0.5rem;
		border: 1px solid #3a3a3a;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
		gap: 2px;
	}

	.bubble-menu button, .floating-menu button {
		background: none;
		border: none;
		color: #e0e0e0;
		padding: 0.4rem 0.6rem;
		border-radius: 0.3rem;
		cursor: pointer;
		font-size: 0.85rem;
		transition: background 0.2s, color 0.2s;
	}

	.bubble-menu button:hover, .floating-menu button:hover {
		background-color: #3a3a3a;
		color: #fff;
	}

	.bubble-menu button.active {
		background-color: #4a9eff;
		color: #fff;
	}

	.editor-stats {
		position: absolute;
		bottom: 1rem;
		right: 1.5rem;
		font-size: 0.75rem;
		color: #666;
		pointer-events: none;
		background: rgba(13, 17, 23, 0.8);
		padding: 2px 8px;
		border-radius: 10px;
	}

	:global(.tiptap-editor) {
		height: 100%;
		padding: 2rem 3rem;
		color: #e0e0e0;
		background: transparent;
		outline: none;
	}

	:global(.tiptap-editor p.is-editor-empty:first-child::before) {
		color: #555;
		content: attr(data-placeholder);
		float: left;
		height: 0;
		pointer-events: none;
	}

	:global(.tiptap-editor h1) {
		font-size: 2.25rem;
		font-weight: 800;
		margin: 2rem 0 1rem 0;
		color: #fff;
		border-bottom: 2px solid #333;
		padding-bottom: 0.5rem;
	}

	:global(.tiptap-editor h2) {
		font-size: 1.75rem;
		font-weight: 700;
		margin: 1.5rem 0 0.75rem 0;
		color: #fff;
	}

	:global(.tiptap-editor h3) {
		font-size: 1.4rem;
		font-weight: 600;
		margin: 1.25rem 0 0.5rem 0;
		color: #eee;
	}

	:global(.tiptap-editor p) {
		margin: 0.75rem 0;
		line-height: 1.7;
	}

	:global(.tiptap-editor ul),
	:global(.tiptap-editor ol) {
		padding-left: 2rem;
		margin: 0.75rem 0;
	}

	:global(.tiptap-editor li) {
		margin: 0.4rem 0;
	}

	:global(.tiptap-editor code) {
		background: rgba(255, 255, 255, 0.1);
		color: #ec4899;
		padding: 0.2rem 0.4rem;
		border-radius: 4px;
		font-family: 'Fira Code', monospace;
		font-size: 0.9em;
	}

	:global(.tiptap-editor pre) {
		background: #0d1117;
		color: #abb2bf;
		padding: 1.5rem;
		border-radius: 12px;
		overflow-x: auto;
		margin: 2rem 0;
		border: 1px solid #30363d;
		font-family: 'Fira Code', monospace;
		position: relative;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
	}

	:global(.tiptap-editor pre::before) {
		content: attr(data-language);
		position: absolute;
		top: 0;
		right: 1.5rem;
		background: #30363d;
		color: #8b949e;
		font-size: 0.7rem;
		padding: 0.2rem 0.6rem;
		border-radius: 0 0 6px 6px;
		text-transform: uppercase;
		font-weight: bold;
	}

	:global(.tiptap-editor pre code) {
		background: none;
		color: inherit;
		padding: 0;
		font-size: 0.95rem;
		line-height: 1.7;
		display: block;
	}

	:global(.tiptap-link) {
		color: #4a9eff;
		text-decoration: underline;
		cursor: pointer;
	}

	:global(.tiptap-link:hover) {
		color: #60a5fa;
	}

	:global(.tiptap-editor ul[data-type='taskList']) {
		list-style: none;
		padding-left: 0.5rem;
		margin: 1rem 0;
	}

	:global(.tiptap-editor .drawing-node) {
		margin: 1.5rem 0;
		border: 1px solid #333;
		border-radius: 8px;
		background: #1e1e1e;
		overflow: hidden;
	}

	:global(.tiptap-editor .drawing-container) {
		position: relative;
		width: 100%;
		overflow: hidden;
	}

	:global(.tiptap-editor canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}

	:global(.tiptap-editor .drawing-resize-handle) {
		height: 8px;
		background: #2a2a2a;
		cursor: ns-resize;
		border-top: 1px solid #3a3a3a;
		transition: background 0.2s;
	}

	:global(.tiptap-editor .drawing-resize-handle:hover) {
		background: #4a9eff;
	}

	:global(.tiptap-editor ul[data-type='taskList'] li) {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		margin: 0.5rem 0;
	}

	:global(.tiptap-editor ul[data-type='taskList'] li label) {
		flex-shrink: 0;
		margin-top: 0.15rem;
		user-select: none;
	}

	:global(.tiptap-editor ul[data-type='taskList'] li > div > p) {
		margin: 0;
	}

	:global(.tiptap-editor ul[data-type='taskList'] li input[type='checkbox']) {
		appearance: none;
		width: 1.1rem;
		height: 1.1rem;
		border: 2px solid #555;
		border-radius: 4px;
		background: #1a1a1a;
		cursor: pointer;
		position: relative;
		transition: all 0.2s;
	}

	:global(.tiptap-editor ul[data-type='taskList'] li input[type='checkbox']:checked) {
		background: #4a9eff;
		border-color: #4a9eff;
		transform: scale(1.1);
	}

	:global(.tiptap-editor ul[data-type='taskList'] li input[type='checkbox']:checked::after) {
		content: '✓';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		color: white;
		font-size: 0.8rem;
		font-weight: bold;
	}

	:global(.tiptap-editor ul[data-type='taskList'] li > div) {
		flex: 1;
		margin: 0;
	}

	:global(.tiptap-editor ul[data-type='taskList'] li[data-checked='true'] > div) {
		text-decoration: line-through;
		opacity: 0.5;
		color: #888;
	}

	:global(.file-link-widget) {
		display: inline-flex;
		align-items: center;
		background: rgba(74, 158, 255, 0.1);
		border: 1px solid rgba(74, 158, 255, 0.2);
		border-radius: 6px;
		padding: 4px 10px;
		color: #4a9eff;
		cursor: pointer;
		margin: 0 4px;
		font-size: 0.95rem;
		transition: all 0.2s;
		font-weight: 500;
	}

	:global(.file-link-widget:hover) {
		background: rgba(74, 158, 255, 0.2);
		border-color: rgba(74, 158, 255, 0.4);
	}

	:global(.drawing-node) {
		margin: 2rem 0;
		width: 100%;
		max-width: 800px;
		margin-left: auto;
		margin-right: auto;
	}

	:global(.tiptap-image) {
		display: block;
		max-width: 100%;
		height: auto;
		border-radius: 12px;
		margin: 2rem auto;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
		border: 1px solid #333;
	}
</style>
