<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { get } from 'svelte/store';
	import { invoke, convertFileSrc } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
	import {
		notesList,
		activeNoteId,
		activeNote,
		notesDirectory,
		initNotes,
		setNotesDirectory,
		createNoteFile,
		saveNoteToFile,
		deleteNoteFile,
		reloadNoteFromDisk,
		applyExternalContent,
		activeNoteContent,
		taskNotesList
	} from '$lib/stores/notes';
	import { openFiles, activeFile, currentDirectory, terminalVisible, terminalHeight } from '$lib/stores/files';
	import { saveRequested, commandPaletteOpen, colorChangeRequested, setupGlobalShortcuts, settingsOpen, activeTab } from '$lib/stores/shortcuts';
	import { focusArea } from '$lib/stores/focus';
	import { settingsStore } from '$lib/stores/settings';
    import { aiState } from '$lib/stores/ai';
	import { consoleStore } from '$lib/stores/consoleStore';
	import type { Note } from '$lib/stores/notes';
	import type { OpenFile } from '$lib/stores/files';

	import Sidebar from '$lib/components/Sidebar.svelte';
	import FileEditor from '$lib/components/FileEditor.svelte';
	import ColorPalette from '$lib/components/ColorPalette.svelte';
	import NoteEditor from '$lib/components/NoteEditor.svelte';
	import PDFView from '$lib/components/PDFView.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import Terminal from '$lib/components/Terminal.svelte';
	import RefreshDiffModal from '$lib/components/RefreshDiffModal.svelte';
	import WindowControls from '$lib/components/WindowControls.svelte';
	import { detectLanguage } from '$lib/utils/files';
	import { FolderTree, Notebook, ListTodo, RefreshCw, FilePlus2, ListPlus, PanelLeft } from 'lucide-svelte';

	let loading = $state(true);
	let error = $state('');
	let focusedTabIndex = $state(-1);
	let tabsContainer = $state<HTMLElement>();

	// Refresh feature state
	let showDiffModal = $state(false);
	let diffOldContent = $state('');
	let diffNewContent = $state('');
	let diffNoteTitle = $state('');
	let diffNoteId = $state('');
	let isRefreshing = $state(false);

	// Sync focusedTabIndex with activeFile ONLY when not explicitly navigating the toolbar
	// Sync focusedTabIndex with activeFile ONLY when not explicitly navigating the toolbar
    $effect(() => {
        if ($openFiles.length > 0) {
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
    });

	// Auto-focus toolbar when focusArea switches to 'file-tabs'
	$effect(() => {
        if ($focusArea === 'file-tabs' && tabsContainer) {
            tick().then(() => {
                if (tabsContainer && document.activeElement !== tabsContainer) {
                    tabsContainer.focus();
                }
            });
        }
    });

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
				if ($activeFile) {
					saveRequested.set(true);
					setTimeout(() => saveRequested.set(false), 100);
				}
			}
		},
		{
			id: 'new-task',
			label: 'New Task',
			description: 'Create a new task list',
			action: () => createNewNote('tasks')
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

	async function createNewNote(subfolder?: string) {
		console.log('createNewNote called, subfolder:', subfolder, 'notesDirectory:', $notesDirectory);
		
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
				const actualSubfolder = subfolder || ($activeTab === 'tasks' ? 'tasks' : undefined);
				const note = await createNoteFile(title, actualSubfolder);
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
			closeFile($activeFile.path);
		}
	}

	// React to activeFile changes to lazy load if empty
	$effect(() => {
		if ($activeFile && $activeFile.modified === false && $activeFile.content === "") {
			(async () => {
				const f = { ...$activeFile };
				try {
					if (f.type === 'pdf') {
						f.content = convertFileSrc(f.path);
					} else {
						f.content = await invoke<string>('read_file', { path: f.path });
					}
					openFiles.update(fs => fs.map(file => file.path === f.path ? f : file));
                    // Update the active file reference directly to trigger re-renders
					activeFile.set(f);
				} catch (e) {
					console.error("Failed to lazy load active file:", e);
				}
			})();
		}
	});

	// Inject custom font variable continuously into the DOM root
	$effect(() => {
		if (typeof document !== 'undefined' && $settingsStore.editorFont) {
			document.documentElement.style.setProperty('--app-font', $settingsStore.editorFont);
		}
	});

	onMount(() => {
		console.log('🚀 App mounted, setting up shortcuts...');
		setupGlobalShortcuts();
        
        // Use an IIFE for async setup
        (async () => {
			consoleStore.init(); // Initialize log interception
            await settingsStore.init();
            await initNotes(); // Start listening for sync events
            console.log('✅ Shortcuts initialized and settings loaded');

            const settings = get(settingsStore);
            const dir = settings.notesDirectory;

            if (dir) {
                try {
                    await setNotesDirectory(dir);
                } catch (e) {
                    console.error('Failed to load saved notes directory:', e);
                }
            }

            // Restore last active state based on initial tab
            if ($activeTab === 'tasks') {
                if (settings.lastActiveTaskId) activeNoteId.set(settings.lastActiveTaskId);
            } else if ($activeTab === 'notes') {
                if (settings.lastActiveNoteId) activeNoteId.set(settings.lastActiveNoteId);
            }

            loading = false;
        })();

        // Listen for restore-main event from overlay
        listen('restore-main', async (event: any) => {
            console.log('📥 Received restore-main event:', event.payload);
            const { tab, noteId } = event.payload || {};
            
            const win = getCurrentWebviewWindow();
            await win.unminimize();
            await win.show();
            await win.setFocus();

            if (tab) activeTab.set(tab);
            if (noteId) activeNoteId.set(noteId);
        });

        // Listen for open-path event from overlay (Smart Redirection)
        listen('open-path', async (event: any) => {
            console.log('📥 Received open-path event:', event.payload);
            const { path } = event.payload || {};
            if (!path) return;

            const win = getCurrentWebviewWindow();
            await win.unminimize();
            await win.show();
            await win.setFocus();

            handleSmartFileOpen(path);
        });

		const handleDirChange = async (e: any) => {
			const newDir = e.detail;
			if (newDir) {
				await setNotesDirectory(newDir);
			}
		};
		window.addEventListener('notes-directory-changed', handleDirChange);

		return () => {
			window.removeEventListener('notes-directory-changed', handleDirChange);
		};
	});

	// --- Refresh Feature (Manual Only) ---

	async function checkForDiskChanges(note: Note) {
		const diskContent = await reloadNoteFromDisk(note.id);
		if (diskContent === null) return;

		// Use activeNoteContent for active note to ensure we compare against live editor state
		// rather than the (potentially empty) store object from the list.
		const currentActiveId = get(activeNoteId);
		const currentNoteContent = get(activeNoteContent);
		
		const currentLocalContent = (currentActiveId === note.id && currentNoteContent) 
			? currentNoteContent 
			: (note.content || '');

		if (diskContent.trim() !== currentLocalContent.trim()) {
			diffOldContent = currentLocalContent;
			diffNewContent = diskContent;
			diffNoteTitle = note.title;
			diffNoteId = note.id;
			showDiffModal = true;
		} else {
			// Mtime changed but content is the same (e.g. only frontmatter touched)
			if (note.path) {
				const lastKnownMtime = await invoke<number>('get_file_mtime', { path: note.path });
			}
		}
	}

	async function handleManualRefresh() {
		if (isRefreshing) return;
		const note = $activeNote;
		if (!note) return;

		isRefreshing = true;
		try {
			// 1. Force the current editor to save its content to disk first
			window.dispatchEvent(new CustomEvent('app:request-save'));
			
			// 2. Wait a moment for the save to hit the store/disk
			await tick();
			await new Promise(r => setTimeout(r, 100)); // Small buffer for disk IO

			await checkForDiskChanges(note);
			if (!showDiffModal) {
				// No changes detected, briefly flash the button
				console.log('[Refresh] No external changes detected');
			}
		} finally {
			isRefreshing = false;
		}
	}

	function handleAcceptChanges() {
		if (diffNoteId && diffNewContent !== undefined) {
			applyExternalContent(diffNoteId, diffNewContent);
			// Force re-key the editor by briefly unsetting activeNoteId
			const id = diffNoteId;
			activeNoteId.set(null);
			tick().then(() => activeNoteId.set(id));
		}
		closeDiffModal();
	}

	function handleRejectChanges() {
		closeDiffModal();
	}

	function closeDiffModal() {
		showDiffModal = false;
		diffOldContent = '';
		diffNewContent = '';
		diffNoteTitle = '';
		diffNoteId = '';
	}

	async function handleSmartFileOpen(path: string) {
		console.log('🔗 Smart opening file:', path);
		
		// Check if it's a note or task list first
		const allNotes = [...get(notesList), ...get(taskNotesList)];
		const existingNote = allNotes.find(n => n.path === path);

		if (existingNote) {
			const isTask = path.includes('tasks') || existingNote.id.startsWith('task-');
			activeTab.set(isTask ? 'tasks' : 'notes');
			activeNoteId.set(existingNote.id);
			return;
		}

		// Otherwise, open in Files tab
		handleFileClick(path);
	}

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
				type: type as any
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

	// Terminal resize handler
	function startTerminalResize(event: MouseEvent) {
		event.preventDefault();
		const startY = event.clientY;
		const startHeight = $terminalHeight;

		function onMouseMove(e: MouseEvent) {
			const deltaY = startY - e.clientY;
			const newHeight = Math.max(100, Math.min(500, startHeight + deltaY));
			terminalHeight.set(newHeight);
		}

		function onMouseUp() {
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
		}

		document.addEventListener('mousemove', onMouseMove);
		document.addEventListener('mouseup', onMouseUp);
	}
