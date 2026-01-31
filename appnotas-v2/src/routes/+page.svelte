<script lang="ts">
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { 
		notesList, 
		activeNoteId, 
		activeNote,
		notesDirectory,
		initNotes,
		setNotesDirectory,
		createNoteFile,
		saveNoteToFile,
		deleteNoteFile
	} from '$lib/stores/notes';
	import { openFiles, activeFile } from '$lib/stores/files';
	import { commandPaletteOpen, setupGlobalShortcuts } from '$lib/stores/shortcuts';
	import type { Note } from '$lib/stores/notes';
	import type { OpenFile } from '$lib/stores/files';

	import Sidebar from '$lib/components/Sidebar.svelte';
	import FileEditor from '$lib/components/FileEditor.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import NoteEditor from '$lib/components/NoteEditor.svelte';

	let loading = true;
	let error = '';

	// Command palette commands
	const commands = [
		{
			id: 'new-note',
			label: 'New Note',
			description: 'Create a new note',
			action: createNewNote
		},
		{
			id: 'choose-notes-dir',
			label: 'Choose Notes Directory',
			description: 'Select where to store your notes',
			action: chooseNotesDirectory
		},
		{
			id: 'open-file',
			label: 'Open File',
			description: 'Browse and open a file',
			action: () => {
				// Switch to Files tab and focus the file tree
				const filesTab = document.querySelector('[class*="tab"]:not(.active)') as HTMLElement;
				filesTab?.click();
			}
		},
		{
			id: 'close-tab',
			label: 'Close Tab',
			description: 'Close the current file tab',
			action: closeCurrentTab
		},
		{
			id: 'save-file',
			label: 'Save File',
			description: 'Save the current file (Ctrl+S)',
			action: () => {
				if ($activeFile && handleSave) {
					const editor = document.querySelector('.file-editor') as any;
					if (editor?.save) editor.save();
				}
			}
		}
	];

	async function chooseNotesDirectory() {
		try {
			const selected = await openDialog({
				directory: true,
				multiple: false,
				title: 'Choose Notes Directory'
			});

			if (selected && typeof selected === 'string') {
				await setNotesDirectory(selected);
				console.log('Notes directory set to:', selected);
			}
		} catch (e) {
			console.error('Failed to choose directory:', e);
		}
	}

	async function createNewNote() {
		console.log('createNewNote called, notesDirectory:', $notesDirectory);
		
		// Check if notes directory is set for file-based notes
		if ($notesDirectory) {
			// Use file-based notes
			try {
				// Auto-generate title - user can change it later
				const title = `Note ${new Date().toLocaleString('en-US', { 
					month: 'short', 
					day: 'numeric', 
					hour: '2-digit', 
					minute: '2-digit' 
				})}`;
				const note = await createNoteFile(title);
				console.log('File-based note created:', note.id);
				activeFile.set(null); // Show the note editor
			} catch (e) {
				console.error('Failed to create file-based note:', e);
				error = String(e);
			}
		} else {
			// Fall back to in-memory notes
			const newNote: Note = {
				id: crypto.randomUUID(),
				title: 'Untitled Note',
				content: '',
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				tags: []
			};
			
			try {
				await invoke('save_note', { note: newNote });
				console.log('In-memory note created:', newNote.id);
				
				notesList.update((n) => [newNote, ...n]);
				activeNoteId.set(newNote.id);
				activeFile.set(null);
			} catch (e) {
				console.error('Failed to create note:', e);
			}
		}
	}

	function closeCurrentTab() {
		if ($activeFile) {
			closeFile($activeFile);
		}
	}

	onMount(async () => {
		console.log('🚀 App mounted, setting up shortcuts...');
		setupGlobalShortcuts();
		console.log('✅ Shortcuts initialized');

		try {
			// Load initial in-memory notes (backward compat)
			const initialNotes = await invoke<Note[]>('list_notes');
			notesList.set(initialNotes);
			if (initialNotes.length > 0) {
				activeNoteId.set(initialNotes[0].id);
			}
		} catch (e) {
			error = String(e);
			console.error('Failed to load notes:', e);
		} finally {
			loading = false;
		}
	});

	async function handleSave(file: OpenFile, newContent: string) {
		try {
			await invoke('write_file', { path: file.path, content: newContent });
			openFiles.update((files) =>
				files.map((f) => (f.path === file.path ? { ...f, content: newContent, modified: false } : f))
			);
			console.log('File saved:', file.path);
		} catch (e) {
			console.error('Failed to save file:', e);
		}
	}

	function closeFile(file: OpenFile) {
		openFiles.update((files) => files.filter((f) => f.path !== file.path));
		if ($activeFile?.path === file.path) {
			activeFile.set($openFiles[0] || null);
		}
	}
</script>

<CommandPalette bind:isOpen={$commandPaletteOpen} {commands} />

