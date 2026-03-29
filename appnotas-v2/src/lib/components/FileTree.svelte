<script lang="ts">
	import { openFiles, currentDirectory, activeFile } from '$lib/stores/files';
	import { focusArea } from '$lib/stores/focus';
	import { invoke, convertFileSrc } from '@tauri-apps/api/core';
	import { detectLanguage } from '$lib/utils/files';
	import { tick, onMount } from 'svelte';
    import { homeDir } from '@tauri-apps/api/path';

	interface FileEntry {
		name: string;
		path: string;
		is_dir: boolean;
		size: number | null;
	}

	let entries = $state<FileEntry[]>([]);
	let loading = $state(false);
	let error = $state('');
	let selectedIndex = $state(0);
	let treeContainer = $state<HTMLElement>();
	let searchQuery = $state('');
	let searchInput = $state<HTMLInputElement>();

	// Filter entries based on search query
	let filteredEntries = $derived(searchQuery 
		? entries.filter(e => e.name.toLowerCase().includes(searchQuery.toLowerCase()))
		: entries
    );

	// Auto-focus search input when focusArea switches to 'file-search'
    $effect(() => {
        if ($focusArea === 'file-search' && searchInput) {
            tick().then(() => {
                if (searchInput && document.activeElement !== searchInput) {
                    searchInput.focus();
                }
            });
        }
    });

	// Auto-focus container when focusArea switches to 'list' or entries load/change
    $effect(() => {
        if ($focusArea === 'file-tree' && treeContainer) {
            tick().then(() => {
                if (treeContainer && document.activeElement !== treeContainer) {
                    treeContainer.focus({ preventScroll: true });
                }
            });
        }
    });

    $effect(() => {
        if (treeContainer && entries.length > 0) {
            scrollToSelected(selectedIndex);
        }
    });

	async function scrollToSelected(index: number) {
		await tick();
		if (!treeContainer) return;
		const selectedElement = treeContainer.querySelector(`.entry.selected`) as HTMLElement;
		if (selectedElement) {
			selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		}
	}

    $effect(() => {
        if ($currentDirectory) {
            loadDirectory($currentDirectory);
        }
    });

	async function loadDirectory(path: string) {
		loading = true;
		error = '';
		selectedIndex = 0;
		try {
			entries = await invoke<FileEntry[]>('list_directory', { path });
			console.log('Loaded directory:', path, entries.length, 'entries');
		} catch (e) {
			error = String(e);
			console.error('Failed to load directory:', e);
			entries = [];
		} finally {
			loading = false;
		}
	}

	async function handleClick(entry: FileEntry, index: number) {
		selectedIndex = index;
		await openEntry(entry);
	}

	async function openEntry(entry: FileEntry) {
		if (entry.is_dir) {
			console.log('Navigating to directory:', entry.path);
			currentDirectory.set(entry.path);
		} else {
			console.log('Opening file:', entry.path);
			error = ''; // Clear any previous error
			try {
				const isPdf = entry.name.toLowerCase().endsWith('.pdf');
				let content = '';
				const language = detectLanguage(entry.name);
				
				// Determine file type based on language
				let type: 'pdf' | 'text';
				if (isPdf) {
					type = 'pdf';
				} else {
					type = 'text'; // JavaScript, Python, TypeScript, etc.
				}

				if (isPdf) {
					content = convertFileSrc(entry.path);
				} else {
					content = await invoke<string>('read_file', { path: entry.path });
				}

				console.log('File loaded, type:', type, 'language:', language);
				
				const newFile = {
					path: entry.path,
					content,
					modified: false,
					language,
					type
				};
				
				openFiles.update((files) => {
					// Don't duplicate if already open
					if (files.some(f => f.path === entry.path)) {
						return files;
					}
					return [...files, newFile];
				});
				
				activeFile.set(newFile);
				focusArea.set('editor');
			} catch (e) {
				const errMsg = String(e);
				// Check for UTF-8/encoding errors
				if (errMsg.includes('UTF-8') || errMsg.includes('valid') || errMsg.includes('stream')) {
					error = `Cannot open file: Not a valid text file (binary or unsupported encoding)`;
				} else {
					error = `Failed to open file: ${errMsg}`;
				}
				console.error('Failed to open file:', e);
				
				// Auto-clear error after 3 seconds
				setTimeout(() => {
					error = '';
				}, 3000);
				
				// Don't change activeFile - keep navigation working
			}
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if ($focusArea !== 'list') return;
		if (entries.length === 0) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, entries.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			openEntry(entries[selectedIndex]);
		} else if (e.key === 'Backspace' && !e.ctrlKey) {
			e.preventDefault();
			// Go to parent directory
			const parent = entries.find(e => e.name === '..');
			if (parent) {
				openEntry(parent);
			}
		}
	}

	function formatSize(bytes: number | null): string {
		if (!bytes) return '';
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}

	// Initialize with user's home directory
	onMount(async () => {
		if (!$currentDirectory) {
            try {
			    const home = await homeDir();
			    currentDirectory.set(home);
            } catch (e) {
                console.error('Failed to get home dir:', e);
                // Fallback for extreme cases
                currentDirectory.set('/'); 
            }
		}
	});
</script>