</script>


<div class="app">
	<Sidebar />

	<div class="main-grid" class:show-settings={$settingsOpen}>
		<div class="editor-section">
			<header data-tauri-drag-region>
				<div class="header-branding" style="display: flex; align-items: center; gap: 0.5rem; padding-left: 0.5rem;">
					<button class="btn-icon" onclick={() => settingsStore.toggleSidebar()} title="Toggle Sidebar">
						<PanelLeft size={18} />
					</button>
					<img src="/app-logo.png" alt="AppNotas" class="header-logo" />
				</div>
				<div class="header-actions">
					{#if $aiState.pendingProposals > 0}
						<div class="ai-counter" title="Pending AI Proposals">
							<span class="count">{$aiState.pendingProposals}</span>
							<span class="icon">✨</span>
						</div>
					{/if}
					<button 
						class="btn-icon refresh-btn" 
						class:spinning={isRefreshing}
						onclick={handleManualRefresh}
						title="Check for external changes"
						disabled={!$activeNote || $activeTab !== 'notes'}
					>
						<RefreshCw size={16} />
					</button>
					<button 
						class="btn-icon terminal-toggle" 
						class:active={$terminalVisible}
						onclick={() => terminalVisible.update(v => !v)} 
						title="Toggle Terminal (Ctrl+`)"
					>
						&gt;_
					</button>
					<button class="btn-icon" onclick={() => settingsOpen.update(v => !v)} title="Settings (Ctrl+,)">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="3"></circle>
							<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
						</svg>
					</button>
					<button 
						class="btn-primary" 
						class:tasks-btn={$activeTab === 'tasks'}
						onclick={() => createNewNote($activeTab === 'tasks' ? 'tasks' : undefined)}
					>
						<div style="display: flex; align-items: center; gap: 0.4rem; justify-content: center;">
							{#if $activeTab === 'tasks'}
								<ListPlus size={16} /> New Task
							{:else}
								<FilePlus2 size={16} /> New Note
							{/if}
						</div>
					</button>
					<WindowControls />
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
						onkeydown={handleToolbarKeyDown}
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
										onclick={() => {
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
									<button class="close-button" onclick={(e: MouseEvent) => { e.stopPropagation(); closeFile(file.path); }}>
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
								<div class="empty-icon">
									<FolderTree size={64} opacity={0.3} color="#fff" />
								</div>
								<h2>Select a file from the explorer</h2>
								<p>Navigate the file tree to open documents</p>
							</div>
						{/if}
					{:else}
						<!-- Notes Mode (Default) -->
						{#if $activeNote}
							{#key $activeNote.id}
								<NoteEditor handleFileClick={handleSmartFileOpen} />
							{/key}
						{:else}
							<div class="empty-state">
								<div class="empty-icon">
									{#if $activeTab === 'tasks'}
										<ListTodo size={64} opacity={0.3} color="#fff" />
									{:else}
										<Notebook size={64} opacity={0.3} color="#fff" />
									{/if}
								</div>
								<h2>{$activeTab === 'tasks' ? 'Select a task list to edit' : 'Select a note to start writing'}</h2>
								<p>Or use <kbd>Ctrl+P</kbd> for commands</p>
							</div>
						{/if}
					{/if}
				</div>

				<!-- Global Terminal (works on both tabs) -->
				{#if $terminalVisible}
					<div 
						class="terminal-container" 
						style="height: {$terminalHeight}px;"
					>
						<button 
							class="terminal-resize-handle"
							onmousedown={startTerminalResize}
							aria-label="Resize Terminal"
						></button>
						<Terminal 
							cwd={$activeTab === 'files' ? $currentDirectory : ($notesDirectory || '')} 
							visible={true} 
						/>
					</div>
				{/if}
			{/if}

			{#if showDiffModal}
				<RefreshDiffModal
					oldContent={diffOldContent}
					newContent={diffNewContent}
					noteTitle={diffNoteTitle}
					onaccept={handleAcceptChanges}
					onreject={handleRejectChanges}
				/>
			{/if}

			{#if $commandPaletteOpen}
				<ColorPalette 
					onSelect={(color) => colorChangeRequested.set(color)}
					onClose={() => commandPaletteOpen.set(false)}
				/>
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
		font-family: var(--app-font, 'Inter', -apple-system, sans-serif);
	}

	/* Custom Dark Scrollbars */
	:global(::-webkit-scrollbar) {
		width: 10px;
		height: 10px;
	}

	:global(::-webkit-scrollbar-track) {
		background: transparent;
	}

	:global(::-webkit-scrollbar-corner) {
		background: transparent;
	}

	:global(::-webkit-scrollbar-thumb) {
		background: rgba(255, 255, 255, 0.1);
		border: 2px solid #09090b;
		border-radius: 6px;
	}

	:global(::-webkit-scrollbar-thumb:hover) {
		background: rgba(255, 255, 255, 0.2);
	}

	/* Refined focus reset */
	:global(*:focus) {
		outline: none !important;
	}

	/* Specific focus indicators for navigation areas */
	:global(.content-tabs:focus-within) {
		box-shadow: inset 0 0 0 2px #4a9eff !important; /* Stronger focus indicator */
	}

	.app {
		display: flex;
		height: 100vh;
		background: #09090b;
		color: #fafafa;
		overflow: hidden;
	}

	.main-grid {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr;
		height: 100vh;
		background-color: #09090b;
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
		padding: 0 0 0 0.5rem; /* Reduced to fit the toggle button nicely */
		height: 48px; /* Fixed height for title bar feel */
		border-bottom: 1px solid #2a2a2a;
		background: #1a1a1a;
		user-select: none; /* Prevent highlighting while dragging */
	}

	.header-branding {
		display: flex;
		align-items: center;
	}

	.header-logo {
		height: 32px;
		width: auto;
		object-fit: contain;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.terminal-toggle {
		font-family: 'Fira Code', monospace;
		font-weight: 700;
		font-size: 1rem;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		color: #888;
		transition: all 0.2s;
	}

	.terminal-toggle.active {
		color: #4a9eff;
		background: rgba(74, 158, 255, 0.1);
	}

	.terminal-toggle:hover {
		color: #ccc;
		background: #2a2a2a;
	}

	.refresh-btn {
		font-size: 1rem;
		transition: all 0.3s;
	}

	.refresh-btn:hover {
		background: #2a2a2a;
	}

	.refresh-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.refresh-btn.spinning {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
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

	.btn-primary.tasks-btn {
		background: #a04dff;
	}

	.btn-primary.tasks-btn:hover {
		background: #b373ff;
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
		box-shadow: inset 0 0 0 3px #4a9eff, 0 0 15px rgba(74, 158, 255, 0.4);
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

    .ai-counter {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        padding: 0.2rem 0.6rem;
        background: rgba(74, 158, 255, 0.2);
        border: 1px solid rgba(74, 158, 255, 0.4);
        border-radius: 12px;
        font-size: 0.8rem;
        color: #4a9eff;
        margin-right: 0.5rem;
        animation: pulse 2s infinite;
    }

    .ai-counter .count {
        font-weight: bold;
    }

    @keyframes pulse {
        0% { box-shadow: 0 0 0 0 rgba(74, 158, 255, 0.4); }
        70% { box-shadow: 0 0 0 4px rgba(74, 158, 255, 0); }
        100% { box-shadow: 0 0 0 0 rgba(74, 158, 255, 0); }
    }

	/* Terminal Container */
	.terminal-container {
		position: relative;
		width: 100%;
		flex-shrink: 0;
		background: #0d1117;
	}

	.terminal-resize-handle {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 6px;
		cursor: ns-resize;
		background: transparent;
		z-index: 10;
		transition: background 0.15s ease;
	}

	.terminal-resize-handle:hover,
	.terminal-resize-handle:active {
		background: rgba(74, 158, 255, 0.3);
	}

	.terminal-container :global(.terminal-wrapper) {
		height: 100%;
	}
</style>
