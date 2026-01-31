<script lang="ts">
	import { codeInsertRequested, fileInsertRequested } from '$lib/stores/shortcuts';

	let isOpen = false;
	let selectedCommand: 'code' | 'file' | null = null;

	const commands = [
		{ id: 'code', label: '@code', description: 'Insert code snippet', icon: '📝' },
		{ id: 'file', label: '@file', description: 'Link to a file', icon: '📁' }
	];

	// Listen for command palette requests
	$: if ($codeInsertRequested && !isOpen) {
		open();
	}

	export function open() {
		isOpen = true;
		selectedCommand = null;
	}

	export function close() {
		isOpen = false;
		selectedCommand = null;
	}

	function selectCommand(commandId: 'code' | 'file') {
		selectedCommand = commandId;
		close();

		// Trigger the appropriate action
		if (commandId === 'code') {
			window.dispatchEvent(new CustomEvent('openCodeDialog'));
		} else if (commandId === 'file') {
			window.dispatchEvent(new CustomEvent('openFileDialog'));
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			close();
		}
	}
</script>

{#if isOpen}
	<div class="command-palette" on:keydown={handleKeydown}>
		<div class="command-list">
			{#each commands as command}
				<button class="command-item" on:click={() => selectCommand(command.id as 'code' | 'file')}>
					<span class="command-icon">{command.icon}</span>
					<div class="command-text">
						<div class="command-label">{command.label}</div>
						<div class="command-description">{command.description}</div>
					</div>
				</button>
			{/each}
		</div>
	</div>
{/if}

<style>
	.command-palette {
		position: absolute;
		bottom: 100%;
		left: 0;
		margin-bottom: 0.5rem;
		background: #2a2a2a;
		border: 1px solid #3a3a3a;
		border-radius: 6px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		z-index: 1000;
		min-width: 200px;
	}

	.command-list {
		padding: 0.25rem;
	}

	.command-item {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		background: transparent;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		text-align: left;
		color: #ccc;
		transition: background 0.2s;
	}

	.command-item:hover {
		background: #3a3a3a;
	}

	.command-icon {
		font-size: 1.25rem;
	}

	.command-text {
		flex: 1;
	}

	.command-label {
		font-weight: 500;
		color: #fff;
		margin-bottom: 0.15rem;
	}

	.command-description {
		font-size: 0.85rem;
		color: #999;
	}
</style>
