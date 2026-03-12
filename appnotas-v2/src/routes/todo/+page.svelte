<script lang="ts">
    import { onMount } from 'svelte';
    import { allTasks, toggleTask, updateTaskText, initNotes, createNoteFile, saveNoteToFile, notesList, taskNotes, selectedTaskFileId, deleteNoteFile, activeNoteId, taskNotesList } from '$lib/stores/notes';
    import { get } from 'svelte/store';
    import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
    import { emit, listen } from '@tauri-apps/api/event';
    import { activeTab } from '$lib/stores/shortcuts';
    import { settingsStore } from '$lib/stores/settings';
    import type { TaskItem } from '$lib/stores/notes';

    import OverlayCommandPalette from '$lib/components/OverlayCommandPalette.svelte';
    import { open as openFileDialog } from '@tauri-apps/plugin-dialog';

    import { geminiService } from '$lib/services/geminiService';
    import appIcon from '$lib/assets/nobg-icon.png';

    let loading = $state(true);
    let newTaskText = $state('');
    let showFileSelector = $state(false);
    let showCommandPalette = $state(false);
    let commandPaletteRef = $state<any>();

    // AI Flow State
    type AIState = 'NORMAL' | 'AI_SELECT' | 'AI_PROMPT' | 'AI_LOADING';
    let aiState = $state<AIState>('NORMAL');
    let aiSelectedTaskIds = $state<Set<string>>(new Set());
    let aiPrompt = $state('');
    let aiError = $state<string | null>(null);
    let editingTaskId = $state<string | null>(null);
    let commandPaletteTarget = $state<'quick-add' | 'item-edit'>('quick-add');
    let activeEditElement: HTMLElement | null = null;

    onMount(async () => {
        await settingsStore.init();
        await initNotes();
        loading = false;
    });

    function focusAction(node: HTMLElement) {
        node.focus();
        // Move cursor to end
        const range = document.createRange();
        range.selectNodeContents(node);
        range.collapse(false);
        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    async function handleTextBlur(task: TaskItem, e: FocusEvent) {
        if (editingTaskId !== task.taskId) return;
        const el = e.target as HTMLElement;
        const newText = el.innerText.trim();
        if (newText !== task.text && newText !== '') {
            await updateTaskText(task.id, task.lineIndex, newText);
        }
        editingTaskId = null;
    }

    function handleTextKeydown(e: KeyboardEvent) {
        if (showCommandPalette && commandPaletteRef) {
            commandPaletteRef.handleKey(e);
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLElement).blur();
        } else if (e.key === 'Escape') {
            editingTaskId = null;
        }
    }

    function handleTextOnInput(e: Event) {
        const el = e.target as HTMLElement;
        activeEditElement = el;
        const text = el.innerText;
        
        if (text.endsWith('@')) {
            commandPaletteTarget = 'item-edit';
            showCommandPalette = true;
        } else if (!text.includes('@')) {
            if (commandPaletteTarget === 'item-edit') {
                showCommandPalette = false;
            }
        }
    }

    async function handleToggle(task: TaskItem) {
        await toggleTask(task.id, task.lineIndex, task.checked);
    }

    async function handleQuickAdd(e: KeyboardEvent) {
        if (showCommandPalette && commandPaletteRef) {
            commandPaletteRef.handleKey(e);
            return;
        }

        if (e.key === 'Enter' && newTaskText.trim()) {
            const text = newTaskText.trim();
            // Don't add if it's just a command prefix
            if (text === '@') return;

            newTaskText = '';
            
            const selectedId = get(selectedTaskFileId);
            const notes = get(notesList);
            const tasks = get(taskNotes);
            const allAvailableNotes = [...notes, ...tasks];

            let targetNote = selectedId 
                ? allAvailableNotes.find(n => n.id === selectedId) 
                : (allAvailableNotes.find(n => n.title.toLowerCase().includes('todo')) || allAvailableNotes[0]);
            
            if (targetNote) {
                // Enforce checklist item prefix if missing
                const taskPrefix = text.startsWith('- [ ] ') ? '' : '- [ ] ';
                const newContent = targetNote.content + (targetNote.content.endsWith('\n') ? '' : '\n') + `${taskPrefix}${text}`;
                await saveNoteToFile(targetNote.id, newContent);
            } else {
                const newNote = await createNoteFile('Todo', 'tasks');
                const taskPrefix = text.startsWith('- [ ] ') ? '' : '- [ ] ';
                const newContent = `${taskPrefix}${text}`;
                await saveNoteToFile(newNote.id, newContent);
            }
        }
    }

    $effect(() => {
        if (newTaskText.endsWith('@')) {
            commandPaletteTarget = 'quick-add';
            showCommandPalette = true;
        } else if (!newTaskText.includes('@')) {
            if (commandPaletteTarget === 'quick-add') {
                showCommandPalette = false;
            }
        }
    });

    async function handleCommandSelect(event: any) {
        const { id } = event.detail;
        showCommandPalette = false;

        if (id === 'file') {
            try {
                const selected = await openFileDialog({ multiple: false, directory: false });
                if (selected && typeof selected === 'string') {
                    const name = selected.split(/[\\/]/).pop() || selected;
                    const link = `@[${name}](${selected})`;

                    if (commandPaletteTarget === 'quick-add') {
                        const baseText = newTaskText.replace(/@$/, '');
                        newTaskText = baseText + link;
                    } else if (commandPaletteTarget === 'item-edit' && activeEditElement) {
                        const baseText = activeEditElement.innerText.replace(/@$/, '');
                        activeEditElement.innerText = baseText + link;
                        // Put focus back at the end
                        activeEditElement.focus();
                        const range = document.createRange();
                        range.selectNodeContents(activeEditElement);
                        range.collapse(false);
                        const selection = window.getSelection();
                        if (selection) {
                            selection.removeAllRanges();
                            selection.addRange(range);
                        }
                    }
                }
            } catch (err) {
                console.error('File dialog error:', err);
            }
        } else if (id === 'ai') {
            if (commandPaletteTarget === 'quick-add') {
                newTaskText = newTaskText.replace(/@$/, '');
            } else if (commandPaletteTarget === 'item-edit' && activeEditElement) {
                activeEditElement.innerText = activeEditElement.innerText.replace(/@$/, '');
            }
            startAIFlow();
        }
    }

    function startAIFlow() {
        const tasks = get(allTasks);
        aiSelectedTaskIds = new Set(tasks.map(t => t.taskId));
        aiState = 'AI_SELECT';
        aiError = null;
    }

    function toggleTaskSelection(taskId: string) {
        if (aiSelectedTaskIds.has(taskId)) {
            aiSelectedTaskIds.delete(taskId);
        } else {
            aiSelectedTaskIds.add(taskId);
        }
        aiSelectedTaskIds = new Set(aiSelectedTaskIds); // Trigger reactivity
    }

    function selectAllTasks() {
        const tasks = get(allTasks);
        aiSelectedTaskIds = new Set(tasks.map(t => t.taskId));
    }

    function deselectAllTasks() {
        aiSelectedTaskIds = new Set();
    }

    function setAiPreset(type: 'grammar' | 'writing' | 'subtasks') {
        if (type === 'grammar') {
            aiPrompt = "Fix the grammar and spelling for these tasks.";
        } else if (type === 'writing') {
            aiPrompt = "Improve the writing and clarity of these tasks.";
        } else if (type === 'subtasks') {
            aiPrompt = "Break down these tasks into smaller, actionable sub-tasks.";
        }
    }

    function proceedToPrompt() {
        if (aiSelectedTaskIds.size === 0) {
            aiError = "Please select at least one task to proceed.";
            setTimeout(() => aiError = null, 3000);
            return;
        }
        aiState = 'AI_PROMPT';
    }

    async function submitAIFlow() {
        if (!aiPrompt.trim()) return;
        
        const tasks = get(allTasks).filter(t => aiSelectedTaskIds.has(t.taskId));
        const contextText = tasks.map(t => t.text).join('\n');
        
        aiState = 'AI_LOADING';
        try {
            const response = await geminiService.generateResponse(
                aiPrompt,
                { text: contextText },
                undefined,
                'tasks'
            );
            
            // Post-process response to ensure it's a checklist
            const cleanedLines = response.split('\n')
                .filter(line => line.trim())
                .map(line => {
                    if (line.trim().startsWith('- [ ]') || line.trim().startsWith('- [x]')) {
                        return line.trim();
                    }
                    return `- [ ] ${line.trim()}`;
                });

            // Add new tasks to the current selected file or default todo
            const selectedId = get(selectedTaskFileId);
            const notes = get(notesList);
            const tasksList = get(taskNotes);
            const allAvailableNotes = [...notes, ...tasksList];

            let targetNote = selectedId 
                ? allAvailableNotes.find(n => n.id === selectedId) 
                : (allAvailableNotes.find(n => n.title.toLowerCase().includes('todo')) || allAvailableNotes[0]);
            
            if (targetNote) {
                const newContent = targetNote.content + (targetNote.content.endsWith('\n') ? '' : '\n') + cleanedLines.join('\n');
                await saveNoteToFile(targetNote.id, newContent);
            }
            
            aiState = 'NORMAL';
            aiPrompt = '';
        } catch (err) {
            console.error('AI Flow Error:', err);
            aiError = "AI Request failed. Please try again.";
            aiState = 'AI_PROMPT';
        }
    }

    function cancelAIFlow() {
        aiState = 'NORMAL';
        aiPrompt = '';
        aiError = null;
    }

    // Helper to render task text with potential file links
    function parseTaskText(text: string) {
        const fileLinkRegex = /@\[(.+?)\]\((.+?)\)/g;
        const parts = [];
        let lastIndex = 0;
        let match;

        while ((match = fileLinkRegex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                parts.push({ type: 'text', content: text.substring(lastIndex, match.index) });
            }
            parts.push({ type: 'file', name: match[1], path: match[2] });
            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < text.length) {
            parts.push({ type: 'text', content: text.substring(lastIndex) });
        }

        return parts.length > 0 ? parts : [{ type: 'text', content: text }];
    }

    async function handleFileClick(path: string) {
        // Assuming there's a global utility to open files by path
        // For now we just log it or rely on existing listeners
        console.log('Opening file from overlay:', path);
        // We can use emit if there's a listener in main
        await emit('open-path', { path });
    }

    async function togglePin() {
        const win = getCurrentWebviewWindow();
        const pinned = await win.isAlwaysOnTop();
        await win.setAlwaysOnTop(!pinned);
    }

    async function hideWindow() {
        await getCurrentWebviewWindow().hide();
    }

    async function openSettings() {
        await returnToApp();
        activeTab.set('tasks');
    }

    async function returnToApp() {
        const selectedId = get(selectedTaskFileId);
        // Correctly emit event to main window context
        await emit('restore-main', {
            tab: 'tasks',
            noteId: selectedId
        });
        await getCurrentWebviewWindow().hide();
    }

    async function syncNotes() {
        loading = true;
        await initNotes();
        loading = false;
    }

    function selectTaskFile(id: string) {
        selectedTaskFileId.set(id);
        showFileSelector = false;
    }

    let activeTasks = $derived($allTasks.filter((t: TaskItem) => !t.checked));
    let completedTasks = $derived($allTasks.filter((t: TaskItem) => t.checked));