<div class="app">
	<Sidebar />

	<div class="main">
		<header>
			<h1>AppNotas v2</h1>
			<div class="header-actions">
				<button class="btn-primary" on:click={createNewNote}>
					📝 New Note
				</button>
				<button class="btn-secondary" on:click={chooseNotesDirectory}>
					📁 Choose Directory
				</button>
				{#if $notesDirectory}
					<span class="notes-dir-badge" title={$notesDirectory}>
						📂 {$notesDirectory.split(/[/\\]/).pop()}
					</span>
				{/if}
			</div>
		</header>

		<div class="content-area">
			{#if loading}
				<div class="loading">Loading...</div>
			{:else if error}
				<div class="error">Error: {error}</div>
			{:else}
				{@const shouldShowTabs = $activeFile && $openFiles.length > 0}
				{@const _ = shouldShowTabs ? null : console.warn('⚠️ TAB BAR HIDDEN:', {
					hasActiveFile: !!$activeFile,
					openFilesCount: $openFiles.length,
					openFiles: $openFiles.map(f => f.path)
				})}
				
				<!-- File Tabs - Always show if there's an active file -->
				{#if shouldShowTabs}
					<div class="tabs">
						{#each $openFiles as file}
							<div class="tab" class:active={$activeFile?.path === file.path}>
								<button
									class="tab-button"
									on:click={() => {
										console.log('🔄 TAB CLICK:', {
											from: $activeFile?.path,
											to: file.path,
											contentPreview: file.content.substring(0, 50)
										});
										activeFile.set(file);
									}}
								>
									{file.path.split('\\').pop()}
									{#if file.modified}
										<span class="modified">●</span>
									{/if}
								</button>
								<button class="close-button" on:click={() => closeFile(file)}>×</button>
							</div>
						{/each}
					</div>
				{/if}

				<!-- Content Area -->
				{#if $activeFile}
					<!-- File Editor Mode -->
					{#key $activeFile.path}
						{@const currentFile = $activeFile}
						{@const _ = console.log('🔑 KEY BLOCK RE-RENDERING:', {
							path: currentFile.path,
							language: currentFile.language,
							contentLength: currentFile.content.length,
							contentPreview: currentFile.content.substring(0, 80),
							openFilesCount: $openFiles.length
						})}
						<FileEditor
							content={currentFile.content}
							language={currentFile.language}
							onSave={(content) => handleSave(currentFile, content)}
							onModified={(modified) => {
								if (modified !== currentFile.modified) {
									openFiles.update((files) =>
										files.map((f) => (f.path === currentFile.path ? { ...f, modified } : f))
									);
								}
							}}
						/>
					{/key}
				{:else if $activeNote}
					<!-- Note Editor Mode -->
					<NoteEditor />
				{:else}
					<div class="empty-state">
						<p>Select a note or open a file to get started</p>
					</div>
				{/if}
			{/if}
		</div>
	</div>
</div>

<style>
	.app {
		display: flex;
		height: 100vh;
		background: #1a1a1a;
		color: #fff;
	}

	.main {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid #2a2a2a;
		background: #1a1a1a;
	}

	h1 {
		font-size: 1.25rem;
		margin: 0;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.btn-primary,
	.btn-secondary {
		padding: 0.5rem 1rem;
		border-radius: 4px;
		border: none;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-primary {
		background: #4a9eff;
		color: white;
	}

	.btn-primary:hover {
		background: #3a8eef;
	}

	.btn-secondary {
		background: #2a2a2a;
		color: #ccc;
		border: 1px solid #3a3a3a;
	}

	.btn-secondary:hover {
		background: #3a3a3a;
	}

	.notes-dir-badge {
		padding: 0.5rem 0.75rem;
		background: #2a2a2a;
		border: 1px solid #3a3a3a;
		border-radius: 4px;
		font-size: 0.75rem;
		color: #999;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.content-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.loading,
	.error,
	.empty-state {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #888;
	}

	.error {
		color: #ff5555;
	}

	.tabs {
		display: flex;
		background: #2a2a2a;
		border-bottom: 1px solid #3a3a3a;
		overflow-x: auto;
		position: relative;
		z-index: 10;
		min-height: 45px;
	}

	.tab {
		display: flex;
		align-items: center;
		background: #1a1a1a;
		border-right: 1px solid #3a3a3a;
	}

	.tab.active {
		background: #2a2a2a;
	}

	.tab-button {
		padding: 0.5rem 1rem;
		background: transparent;
		border: none;
		color: #ccc;
		cursor: pointer;
		font-size: 0.875rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.modified {
		color: #4a9eff;
	}

	.close-button {
		padding: 0.25rem 0.5rem;
		background: transparent;
		border: none;
		color: #888;
		cursor: pointer;
		font-size: 1.25rem;
		line-height: 1;
	}

	.close-button:hover {
		color: #ff5555;
	}
</style>
