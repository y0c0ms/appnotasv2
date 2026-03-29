<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { saveRequested, commandPaletteOpen, colorChangeRequested, activeTab } from '$lib/stores/shortcuts';
	import { focusArea } from '$lib/stores/focus';
	import { settingsStore } from '$lib/stores/settings';
	import TipTapEditor from './TipTapEditor.svelte';
	import CodeMirrorEditor from './CodeMirrorEditor.svelte';
	import AIPalette from './AIPalette.svelte';

	interface Props {
		content: string;
		language?: string;
		onSave?: ((content: string) => void) | null;
		onModified?: ((modified: boolean) => void) | null;
		handleFileClick?: (path: string) => void;
	}

	let props: Props = $props();
	
	let textContent = $state(props.content);
	let initialContent = $state(props.content);

	let tiptapEditor = $state<any>(undefined);
	let codeMirrorEditor = $state<any>(undefined);
	
	// We use state initialized from prop.
    // In Svelte 5, to avoid "captures initial value" warning, we use the props object directly

	// Sync with prop changes if they happen (though usually handled by {#key} in parent)
	$effect(() => {
		textContent = props.content;
		initialContent = props.content;
	});

	let isModified = $state(false);
	
	let showAIPalette = $state(false);
	let aiContext = $state<any>(null);

	// Derive background style based on frontmatter
	let colorHex = $derived.by(() => {
		if (isCodeFile) return 'default';
        let colorName = 'default';
        
		if (textContent.startsWith('---\n')) {
			const parts = textContent.split('---\n');
			if (parts.length >= 3) {
				const fm = parts[1];
				const match = fm.match(/color:\s*([^\s]+)/);
				if (match) {
					colorName = match[1].trim();
				}
			}
		}
		
		const colorMap: Record<string, string> = {
			'red': $settingsStore.customColors.ctrl1,
			'yellow': $settingsStore.customColors.ctrl2,
			'green': $settingsStore.customColors.ctrl3,
			'blue': '#4a9eff',
			'purple': '#b314e3',
			'default': 'inherit'
		};
		return colorMap[colorName] || colorName;
	});

	let backgroundStyle = $derived(colorHex === 'default' || colorHex === 'inherit' || colorHex === 'transparent'
		? 'background: #0d1117;' 
		: `background: linear-gradient(180deg, ${colorHex}1A 0%, #0d1117 100%);`);

	// Process external color changes (when files tab is active)
	$effect(() => {
		if ($colorChangeRequested && $activeTab === 'files' && !isCodeFile) {
			const color = $colorChangeRequested;
			
			// Inject or update color in frontmatter
			let hasFrontmatter = textContent.startsWith('---\n');
			if (hasFrontmatter) {
				const parts = textContent.split('---\n');
				if (parts.length >= 3) {
					let fm = parts[1];
					const lines = fm.split('\n');
					let hasColor = false;
					for (let i = 0; i < lines.length; i++) {
						if (lines[i].startsWith('color:')) {
							lines[i] = `color: ${color}`;
							hasColor = true;
							break;
						}
					}
					if (!hasColor) {
						lines.push(`color: ${color}`);
					}
					parts[1] = lines.filter(Boolean).join('\n') + '\n';
					textContent = parts.join('---\n');
				}
			} else {
				const fm = `color: ${color}\n`;
				textContent = `---\n${fm}---\n\n${textContent}`;
			}
			
			isModified = true;
			colorChangeRequested.set(''); // clear it so we don't re-trigger loops
		}
	});

	let isCodeFile = $derived(props.language !== 'markdown');

	// Watch for Ctrl+S
    $effect(() => {
        if ($saveRequested) {
            save(); // Use function directly
        }
    });

    $effect(() => {
        isModified = textContent !== initialContent;
        if (props.onModified) {
            props.onModified(isModified);
        }
    });

	function save() {
		if (props.onSave && isModified) {
			props.onSave(textContent);
			initialContent = textContent;
			isModified = false;
		}
	}

	// Auto-focus editor when focusArea switches to 'editor'
    $effect(() => {
        if ($focusArea === 'editor') {
            if (isCodeFile && codeMirrorEditor) {
                codeMirrorEditor.focus();
            } else if (!isCodeFile && tiptapEditor) {
                const tiptap = tiptapEditor.getEditor();
                if (tiptap && !tiptap.isFocused) {
                    tiptap.commands.focus();
                }
            }
        }
    });

    let isFirstUpdate = true;
	function handleContentUpdate(newContent: string) {
		textContent = newContent;
        if (isFirstUpdate) {
            initialContent = newContent;
            isFirstUpdate = false;
        }
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
            editor: editorInst
		};
		showAIPalette = true;
	}

	function handleCommand(id: string) {
		if (isCodeFile || !tiptapEditor) return;
		const tiptap = tiptapEditor.getEditor();
		if (!tiptap) return;

		switch (id) {
			case 'tasks':
				tiptap.chain().focus().toggleTaskList().run();
				break;
			case 'heading1':
				tiptap.chain().focus().toggleHeading({ level: 1 }).run();
				break;
			case 'heading2':
				tiptap.chain().focus().toggleHeading({ level: 2 }).run();
				break;
			case 'bullet-list':
				tiptap.chain().focus().toggleBulletList().run();
				break;
			case 'ordered-list':
				tiptap.chain().focus().toggleOrderedList().run();
				break;
			case 'code-block':
				tiptap.chain().focus().setCodeBlock().run();
				break;
			case 'quote':
				tiptap.chain().focus().toggleBlockquote().run();
				break;
			case 'divider':
				tiptap.chain().focus().setHorizontalRule().run();
				break;
		}
	}
</script>

	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div 
		class="file-editor" 
		class:focused={$focusArea === 'editor'}
		onclick={() => focusArea.set('editor')}
		onkeydown={() => focusArea.set('editor')}
		role="region"
		aria-label="File Editor"
		tabindex="0"
	>
	<div class="editor-container" style="font-size: {$settingsStore.zoomLevel}rem; line-height: 1.6; {backgroundStyle}">
		{#if isCodeFile}
			<CodeMirrorEditor
				bind:this={codeMirrorEditor}
				content={textContent}
				language={props.language}
				onUpdate={handleContentUpdate}
				onSave={save}
				onAITrigger={handleCodeMirrorAI}
			/>
		{:else}
			<TipTapEditor
				bind:this={tiptapEditor}
				content={textContent}
				mode="markdown"
				language={props.language}
				onUpdate={handleContentUpdate}
				onAITrigger={handleTipTapAI}
				onFileClick={props.handleFileClick}
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
		onClose={() => (showAIPalette = false)}
	/>
{/if}

<style>
	.file-editor {
		height: 100%;
		display: flex;
		flex-direction: column;
		background: #09090b;
		transition: border 0.15s ease;
		overflow: hidden;
		border: 2px solid transparent;
		box-sizing: border-box;
		border-radius: 6px;
	}

	.file-editor.focused {
		border: 2px solid rgba(74, 158, 255, 0.4);
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
