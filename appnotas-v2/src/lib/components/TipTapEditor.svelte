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
					serialize(state: any, node: any) {
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
	import { activeNote } from '$lib/stores/notes';

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
    interface Props {
        content?: string;
        onUpdate?: (content: string) => void;
        onCommandTrigger?: () => void;
        onFileClick?: (path: string) => void;
        placeholder?: string;
        onAITrigger?: (context: AIContext, editor?: any) => void;
        mode?: 'markdown' | 'code';
        language?: string;
    }

    let {
        content = '',
        onUpdate = () => {},
        onCommandTrigger = () => {},
        onFileClick = () => {},
        placeholder = 'Start writing...',
        onAITrigger = () => {},
        mode = 'markdown',
        language = 'typescript'
    }: Props = $props();

	let element = $state<HTMLElement>();
	let editor = $state<Editor>();
	let updateTimer: ReturnType<typeof setTimeout>;
	let bubbleMenuElement = $state<HTMLElement>();
	let floatingMenuElement = $state<HTMLElement>();
    
    // AI Loading Overlay State
    let showAiLoading = $state(false);
    let aiLoadingPos = $state({ top: 0, left: 0 });

	// State to re-render when editor is ready
	let isReady = $state(false);

    // Safe wrappers for menu actions
    const registerBubbleMenu = (node: HTMLElement, params: any) => {
        if (editor && (editor as any).registerBubbleMenu) {
            (editor as any).registerBubbleMenu(node, params);
        }
    };
    const registerFloatingMenu = (node: HTMLElement, params: any) => {
        if (editor && (editor as any).registerFloatingMenu) {
            (editor as any).registerFloatingMenu(node, params);
        }
    };

	let editorZoom = $derived($settingsStore.zoomLevel || 1.0);

    function updateAiLoadingPosition() {
        if (!editor || !editor.view || !editor.view.dom) {
            showAiLoading = false;
            return;
        }

        const hasZone = (editor.storage as any).aiZone?.zones?.length > 0;
        
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

    // Portal action dummy for now if not found, to avoid breaking if it was missing.
    // Assuming it was implicit or global? 
    // Actually, I'll add a simple action definition if it's missing to be safe, 
    // OR just remove it if it was doing nothing. 
    // Re-reading code: if it was erroring, user would complain.
    // I'll define a local portal action just in case to be safe.
    function portal(node: HTMLElement) {
        let target = document.body;
        target.appendChild(node);
        return {
            destroy() {
                if (node.parentNode) {
                    node.parentNode.removeChild(node);
                }
            }
        };
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

                /* File Link Widget Stylings */
                .file-link-widget {
                    display: inline-flex;
                    align-items: center;
                    background: #2a2a2a;
                    border: 1px solid #3a3a3a;
                    border-radius: 4px;
                    padding: 0.1rem 0.5rem;
                    margin: 0 0.2rem;
                    color: #4a9eff;
                    cursor: pointer;
                    font-size: 0.9em;
                    transition: all 0.2s;
                    user-select: none;
                    vertical-align: middle;
                    line-height: 1.2;
                }

                .file-link-widget:hover {
                    background: #3a3a3a;
                    border-color: #4a9eff;
                    color: #fff;
                }

                .file-link-widget svg {
                    margin-right: 4px;
                    opacity: 0.8;
                }
            `;
            document.head.appendChild(style);
        }

        const isTaskNote = $activeNote?.path?.includes('tasks') || $activeNote?.id?.startsWith('task-');

		editor = new Editor({
			element: element,
			extensions: [
				StarterKit.configure({
					heading: isTaskNote ? false : { levels: [1, 2, 3] },
					codeBlock: false,
					paragraph: false, 
                    blockquote: isTaskNote ? false : {},
                    horizontalRule: isTaskNote ? false : {},
                    bulletList: isTaskNote ? false : {},
                    orderedList: isTaskNote ? false : {},
                    dropcursor: {
                        width: 3,
                        color: '#4a9eff',
                    } as any,
                    gapcursor: true as any, 
				}),
				CustomParagraph, // Use our custom paragraph
				Placeholder.configure({ placeholder: isTaskNote ? 'Add a task...' : placeholder }),
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
				TaskList.configure({
                    HTMLAttributes: {
                        class: 'tiptap-task-list',
                    },
                }),
				TaskItem.configure({ 
                    nested: true,
                    HTMLAttributes: {
                        class: 'tiptap-task-item',
                    },
                }),
				AIProposal,
				BubbleMenu.configure({
					pluginKey: 'bubbleMenu',
					shouldShow: ({ state, from, to }) => {
                        if (isTaskNote) return false;
						const { showEditorMenus } = get(settingsStore);
						return showEditorMenus && from !== to;
					},
				}),
				FloatingMenu.configure({
					pluginKey: 'floatingMenu',
					shouldShow: ({ state }) => {
                        if (isTaskNote) return false;
						const { showEditorMenus } = get(settingsStore);
						const { $from: selectionFrom } = state.selection;
						return showEditorMenus && 
							   selectionFrom.parent.type.name === 'paragraph' && 
							   selectionFrom.parent.content.size === 0;
					},
				}),
				CharacterCount,
			],
			content,
			editorProps: {
                attributes: {
                    class: `tiptap-editor ${isTaskNote ? 'task-mode' : ''}`,
                },
				handleDOMEvents: {
                    paste: (view, event) => {
                        if (isTaskNote) {
                            event.preventDefault();
                            const text = event.clipboardData?.getData('text/plain');
                            if (text) {
                                const lines = text.split('\n').filter(l => l.trim().length > 0);
                                editor?.chain().focus().insertContent({
                                    type: 'taskList',
                                    content: lines.map(line => ({
                                        type: 'taskItem',
                                        attrs: { checked: false },
                                        content: [{ type: 'paragraph', content: [{ type: 'text', text: line }] }]
                                    }))
                                }).run();
                            }
                            return true;
                        }
                        return false;
                    },
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
					if (event.key === '@') {
                        // Prevent the character from being typed to avoid clean up later
                        event.preventDefault();
						onCommandTrigger();
						return true;
					}
                    
                    // Force task structure on Enter in task mode
                    if (isTaskNote && event.key === 'Enter') {
                        // After Enter, check if we need to toggle task list
                        setTimeout(() => {
                            if (editor && !editor.isActive('taskList')) {
                                editor.commands.toggleTaskList();
                            }
                        }, 10);
                    }

					return false;
				},
			},
            onTransaction: ({ transaction }) => {
                requestAnimationFrame(updateAiLoadingPosition);
                
                // Absolute Task Enforcement - Only when focused to avoid loops during load
                if (isTaskNote && editor && editor.isFocused && transaction.docChanged) {
                    if (editor.isEmpty && !editor.isActive('taskList')) {
                        editor.commands.toggleTaskList();
                    } else if (!editor.isActive('taskList')) {
                        const sel = editor.state.selection as any;
                        if (sel.$from && sel.$from.parent.type.name !== 'taskItem') {
                             editor.commands.toggleTaskList();
                        }
                    }
                }
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
						const markdownStorage = (editor.storage as any).markdown as { getMarkdown: () => string };
						output = markdownStorage.getMarkdown();
					}
                    // Debug: Log HTML to see structure
                    // console.log('[TipTap HTML Debug]', editor.getHTML());
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

        // Global AI Trigger Listener
        const handleGlobalAITrigger = () => {
            if (editor && editor.isFocused) {
                console.log('[TipTap] Global AI trigger received');
                triggerAI();
            }
        };

        const handleGlobalAIAccept = () => {
            if (editor && editor.isFocused) {
                editor.commands.acceptAIProposal();
            }
        };

        const handleGlobalAIReject = () => {
            if (editor && editor.isFocused) {
                editor.commands.rejectAIProposal();
            }
        };

        window.addEventListener('app:ai-trigger', handleGlobalAITrigger);
        window.addEventListener('app:ai-accept', handleGlobalAIAccept);
        window.addEventListener('app:ai-reject', handleGlobalAIReject);

        // Immediate set
        if (editor) {
             currentEditor.set(editor);
             (window as any).tiptapEditor = editor;
        }

        return () => {
             window.removeEventListener('app:ai-trigger', handleGlobalAITrigger);
             window.removeEventListener('app:ai-accept', handleGlobalAIAccept);
             window.removeEventListener('app:ai-reject', handleGlobalAIReject);
             if (editor) editor.destroy();
        };
	});

	onDestroy(() => {
		clearTimeout(updateTimer);
        // clearInterval(debugInterval); // We can't easily access the interval var from here due to scope, 
        // but for a debug session it's fine. Ideally we'd store it in a let variable.
		if (editor) editor.destroy();
	});

	// Reactive content update from parent
    $effect(() => {
        if (editor && content !== undefined) {
            const currentText = mode === 'code' 
                ? editor.getText() 
                : ((editor.storage as any).markdown as { getMarkdown: () => string }).getMarkdown();
            
            if (currentText !== content && !editor.isFocused) {
                if (mode === 'code') {
                    editor.commands.setContent({
                        type: 'doc',
                        content: [{
                            type: 'codeBlock',
                            attrs: { language: language },
                            content: [{ type: 'text', text: content || '' }]
                        }]
                    }, false as any);
                } else {
                    editor.commands.setContent(content, false as any);
                }
            }
        }
    });

	// Expose editor instance for parent component via export function (Svelte 5 standard)
	export function getEditor() {
		return editor;
	}

	async function triggerAI() {
		if (!editor) return;
		const context = await getSelectionContext();
		onAITrigger(context, editor);
	}

	async function getSelectionContext(): Promise<AIContext> {
		const { from, to } = editor!.state.selection;
		const text = editor!.state.doc.textBetween(from, to, ' ');
		
		const images: string[] = [];
		const drawings: string[] = [];

		editor!.state.doc.nodesBetween(from, to, (node) => {
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
		<div use:registerBubbleMenu={{ element: bubbleMenuElement }}>
			<TipTapBubbleMenu 
				{editor} 
				{mode} 
				onAITrigger={triggerAI} 
			/>
		</div>

		{#if mode === 'markdown'}
			<div use:registerFloatingMenu={{ element: floatingMenuElement }}>
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
