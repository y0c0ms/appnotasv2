<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { codeInsertRequested } from '$lib/stores/shortcuts';

	let isOpen = false;
	let code = '';
	let language = 'javascript';

	const languages = [
		'javascript',
		'typescript',
		'python',
		'rust',
		'html',
		'css',
		'json',
		'markdown',
		'bash',
		'sql'
	];

	// Listen for code insert requests from store
	$: if ($codeInsertRequested) {
		open();
	}

	// Listen for openCodeDialog custom event
	function handleOpenCodeDialog() {
		console.log('CodeInsertDialog: openCodeDialog event received');
		open();
	}

	onMount(() => {
		window.addEventListener('openCodeDialog', handleOpenCodeDialog);
	});

	onDestroy(() => {
		window.removeEventListener('openCodeDialog', handleOpenCodeDialog);
	});

	export function open() {
		console.log('CodeInsertDialog: Opening dialog');
		isOpen = true;
		code = '';
		language = 'javascript';
	}

	export function close() {
		isOpen = false;
		code = '';
	}

	function handleInsert() {
		if (!code.trim()) return;

		// Dispatch event with the code block
		const codeBlock = `\`\`\`${language}\n${code}\n\`\`\``;
		window.dispatchEvent(
			new CustomEvent('insertCodeBlock', {
				detail: { codeBlock }
			})
		);

		close();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			close();
		} else if (e.ctrlKey && e.key === 'Enter') {
			handleInsert();
		}
	}
</script>

{#if isOpen}
	<div class="modal-overlay" on:click={close}>
		<div class="modal-content" on:click|stopPropagation>
			<div class="modal-header">
				<h3>Insert Code Snippet</h3>
				<button class="close-btn" on:click={close}>×</button>
			</div>

			<div class="modal-body">
				<div class="language-selector">
					<label for="language">Language:</label>
					<select id="language" bind:value={language}>
						{#each languages as lang}
							<option value={lang}>{lang}</option>
						{/each}
					</select>
				</div>

				<textarea
					class="code-input"
					bind:value={code}
					on:keydown={handleKeydown}
					placeholder="Paste or type your code here...
Ctrl+Enter to insert"
					autofocus
				></textarea>
			</div>

			<div class="modal-footer">
				<button class="btn-secondary" on:click={close}>Cancel</button>
				<button class="btn-primary" on:click={handleInsert} disabled={!code.trim()}>
					Insert Code
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10000;
	}

	.modal-content {
		background: #1e1e1e;
		border-radius: 8px;
		width: 90%;
		max-width: 600px;
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid #3a3a3a;
	}

	.modal-header h3 {
		margin: 0;
		color: #fff;
		font-size: 1.25rem;
	}

	.close-btn {
		background: none;
		border: none;
		color: #999;
		font-size: 2rem;
		cursor: pointer;
		line-height: 1;
		padding: 0;
		width: 2rem;
		height: 2rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.close-btn:hover {
		color: #fff;
	}

	.modal-body {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		flex: 1;
		overflow: hidden;
	}

	.language-selector {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.language-selector label {
		color: #ccc;
		font-weight: 500;
	}

	.language-selector select {
		background: #2a2a2a;
		border: 1px solid #3a3a3a;
		color: #fff;
		padding: 0.5rem;
		border-radius: 4px;
		font-size: 0.9rem;
		cursor: pointer;
	}

	.language-selector select:focus {
		outline: none;
		border-color: #4a9eff;
	}

	.code-input {
		flex: 1;
		background: #0d1117;
		border: 1px solid #3a3a3a;
		border-radius: 4px;
		color: #ccc;
		padding: 1rem;
		font-family: 'Courier New', monospace;
		font-size: 0.9rem;
		line-height: 1.6;
		resize: none;
	}

	.code-input:focus {
		outline: none;
		border-color: #4a9eff;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		padding: 1rem 1.5rem;
		border-top: 1px solid #3a3a3a;
	}

	.btn-secondary,
	.btn-primary {
		padding: 0.5rem 1.25rem;
		border-radius: 4px;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
		border: none;
		transition: all 0.2s;
	}

	.btn-secondary {
		background: #2a2a2a;
		color: #ccc;
	}

	.btn-secondary:hover {
		background: #3a3a3a;
	}

	.btn-primary {
		background: #4a9eff;
		color: #fff;
	}

	.btn-primary:hover:not(:disabled) {
		background: #3a8eef;
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
