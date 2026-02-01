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
	
	// Internal Custom Extensions
	import CodeBlockNode from './tiptap/CodeBlockNode.svelte'; 
    import { SvelteNodeViewRenderer } from 'svelte-tiptap';
	import { ResizableImage } from '../tiptap/extensions/ResizableImage';
	import { FileLink } from '../tiptap/extensions/FileLink';
	import { Drawing } from '../tiptap/extensions/Drawing';
	import { BlockSelection } from '../tiptap/extensions/BlockSelection';
	import { AIZone } from '../tiptap/extensions/AIZone';

	// Modularized UI Components
	import TipTapBubbleMenu from './tiptap/menus/TipTapBubbleMenu.svelte';
	import TipTapFloatingMenu from './tiptap/menus/TipTapFloatingMenu.svelte';
	
	// Utilities
	import { renderDrawingToPNG } from '../tiptap/utils/drawing';
	import { createLowlight } from 'lowlight';
	import js from 'highlight.js/lib/languages/javascript';
	import ts from 'highlight.js/lib/languages/typescript';
	import html from 'highlight.js/lib/languages/xml';
	import css from 'highlight.js/lib/languages/css';
	import md from 'highlight.js/lib/languages/markdown';
	import py from 'highlight.js/lib/languages/python';
	import json from 'highlight.js/lib/languages/json';
	import { settingsStore } from '$lib/stores/settings';
	import { get } from 'svelte/store';

	// Import modularized styles
	import '../tiptap/TipTapEditor.css';

	const lowlight = createLowlight();
	lowlight.register('javascript', js);
	lowlight.register('typescript', ts);
	lowlight.register('html', html);
	lowlight.register('css', css);
	lowlight.register('markdown', md);
	lowlight.register('python', py);
	lowlight.register('json', json);

	interface AIContext {
		text: string;
		images: string[];
		drawings: string[];
	}

	// Props
	export let content: string = '';
	export let onUpdate: (content: string) => void = () => {};
	export let onCommandTrigger: () => void = () => {};
	export let onFileClick: (path: string) => void = () => {};
	export let placeholder: string = 'Start writing...';
	export let onAITrigger: (context: AIContext) => void = () => {};
	export let mode: 'markdown' | 'code' = 'markdown';
	export let language: string = 'typescript';

	let element: HTMLElement;
	let editor: Editor;
	let updateTimer: ReturnType<typeof setTimeout>;
	let bubbleMenuElement: HTMLElement;
	let floatingMenuElement: HTMLElement;

	$: editorZoom = $settingsStore.zoomLevel || 1.0;

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
				CodeBlockLowlight.extend({
                    addNodeView() {
                        return SvelteNodeViewRenderer(CodeBlockNode);
                    }
                }).configure({ lowlight }),
				FileLink.configure({
					onFileClick,
					HTMLAttributes: { class: 'file-link-widget' }
				}),
				ResizableImage.configure({
					allowBase64: true,
					HTMLAttributes: { class: 'tiptap-image' }
				}),
				Drawing,
				BlockSelection,
				AIZone,
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
					if (event.key === 'Enter' && event.ctrlKey && event.shiftKey) {
						triggerAI();
						return true;
					}
					if (event.key === 'Tab' && mode === 'code') {
						editor.commands.insertContent('  ');
						return true;
					}
					return false;
				}
			},
			onUpdate: ({ editor }) => {
				clearTimeout(updateTimer);
				updateTimer = setTimeout(() => {
					let output;
					if (mode === 'code') {
						output = editor.getText();
					} else {
						const markdownStorage = editor.storage.markdown as { getMarkdown: () => string };
						output = markdownStorage.getMarkdown();
					}
					onUpdate(output);
				}, 500);
			}
		});
	});

	onDestroy(() => {
		clearTimeout(updateTimer);
		if (editor) editor.destroy();
	});

	// Reactive content update from parent
	$: if (editor && content !== undefined) {
		const currentText = mode === 'code' 
            ? editor.getText() 
            : (editor.storage.markdown as { getMarkdown: () => string }).getMarkdown();
		
		if (currentText !== content && !editor.isFocused) {
			if (mode === 'code') {
				editor.commands.setContent({
					type: 'doc',
					content: [{
						type: 'codeBlock',
						attrs: { language: language },
						content: [{ type: 'text', text: content || '' }]
					}]
				}, false);
			} else {
				editor.commands.setContent(content, false);
			}
		}
	}

	// Expose editor instance for parent component
	export function getEditor() {
		return editor;
	}

	async function triggerAI() {
		if (!editor) return;
		const context = await getSelectionContext();
		onAITrigger(context);
	}

	async function getSelectionContext(): Promise<AIContext> {
		const { from, to } = editor.state.selection;
		const text = editor.state.doc.textBetween(from, to, ' ');
		
		const images: string[] = [];
		const drawings: string[] = [];

		editor.state.doc.nodesBetween(from, to, (node) => {
			if (node.type.name === 'image') {
				images.push(node.attrs.src);
			} else if (node.type.name === 'drawing') {
				const png = renderDrawingToPNG(node.attrs.lines, node.attrs.height);
				drawings.push(png);
			}
		});

		return { text, images, drawings };
	}
</script>

<div class="tiptap-wrapper">
	{#if editor && $settingsStore.showEditorMenus}
		<div use:editor.registerBubbleMenu={{ element: bubbleMenuElement }}>
			<TipTapBubbleMenu 
				{editor} 
				{mode} 
				onAITrigger={triggerAI} 
			/>
		</div>

		{#if mode === 'markdown'}
			<div use:editor.registerFloatingMenu={{ element: floatingMenuElement }}>
				<TipTapFloatingMenu {editor} />
			</div>
		{/if}
	{/if}

	<div 
		bind:this={element} 
		class="tiptap-container"
		spellcheck={mode === 'markdown' ? 'true' : 'false'}
		style="zoom: {editorZoom}"
	></div>
	
	{#if editor}
		<div class="editor-stats">
			{editor.storage.characterCount.characters()} chars
		</div>
	{/if}
</div>

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
</style>
