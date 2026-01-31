<script lang="ts">
	import { onMount } from 'svelte';
	import { activeNote, notesList, saveNoteToFile, setNoteColor } from '$lib/stores/notes';
	import {
		colorChangeRequested,
		codeInsertRequested,
		fileInsertRequested,
		listModeToggleRequested
	} from '$lib/stores/shortcuts';
	import { openFiles, activeFile } from '$lib/stores/files';
	import { settingsStore } from '$lib/stores/settings';
	import { focusArea } from '$lib/stores/focus';
	import { invoke, convertFileSrc } from '@tauri-apps/api/core';
	import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
	import TipTapEditor from './TipTapEditor.svelte';
	import CodeInsertDialog from './CodeInsertDialog.svelte';
	import CommandPalette from './CommandPalette.svelte';

	let title = $activeNote?.title || '';
	export let handleFileClick: (path: string) => void = () => {};
	let editor: any;
	let saveTimeout: ReturnType<typeof setTimeout>;
	let showCommandPalette = false;

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
	$: if ($colorChangeRequested && $activeNote) {
		const color = $colorChangeRequested;
		const colorMap: Record<string, string> = {
			'red': $settingsStore.customColors.ctrl1,
			'yellow': $settingsStore.customColors.ctrl2,
			'green': $settingsStore.customColors.ctrl3,
			'blue': '#4a9eff',
			'default': 'inherit'
		};
		setNoteColor($activeNote.id, colorMap[color] || color);
	}

	// Get color class
	$: colorClass = $activeNote?.color || 'default';

	// Update title when active note changes
	$: if ($activeNote) {
		title = $activeNote.title;
	}

	// Watch for list mode toggle from store
	$: if ($listModeToggleRequested) {
		handleCommand('tasks');
	}

	// Auto-focus editor when focusArea switches to 'editor'
	$: if ($focusArea === 'editor' && editor) {
		const tiptap = editor.getEditor();
		if (tiptap && !tiptap.isFocused) {
			tiptap.commands.focus();
		}
	}

	// Handle title change
	function handleTitleChange() {
		if ($activeNote && title !== $activeNote.title) {
			saveNote();		}
	}

	// Schedule auto-save
	function scheduleSave() {
		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(() => {
			saveNote();
		}, 1000);
	}

	// Save note
	async function saveNote() {
		if (!$activeNote) return;

		const updatedNote = {
			...$activeNote,
			title,
			lastModified: new Date()
		};

		try {
			await saveNoteToFile(updatedNote.id, updatedNote.content);
			console.log('File-based note auto-saved:', updatedNote.filename || updatedNote.title);

			notesList.update((notes) =>
				notes.map((n) => (n.id === updatedNote.id ? updatedNote : n))
			);
		} catch (e) {
			console.error('Failed to save note:', e);
		}
	}

	// Handle content update from TipTap
	function handleContentUpdate(markdown: string) {
		if ($activeNote) {
			notesList.update(notes =>
				notes.map(n => n.id === $activeNote!.id ? { ...n, content: markdown } : n)
			);
			scheduleSave();
		}
	}

	// Handle code insert
	async function handleCodeInsert() {
		console.log('NoteEditor: triggering code insert dialog');
		// Open code dialog
		window.dispatchEvent(new CustomEvent('openCodeDialog'));
	}

	// Handle file link
	async function handleFileLink() {
		console.log('NoteEditor: triggering file link dialog');
		try {
			const result = await openFileDialog({
				multiple: false,
				directory: false
			});

			if (result && editor) {
				const filepath = result as string;
				const filename = filepath.split(/[\\/]/).pop() || 'file';
				
				// Insert link into editor as a widget node
				const tiptapEditor = editor.getEditor();
				if (tiptapEditor) {
					tiptapEditor
						.chain()
						.focus()
						.setFileLink({ path: filepath, name: filename })
						.run();
				}
			}
		} catch (error) {
			console.error('Failed to select file:', error);
		}
	}

	// Unified command executor
	async function handleCommand(command: string) {
		const tiptapEditor = editor?.getEditor();
		if (!tiptapEditor) return;

		switch (command) {
			case 'tasks':
				tiptapEditor.chain().focus().toggleTaskList().run();
				break;
			case 'image':
				try {
					const result = await openFileDialog({
						multiple: false,
						directory: false,
						filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
					});
					if (result) {
						tiptapEditor.chain().focus().setImage({ src: convertFileSrc(result as string) }).run();
					}
				} catch (e) { console.error('Image upload failed:', e); }
				break;
			case 'drawing':
				tiptapEditor.chain().focus().insertContent({ type: 'drawing' }).run();
				break;
			case 'style':
				settingsStore.toggleMenus();
				break;
			case 'color':
				if (args[0]) {
					tiptapEditor.chain().focus().setMark('textStyle', { color: args[0] }).run();
				}
				break;
			case 'file':
				handleFileLink();
				break;
			case 'code':
				handleCodeInsert();
				break;
		}
	}

	// Listen for code block insert from dialog
	function handleCodeBlockInsert(event: CustomEvent) {
		const { codeBlock } = event.detail;
		const tiptapEditor = editor?.getEditor();
		
		if (tiptapEditor) {
			tiptapEditor
				.chain()
				.focus()
				.insertContent(codeBlock + '\n')
				.run();
		}
	}


	// Handle file mention clicks
	// This function is now exported and can be passed from parent
	// async function handleFileClick(filepath: string) {
	// 	const existing = $openFiles.find(f => f.path === filepath);
	// 	if (existing) {
	// 		activeFile.set(existing);
	// 		return;
	// 	}

	// 	const ext = filepath.split('.').pop()?.toLowerCase() || '';
		
	// 	// Special handling for PDFs (binary files)
	// 	if (ext === 'pdf') {
	// 		const assetUrl = convertFileSrc(filepath);
	// 		const newFile = { 
	// 			name: filepath.split(/[\\/]/).pop() || 'file.pdf', 
	// 			path: filepath, 
	// 			content: assetUrl, 
	// 			language: 'pdf', 
	// 			modified: false,
	// 			type: 'pdf' as const
	// 		};
			
	// 		openFiles.update(files => [...files, newFile]);
	// 		activeFile.set(newFile);
	// 		return;
	// 	}

	// 	try {
	// 		const content = await invoke<string>('read_file', { path: filepath });
	// 		const langMap: Record<string, string> = { js:'javascript', ts:'typescript', py:'python', rs:'rust', html:'html', css:'css', json:'json', md:'markdown' };
			
	// 		const newFile = { 
	// 			name: filepath.split(/[\\/]/).pop() || 'file', 
	// 			path: filepath, 
	// 			content: content || '', 
	// 			language: langMap[ext] || 'text', 
	// 			modified: false 
	// 		};
			
	// 		openFiles.update(files => [...files, newFile]);
	// 		activeFile.set(newFile);
	// 	} catch (err) {
	// 		console.error('Failed to open file from link:', err);
	// 	}
	// }


	onMount(() => {
		// Listen for code block insert events
		window.addEventListener('insertCodeBlock', handleCodeBlockInsert as EventListener);

		return () => {
			window.removeEventListener('insertCodeBlock', handleCodeBlockInsert as EventListener);
			clearTimeout(saveTimeout);
		};
	});
