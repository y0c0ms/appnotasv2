<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { activeNote, notesList, taskNotesList, saveNoteToFile, setNoteColor } from '$lib/stores/notes';
	import {
		colorChangeRequested,
		codeInsertRequested,
		fileInsertRequested,
		listModeToggleRequested
	} from '$lib/stores/shortcuts';
	// import { openFiles, activeFile } from '$lib/stores/files'; // Unused ?
	import { settingsStore } from '$lib/stores/settings';
	import { focusArea } from '$lib/stores/focus';
	import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
	import TipTapEditor from './TipTapEditor.svelte';
	import AIPalette from './AIPalette.svelte';
	import CommandPalette from './CommandPalette.svelte';

    interface Props {
        handleFileClick?: (path: string) => void;
    }

    let { handleFileClick = () => {} }: Props = $props();

	let title = $state($activeNote?.title || '');
	let editor = $state<any>(undefined);
	let saveTimeout: ReturnType<typeof setTimeout>;
	let showCommandPalette = $state(false);
	let showAIPalette = $state(false);
	let aiContext = $state<any>(null);
    let aiEditorInstance = $state<any>(null);

	onMount(() => {
		settingsStore.init();

		const handleGlobalToggle = () => {
			settingsStore.toggleMenus();
		};
		window.addEventListener('toggle-editor-menus', handleGlobalToggle);
		
		return () => {
			window.removeEventListener('toggle-editor-menus', handleGlobalToggle);
		};
	});

	// Listen for color change requests
    $effect(() => {
        if ($colorChangeRequested && $activeNote) {
            const color = $colorChangeRequested;
            const colorMap: Record<string, string> = {
                'red': $settingsStore.customColors.ctrl1,
                'yellow': $settingsStore.customColors.ctrl2,
                'green': $settingsStore.customColors.ctrl3,
                'blue': '#4a9eff',
                'default': 'inherit'
            };
            setNoteColor($activeNote.id, colorMap[color] || color);
            colorChangeRequested.set(''); // Prevent infinite effect loop
        }
    });

	// Get color hex
	let colorHex = $derived($activeNote?.color || 'default');

	// Calculate background style
	let backgroundStyle = $derived(colorHex === 'default' 
		? 'background: #0d1117;' 
		: `background: linear-gradient(180deg, ${colorHex}1A 0%, #0d1117 100%);`);
	
	const borderStyle = 'border-left: none;';

	// Update title when active note changes
    $effect(() => {
        if ($activeNote) {
            title = $activeNote.title;
        }
    });

	// Watch for list mode toggle from store
    $effect(() => {
        if ($listModeToggleRequested) {
            handleCommand('tasks');
        }
    });

	// Auto-focus editor when focusArea switches to 'editor'
    $effect(() => {
        if ($focusArea === 'editor' && editor) {
            const tiptap = editor.getEditor();
            if (tiptap && !tiptap.isFocused) {
                tiptap.commands.focus();
            }
        }
    });

	// Local state to prevent global store thrashing & enable save-on-switch
	let localContent = $state('');
	let localTitle = $state('');
	let currentNoteId = $state('');
	let isDirty = $state(false); // Track if we actually have unsaved changes

	// Sync local state when active note changes (either ID or content)
    $effect(() => {
        if ($activeNote) {
            if ($activeNote.id !== currentNoteId) {
                // If we were editing a note (currentNoteId) and it's dirty, save it NOW
                if (currentNoteId && isDirty) {
                    saveSpecificNote(currentNoteId, localContent, localTitle);
                }

                // Now switch context
                currentNoteId = $activeNote.id;
                localContent = $activeNote.content;
                localTitle = $activeNote.title;
                // Sync the bound title too
                title = $activeNote.title;
                isDirty = false;
            } else if ($activeNote.content !== localContent && !isDirty) {
                // If the same note was updated externally (e.g. by Overlay) 
                // and we don't have local unsaved changes, accept the new content.
                console.log('🔄 Accepting external content update for:', $activeNote.title);
                localContent = $activeNote.content;
                localTitle = $activeNote.title;
                title = $activeNote.title;
            }
        }
    });

	// Handle title input
	function handleTitleInput() {
		localTitle = title;
		isDirty = true;
		scheduleSave();
	}

	// Schedule auto-save
	function scheduleSave() {
		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(() => {
			if (isDirty && currentNoteId) {
				saveSpecificNote(currentNoteId, localContent, localTitle);
			}
		}, 1000);
	}

	// Save specific note (bypassing activeNote dependency which might have changed)
	async function saveSpecificNote(id: string, content: string, noteTitle: string) {
		try {
			// Find the original note to preserve properties we aren't changing (like tags/colors)
            const allNotes = [...$notesList, ...$taskNotesList];
			const originalNote = allNotes.find(n => n.id === id);
			if (!originalNote) return;

			await saveNoteToFile(originalNote.id, content, noteTitle);
			console.log('Saved note:', noteTitle);

			// If we just saved the currently active note, clear dirty flag
			if (id === currentNoteId) {
				isDirty = false;
			}
		} catch (e) {
			console.error('Failed to save note:', e);
		}
	}
	
	// Legacy function for compatibility
	async function saveNote() {
		if (currentNoteId) {
			saveSpecificNote(currentNoteId, localContent, localTitle);
		}
	}

	// Handle content update from TipTap (Debounced from component)
	function handleContentUpdate(markdown: string) {
		// Only update if content actually changed
		if (markdown !== localContent) {
			localContent = markdown; 
			isDirty = true;
			scheduleSave();
		}
	}

	function handleCodeInsert() {
		const tiptap = editor.getEditor();
		if (tiptap) {
			tiptap.chain().focus().setCodeBlock().run();
		}
	}

	async function handleFileLink() {
		try {
			const selected = await openFileDialog({
				multiple: false,
				directory: false
			});

			if (selected && typeof selected === 'string') {
                const name = selected.split(/[\\/]/).pop() || selected;
				const tiptap = editor.getEditor();
				if (tiptap) {
					// Use our custom file-link extension with name
					tiptap.chain().focus().insertContent({
						type: 'fileLink',
						attrs: { path: selected, name }
					}).run();
				}
			}
		} catch (err) {
			console.error('Failed to select file:', err);
		}
	}

	function handleCommand(id: string) {
		const tiptap = editor.getEditor();
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
				handleCodeInsert();
				break;
			case 'quote':
				tiptap.chain().focus().toggleBlockquote().run();
				break;
			case 'divider':
				tiptap.chain().focus().setHorizontalRule().run();
				break;
			case 'drawing':
				tiptap.chain().focus().insertContent({
					type: 'drawing',
					attrs: { lines: [] }
				}).run();
				break;
            case 'ai':
                // Trigger AI logic
                const event = new CustomEvent('app:ai-trigger');
                window.dispatchEvent(event);
                break;
		}
	}
	
	// Ensure we save when component unmounts/navigates away
	onDestroy(() => {
		if (currentNoteId && isDirty) {
			console.log('Editor unmounting, saving pending changes...');
			saveSpecificNote(currentNoteId, localContent, localTitle);
		}
		clearTimeout(saveTimeout);
	});
