<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { open } from '@tauri-apps/plugin-dialog';
	import { marked } from 'marked';
	import { settingsStore } from '$lib/stores/settings';
	import { 
		localChatStore, 
		type ChatSession, 
		type ChatMessage 
	} from '$lib/stores/localChatStore';
	import { 
		Bot, 
		Image as ImageIcon, 
		Clipboard, 
		Send, 
		Copy, 
		Check, 
		RefreshCw, 
		Plus, 
		Trash2, 
		Sparkles,
		FileText,
		History
	} from 'lucide-svelte';

	/** A send parked while another turn is streaming; the model is captured at
	 *  enqueue time so switching models mid-stream doesn't retarget it. */
	interface QueuedSend {
		prompt: string;
		ocr: string;
		model: string;
	}

	let models = $state<string[]>([]);
	let selectedModel = $state<string>('qwen-coder-7b:latest');
	let userInput = $state<string>('');
	let isOcrLoading = $state<boolean>(false);
	let currentOcrText = $state<string>('');
	let sendQueue = $state<QueuedSend[]>([]);
	let copiedIndex = $state<number | null>(null);
	let statusText = $state<string>('Ready');
	let showHistoryMenu = $state<boolean>(false);
	let chatContainer = $state<HTMLDivElement | null>(null);

	const sessions = localChatStore.sessions;
	const activeId = localChatStore.activeId;
	const isStreaming = localChatStore.isStreaming;

	let currentSession = $derived<ChatSession | undefined>(
		$sessions.find(s => s.id === $activeId) || $sessions[0]
	);

	let currentMessages = $derived<ChatMessage[]>(
		currentSession?.messages || []
	);

	onMount(() => {
		fetchModels();
		scrollToBottom();
	});

	$effect(() => {
		if (currentMessages.length > 0) {
			tick().then(scrollToBottom);
		}
	});

	function scrollToBottom() {
		if (chatContainer) {
			chatContainer.scrollTop = chatContainer.scrollHeight;
		}
	}

	async function fetchModels() {
		try {
			statusText = 'Fetching Ollama models...';
			const fetched = await invoke<string[]>('list_ollama_models');
			if (fetched && fetched.length > 0) {
				models = fetched;
				if (currentSession && models.includes(currentSession.model)) {
					selectedModel = currentSession.model;
				} else {
					selectedModel = models[0];
				}
				statusText = `Loaded ${models.length} model(s).`;
			} else {
				models = ['qwen-coder-7b:latest', 'llama3.2-3b:latest'];
				statusText = 'Ollama offline or no models found.';
			}
		} catch (err: unknown) {
			models = ['qwen-coder-7b:latest', 'llama3.2-3b:latest'];
			statusText = 'Could not fetch Ollama models.';
		}
	}

	async function handleClipboardOcr() {
		try {
			isOcrLoading = true;
			statusText = 'Processing clipboard image...';
			console.info('🖼️ [OCR] Reading image from Windows clipboard...');
			const extracted = await invoke<string>('run_ocr', { imagePath: null });
			if (!extracted || extracted.trim() === '') {
				statusText = 'No text detected in clipboard.';
				console.warn('🖼️ [OCR] No text detected in clipboard image.');
			} else {
				currentOcrText = extracted;
				statusText = 'OCR completed successfully.';
				console.info(`🖼️ [OCR Success] Extracted ${extracted.length} characters.`);
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			statusText = `OCR Error: ${msg}`;
			console.error(`🖼️ [OCR Error] ${msg}`);
		} finally {
			isOcrLoading = false;
		}
	}

	async function handleFileOcr() {
		try {
			const selected = await open({
				multiple: false,
				filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
			});
			if (!selected || typeof selected !== 'string') return;

			isOcrLoading = true;
			statusText = `Processing ${selected}...`;
			console.info(`🖼️ [OCR] Processing image file: ${selected}`);
			const extracted = await invoke<string>('run_ocr', { imagePath: selected });
			if (!extracted || extracted.trim() === '') {
				statusText = 'No text detected in image.';
				console.warn(`🖼️ [OCR] No text detected in ${selected}`);
			} else {
				currentOcrText = extracted;
				statusText = 'OCR completed successfully.';
				console.info(`🖼️ [OCR Success] Extracted ${extracted.length} characters from ${selected}.`);
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			statusText = `OCR Error: ${msg}`;
			console.error(`🖼️ [OCR Error] ${msg}`);
		} finally {
			isOcrLoading = false;
		}
	}

	async function sendMessage() {
		if (!userInput.trim() && !currentOcrText) return;

		const item: QueuedSend = {
			prompt: userInput.trim(),
			ocr: currentOcrText,
			model: selectedModel
		};

		userInput = '';
		currentOcrText = '';

		// A turn is already in flight: park this one instead of dropping it. The
		// running turn drains the queue when it finishes.
		if ($isStreaming) {
			sendQueue = [...sendQueue, item];
			statusText = `Queued ${sendQueue.length} message(s) — sending after the current answer.`;
			return;
		}

		await runSend(item);
	}

	async function runSend(item: QueuedSend) {
		if (!currentSession) {
			localChatStore.createSession(item.model);
		}

		statusText = `Streaming response from ${item.model}...`;
		await localChatStore.streamOllamaChat($activeId, item.model, item.prompt, item.ocr);

		const next = sendQueue[0];
		if (next) {
			sendQueue = sendQueue.slice(1);
			await runSend(next);
			return;
		}

		statusText = 'Ready.';
	}

	function copyToClipboard(text: string, index: number) {
		navigator.clipboard.writeText(text);
		copiedIndex = index;
		setTimeout(() => {
			if (copiedIndex === index) copiedIndex = null;
		}, 2000);
	}

	function renderMarkdown(content: string): string {
		if (!content) return '';
		try {
			return marked.parse(content, { gfm: true, breaks: true }) as string;
		} catch (e) {
			return content;
		}
	}

	function handleNewChat() {
		localChatStore.createSession(selectedModel);
		showHistoryMenu = false;
		currentOcrText = '';
		statusText = 'Started new chat.';
	}

	function selectChat(id: string) {
		activeId.set(id);
		showHistoryMenu = false;
	}

	function deleteChat(id: string, e: MouseEvent) {
		e.stopPropagation();
		localChatStore.deleteSession(id);
	}
</script>

<!-- Every size inside the panel is in `em`, so this one declaration sets the
     panel's scale and makes it follow Ctrl+= / Ctrl+- like the editor does.
     1.2rem base * the 0.73em message rule ≈ 14px of body text, matching the
     note editor instead of the ~9px the old 0.8rem base produced. -->
<div class="models-panel" style={`font-size: ${1.2 * ($settingsStore.zoomLevel || 1)}rem`}>
	<!-- Top Bar / Model & History Selector -->
	<div class="header">
		<div class="model-select-wrapper">
			<Bot size={14} class="icon-bot" />
			<select bind:value={selectedModel} class="model-select">
				{#each models as m}
					<option value={m}>{m}</option>
				{/each}
			</select>
			<button class="btn-icon" onclick={fetchModels} title="Refresh models">
				<RefreshCw size={12} class={$isStreaming ? 'spin' : ''} />
			</button>
		</div>

		<div class="header-actions">
			<button 
				class="btn-icon" 
				class:active={showHistoryMenu} 
				onclick={() => (showHistoryMenu = !showHistoryMenu)} 
				title="History"
			>
				<History size={13} />
			</button>
			<button class="btn-icon" onclick={handleNewChat} title="New Chat">
				<Plus size={13} />
			</button>
		</div>
	</div>

	<!-- Chat Sessions History Dropdown Drawer -->
	{#if showHistoryMenu}
		<div class="history-drawer">
			<div class="history-header">
				<span>Chat History ({$sessions.length})</span>
				<button class="new-chat-btn" onclick={handleNewChat}>
					<Plus size={11} /> New
				</button>
			</div>
			<div class="history-list">
				{#each $sessions as sess}
					<div 
						role="button"
						tabindex="0"
						class="history-item" 
						class:active={sess.id === $activeId} 
						onclick={() => selectChat(sess.id)}
						onkeydown={(e) => { if (e.key === 'Enter') selectChat(sess.id); }}
					>
						<span class="history-title">{sess.title}</span>
						<button type="button" class="del-sess-btn" onclick={(e) => deleteChat(sess.id, e)} title="Delete chat">
							<Trash2 size={11} />
						</button>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- OCR Action Toolbar -->
	<div class="ocr-toolbar">
		<button class="ocr-btn" onclick={handleClipboardOcr} disabled={isOcrLoading}>
			<Clipboard size={13} />
			<span>Read Clipboard</span>
		</button>
		<button class="ocr-btn" onclick={handleFileOcr} disabled={isOcrLoading}>
			<ImageIcon size={13} />
			<span>Attach File</span>
		</button>
	</div>

	<!-- OCR Preview Chip -->
	{#if currentOcrText}
		<div class="ocr-preview">
			<div class="ocr-header">
				<div class="ocr-title">
					<FileText size={12} /> Extracted OCR Text
				</div>
				<button class="ocr-clear" onclick={() => (currentOcrText = '')}>✕</button>
			</div>
			<div class="ocr-body">{currentOcrText}</div>
		</div>
	{/if}

	<!-- Chat History Conversation Panel -->
	<div class="chat-history" bind:this={chatContainer}>
		{#if currentMessages.length === 0}
			<div class="empty-state">
				<Sparkles size={24} />
				<p>Chat with Local Ollama Models</p>
				<span class="subtext">Supports real-time streaming & persistent chat history</span>
			</div>
		{:else}
			{#each currentMessages as msg, idx}
				<div class="chat-bubble {msg.role}">
					<div class="bubble-header">
						<span class="role-name">{msg.role === 'user' ? 'You' : (currentSession?.model || 'Assistant')}</span>
						<button class="copy-btn" onclick={() => copyToClipboard(msg.content, idx)} title="Copy text">
							{#if copiedIndex === idx}
								<Check size={12} color="#4aff4a" />
							{:else}
								<Copy size={12} />
							{/if}
						</button>
					</div>
					
					{#if msg.role === 'assistant'}
						<div class="bubble-content markdown-body">
							{@html renderMarkdown(msg.content)}
							{#if $isStreaming && idx === currentMessages.length - 1}
								<span class="cursor-pulse">▌</span>
							{/if}
						</div>
					{:else}
						<div class="bubble-content raw-user-text">{msg.content}</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>

	<!-- Queued Sends -->
	{#if sendQueue.length > 0}
		<div class="queue-bar">
			<span class="queue-label">Queued ({sendQueue.length})</span>
			{#each sendQueue as q, qi}
				<span class="queue-chip" title={q.prompt || 'Image / OCR text'}>
					{(q.prompt || 'OCR text').slice(0, 24)}
					<button
						type="button"
						class="queue-drop"
						title="Remove from queue"
						onclick={() => (sendQueue = sendQueue.filter((_, i) => i !== qi))}
					>✕</button>
				</span>
			{/each}
		</div>
	{/if}

	<!-- Prompt Input Area -->
	<div class="input-area">
		<textarea
			bind:value={userInput}
			placeholder={currentOcrText ? "Ask a question about the image..." : "Ask local LLM..."}
			rows={2}
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					sendMessage();
				}
			}}
		></textarea>
		<button
			class="send-btn"
			onclick={sendMessage}
			disabled={isOcrLoading || (!userInput.trim() && !currentOcrText)}
			title={$isStreaming ? 'Queue this message' : 'Send'}
		>
			<Send size={14} />
		</button>
	</div>

	<!-- Status Footer Bar -->
	<div class="status-bar">{statusText}</div>
</div>

<style>
	.models-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: #09090b;
		color: #e4e4e7;
		position: relative;
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5em 0.65em;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
		background: #0d0d11;
	}

	.model-select-wrapper {
		display: flex;
		align-items: center;
		gap: 0.4em;
		flex: 1;
		min-width: 0;
	}

	.icon-bot {
		color: #38bdf8;
		flex-shrink: 0;
	}

	.model-select {
		background: #18181b;
		color: #e4e4e7;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 4px;
		padding: 0.25em 0.4em;
		font-size: 0.72em;
		flex: 1;
		outline: none;
		min-width: 0;
		text-overflow: ellipsis;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.2em;
	}

	.btn-icon {
		background: transparent;
		border: none;
		color: #a1a1aa;
		cursor: pointer;
		padding: 0.25em;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
	}

	.btn-icon:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}

	.btn-icon.active {
		color: #38bdf8;
		background: rgba(56, 189, 248, 0.1);
	}

	.history-drawer {
		position: absolute;
		top: 35px;
		left: 0;
		right: 0;
		z-index: 20;
		background: #121217;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
		box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
		max-height: 220px;
		display: flex;
		flex-direction: column;
	}

	.history-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.4em 0.65em;
		font-size: 0.7em;
		color: #a1a1aa;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
	}

	.new-chat-btn {
		background: rgba(56, 189, 248, 0.15);
		color: #38bdf8;
		border: none;
		border-radius: 3px;
		padding: 0.15em 0.4em;
		font-size: 0.68em;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.2em;
	}

	.history-list {
		overflow-y: auto;
		max-height: 180px;
	}

	.history-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.35em 0.65em;
		cursor: pointer;
		font-size: 0.72em;
		color: #d4d4d8;
		transition: background 0.15s;
	}

	.history-item:hover {
		background: rgba(255, 255, 255, 0.05);
	}

	.history-item.active {
		background: rgba(56, 189, 248, 0.12);
		color: #38bdf8;
		font-weight: 500;
	}

	.history-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
	}

	.del-sess-btn {
		background: transparent;
		border: none;
		color: #71717a;
		cursor: pointer;
		padding: 0.1em;
		opacity: 0.6;
	}

	.del-sess-btn:hover {
		color: #f43f5e;
		opacity: 1;
	}

	.ocr-toolbar {
		display: flex;
		gap: 0.4em;
		padding: 0.4em 0.65em;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
	}

	.ocr-btn {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35em;
		background: #18181b;
		border: 1px solid rgba(255, 255, 255, 0.08);
		color: #38bdf8;
		padding: 0.35em;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.7em;
		transition: all 0.15s;
	}

	.ocr-btn:hover:not(:disabled) {
		background: #27272a;
		border-color: #38bdf8;
	}

	.ocr-preview {
		background: rgba(56, 189, 248, 0.05);
		border: 1px solid rgba(56, 189, 248, 0.2);
		border-radius: 4px;
		margin: 0.4em 0.65em 0 0.65em;
		padding: 0.35em 0.5em;
	}

	.ocr-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		color: #38bdf8;
		font-size: 0.68em;
		font-weight: 600;
		margin-bottom: 0.2em;
	}

	.ocr-title {
		display: flex;
		align-items: center;
		gap: 0.3em;
	}

	.ocr-clear {
		background: transparent;
		border: none;
		color: #a1a1aa;
		cursor: pointer;
		font-size: 0.7em;
	}

	.ocr-body {
		max-height: 70px;
		overflow-y: auto;
		font-family: monospace;
		font-size: 0.65em;
		color: #cbd5e1;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	.chat-history {
		flex: 1;
		overflow-y: auto;
		padding: 0.65em;
		display: flex;
		flex-direction: column;
		gap: 0.6em;
		min-width: 0;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: #71717a;
		gap: 0.4em;
		text-align: center;
	}

	.subtext {
		font-size: 0.65em;
		color: #52525b;
	}

	.chat-bubble {
		display: flex;
		flex-direction: column;
		padding: 0.5em 0.65em;
		border-radius: 6px;
		max-width: 100%;
		box-sizing: border-box;
		overflow-wrap: anywhere;
		word-break: break-word;
		min-width: 0;
	}

	.chat-bubble.user {
		background: #18181b;
		border: 1px solid rgba(255, 255, 255, 0.06);
		align-self: flex-start;
		width: 100%;
	}

	.chat-bubble.assistant {
		background: #0f172a;
		border: 1px solid rgba(56, 189, 248, 0.15);
		align-self: flex-start;
		width: 100%;
	}

	.bubble-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.65em;
		color: #71717a;
		margin-bottom: 0.25em;
	}

	.role-name {
		font-weight: 600;
		color: #a1a1aa;
	}

	.chat-bubble.assistant .role-name {
		color: #38bdf8;
	}

	.bubble-content {
		font-size: 0.73em;
		line-height: 1.4;
		overflow-wrap: anywhere;
		word-break: break-word;
		min-width: 0;
	}

	.raw-user-text {
		white-space: pre-wrap;
		color: #e4e4e7;
	}

	:global(.markdown-body) {
		color: #e4e4e7;
		font-size: 0.73em;
		line-height: 1.45;
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	:global(.markdown-body p) {
		margin: 0 0 0.4em 0;
	}

	:global(.markdown-body p:last-child) {
		margin-bottom: 0;
	}

	:global(.markdown-body code) {
		background: rgba(255, 255, 255, 0.08);
		color: #38bdf8;
		padding: 0.1em 0.3em;
		border-radius: 3px;
		font-family: monospace;
		font-size: 0.7em;
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	:global(.markdown-body pre) {
		background: #050507;
		border: 1px solid rgba(255, 255, 255, 0.1);
		padding: 0.5em;
		border-radius: 4px;
		overflow-x: auto;
		margin: 0.4em 0;
	}

	:global(.markdown-body pre code) {
		background: transparent;
		padding: 0;
		color: #f4f4f5;
	}

	:global(.markdown-body ul, .markdown-body ol) {
		margin: 0.3em 0;
		padding-left: 1.2em;
	}

	.cursor-pulse {
		color: #38bdf8;
		animation: blink 0.8s infinite;
		margin-left: 2px;
	}

	@keyframes blink {
		0%, 100% { opacity: 1; }
		50% { opacity: 0; }
	}

	.copy-btn {
		background: transparent;
		border: none;
		color: #71717a;
		cursor: pointer;
		padding: 0.1em;
	}

	.copy-btn:hover {
		color: #fff;
	}

	.queue-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35em;
		padding: 0.35em 0.65em;
		border-top: 1px solid rgba(255, 255, 255, 0.05);
		background: #0d0d11;
		font-size: 0.7em;
	}

	.queue-label {
		color: #a1a1aa;
		font-weight: 600;
	}

	.queue-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		max-width: 100%;
		padding: 0.15em 0.4em;
		border-radius: 999px;
		background: rgba(74, 158, 255, 0.12);
		border: 1px solid rgba(74, 158, 255, 0.3);
		color: #cbd5f5;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.queue-drop {
		background: none;
		border: none;
		color: #8f9bb3;
		cursor: pointer;
		padding: 0;
		line-height: 1;
	}

	.queue-drop:hover {
		color: #fff;
	}

	.input-area {
		display: flex;
		align-items: flex-end;
		gap: 0.4em;
		padding: 0.4em 0.65em;
		border-top: 1px solid rgba(255, 255, 255, 0.05);
		background: #0d0d11;
	}

	textarea {
		flex: 1;
		background: #18181b;
		color: #e4e4e7;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 4px;
		padding: 0.4em;
		font-size: 0.73em;
		resize: none;
		outline: none;
		font-family: inherit;
		min-width: 0;
	}

	textarea:focus {
		border-color: #38bdf8;
	}

	.send-btn {
		background: #0284c7;
		color: #fff;
		border: none;
		border-radius: 4px;
		padding: 0.45em 0.6em;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.send-btn:hover:not(:disabled) {
		background: #0369a1;
	}

	.status-bar {
		padding: 0.2em 0.65em;
		font-size: 0.64em;
		color: #71717a;
		border-top: 1px solid rgba(255, 255, 255, 0.02);
		background: #09090b;
	}

	.spin {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		100% {
			transform: rotate(360deg);
		}
	}
</style>
