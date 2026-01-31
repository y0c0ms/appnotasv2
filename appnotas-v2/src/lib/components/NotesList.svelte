<script lang="ts">
	import { notesList, activeNoteId } from '$lib/stores/notes';
	import type { Note } from '$lib/stores/notes';

	function selectNote(note: Note) {
		activeNoteId.set(note.id);
	}
</script>

<div class="notes-list">
	{#if $notesList.length === 0}
		<div class="empty">No notes yet</div>
	{:else}
		{#each $notesList as note}
			<button
				class="note-item"
				class:active={$activeNoteId === note.id}
				on:click={() => selectNote(note)}
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
