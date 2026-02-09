<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Editor } from '@tiptap/core';
	import BubbleMenu from '@tiptap/extension-bubble-menu';
	import FloatingMenu from '@tiptap/extension-floating-menu';
	import StarterKit from '@tiptap/starter-kit';
	import Placeholder from '@tiptap/extension-placeholder';
	import TaskList from '@tiptap/extension-task-list';
	import TaskItem from '@tiptap/extension-task-item';
	import { AIProposal } from '../tiptap/extensions/AIProposal';
	import Paragraph from '@tiptap/extension-paragraph';
    import '../tiptap/TipTapEditor.css';
    import { currentEditor } from '../stores/editorStore';

	// Custom Paragraph to preserve empty lines in Markdown
	const CustomParagraph = Paragraph.extend({
		addStorage() {
			return {
				markdown: {
					serialize(state, node) {
						if (node.content.size === 0) {
							state.write('&nbsp;');
							state.closeBlock(node);
							return;
						}
						state.renderInline(node);
						state.closeBlock(node);
					},
					parse: {
						// Ensure &nbsp; is parsed back as an empty paragraph if needed, 
						// though standard parser usually handles it as text.
						// We might not need explicit parse logic if it's just &nbsp;
					}
				}
			};
		}
	});

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
	export let onAITrigger: (context: AIContext, editor?: any) => void = () => {};
	export let mode: 'markdown' | 'code' = 'markdown';
	export let language: string = 'typescript';

	let element: HTMLElement;
	let editor: Editor;
	let updateTimer: ReturnType<typeof setTimeout>;
	let bubbleMenuElement: HTMLElement;
	let floatingMenuElement: HTMLElement;
    
    // AI Loading Overlay State
    let showAiLoading = false;
    let aiLoadingPos = { top: 0, left: 0 };

	$: editorZoom = $settingsStore.zoomLevel || 1.0;

    function updateAiLoadingPosition() {
        if (!editor || !editor.view || !editor.view.dom) {
            showAiLoading = false;
            return;
        }

        const hasZone = editor.storage.aiZone?.zones?.length > 0;
        
        if (hasZone) {
            const dom = editor.view.dom;
           // We use global selector because styles are global, but scoped to this editor instance?
           // Ideally we scope to this editor element.
           const zones = dom.querySelectorAll('.ai-improvement-zone');
            
           // console.log(`[TipTap] updating AI loading pos. Zones found: ${zones.length}`);

           if (zones.length > 0) {
                let minTop = Infinity, maxBottom = -Infinity, minLeft = Infinity, maxRight = -Infinity;
                
                zones.forEach(zone => {
                    const rect = zone.getBoundingClientRect();
                    if (rect.top < minTop) minTop = rect.top;
                    if (rect.bottom > maxBottom) maxBottom = rect.bottom;
                    if (rect.left < minLeft) minLeft = rect.left;
                    if (rect.right > maxRight) maxRight = rect.right;
                });
                
                if (minTop === Infinity) return;

                const top = minTop + (maxBottom - minTop) / 2;
                const left = minLeft + (maxRight - minLeft) / 2;
                
                aiLoadingPos = { top, left };
                showAiLoading = true;
                return;
            }
        }
        
        showAiLoading = false;
    }

	onMount(() => {
        // Inject global styles manually to bypass Svelte scoping issues for complex TipTap structures
        const styleId = 'tiptap-checklist-fix';
        
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                /* Checklist Fixes */
                ul[data-type='taskList'] {
                    list-style: none !important;
                    padding: 0 !important;
                    margin: 0 !important;
                }

                /* Target by data-checked since data-type is missing */
                li[data-checked] {
                    display: flex !important;
                    flex-direction: row !important;
                    flex-wrap: nowrap !important;
                    align-items: flex-start !important;
                    margin: 0.2rem 0 !important;
                }

                li[data-checked] label {
                    flex: 0 0 auto !important;
                    margin-right: 0.5rem !important;
                    margin-top: 0.2rem !important; /* Visual alignment with text */
                    user-select: none;
                }

                li[data-checked] > div {
                    flex: 1 1 auto !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    min-width: 0 !important;
                    display: block !important;
                }

                li[data-checked] p {
                    margin: 0 !important;
                    padding: 0 !important;
                    line-height: 1.5 !important;
                    display: block !important;
                }

                /* Hide default markers */
                li[data-checked]::marker,
                li[data-checked]::before {
                    display: none !important;
                    content: "" !important;
                }
                   
                /* Checkbox styling */
                 li[data-checked] input[type='checkbox'] {
                    appearance: none;
                    width: 1.1rem;
                    height: 1.1rem;
                    border: 2px solid #555;
                    border-radius: 4px;
                    background: #1a1a1a;
                    cursor: pointer;
                    position: relative;
                    margin: 0;
                }

                 li[data-checked] input[type='checkbox']:checked {
                    background: #4a9eff;
                    border-color: #4a9eff;
                }

                 li[data-checked] input[type='checkbox']:checked::after {
                    content: '✓';
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    color: white;
                    font-size: 0.8rem;
                    font-weight: bold;
                }
                
                /* Completed state */
                li[data-checked='true'] > div {
                    text-decoration: line-through;
                    opacity: 0.6;
                    color: #888;
                }
            `;
            document.head.appendChild(style);
        }

		editor = new Editor({
			element: element,
            editorProps: {
                attributes: {
                    class: 'tiptap-editor',
                },
            },
			extensions: [
				StarterKit.configure({
					heading: { levels: [1, 2, 3] },
					codeBlock: false,
					paragraph: false, // Disable default paragraph
                    dropCursor: {
                        width: 3,
                        color: '#4a9eff', // Use theme color
                    },
                    gapCursor: true, 
				}),
				CustomParagraph, // Use our custom paragraph
				Placeholder.configure({ placeholder }),
				Markdown.configure({
					html: true,
					transformPastedText: true,
					transformCopiedText: true,
					breaks: true,
					tightLists: false,
				}),
				CodeBlockLowlight.extend({
                    draggable: true,
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
				AIProposal,
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
				CharacterCount,
			],
			content,
			editorProps: {
				attributes: { class: 'tiptap-editor' },
				handleDOMEvents: {
					dragover: (view, event) => {
                        // Only block if it looks like a file drag from OS
                        // Internal drags usually have different types or effects
                        const hasFiles = event.dataTransfer && event.dataTransfer.types.includes('Files');
                        if (hasFiles) {
						    event.preventDefault();
						    return false;
                        }
                        // Allow ProseMirror to handle internal drags
						return false; 
					},
					drop: (view, event) => {
						const hasFiles = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length > 0;
						if (hasFiles) {
                            event.preventDefault();
							return false; 
						}
                        // Allow ProseMirror to handle internal drops
						return false;
					}
				},
				handleKeyDown: (view, event) => {
					const { keybinds } = get(settingsStore);
                    const aiTrigger = keybinds['aiTrigger'] || 'Ctrl+Shift+Enter';
                    const aiAccept = keybinds['aiAccept'] || 'Ctrl+Shift+]';
                    const aiReject = keybinds['aiReject'] || 'Ctrl+Shift+[';
                    
					if (event.key === '@') {
						onCommandTrigger();
						return true;
					}
                    
                    // Helper to match simple keybinds
                    const match = (pattern: string, e: KeyboardEvent) => {
                        const parts = pattern.toLowerCase().split('+');
                        const key = parts[parts.length - 1];
                        const ctrl = parts.includes('ctrl');
                        const shift = parts.includes('shift');
                        const alt = parts.includes('alt');
                        const meta = parts.includes('meta'); // cmd

                        if (e.ctrlKey !== ctrl) return false;
                        if (e.shiftKey !== shift) return false;
                        if (e.altKey !== alt) return false;
                        if (e.metaKey !== meta) return false;
                        
                        // Key matching is tricky with Shift. 
                        // If pattern is 'Ctrl+Shift+]', user might type '}'
                        // We compare key case-insensitively or check code?
                        // Let's check against event.key assuming it might be the shifted char
                        // OR the unshifted char.
                        if (e.key.toLowerCase() === key) return true;
                        return false;
                    };

                    // AI Trigger
                    if (match(aiTrigger, event)) {
                        event.preventDefault();
                        triggerAI();
                        return true;
                    }

                    // AI Accept
                    if (match(aiAccept, event)) {
                        event.preventDefault();
                        editor.commands.acceptAIProposal();
                        return true;
                    }

                    // AI Reject
                    if (match(aiReject, event)) {
                        event.preventDefault();
                        editor.commands.rejectAIProposal();
                        return true;
                    }
					return false;
				},
			},
            onTransaction: () => {
                requestAnimationFrame(updateAiLoadingPosition);
            },
            onSelectionUpdate: () => {
                requestAnimationFrame(updateAiLoadingPosition);
            },
			onUpdate: ({ editor }) => {
				clearTimeout(updateTimer);
				// Debounce very slightly (e.g. 50ms) to avoid performance kill, 
                // but fast enough to capture quick edits before switch
				updateTimer = setTimeout(() => {
					let output;
					if (mode === 'code') {
						output = editor.getText();
					} else {
						const markdownStorage = editor.storage.markdown as { getMarkdown: () => string };
						output = markdownStorage.getMarkdown();
					}
                    // Debug: Log HTML to see structure
                    console.log('[TipTap HTML Debug]', editor.getHTML());
					onUpdate(output);
				}, 50); 
			},
            onCreate: ({ editor: e }) => {
                currentEditor.set(e);
                (window as any).tiptapEditor = e;
            },
            onFocus: () => {
                if (editor) {
                    currentEditor.set(editor);
                    (window as any).tiptapEditor = editor;
                }
            }
		});

        // Immediate set
        if (editor) {
             currentEditor.set(editor);
             (window as any).tiptapEditor = editor;
        }
	});

	onDestroy(() => {
		clearTimeout(updateTimer);
        // clearInterval(debugInterval); // We can't easily access the interval var from here due to scope, 
        // but for a debug session it's fine. Ideally we'd store it in a let variable.
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
		onAITrigger(context, editor);
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
		style="transform: scale({editorZoom}); transform-origin: top left;"
	></div>

    <!-- AI Loading Overlay -->
    {#if showAiLoading}
        <div 
            use:portal
            class="ai-zone-spinner-widget"
            style="position: fixed; top: {aiLoadingPos.top}px; left: {aiLoadingPos.left}px; margin: 0; pointer-events: none; z-index: 99999;"
        >
            <div class="spinner"></div>
        </div>
    {/if}
	
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
