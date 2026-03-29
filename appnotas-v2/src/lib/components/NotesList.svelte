<script lang="ts">
	import { notesList, activeNoteId, filteredNotes, searchQuery, toggleNotePin, deleteNoteFile } from '$lib/stores/notes';
	import { focusArea } from '$lib/stores/focus';
	import type { Note } from '$lib/stores/notes';
	import { tick } from 'svelte';
	import { Search, Pin, Trash2 } from 'lucide-svelte';

	let selectedIndex = $state(0);
	let listContainer = $state<HTMLElement>();
	let searchInput = $state<HTMLInputElement>();

	// Sort filtered notes: pinned first, then by updated_at (descending)
    // Note: $filteredNotes is a store value, so we use $derived to track it.
	let sortedNotes = $derived([...$filteredNotes].sort((a, b) => {
		if (a.pinned && !b.pinned) return -1;
		if (!a.pinned && b.pinned) return 1;
		// Secondary sort by date if needed, though filteredNotes might already be sorted
		return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
	}));

    $effect(() => {
        if ($activeNoteId && sortedNotes.length > 0) {
            const index = sortedNotes.findIndex(n => n.id === $activeNoteId);
            if (index !== -1) selectedIndex = index;
        }
    });

	// Auto-focus search input when focusArea is 'note-search'
    $effect(() => {
        if ($focusArea === 'note-search' && searchInput) {
            tick().then(() => {
                if (searchInput && document.activeElement !== searchInput) {
                    searchInput.focus();
                }
            });
        }
    });

	// Auto-focus container when focusArea switches to 'list'
    $effect(() => {
        if ($focusArea === 'list' && listContainer) {
            tick().then(() => {
                if (listContainer && document.activeElement !== listContainer && document.activeElement !== searchInput) {
                    listContainer.focus({ preventScroll: true });
                }
            });
        }
    });

	function selectNote(note: Note) {
		activeNoteId.set(note.id);
	}

	async function handleKeyDown(e: KeyboardEvent) {
		if ($focusArea !== 'list') return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, sortedNotes.length - 1);
			await scrollToSelected();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
			await scrollToSelected();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const note = sortedNotes[selectedIndex];
			if (note) selectNote(note);
		}
	}

	async function scrollToSelected() {
		await tick();
		if (!listContainer) return;
		const selected = listContainer.querySelector('.note-item.selected') as HTMLElement;
		if (selected) {
			selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		}
	}

	async function handleDelete(e: MouseEvent, note: Note) {
		e.stopPropagation();
		if (confirm(`Are you sure you want to delete "${note.title || 'Untitled'}"?`)) {
			await deleteNoteFile(note.id);
			if ($activeNoteId === note.id) activeNoteId.set(null);
		}
	}

	function handlePin(e: MouseEvent, note: Note) {
		e.stopPropagation();
		toggleNotePin(note.id);
	}
</script>