</script>

<CodeInsertDialog />

{#if showCommandPalette}
	<div class="command-palette-wrapper" on:click|self={() => (showCommandPalette = false)} role="dialog">
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
{/if}

<div class="note-editor color-{colorClass}" class:focused={$focusArea === 'editor'}>
	<input
		class="note-title"
		bind:value={title}
		on:blur={handleTitleChange}
		on:input={scheduleSave}
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
		transition: outline 0.15s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.note-editor.focused {
		outline: 2px solid #4a9eff;
		outline-offset: -2px;
	}

	.note-title {
		width: 100%;
		padding: 1rem 1.5rem;
		font-size: 1.75rem;
		font-weight: 600;
		border: none;
		background: transparent;
		color: #fff;
		outline: none;
		border-bottom: 1px solid #2a2a2a;
	}

	.note-title::placeholder {
		color: #666;
	}

	.editor-wrapper {
		flex: 1;
		overflow: auto;
		background: #0d1117;
	}

	.note-hints {
		padding: 0.75rem 1.5rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: #0d1117;
		border-top: 1px solid #1a1a1a;
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

	/* Color variants */
	.color-red {
		border-left: 4px solid #ef4444;
	}

	.color-blue {
		border-left: 4px solid #3b82f6;
	}

	.color-green {
		border-left: 4px solid #10b981;
	}

	.color-yellow {
		border-left: 4px solid #f59e0b;
	}

	.color-purple {
		border-left: 4px solid #8b5cf6;
	}

	.color-pink {
		border-left: 4px solid #ec4899;
	}
</style>
