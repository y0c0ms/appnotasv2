<script lang="ts">
	import NotesList from './NotesList.svelte';
	import FileTree from './FileTree.svelte';

	let activeTab: 'notes' | 'files' = 'notes';
</script>

<div class="sidebar">
	<div class="tabs">
		<button class="tab" class:active={activeTab === 'notes'} on:click={() => (activeTab = 'notes')}>
			📝 Notes
		</button>
		<button class="tab" class:active={activeTab === 'files'} on:click={() => (activeTab = 'files')}>
			📁 Files
		</button>
	</div>

	<div class="tab-content">
		{#if activeTab === 'notes'}
			<NotesList />
		{:else}
			<FileTree />
		{/if}
	</div>
</div>

<style>
	.sidebar {
		width: 250px;
		height: 100vh;
		background: #1a1a1a;
		border-right: 1px solid #2a2a2a;
		display: flex;
		flex-direction: column;
	}

	.tabs {
		display: flex;
		border-bottom: 1px solid #2a2a2a;
	}

	.tab {
		flex: 1;
		padding: 0.75rem;
		background: transparent;
		border: none;
		color: #888;
		cursor: pointer;
		transition: all 0.15s;
		font-size: 0.875rem;
	}

	.tab:hover {
		background: #2a2a2a;
		color: #ccc;
	}

	.tab.active {
		background: #2a2a2a;
		color: #4a9eff;
		border-bottom: 2px solid #4a9eff;
	}

	.tab-content {
		flex: 1;
		overflow: hidden;
	}
</style>
