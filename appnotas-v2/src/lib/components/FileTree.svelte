<script lang="ts">
	import { openFiles, currentDirectory, activeFile } from '$lib/stores/files';
	import { invoke } from '@tauri-apps/api/core';
	import { detectLanguage } from '$lib/utils/files';

	interface FileEntry {
		name: string;
		path: string;
		is_dir: boolean;
		size: number | null;
	}

	let entries: FileEntry[] = [];
	let loading = false;
	let error = '';
	let selectedIndex = 0;

	$: if ($currentDirectory) {
		loadDirectory($currentDirectory);
	}

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
			try {
				const content = await invoke<string>('read_file', { path: entry.path });
				console.log('File content loaded, length:', content.length);
				
				const newFile = {
					path: entry.path,
					content,
					modified: false,
					language: detectLanguage(entry.name)
				};
				
				openFiles.update((files) => {
					// Don't duplicate if already open
					if (files.some(f => f.path === entry.path)) {
						return files;
					}
					return [...files, newFile];
				});
				
				activeFile.set(newFile);
			} catch (e) {
				error = `Failed to open file: ${e}`;
				console.error('Failed to open file:', e);
			}
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
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
	import { onMount } from 'svelte';
	onMount(() => {
		if (!$currentDirectory) {
			const homeDir = 'C:\\Users\\Utilizador';
			currentDirectory.set(homeDir);
		}
	});
</script>

<div class="file-tree" on:keydown={handleKeyDown} tabindex="0">
	<div class="current-path">
		{$currentDirectory || 'No directory'}
	</div>

	<div class="keyboard-hint">
		<kbd>↑↓</kbd> Navigate • <kbd>Enter</kbd> Open • <kbd>Backspace</kbd> Up
	</div>

	{#if loading}
		<div class="loading">Loading...</div>
	{:else if error}
		<div class="error">{error}</div>
	{:else}
		<div class="entries">
			{#each entries as entry, i}
				<button
					class="entry"
					class:directory={entry.is_dir}
					class:selected={i === selectedIndex}
					on:click={() => handleClick(entry, i)}
					on:mouseenter={() => (selectedIndex = i)}
				>
					<span class="icon">{entry.is_dir ? '📁' : '📄'}</span>
					<span class="name">{entry.name}</span>
					{#if !entry.is_dir && entry.size}
						<span class="size">{formatSize(entry.size)}</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.file-tree {
		height: 100%;
		display: flex;
		flex-direction: column;
		background: #1a1a1a;
		outline: none;
	}

	.file-tree:focus {
		outline: 2px solid #4a9eff;
		outline-offset: -2px;
	}

	.current-path {
		padding: 0.5rem;
		font-size: 0.75rem;
		color: #888;
		border-bottom: 1px solid #2a2a2a;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.keyboard-hint {
		padding: 0.5rem;
		font-size: 0.7rem;
		color: #666;
		border-bottom: 1px solid #2a2a2a;
		text-align: center;
	}

	.keyboard-hint kbd {
		background: #2a2a2a;
		padding: 0.125rem 0.25rem;
		border-radius: 2px;
		font-size: 0.65rem;
		color: #4a9eff;
	}

	.loading,
	.error {
		padding: 1rem;
		text-align: center;
		color: #888;
	}

	.error {
		color: #ff5555;
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
	}

	.entry:hover {
		background: #2a2a2a;
	}

	.entry.selected {
		background: #2a2a2a;
		border-left-color: #4a9eff;
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