<div class="notes-sidebar-container">
	<div class="search-box">
		<div class="search-icon-wrapper">
			<Search size={14} color="#888" />
		</div>
		<input 
			type="text" 
			class:focused={$focusArea === 'note-search'}
			placeholder="Search notes..." 
			bind:value={$searchQuery}
			bind:this={searchInput}
			onfocus={() => focusArea.set('note-search')}
			onkeydown={(e) => {
                e.stopPropagation(); // Stop propagation if intended
				if (e.key === 'Escape') {
					searchQuery.set('');
					focusArea.set('list');
					listContainer?.focus();
				} else if (e.key === 'ArrowDown' || e.key === 'Enter') {
					e.preventDefault();
					focusArea.set('list');
					listContainer?.focus();
				}
			}}
		/>
	</div>

	<div 
		class="notes-list" 
		class:focused={$focusArea === 'list'}
		onkeydown={handleKeyDown}
		tabindex="0"
		role="listbox"
		aria-label="Notes List"
		bind:this={listContainer}
	>
		{#if sortedNotes.length === 0}
			<div class="empty">{$searchQuery ? 'No matches found' : 'No notes yet'}</div>
		{:else}
		{#each sortedNotes as note, i}
			<div class="note-item-wrapper">
				<button 
					class="note-item"
					class:active={$activeNoteId === note.id}
					class:selected={i === selectedIndex}
                    class:pinned={note.pinned}
					onclick={() => {
						selectedIndex = i;
						selectNote(note);
					}}
				>
					<div class="item-main">
						<div class="item-title-row">
							<div class="item-title">{note.title || 'Untitled'}</div>
							{#if note.pinned}
								<span class="pinned-indicator" title="Pinned Note"><Pin size={10} /></span>
							{/if}
						</div>
						<div class="item-meta">
							{new Date(note.updated_at).toLocaleDateString()}
						</div>
					</div>
				</button>

				<div class="item-actions">
					<button 
						class="action-btn pin-btn" 
						class:active={note.pinned}
						onclick={(e) => handlePin(e, note)}
						title={note.pinned ? "Unpin Note" : "Pin Note"}
					>
						<Pin size={14} />
					</button>
					<button 
						class="action-btn delete-btn" 
						onclick={(e) => handleDelete(e, note)}
						title="Delete Note"
					>
						<Trash2 size={14} />
					</button>
				</div>
			</div>
		{/each}
		{#if sortedNotes.length > 100}
			<div class="more-indicator">Showing top 100 results...</div>
		{/if}
	{/if}
</div>
</div>

<style>
	.notes-sidebar-container {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: #09090b;
		gap: 2px;
	}

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
		padding: 0.4rem 0.6rem 0.4rem 2rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: 6px;
		color: #fff;
		font-size: 0.8rem;
		outline: none;
		transition: border-color 0.15s ease, box-shadow 0.15s ease;
		box-sizing: border-box;
	}

	.search-box input:focus,
	.search-box input.focused {
		border-color: #4a9eff;
		box-shadow: 0 0 0 2px rgba(74, 158, 255, 0.3);
	}

	/* NOTES LIST */
	.notes-list {
		flex: 1;
		overflow-y: auto;
		scrollbar-width: thin;
		padding: 0.3rem;
		box-sizing: border-box;
		outline: none;
	}

	.note-item-wrapper {
		position: relative;
		margin-bottom: 2px;
	}

	.note-item {
		width: 100%;
		padding: 0.6rem 0.8rem;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		text-align: left;
		cursor: pointer;
		transition: all 0.15s ease;
		display: flex;
		align-items: center;
		justify-content: space-between;
		box-sizing: border-box;
	}

	.note-item:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.note-item.selected {
		border-color: rgba(74, 158, 255, 0.2);
		background: rgba(74, 158, 255, 0.03);
	}

	.note-item.active {
		background: rgba(74, 158, 255, 0.08);
		border-color: rgba(74, 158, 255, 0.2);
	}

	.item-main {
		flex: 1;
		min-width: 0;
	}

	.item-title-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.2rem;
	}

	.item-title {
		font-size: 0.85rem;
		font-weight: 500;
		color: #ddd;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.active .item-title {
		color: #fff;
	}

	.pinned-indicator {
		color: #4a9eff;
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.item-meta {
		font-size: 0.7rem;
		color: #666;
	}

	/* ACTIONS */
	.item-actions {
		position: absolute;
		right: 0.5rem;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		gap: 0.25rem;
		opacity: 0;
		transition: opacity 0.15s ease;
		pointer-events: none;
	}

	.note-item-wrapper:hover .item-actions {
		opacity: 1;
		pointer-events: all;
	}

	.action-btn {
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #1a1a1a;
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: 4px;
		color: #888;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.action-btn:hover {
		background: #2a2a2a;
		color: #fff;
	}

	.pin-btn.active {
		color: #4a9eff;
		background: rgba(74, 158, 255, 0.1);
		border-color: rgba(74, 158, 255, 0.2);
	}

	.delete-btn:hover {
		color: #ff5c5c;
		background: rgba(255, 92, 92, 0.1);
		border-color: rgba(255, 92, 92, 0.2);
	}

	.more-indicator {
		padding: 0.75rem;
		text-align: center;
		font-size: 0.75rem;
		color: #444;
	}

	.empty {
		padding: 2rem 1rem;
		text-align: center;
		color: #555;
	}
</style>
