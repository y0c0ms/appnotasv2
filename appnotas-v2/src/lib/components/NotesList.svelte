<script lang="ts">
	import { notesList, activeNoteId } from '$lib/stores/notes';
	import { focusArea } from '$lib/stores/focus';
	import type { Note } from '$lib/stores/notes';
	import { tick } from 'svelte';

	let selectedIndex = 0;
	let listContainer: HTMLElement;

	$: if ($activeNoteId && $notesList.length > 0) {
		const index = $notesList.findIndex(n => n.id === $activeNoteId);
		if (index !== -1) selectedIndex = index;
	}

	// Auto-focus container when focusArea switches to 'list'
	$: if ($focusArea === 'list' && listContainer) {
		tick().then(() => {
			if (document.activeElement !== listContainer) {
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
			selectedIndex = Math.min(selectedIndex + 1, $notesList.length - 1);
			await scrollToSelected();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
			await scrollToSelected();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const note = $notesList[selectedIndex];
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

<div 
	class="notes-list" 
	class:focused={$focusArea === 'list'}
	on:keydown={handleKeyDown}
	tabindex="0"
	role="listbox"
	aria-label="Notes List"
	bind:this={listContainer}
>
	{#if $notesList.length === 0}
		<div class="empty">No notes yet</div>
	{:else}
		{#each $notesList as note, i}
			<button
				class="note-item"
				class:active={$activeNoteId === note.id}
				class:selected={i === selectedIndex}
				on:click={() => {
					selectedIndex = i;
					selectNote(note);
				}}
			>
				<div class="note-title">{note.title}</div>
				<div class="note-preview">{note.content.slice(0, 50)}...</div>
			</button>
		{/each}
	{/if}
</div>

<style>
	.notes-list {
		height: 100%;
		overflow-y: auto;
	}

	.empty {
		padding: 2rem 1rem;
		text-align: center;
		color: #666;
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
	}

	.note-item:hover {
		background: #2a2a2a;
	}

	.note-item.active {
		background: #2a2a2a;
		border-left-color: #4a9eff;
	}

	.note-item.selected {
		background: #2a2a2a;
	}

	.notes-list.focused {
		outline: 2px solid #4a9eff;
		outline-offset: -2px;
	}

	.note-title {
		color: #fff;
		font-weight: 500;
		margin-bottom: 0.25rem;
	}

	.note-preview {
		font-size: 0.75rem;
		color: #888;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
