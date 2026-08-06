<script lang="ts">
	import { activeTab } from '$lib/stores/shortcuts';
	import NotesList from './NotesList.svelte';
	import FileTree from './FileTree.svelte';
	import TaskList from './TaskList.svelte';
	import { Notebook, Folder, ListTodo } from 'lucide-svelte';
	import { settingsStore } from '$lib/stores/settings';
	import ResizeHandle from './ResizeHandle.svelte';

	const MIN_WIDTH = 180;
	const MAX_WIDTH = 640;

	function setWidth(px: number) {
		const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px)));
		settingsStore.update(s => ({ ...s, sidebarWidth: clamped }));
	}
</script>

<div
	class="sidebar"
	class:collapsed={$settingsStore.sidebarCollapsed}
	style={$settingsStore.sidebarCollapsed ? undefined : `width: ${$settingsStore.sidebarWidth}px`}
>
	{#if !$settingsStore.sidebarCollapsed}
		<div class="tabs">
			<button 
				class="tab" 
				class:active={$activeTab === 'notes'} 
				onclick={() => ($activeTab = 'notes')}
			>
				<Notebook size={16} /> Notes
			</button>
			<button 
				class="tab" 
				class:active={$activeTab === 'files'} 
				onclick={() => ($activeTab = 'files')}
			>
				<Folder size={16} /> Files
			</button>
			<button 
				class="tab" 
				class:active={$activeTab === 'tasks'} 
				onclick={() => ($activeTab = 'tasks')}
			>
				<ListTodo size={16} /> Tasks
			</button>
		</div>

		<div class="tab-content">
			{#if $activeTab === 'notes'}
				<NotesList />
			{:else if $activeTab === 'files'}
				<FileTree />
			{:else}
				<TaskList />
			{/if}
		</div>

		<ResizeHandle
			edge="right"
			label="Resize sidebar"
			onmove={(clientX) => setWidth(clientX)}
			onstep={(delta) => setWidth($settingsStore.sidebarWidth + delta)}
			onend={() => settingsStore.save()}
		/>
	{/if}
</div>

<style>
	.sidebar {
		position: relative;
		width: 250px;
		height: 100vh;
		background: #09090b;
		border-right: 1px solid rgba(255, 255, 255, 0.05);
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
		overflow: hidden;
	}

	.sidebar.collapsed {
		width: 0px;
		border-right: none;
	}

	/* Removed focus-within to prevent double borders */

	.tabs {
		display: flex;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
	}

	.tab {
		flex: 1;
		padding: 0.75rem;
		background: transparent;
		border: none;
		color: #888;
		cursor: pointer;
		transition: all 0.15s;
		font-size: 0.75rem;
        font-weight: 500;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
	}

	.tab:hover {
		background: rgba(255, 255, 255, 0.02);
		color: #ccc;
	}

	.tab.active {
		background: rgba(255, 255, 255, 0.04);
		color: #4a9eff;
	}

	.tab-content {
		flex: 1;
		overflow: hidden;
	}
</style>
