<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { get } from 'svelte/store';
	import { invoke, convertFileSrc } from '@tauri-apps/api/core';
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
	import { openFiles, activeFile, currentDirectory } from '$lib/stores/files';
	import { commandPaletteOpen, setupGlobalShortcuts, settingsOpen, activeTab } from '$lib/stores/shortcuts';
	import { focusArea } from '$lib/stores/focus';
	import { settingsStore } from '$lib/stores/settings';
	import type { Note } from '$lib/stores/notes';
	import type { OpenFile } from '$lib/stores/files';

	import Sidebar from '$lib/components/Sidebar.svelte';
	import FileEditor from '$lib/components/FileEditor.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import NoteEditor from '$lib/components/NoteEditor.svelte';
	import PDFView from '$lib/components/PDFView.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import { detectLanguage } from '$lib/utils/files';

	let loading = true;
	let error = '';
	let focusedTabIndex = -1;
	let tabsContainer: HTMLElement;

	// Sync focusedTabIndex with activeFile ONLY when not explicitly navigating the toolbar
	$: if ($openFiles.length > 0) {
		if ($focusArea !== 'file-tabs') {
			const idx = $activeFile ? $openFiles.findIndex(f => f.path === $activeFile.path) : -1;
			if (idx !== -1) {
				focusedTabIndex = idx;
			} else if (focusedTabIndex >= $openFiles.length) {
				focusedTabIndex = $openFiles.length - 1;
			} else if (focusedTabIndex === -1) {
				focusedTabIndex = 0;
			}
		}
	} else {
		focusedTabIndex = -1;
	}

	// Auto-focus toolbar when focusArea switches to 'file-tabs'
	$: if ($focusArea === 'file-tabs' && tabsContainer) {
		// One-time sync when entering the area
		const idx = $activeFile ? $openFiles.findIndex(f => f.path === $activeFile.path) : -1;
		if (idx !== -1) focusedTabIndex = idx;
		
		tick().then(() => {
			if (document.activeElement !== tabsContainer) {
				tabsContainer.focus();
			}
		});
	}

	function handleToolbarKeyDown(e: KeyboardEvent) {
		if ($focusArea !== 'file-tabs') return;

		if (e.key === 'ArrowRight') {
			e.preventDefault();
			focusedTabIndex = (focusedTabIndex + 1) % $openFiles.length;
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			focusedTabIndex = (focusedTabIndex - 1 + $openFiles.length) % $openFiles.length;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const file = $openFiles[focusedTabIndex];
			if (file) {
				activeFile.set(file);
			}
		}
	}

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
			} catch (e) {
				console.error('Failed to create file-based note:', e);
				error = String(e);
			}
		} else {
			// Warn user and open settings
			error = 'Please configure a Notes Directory in Settings before creating notes.';
			settingsOpen.set(true);
			// Force tab to notes to show the list area where the error might be visible
			activeTab.set('notes');
			setTimeout(() => (error = ''), 5000);
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
		await settingsStore.init();
		console.log('✅ Shortcuts initialized and settings loaded');

		const dir = get(settingsStore).notesDirectory;

		if (dir) {
			console.log('📂 Loading saved notes directory:', dir);
			try {
				await setNotesDirectory(dir);
			} catch (e) {
				console.error('Failed to load saved notes directory:', e);
			}
		}

		const handleDirChange = async (e: any) => {
			const newDir = e.detail;
			if (newDir) {
				await setNotesDirectory(newDir);
			}
		};
		window.addEventListener('notes-directory-changed', handleDirChange);

		// Restore last active note if available
		const lastNoteId = get(settingsStore).lastActiveNoteId;
		if (lastNoteId) {
			console.log('🔄 Restoring last active note:', lastNoteId);
			activeNoteId.set(lastNoteId);
		}

		loading = false;

		return () => {
			window.removeEventListener('notes-directory-changed', handleDirChange);
		};
	});

	async function handleFileClick(path: string) {
		console.log('🔗 File link clicked in note:', path);
		try {
			// 1. Switch sidebar to "Files"
			activeTab.set('files');

			// 2. Set the current directory to the folder containing the file
			const lastSlash = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
			if (lastSlash !== -1) {
				const parentDir = path.substring(0, lastSlash);
				console.log('📂 Navigating to parent directory:', parentDir);
				currentDirectory.set(parentDir);
			}

			// 3. Open the file
			const fileName = path.split(/[\\/]/).pop() || 'Untitled';
			const type = fileName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'markdown';
			
			let content = '';
			if (type === 'pdf') {
				content = convertFileSrc(path);
			} else {
				content = await invoke<string>('read_file', { path });
			}
			
			const newFile: OpenFile = {
				path,
				content,
				modified: false,
				language: detectLanguage(fileName),
				type
			};

			openFiles.update((files) => {
				if (files.some((f) => f.path === path)) return files;
				return [...files, newFile];
			});
			activeFile.set(newFile);
		} catch (e) {
			console.error('Failed to open linked file:', e);
		}
	}

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

	function closeFile(path: string) {
		openFiles.update((files) => files.filter((f) => f.path !== path));
		if ($activeFile?.path === path) {
			activeFile.set(get(openFiles)[0] || null);
		}
	}