<svelte:window 
    onkeydown={() => { if (error) error = ''; }} 
    onmousedown={() => { if (error) error = ''; }} 
/>

<div class="file-tree-wrapper">
	<div class="current-path">
		{$currentDirectory || 'No directory'}
	</div>

	<div class="search-container">
		<input
			type="text"
			class="search-input"
			class:focused={$focusArea === 'file-search'}
			placeholder="🔍 Filter files..."
			bind:value={searchQuery}
			bind:this={searchInput}
			onfocus={() => focusArea.set('file-search')}
			onkeydown={(e) => {
                e.stopPropagation();
				if (e.key === 'Escape') {
					searchQuery = '';
					focusArea.set('list');
					treeContainer?.focus();
				} else if (e.key === 'ArrowDown' || e.key === 'Enter') {
					e.preventDefault();
					focusArea.set('list');
					treeContainer?.focus();
				}
			}}
		/>
		{#if searchQuery}
			<button class="clear-search" onclick={() => searchQuery = ''} title="Clear search">×</button>
		{/if}
	</div>

	<div 
		class="file-list" 
		class:focused={$focusArea === 'list'}
		onkeydown={handleKeyDown} 
		tabindex="0"
		role="listbox"
		aria-label="File Explorer"
		bind:this={treeContainer}
	>
		{#if loading}
			<div class="loading">Loading...</div>
		{:else}
			{#if error}
				<div class="error-toast">{error}</div>
			{/if}
			<div class="entries">
				{#each filteredEntries as entry, i}
					<button
						class="entry"
						class:directory={entry.is_dir}
						class:selected={i === selectedIndex}
						onclick={() => handleClick(entry, i)}
						onmouseenter={() => (selectedIndex = i)}
					>
						<span class="icon">{entry.is_dir ? '📁' : '📄'}</span>
						<span class="name">{entry.name}</span>
						{#if !entry.is_dir && entry.size}
							<span class="size">{formatSize(entry.size)}</span>
						{/if}
					</button>
				{/each}
				{#if filteredEntries.length === 0 && searchQuery}
					<div class="no-results">No files match "{searchQuery}"</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.file-tree-wrapper {
		height: 100%;
		display: flex;
		flex-direction: column;
		background: #1a1a1a;
		gap: 2px;
	}

	.current-path {
		padding: 0.5rem;
		font-size: 0.75rem;
		color: #888;
		background: #1a1a1a;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		border-bottom: 1px solid #2a2a2a;
	}

	/* Search Container */
	.search-container {
		padding: 0.5rem;
		position: relative;
		background: #1a1a1a;
		border: 2px solid transparent;
		transition: border-color 0.15s ease;
		box-sizing: border-box;
	}


	.file-list {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		outline: none;
		background: #1a1a1a;
		border: 2px solid transparent;
		transition: border-color 0.15s ease;
		box-sizing: border-box;
	}

	.file-list.focused {
		border-color: #4a9eff;
	}

	.search-input {
		width: 100%;
		padding: 0.5rem 2rem 0.5rem 0.5rem;
		background: #2a2a2a;
		border: 1px solid #3a3a3a;
		border-radius: 4px;
		color: #e0e0e0;
		font-size: 0.8rem;
		outline: none;
		transition: border-color 0.15s ease, box-shadow 0.15s ease;
		box-sizing: border-box;
	}

	.search-input::placeholder {
		color: #666;
	}

	.search-input:focus,
	.search-input.focused {
		border-color: #4a9eff;
		box-shadow: 0 0 0 2px rgba(74, 158, 255, 0.3);
	}

	.clear-search {
		position: absolute;
		right: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		background: transparent;
		border: none;
		color: #888;
		font-size: 1rem;
		cursor: pointer;
		padding: 0.25rem;
		line-height: 1;
	}

	.clear-search:hover {
		color: #fff;
	}

	.no-results {
		padding: 1rem;
		text-align: center;
		color: #666;
		font-size: 0.8rem;
	}

	.loading {
		padding: 1rem;
		text-align: center;
		color: #888;
	}

	.error-toast {
		position: absolute;
		bottom: 1rem;
		left: 50%;
		transform: translateX(-50%);
		background: #ff5555;
		color: #fff;
		padding: 0.5rem 1rem;
		border-radius: 4px;
		font-size: 0.8rem;
		box-shadow: 0 4px 6px rgba(0,0,0,0.3);
		z-index: 10;
		text-align: center;
		pointer-events: none;
		max-width: 90%;
		word-wrap: break-word;
	}

	.entries {
		flex: 1;
		overflow-y: auto;
	}

	.entry {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		background: transparent;
		border: none;
		border-left: 3px solid transparent;
		color: #ccc;
		text-align: left;
		cursor: pointer;
		transition: all 0.15s;
		content-visibility: auto;
		contain-intrinsic-size: 36px;
	}

	.entry:hover {
		background: #2a2a2a;
	}

	.entry.selected {
		background: #2d3a4f;
		border-left-color: #4a9eff;
		color: #fff;
	}

	.entry.directory {
		font-weight: 500;
	}

	.icon {
		font-size: 1rem;
		flex-shrink: 0;
	}

	.name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.size {
		font-size: 0.75rem;
		color: #666;
		flex-shrink: 0;
	}
</style>
