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
	import AIPalette from './AIPalette.svelte';
	import CommandPalette from './CommandPalette.svelte';

	let title = $activeNote?.title || '';
	export let handleFileClick: (path: string) => void = () => {};
	let editor: any;
	let saveTimeout: ReturnType<typeof setTimeout>;
	let showCommandPalette = false;
	let showAIPalette = false;
	let aiContext: any = null;

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

	// Get color hex
	$: colorHex = $activeNote?.color || 'default';

	// Calculate background style
	$: backgroundStyle = colorHex === 'default' 
		? 'background: #0d1117;' 
		: `background: linear-gradient(180deg, ${colorHex}1A 0%, #0d1117 100%);`;
	
	$: borderStyle = 'border-left: none;';

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
		const tiptapEditor = editor?.getEditor();
		if (tiptapEditor) {
			tiptapEditor.chain().focus().setCodeBlock().run();
		}
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
				tiptapEditor.chain().focus().setCodeBlock().run();
				break;
		}
	}

	function handleCodeBlockInsert(event: CustomEvent) {
		const { code, language } = event.detail;
		const tiptapEditor = editor?.getEditor();
		
		if (tiptapEditor) {
			tiptapEditor
				.chain()
				.focus()
				.insertContent(`\`\`\`${language}\n${code}\n\`\`\``)
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


{#if showCommandPalette}
	<div 
		class="command-palette-wrapper" 
		on:click|self={() => (showCommandPalette = false)} 
		on:keydown={(e) => e.key === 'Escape' && (showCommandPalette = false)}
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
		editor={editor?.getEditor()}
		on:close={() => (showAIPalette = false)}
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
					onAITrigger={(ctx) => {
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
		box-shadow: inset 0 0 0 1px rgba(74, 158, 239, 0.4);
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