</script>


{#if showCommandPalette}
	<div 
		class="command-palette-wrapper" 
		onclick={(e) => { if (e.target === e.currentTarget) showCommandPalette = false; }}
		onkeydown={(e) => { if (e.key === 'Escape') showCommandPalette = false; }}
		role="button"
		tabindex="0"
		aria-label="Close command palette"
	>
		<div 
			role="dialog" 
			tabindex={-1}
			aria-modal="true" 
			aria-label="Command Palette"
		>
			<CommandPalette
				on:openCodeDialog={() => {
					showCommandPalette = false;
					handleCodeInsert();
				}}
				on:openFileDialog={() => {
					showCommandPalette = false;
					handleFileLink();
				}}
			on:openDialog={(e) => {
				showCommandPalette = false;
				handleCommand(e.detail.id);
			}}
			on:close={() => (showCommandPalette = false)}
		/>
		</div>
	</div>
{/if}

{#if showAIPalette && aiContext}
	<AIPalette 
		context={aiContext}
		editor={aiEditorInstance}
		onClose={() => (showAIPalette = false)}
	/>
{/if}

<div 
	class="note-editor" 
	class:focused={$focusArea === 'editor'}
	style="{backgroundStyle} {borderStyle}"
>
	<input
		class="note-title"
		bind:value={title}
		onblur={() => isDirty && saveSpecificNote(currentNoteId, localContent, localTitle)}
		oninput={handleTitleInput}
		placeholder="Note title..."
	/>

	<div class="editor-wrapper">
		{#if $activeNote}
			{#key $activeNote.id}
				<TipTapEditor
					bind:this={editor}
					content={$activeNote.content}
					onUpdate={handleContentUpdate}
					onCommandTrigger={() => (showCommandPalette = true)}
					onAITrigger={(ctx, editorInst) => {
                        // Attach editor to context to ensure it arrives
                        if (editorInst) {
                            (ctx as any).editor = editorInst;
                        } else if (editor) {
                            (ctx as any).editor = editor.getEditor();
                        }

						aiContext = ctx;
						showAIPalette = true;
					}}
					onFileClick={handleFileClick}
					placeholder="Start writing... Type @ for commands"
				/>
			{/key}
		{/if}
	</div>

	<div class="note-hints">
		<span>
			Auto-save enabled
			{#if $activeNote?.color}• {$activeNote.color}{/if}
			• Type @ for commands • Ctrl+L for checklists
		</span>
	</div>
</div>

<style>
	.note-editor {
		flex: 1;
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		border: none !important;
		outline: none !important;
		padding-left: 1rem;
	}

	.note-editor.focused {
		box-shadow: inset 0 0 0 3px #4a9eff, 0 0 15px rgba(74, 158, 255, 0.4);
	}

	.note-title {
		width: 100%;
		padding: 1.5rem 2rem 1rem 4rem;
		font-size: 1.75rem;
		font-weight: 700;
		border: none;
		background: transparent;
		color: #fff;
		outline: none;
	}

	.note-title::placeholder {
		color: #666;
	}

	.editor-wrapper {
		flex: 1;
		overflow: auto;
		background: transparent;
		border: none !important;
		outline: none !important;
	}

	.note-hints {
		padding: 0.75rem 2rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: transparent;
		font-size: 0.875rem;
		color: #6b7280;
	}

	.note-hints span {
		color: #777;
		font-size: 0.875rem;
	}

	.command-palette-wrapper {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 9999;
		background: #2a2a2a;
		border: 1px solid #3a3a3a;
		border-radius: 8px;
		padding: 1rem;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
		min-width: 300px;
	}
</style>
