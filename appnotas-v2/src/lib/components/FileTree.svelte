<script lang="ts">
	import { openFiles, currentDirectory, activeFile, terminalCommandBus, terminalVisible } from '$lib/stores/files';
	import { focusArea } from '$lib/stores/focus';
	import { invoke, convertFileSrc } from '@tauri-apps/api/core';
	import { detectLanguage } from '$lib/utils/files';
	import { tick, onMount } from 'svelte';
    import { homeDir } from '@tauri-apps/api/path';
	import { Folder, FileText, Search } from 'lucide-svelte';

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

	interface FileSearchHit {
		path: string;
		name: string;
		is_dir: boolean;
		name_match: boolean;
		line_number: number | null;
		snippet: string;
		match_count: number;
	}

	interface DisplayItem {
		name: string;
		path: string;
		is_dir: boolean;
		detail: string;   // size (browse mode) or relative path (search mode)
		snippet: string;  // matching line (content hits only)
		line: number | null;
	}

	let searchResults = $state<FileSearchHit[]>([]);
	let searching = $state(false);
	let searchSeq = 0;

	// Path shown under a result, relative to the current directory.
	function relativeLabel(dir: string | null, full: string): string {
		if (!dir) return full;
		const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '');
		const d = norm(dir);
		const f = norm(full);
		return f.startsWith(d + '/') ? f.slice(d.length + 1) : full;
	}

	// "Super search": filename + content, recursively, via Rust. Debounced.
	// 1-char queries fall back to a fast local filename filter of the current dir.
	$effect(() => {
		const q = searchQuery.trim();
		const dir = $currentDirectory;
		if (q.length < 2 || !dir) {
			searchResults = [];
			searching = false;
			return;
		}
		const seq = ++searchSeq;
		searching = true;
		const timer = setTimeout(async () => {
			try {
				const res = await invoke<FileSearchHit[]>('search_files', { directory: dir, query: q });
				if (seq === searchSeq) searchResults = res;
			} catch (e) {
				if (seq === searchSeq) { searchResults = []; console.error('File search failed:', e); }
			} finally {
				if (seq === searchSeq) searching = false;
			}
		}, 200);
		return () => clearTimeout(timer);
	});

	// Unified list the UI renders and the keyboard navigates.
	let displayItems = $derived.by<DisplayItem[]>(() => {
		const q = searchQuery.trim();
		if (!q) {
			return entries.map(e => ({
				name: e.name, path: e.path, is_dir: e.is_dir,
				detail: e.is_dir ? '' : formatSize(e.size), snippet: '', line: null
			}));
		}
		if (q.length < 2) {
			const lc = q.toLowerCase();
			return entries.filter(e => e.name.toLowerCase().includes(lc)).map(e => ({
				name: e.name, path: e.path, is_dir: e.is_dir,
				detail: e.is_dir ? '' : formatSize(e.size), snippet: '', line: null
			}));
		}
		return searchResults.map(h => ({
			name: h.name, path: h.path, is_dir: h.is_dir,
			detail: relativeLabel($currentDirectory, h.path),
			snippet: h.snippet, line: h.line_number
		}));
	});

	// Keep the selection in range as the displayed list changes.
	$effect(() => {
		if (selectedIndex >= displayItems.length) selectedIndex = Math.max(0, displayItems.length - 1);
	});

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
                // contains() so focus on a child entry isn't stolen by the container
                if (treeContainer && !treeContainer.contains(document.activeElement)) {
                    treeContainer.focus({ preventScroll: true });
                }
            });
        }
    });

    $effect(() => {
        if (treeContainer && displayItems.length > 0) {
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

	async function handleClick(entry: { name: string; path: string; is_dir: boolean }, index: number) {
		selectedIndex = index;
		await openEntry(entry);
	}

	async function openEntry(entry: { name: string; path: string; is_dir: boolean }) {
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
		if (displayItems.length === 0) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, displayItems.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			openEntry(displayItems[selectedIndex]);
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

	<div class="search-box">
		<div class="search-icon-wrapper">
			<Search size={14} color="#888" />
		</div>
		<input
			type="text"
			class:focused={$focusArea === 'file-search'}
			placeholder="Search files & contents..."
			data-focus-area="file-search"
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
		data-focus-area="list"
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
				{#each displayItems as item, i}
					<button
						class="entry"
						class:directory={item.is_dir}
						class:selected={i === selectedIndex}
						class:has-snippet={!!item.snippet}
						onclick={() => handleClick(item, i)}
						onmouseenter={() => (selectedIndex = i)}
					>
						{#if item.is_dir}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<span class="icon folder-icon-action" title="Open in Terminal" onclick={(e) => {
								e.stopPropagation();
								if ($terminalVisible) {
									$terminalCommandBus = `cd "${item.path}"\r`;
								} else {
									openEntry(item);
								}
							}}>
								<Folder size={14} color="#888" />
							</span>
						{:else}
							<span class="icon">
								<FileText size={14} color="#666" />
							</span>
						{/if}
						<span class="entry-text">
							<span class="entry-row">
								<span class="name">{item.name}</span>
								{#if item.detail}
									<span class="detail">{item.detail}{#if item.line}:{item.line}{/if}</span>
								{/if}
							</span>
							{#if item.snippet}
								<span class="snippet">{item.snippet}</span>
							{/if}
						</span>
					</button>
				{/each}
				{#if searching && displayItems.length === 0}
					<div class="no-results">Searching…</div>
				{:else if displayItems.length === 0 && searchQuery}
					<div class="no-results">No files or contents match "{searchQuery}"</div>
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
		background: #09090b;
		gap: 2px;
	}

	.current-path {
		padding: 0.5rem;
		font-size: 0.75rem;
		color: #888;
		background: #09090b;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
	}

	/* Search Container */
	.search-box {
		padding: 0.5rem;
		background: #09090b;
		border: 2px solid transparent;
		transition: border-color 0.15s ease;
		box-sizing: border-box;
		position: relative;
	}

	.search-icon-wrapper {
		position: absolute;
		left: 1rem;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
	}

	.search-box input {
		width: 100%;
		padding: 0.4rem 2.2rem 0.4rem 2rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: 6px;
		color: #fff;
		font-size: 0.8rem;
		outline: none;
		transition: border-color 0.15s ease, box-shadow 0.15s ease;
		box-sizing: border-box;
	}

	.search-box input::placeholder {
		color: #666;
	}

	.search-box input:focus,
	.search-box input.focused {
		border-color: #4a9eff;
		box-shadow: 0 0 0 2px rgba(74, 158, 255, 0.3);
	}

	.file-list {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		outline: none;
		background: #09090b;
		border: 2px solid transparent;
		transition: border-color 0.15s ease;
		box-sizing: border-box;
	}

	.file-list.focused {
		border-color: #4a9eff;
	}

	.clear-search {
		position: absolute;
		right: 1.25rem;
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
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.folder-icon-action {
		padding: 2px;
		border-radius: 6px;
		transition: all 0.15s ease;
		background: transparent;
	}

	.folder-icon-action:hover {
		background: rgba(255, 255, 255, 0.15);
		cursor: pointer;
	}

	.entry-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow: hidden;
	}

	.entry-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.entry.has-snippet {
		align-items: flex-start;
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.detail {
		font-size: 0.7rem;
		color: #666;
		flex-shrink: 0;
		margin-left: auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 55%;
	}

	.snippet {
		font-size: 0.72rem;
		color: #8a8a8a;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
