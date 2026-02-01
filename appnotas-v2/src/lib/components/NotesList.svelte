<script lang="ts">
	import { notesList, activeNoteId, filteredNotes, searchQuery, toggleNotePin } from '$lib/stores/notes';
	import { focusArea } from '$lib/stores/focus';
	import type { Note } from '$lib/stores/notes';
	import { tick } from 'svelte';

	let selectedIndex = 0;
	let listContainer: HTMLElement;
	let searchInput: HTMLInputElement;

	// Sort filtered notes: pinned first, then by updated_at (descending)
	$: sortedNotes = [...$filteredNotes].sort((a, b) => {
		if (a.pinned && !b.pinned) return -1;
		if (!a.pinned && b.pinned) return 1;
		// Secondary sort by date if needed, though filteredNotes might already be sorted
		return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
	});

	$: if ($activeNoteId && sortedNotes.length > 0) {
		const index = sortedNotes.findIndex(n => n.id === $activeNoteId);
		if (index !== -1) selectedIndex = index;
	}

	// Auto-focus container or search when focusArea switches to 'list'
	$: if ($focusArea === 'list' && listContainer) {
		tick().then(() => {
			if (document.activeElement !== listContainer && document.activeElement !== searchInput) {
				listContainer.focus({ preventScroll: true });
			}
		});
	}

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
</script>

<div class="notes-sidebar-container">
	<div class="search-box">
		<input 
			type="text" 
			placeholder="Search notes..." 
			bind:value={$searchQuery}
			bind:this={searchInput}
			on:focus={() => focusArea.set('list')}
		/>
	</div>

	<div 
		class="notes-list" 
		class:focused={$focusArea === 'list'}
		on:keydown={handleKeyDown}
		tabindex="0"
		role="listbox"
		aria-label="Notes List"
		bind:this={listContainer}
	>
		{#if sortedNotes.length === 0}
			<div class="empty">{$searchQuery ? 'No matches found' : 'No notes yet'}</div>
		{:else}
			{#each sortedNotes.slice(0, 100) as note, i}
				<div class="note-item-wrapper">
					<button
						class="note-item"
						class:active={$activeNoteId === note.id}
						class:pinned={note.pinned}
						class:selected={i === selectedIndex}
						on:click={() => {
							selectedIndex = i;
							selectNote(note);
						}}
					>
						<div class="note-header">
							<div class="note-title">{note.title || 'Untitled'}</div>
							{#if note.pinned}
								<span class="pin-icon">📌</span>
							{/if}
						</div>
						<div class="note-preview">{note.content.substring(0, 60)}</div>
					</button>
					<button 
						class="pin-toggle" 
						on:click|stopPropagation={() => toggleNotePin(note.id)}
						title={note.pinned ? "Unpin note" : "Pin note"}
					>
						{note.pinned ? '×' : '📌'}
					</button>
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
	}

	.search-box {
		padding: 0.5rem;
		border-bottom: 1px solid #2a2a2a;
	}

	.search-box input {
		width: 100%;
		padding: 0.4rem 0.6rem;
		background: #2a2a2a;
		border: 1px solid #3a3a3a;
		border-radius: 4px;
		color: #fff;
		font-size: 0.8rem;
	}

	.search-box input:focus {
		outline: none;
		border-color: #4a9eff;
        box-shadow: 0 0 10px rgba(74, 158, 255, 0.2);
	}

	.notes-list {
		flex: 1;
		overflow-y: auto;
		scrollbar-width: thin;
	}

	.note-item {
		width: 100%;
		padding: 0.75rem;
		background: transparent;
		border: none;
		border-left: 3px solid transparent;
		text-align: left;
		cursor: pointer;
		transition: background 0.1s;
		content-visibility: auto;
		contain-intrinsic-size: 60px;
	}

	.empty {
		padding: 2rem 1rem;
		text-align: center;
		color: #666;
	}

	.note-item-wrapper {
		position: relative;
		width: 100%;
	}

	.note-item {
		width: 100%;
		padding: 0.75rem;
		background: transparent;
		border: none;
		border-left: 3px solid transparent;
		text-align: left;
		cursor: pointer;
		transition: all 0.15s;
		padding-right: 2rem; /* Make room for pin toggle */
	}

	.note-item:hover {
		background: #2a2a2a;
	}

	.note-item.active {
		background: #2a2a2a;
		border-left-color: #4a9eff;
	}
	
	.note-item.pinned {
		background: rgba(74, 158, 255, 0.05); /* Subtle tint for pinned */
	}

	.note-item.selected {
		background: #2a2a2a;
	}

	.notes-list.focused {
		outline: 2px solid #4a9eff;
		outline-offset: -2px;
	}

	.note-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.25rem;
	}

	.note-title {
		color: #fff;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	
	.pin-icon {
		font-size: 0.8rem;
		opacity: 0.8;
	}

	.note-preview {
		font-size: 0.75rem;
		color: #888;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	
	.pin-toggle {
		position: absolute;
		right: 4px;
		top: 4px;
		background: transparent;
		color: #555;
		cursor: pointer;
		opacity: 0.3;
		transition: opacity 0.2s, color 0.2s, background 0.2s;
		padding: 6px;
		border-radius: 4px;
		font-size: 0.8rem;
	}
	
	.note-item-wrapper:hover .pin-toggle,
	.pin-toggle:focus {
		opacity: 1;
	}
	
	.pin-toggle:hover {
        opacity: 1;
		color: #4a9eff;
		background: rgba(255, 255, 255, 0.1);
	}
    
    .note-item.pinned .pin-toggle {
        opacity: 1;
        color: #4a9eff;
    }
</style>