</script>


<div class="app">
	<Sidebar />

	<div class="main-grid" class:show-settings={$settingsOpen}>
		<div class="editor-section">
			<header>
				<h1></h1>
				<div class="header-actions">
					<button class="btn-icon" on:click={() => settingsOpen.update(v => !v)} title="Settings (Ctrl+,)">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="3"></circle>
							<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
						</svg>
					</button>
					<button class="btn-primary" on:click={createNewNote}>
						📝 New Note
					</button>
				</div>
			</header>

			{#if loading}
				<div class="loading">Loading notes...</div>
			{:else if error}
				<div class="error">{error}</div>
			{:else}
				{#if $activeTab === 'files' && $openFiles.length > 0}
					<div 
						role="tablist"
						tabindex={0}
						aria-label="Open files tabs"
						class="content-tabs" 
						class:focused={$focusArea === 'file-tabs'}
						on:keydown={handleToolbarKeyDown}
						bind:this={tabsContainer}
					>
						<div class="tabs-scroll">
							{#each $openFiles as file, i}
								<div 
									class="tab-wrapper" 
									class:highlighted={i === focusedTabIndex}
								>
									<button
										class="tab"
										class:active={$activeFile?.path === file.path}
										on:click={() => {
											focusedTabIndex = i;
											activeNoteId.set(null);
											activeFile.set(file);
										}}
									>
										{file.path.split(/[\\/]/).pop()}
										{#if file.modified}
											<span class="modified">●</span>
										{/if}
									</button>
									<button class="close-button" on:click|stopPropagation={() => closeFile(file.path)}>
										✕
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<div class="main-content">
					{#if $activeTab === 'files'}
						{#if $activeFile}
							<!-- File Editor Mode -->
							{#key $activeFile.path}
								{#if $activeFile.type === 'pdf'}
									<PDFView src={$activeFile.content} />
								{:else}
									<FileEditor
										content={$activeFile.content}
										language={$activeFile.language}
										{handleFileClick}
										onSave={(content) => handleSave($activeFile, content)}
										onModified={(modified) => {
											if (modified !== $activeFile.modified) {
												openFiles.update((files) =>
													files.map((f) => (f.path === $activeFile.path ? { ...f, modified } : f))
												);
											}
										}}
									/>
								{/if}
							{/key}
						{:else}
							<div class="empty-state">
								<div class="empty-icon">📁</div>
								<h2>Select a file from the explorer</h2>
								<p>Navigate the file tree to open documents</p>
							</div>
						{/if}
					{:else}
						<!-- Notes Mode (Default) -->
						{#if $activeNote}
							{#key $activeNote.id}
								<NoteEditor {handleFileClick} />
							{/key}
						{:else}
							<div class="empty-state">
								<div class="empty-icon">📓</div>
								<h2>Select a note to start writing</h2>
								<p>Or use <kbd>Ctrl+P</kbd> for commands</p>
							</div>
						{/if}
					{/if}
				</div>
			{/if}
		</div>

		{#if $settingsOpen}
			<SettingsPanel />
		{/if}
	</div>
</div>

<style>
	:global(body, html) {
		overflow: hidden !important;
		height: 100%;
		margin: 0;
		padding: 0;
	}

	/* Refined focus reset */
	:global(*:focus) {
		outline: none !important;
	}

	/* Specific focus indicators for navigation areas */
	:global(.content-tabs:focus-within), 
	:global(.sidebar:focus-within) {
		box-shadow: inset 0 0 0 1px rgba(74, 158, 239, 0.4) !important;
	}

	.app {
		display: flex;
		height: 100vh;
		background: #1a1a1a;
		color: #fff;
		overflow: hidden;
	}

	.main-grid {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr;
		height: 100vh;
		background-color: #0d1117;
		transition: grid-template-columns 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		overflow: hidden;
	}

	.main-grid.show-settings {
		grid-template-columns: 1fr 350px;
	}

	.editor-section {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		background: #0d1117;
		outline: none !important;
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

	.btn-primary {
		padding: 0.5rem 1rem;
		border-radius: 4px;
		border: none;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		background: #4a9eff;
		color: white;
		transition: all 0.2s;
	}

	.btn-primary:hover {
		background: #3a8eef;
	}

	.content-tabs {
		background: #1a1a1a;
		border-bottom: 1px solid #2a2a2a;
		height: 40px;
		display: flex;
		align-items: center;
		outline: none;
		transition: outline 0.15s ease;
	}

	.content-tabs.focused {
		box-shadow: inset 0 0 0 1px rgba(74, 158, 239, 0.4);
	}

	.tabs-scroll {
		display: flex;
		overflow-x: auto;
		height: 100%;
		scrollbar-width: none;
	}

	.tabs-scroll::-webkit-scrollbar {
		display: none;
	}

	.tab-wrapper {
		display: flex;
		align-items: center;
		border-right: 1px solid #2a2a2a;
		height: 100%;
		background: #1a1a1a;
		transition: background 0.15s;
	}

	.tab-wrapper.highlighted {
		background: #2a2a2a;
	}

	.tab {
		padding: 0 1rem;
		height: 100%;
		background: transparent;
		border: none;
		color: #8b949e;
		font-size: 0.85rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		transition: all 0.2s;
	}

	.tab:hover {
		background: #21262d;
		color: #c9d1d9;
	}

	.tab.active {
		background: #0d1117;
		color: #fff;
		box-shadow: inset 0 2px 0 #4a9eff;
	}

	.close-button {
		padding: 0 0.5rem;
		background: transparent;
		border: none;
		color: #484f58;
		cursor: pointer;
		font-size: 0.75rem;
		transition: color 0.2s;
	}

	.close-button:hover {
		color: #ff7b72;
	}

	.main-content {
		flex: 1;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		outline: none !important;
	}

	.loading,
	.error,
	.empty-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		color: #888;
		padding: 2rem;
	}

	.empty-icon {
		font-size: 4rem;
		margin-bottom: 1.5rem;
		opacity: 0.5;
	}

	.empty-state h2 {
		color: #fff;
		margin: 0 0 0.5rem 0;
	}

	kbd {
		background: #21262d;
		border: 1px solid #30363d;
		border-radius: 6px;
		padding: 0.2rem 0.4rem;
		font-size: 0.8rem;
		color: #c9d1d9;
		font-family: inherit;
	}

	.modified {
		color: #4a9eff;
		font-size: 0.6rem;
	}

	.btn-icon {
		background: none;
		border: none;
		color: #8b949e;
		padding: 0.5rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		border-radius: 6px;
		transition: all 0.2s;
	}

	.btn-icon:hover {
		background: #21262d;
		color: #fff;
	}
</style>