</script>

<svelte:head>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
</svelte:head>

<div class="todo-window">
    <!-- Drag Handle Area -->
    <div class="drag-handle" data-tauri-drag-region></div>

    <header class="window-header">
        <div class="header-left">
            <button class="branding" onclick={returnToApp} title="Return to App">
                <img src={appIcon} alt="AppNotas" class="app-icon-img" />
            </button>
        </div>

        <div class="header-center">
            <button class="list-selector-pill" onclick={() => showFileSelector = !showFileSelector} title="Choose Task List">
                <span class="active-file-name">
                    {#if $selectedTaskFileId}
                        {get(taskNotes).find(n => n.id === $selectedTaskFileId)?.title || 'Task List'}
                    {:else}
                        All Tasks
                    {/if}
                </span>
                <div class="pill-icon">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                </div>
            </button>
        </div>

        <div class="window-controls">
            <button class="control-btn close" onclick={hideWindow} title="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>
    </header>

    {#if showFileSelector}
        <div class="file-selector-overlay">
            <div class="file-selector-content">
                <div class="selector-header">
                    <span>Select Task List</span>
                    <button class="icon-btn" onclick={() => showFileSelector = false}>✕</button>
                </div>
                <div class="file-list">
                    <button class="file-item" class:active={!$selectedTaskFileId} onclick={() => selectTaskFile('')}>
                        Show All Tasks
                    </button>
                    {#each $taskNotes as note}
                        <button class="file-item" class:active={$selectedTaskFileId === note.id} onclick={() => selectTaskFile(note.id)}>
                            {note.title}
                        </button>
                    {/each}
                </div>
            </div>
        </div>
    {/if}

    <main class="task-container scrollbar-custom">
        {#if loading}
            <div class="sync-state">
                <span class="animate-spin">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><polyline points="21 3 21 8 16 8"></polyline></svg>
                </span>
                <span>Syncing...</span>
            </div>
        {:else}
            <div class="section-label">Active Tasks</div>
            
            {#if activeTasks.length === 0}
                <div class="empty-state">No active tasks.</div>
            {/if}

            <div class="task-list">
                {#each activeTasks as task}
                    <div class="task-item" class:editing={editingTaskId === task.taskId}>
                        <div class="checkbox-wrapper">
                            <input 
                                class="custom-checkbox" 
                                type="checkbox"
                                checked={task.checked}
                                onchange={() => handleToggle(task)}
                            />
                        </div>
                        <div class="task-info">
                            {#if editingTaskId === task.taskId}
                                <div 
                                    contenteditable="true" 
                                    role="textbox"
                                    tabindex="0"
                                    class="task-text-edit"
                                    onblur={(e) => handleTextBlur(task, e)}
                                    onkeydown={handleTextKeydown}
                                    oninput={handleTextOnInput}
                                    use:focusAction
                                >{task.text}</div>
                            {:else}
                                <div 
                                    role="button" 
                                    tabindex="0" 
                                    class="task-text" 
                                    onclick={() => editingTaskId = task.taskId}
                                    onkeydown={(e) => e.key === 'Enter' && (editingTaskId = task.taskId)}
                                >
                                    {#each parseTaskText(task.text) as part}
                                        {#if part.type === 'file'}
                                            <button 
                                                class="file-link-widget" 
                                                onclick={(e) => { e.preventDefault(); e.stopPropagation(); handleFileClick(part.path!); }}
                                                title="Open {part.name}"
                                                type="button"
                                            >
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                                                <span class="file-name">{part.name}</span>
                                            </button>
                                        {:else}
                                            {part.content}
                                        {/if}
                                    {/each}
                                </div>
                            {/if}
                            {#if !$selectedTaskFileId}
                                <span class="note-source">{task.noteTitle}</span>
                            {/if}
                        </div>
                        <span class="drag-icon">⋮⋮</span>
                    </div>
                {/each}
            </div>

            {#if completedTasks.length > 0}
                <div class="section-label mt-20">Completed</div>
                <div class="task-list completed-list">
                    {#each completedTasks as task}
                        <div class="task-item strikethrough-item">
                            <div class="checkbox-wrapper">
                                <input 
                                    class="custom-checkbox checked" 
                                    type="checkbox"
                                    checked={task.checked}
                                    onchange={() => handleToggle(task)}
                                />
                            </div>
                            <div class="task-info">
                                <span class="task-text strikethrough">
                                    {#each parseTaskText(task.text) as part}
                                        {#if part.type === 'file'}
                                            <button 
                                                class="file-link-widget" 
                                                onclick={(e) => { e.preventDefault(); e.stopPropagation(); handleFileClick(part.path!); }}
                                                title="Open {part.name}"
                                                type="button"
                                            >
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                                                <span class="file-name">{part.name}</span>
                                            </button>
                                        {:else}
                                            {part.content}
                                        {/if}
                                    {/each}
                                </span>
                                {#if !$selectedTaskFileId}
                                    <span class="note-source">{task.noteTitle}</span>
                                {/if}
                            </div>
                            <span class="drag-icon">⋮⋮</span>
                        </div>
                    {/each}
                </div>
            {/if}
        {/if}
    </main>

    <!-- AI Multi-step Overlays -->
    {#if aiState !== 'NORMAL'}
        <div class="ai-overlay">
            {#if aiState === 'AI_SELECT'}
                <div class="ai-screen selection-screen">
                    <div class="screen-header">
                        <h3>Select Tasks for AI</h3>
                        <div class="header-actions">
                            <button class="text-btn" onclick={selectAllTasks}>Select All</button>
                            <button class="text-btn" onclick={deselectAllTasks}>Clear All</button>
                        </div>
                    </div>
                    
                    <div class="ai-task-list scrollbar-custom">
                        {#each activeTasks as task}
                            <label class="ai-task-item" class:selected={aiSelectedTaskIds.has(task.taskId)}>
                                <input 
                                    type="checkbox" 
                                    checked={aiSelectedTaskIds.has(task.taskId)}
                                    onchange={() => toggleTaskSelection(task.taskId)}
                                />
                                <span class="task-preview">
                                    {#each parseTaskText(task.text) as part}
                                        {#if part.type === 'file'}
                                            <span class="file-link-widget inactive">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                                                <span class="file-name">{part.name}</span>
                                            </span>
                                        {:else}
                                            {part.content}
                                        {/if}
                                    {/each}
                                </span>
                            </label>
                        {/each}
                    </div>

                    {#if aiError}
                        <div class="ai-error-warning">{aiError}</div>
                    {/if}

                    <div class="ai-actions footer-actions">
                        <button class="action-btn secondary" onclick={cancelAIFlow}>Cancel</button>
                        <button class="action-btn primary" onclick={proceedToPrompt}>
                            Next (Prompt)
                        </button>
                    </div>
                </div>
            {:else if aiState === 'AI_PROMPT'}
                <div class="ai-screen prompt-screen">
                    <div class="screen-header">
                        <h3>AI Instructions</h3>
                        <span class="task-count">{aiSelectedTaskIds.size} tasks selected</span>
                    </div>
                    
                    <textarea 
                        class="prompt-input scrollbar-custom"
                        placeholder="What should I do with these tasks? (e.g. 'Sort them by priority', 'Break them down into smaller steps')"
                        bind:value={aiPrompt}
                        onkeydown={(e) => e.key === 'Enter' && !e.shiftKey && submitAIFlow()}
                    ></textarea>

                    <div class="ai-presets">
                        <button class="preset-btn" onclick={() => setAiPreset('grammar')}>Fix Grammar</button>
                        <button class="preset-btn" onclick={() => setAiPreset('writing')}>Improve Writing</button>
                        <button class="preset-btn" onclick={() => setAiPreset('subtasks')}>Break Down</button>
                    </div>

                    <div class="ai-actions footer-actions">
                        <button class="action-btn secondary" onclick={() => aiState = 'AI_SELECT'}>Back</button>
                        <button class="action-btn primary" onclick={submitAIFlow} disabled={!aiPrompt.trim()}>
                            Generate Tasks
                        </button>
                    </div>
                </div>
            {:else if aiState === 'AI_LOADING'}
                <div class="ai-screen loading-screen">
                    <div class="loading-content">
                        <div class="ai-spinner"></div>
                        <p>AI is thinking...</p>
                    </div>
                </div>
            {/if}
        </div>
    {/if}

    <footer class="window-footer">
        {#if showCommandPalette}
            <div class="palette-container">
                <OverlayCommandPalette 
                    bind:this={commandPaletteRef} 
                    on:select={handleCommandSelect}
                    on:close={() => showCommandPalette = false} 
                />
            </div>
        {/if}
        <div class="input-wrapper">
            <span class="add-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </span>
            <input 
                class="quick-input" 
                placeholder="Add a quick task... Type @ for files" 
                type="text"
                bind:value={newTaskText}
                onkeydown={handleQuickAdd}
            />
        </div>
    </footer>
</div>

<style>
    :root {
        --primary: #3b82f6;
        --primary-dim: rgba(59, 130, 246, 0.3);
        --bg-dark: #0d1117;
        --text-main: #e6edf3;
        --text-dim: #8b949e;
        --border-color: rgba(59, 130, 246, 0.3);
        --glass-bg: #12161b;
    }

    :global(body) {
        margin: 0;
        padding: 0;
        background: transparent !important;
        overflow: hidden;
        font-family: 'Inter', -apple-system, sans-serif;
    }

    .todo-window {
        width: 100vw;
        height: 100vh;
        background: var(--glass-bg);
        border: 1px solid var(--border-color);
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        color: var(--text-main);
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
        overflow: hidden;
    }

    .branding {
        display: flex;
        align-items: center;
        background: transparent;
        border: none;
        padding: 0;
        cursor: pointer;
    }

    .app-icon-img {
        width: 36px;
        height: 36px;
        object-fit: contain;
        transition: transform 0.2s;
    }

    .branding:hover .app-icon-img {
        transform: scale(1.1);
    }

    .header-left {
        display: flex;
        justify-content: flex-start;
    }

    .header-center {
        display: flex;
        justify-content: center;
    }

    .window-header {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        padding: 8px 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }

    .list-selector-pill {
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: 4px 16px;
        border-radius: 20px;
        cursor: pointer;
        transition: all 0.2s;
        color: var(--text-main);
    }

    .list-selector-pill:hover {
        background: rgba(59, 130, 246, 0.1);
        border-color: var(--primary);
    }

    .list-selector-pill .active-file-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-main);
        letter-spacing: -0.01em;
    }

    .list-selector-pill:hover .active-file-name {
        color: var(--primary);
    }

    .pill-icon {
        display: flex;
        align-items: center;
        opacity: 0.6;
        margin-top: 1px;
    }

    .list-selector-pill:hover .pill-icon {
        opacity: 1;
        color: var(--primary);
    }

    .window-controls {
        display: flex;
        justify-content: flex-end;
        gap: 4px;
    }

    .control-btn {
        background: transparent;
        border: none;
        color: var(--text-dim);
        padding: 4px;
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
    }

    .control-btn:hover {
        background: rgba(255, 255, 255, 0.08);
        color: var(--text-main);
    }

    .control-btn.close:hover {
        background: rgba(248, 81, 73, 0.2);
        color: #f85149;
    }

    .drag-handle {
        height: 6px;
        width: 48px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
        margin: 8px auto 4px auto;
        cursor: grab;
    }

    .drag-handle:active {
        cursor: grabbing;
    }

    .task-container {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .section-label {
        font-size: 10px;
        font-weight: 700;
        color: var(--text-dim);
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin-bottom: 8px;
        padding-left: 4px;
    }

    .mt-20 { margin-top: 20px; }

    .task-item {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 8px;
        border-radius: 8px;
        transition: background 0.2s;
        position: relative;
    }

    .task-item:hover {
        background: rgba(255, 255, 255, 0.05);
    }

    .task-item.editing {
        background: rgba(59, 130, 246, 0.1);
    }

    .task-text-edit {
        font-size: 14px;
        color: var(--text-main);
        line-height: 1.4;
        background: transparent;
        border: none;
        outline: none;
        width: 100%;
        padding: 0;
        min-height: 1em;
    }

    .task-text {
        font-size: 14px;
        color: var(--text-main);
        line-height: 1.4;
        cursor: text;
        width: 100%;
        background: transparent;
        border: none;
        padding: 0;
        text-align: left;
        display: block;
        font-family: inherit;
    }

    .task-text:hover {
        color: var(--primary);
    }

    .checkbox-wrapper {
        margin-top: 2px;
    }

    .custom-checkbox {
        appearance: none;
        width: 18px;
        height: 18px;
        border: 2px solid rgba(255, 255, 255, 0.2);
        border-radius: 4px;
        background: transparent;
        cursor: pointer;
        transition: all 0.2s;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .custom-checkbox:checked {
        background: var(--primary);
        border-color: var(--primary);
    }

    .custom-checkbox:checked::after {
        content: "";
        position: absolute;
        width: 4px;
        height: 8px;
        border: solid white;
        border-width: 0 2px 2px 0;
        transform: rotate(45deg);
        top: 2px;
    }

    .task-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .task-text {
        font-size: 14px;
        color: var(--text-main);
        line-height: 1.4;
    }

    .note-source {
        font-size: 10px;
        font-weight: 500;
        color: var(--primary);
        opacity: 0.7;
    }

    .drag-icon {
        color: var(--text-dim);
        font-size: 18px;
        opacity: 0;
        transition: opacity 0.2s;
    }

    .task-item:hover .drag-icon {
        opacity: 0.5;
    }

    .strikethrough-item {
        opacity: 0.6;
    }

    .completed-list {
        opacity: 0.5;
    }

    .strikethrough {
        text-decoration: line-through;
        color: var(--text-dim);
    }

    .window-footer {
        padding: 16px;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
        background: rgba(255, 255, 255, 0.02);
        position: relative;
    }

    .palette-container {
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-bottom: 8px;
        z-index: 1000;
    }

    .input-wrapper {
        position: relative;
        display: flex;
        align-items: center;
    }

    .add-icon {
        position: absolute;
        left: 12px;
        color: var(--text-dim);
        font-size: 20px;
    }

    .quick-input {
        width: 100%;
        background: rgba(255, 255, 255, 0.05);
        border: none;
        border-radius: 8px;
        padding: 10px 12px 10px 40px;
        color: var(--text-main);
        font-size: 13px;
        transition: all 0.2s;
    }

    .quick-input::placeholder {
        color: rgba(255, 255, 255, 0.2);
    }

    .quick-input:focus {
        outline: none;
        background: rgba(255, 255, 255, 0.08);
        box-shadow: 0 0 0 1px rgba(160, 77, 255, 0.4);
    }


    .sync-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: 8px;
        color: var(--text-dim);
        font-size: 12px;
    }

    .empty-state {
        padding: 32px;
        text-align: center;
        color: var(--text-dim);
        font-size: 12px;
        font-style: italic;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .animate-spin {
        animation: spin 1.5s linear infinite;
    }

    /* Scrollbar */
    .scrollbar-custom::-webkit-scrollbar { width: 4px; }
    .scrollbar-custom::-webkit-scrollbar-track { background: transparent; }
    .scrollbar-custom::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }

    /* File Selector UI */
    .file-selector-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(8px);
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        z-index: 100;
    }

    .file-selector-content {
        background: #1a1a2e;
        border-top: 1px solid var(--border-color);
        border-radius: 16px 16px 0 0;
        padding: 16px;
        max-height: 60%;
        display: flex;
        flex-direction: column;
    }

    .selector-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
        font-size: 13px;
        font-weight: 700;
        color: var(--text-dim);
    }

    .icon-btn {
        background: transparent;
        border: none;
        color: var(--text-dim);
        cursor: pointer;
    }

    .file-list {
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .file-item {
        width: 100%;
        padding: 10px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid transparent;
        border-radius: 8px;
        color: var(--text-main);
        text-align: left;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
    }

    .file-item:hover {
        background: rgba(255, 255, 255, 0.1);
    }

    .file-item.active {
        border-color: var(--primary);
        background: rgba(160, 77, 255, 0.1);
        color: var(--primary);
    }
    /* File Link Widget */
    .file-link-widget {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: rgba(160, 77, 255, 0.1);
        border: 1px solid rgba(160, 77, 255, 0.2);
        border-radius: 4px;
        padding: 1px 6px;
        color: var(--primary);
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
        vertical-align: middle;
        text-decoration: none;
    }

    .file-link-widget:hover {
        background: rgba(160, 77, 255, 0.2);
        border-color: var(--primary);
    }

    .file-link-widget.inactive {
        background: rgba(255, 255, 255, 0.05);
        border-color: rgba(255, 255, 255, 0.1);
        color: var(--text-dim);
        cursor: default;
    }

    .file-name {
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /* AI Overlay & Screens */
    .ai-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(12px);
        z-index: 500;
        display: flex;
        flex-direction: column;
        animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    .ai-screen {
        flex: 1;
        display: flex;
        flex-direction: column;
        padding: 24px;
        gap: 20px;
    }

    .screen-header {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .screen-header h3 {
        margin: 0;
        font-size: 18px;
        color: var(--primary);
    }

    .task-count {
        font-size: 12px;
        color: var(--text-dim);
    }

    .header-actions {
        display: flex;
        gap: 12px;
        margin-top: 8px;
    }

    .text-btn {
        background: none;
        border: none;
        color: var(--primary);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        padding: 0;
        opacity: 0.8;
    }

    .text-btn:hover { opacity: 1; }

    .ai-task-list {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .ai-task-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.03);
        cursor: pointer;
        transition: all 0.2s;
    }

    .ai-task-item:hover {
        background: rgba(255, 255, 255, 0.06);
    }

    .ai-task-item.selected {
        background: rgba(59, 130, 246, 0.08);
        box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.2);
    }

    .task-preview {
        font-size: 13px;
        color: var(--text-main);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .ai-error-warning {
        padding: 10px;
        background: rgba(248, 81, 73, 0.1);
        border: 1px solid rgba(248, 81, 73, 0.3);
        border-radius: 8px;
        color: #f85149;
        font-size: 12px;
        text-align: center;
        animation: shake 0.4s ease;
    }

    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        75% { transform: translateX(5px); }
    }

    .ai-actions.footer-actions {
        margin-top: auto;
        padding: 20px;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
        background: rgba(13, 17, 23, 0.8);
        width: 100%;
        box-sizing: border-box;
    }

    .prompt-screen, .selection-screen {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .prompt-input {
        min-height: 150px;
        flex: 0 0 auto;
        margin: 0 16px;
    }

    .ai-presets {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 0 16px;
        margin-top: 12px;
        margin-bottom: 20px;
    }

    .ai-task-list {
        flex: 1;
        overflow-y: auto;
        padding: 0 16px;
    }

    .screen-header {
        padding: 16px;
    }

    .preset-btn {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 6px;
        padding: 6px 12px;
        color: var(--text-dim);
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
    }

    .preset-btn:hover {
        background: rgba(59, 130, 246, 0.15);
        border-color: var(--primary);
        color: var(--primary);
    }

    .action-btn {
        flex: 1;
        padding: 12px;
        border-radius: 10px;
        font-weight: 600;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s;
        border: none;
    }

    .action-btn.primary {
        background: var(--primary);
        color: white;
    }

    .action-btn.primary:hover {
        filter: brightness(1.1);
        transform: translateY(-1px);
    }

    .action-btn.primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
    }

    .action-btn.secondary {
        background: rgba(255, 255, 255, 0.1);
        color: var(--text-main);
    }

    .action-btn.secondary:hover {
        background: rgba(255, 255, 255, 0.15);
    }

    .loading-screen {
        justify-content: center;
        align-items: center;
    }

    .loading-content {
        text-align: center;
        color: var(--text-dim);
    }

    .ai-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid rgba(59, 130, 246, 0.1);
        border-top-color: var(--primary);
        border-radius: 50%;
        margin: 0 auto 16px auto;
        animation: spin 1s linear infinite;
    }
</style>
