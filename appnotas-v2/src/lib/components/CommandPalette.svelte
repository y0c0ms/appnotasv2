<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';

	const dispatch = createEventDispatcher();

	const commands = [
		{ id: 'code', label: '@code', description: 'Insert code snippet', icon: '📝' },
		{ id: 'file', label: '@file', description: 'Link to a file', icon: '📁' },
		{ id: 'tasks', label: '@tasks', description: 'Insert checklist', icon: '✅' },
		{ id: 'image', label: '@image', description: 'Insert image', icon: '🖼️' },
		{ id: 'drawing', label: '@drawing', description: 'Insert drawing', icon: '🎨' },
		{ id: 'style', label: '@style', description: 'Toggle editor formatting menus', icon: '✨' }
	];

	let searchQuery = '';
	let selectedIndex = 0;
	let inputElement: HTMLInputElement;

	$: filteredCommands = commands.filter(cmd => 
		cmd.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
		cmd.description.toLowerCase().includes(searchQuery.toLowerCase())
	);

	$: {
		if (selectedIndex >= filteredCommands.length) {
			selectedIndex = Math.max(0, filteredCommands.length - 1);
		}
	}

	onMount(() => {
		inputElement?.focus();
	});

	function selectCommand(commandId: string) {
		console.log('Command selected:', commandId);
		
		if (commandId === 'code') {
			dispatch('openCodeDialog');
		} else if (commandId === 'file') {
			dispatch('openFileDialog');
		} else if (commandId === 'list' || commandId === 'tasks') {
			dispatch('openDialog', { id: 'tasks' });
		} else if (commandId === 'image') {
			dispatch('openDialog', { id: 'image' });
		} else if (commandId === 'drawing') {
			dispatch('openDialog', { id: 'drawing' });
		} else if (commandId === 'style') {
			dispatch('openDialog', { id: 'style' });
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (filteredCommands.length === 0) {
			if (e.key === 'Escape') dispatch('close');
			return;
		}
		
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = (selectedIndex + 1) % filteredCommands.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = (selectedIndex - 1 + filteredCommands.length) % filteredCommands.length;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (filteredCommands[selectedIndex]) {
				selectCommand(filteredCommands[selectedIndex].id);
			}
		} else if (e.key === 'Escape') {
			dispatch('close');
		}
	}
</script>

<div class="command-palette">
	<div class="palette-header">
		<input
			bind:this={inputElement}
			bind:value={searchQuery}
			on:keydown={handleKeyDown}
			placeholder="Search commands... (e.g. @code)"
			class="search-input"
		/>
	</div>
	<div class="command-list">
		{#each filteredCommands as command, i}
			<button 
				class="command-item" 
				class:selected={i === selectedIndex}
				on:click={() => selectCommand(command.id)}
				on:mouseenter={() => selectedIndex = i}
			>
				<span class="command-icon">{command.icon}</span>
				<div class="command-text">
					<div class="command-label">{command.label}</div>
					<div class="command-description">{command.description}</div>
				</div>
			</button>
		{/each}
		{#if filteredCommands.length === 0}
			<div class="no-results">No commands found</div>
		{/if}
	</div>
</div>

<style>
	.command-palette {
		background: #2a2a2a;
		border-radius: 12px;
		overflow: hidden;
		min-width: 400px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
		border: 1px solid #3a3a3a;
	}

	.palette-header {
		padding: 0.5rem;
		background: #1a1a1a;
		border-bottom: 1px solid #3a3a3a;
	}

	.search-input {
		width: 100%;
		padding: 0.75rem 1rem;
		background: transparent;
		border: none;
		outline: none;
		color: #fff;
		font-size: 1rem;
		font-family: inherit;
	}

	.command-list {
		padding: 0.5rem;
		max-height: 400px;
		overflow-y: auto;
	}

	.command-item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: transparent;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		text-align: left;
		color: #ccc;
		transition: all 0.2s;
	}

	.command-item.selected {
		background: #4a9eff;
		color: #fff;
	}

	.command-item.selected .command-label {
		color: #fff;
	}

	.command-item.selected .command-description {
		color: rgba(255, 255, 255, 0.8);
	}

	.command-icon {
		font-size: 1.5rem;
		min-width: 2rem;
		display: flex;
		justify-content: center;
	}

	.command-text {
		flex: 1;
	}

	.command-label {
		font-weight: 600;
		color: #fff;
		margin-bottom: 0.15rem;
	}

	.command-description {
		font-size: 0.85rem;
		color: #999;
	}

	.no-results {
		padding: 2rem;
		text-align: center;
		color: #666;
		font-style: italic;
	}
</style>
