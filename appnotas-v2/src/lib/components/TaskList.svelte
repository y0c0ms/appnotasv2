<script lang="ts">
    import { filteredTaskNotes, taskSearchQuery, selectedTaskFileId, activeNoteId, toggleNotePin } from '$lib/stores/notes';
    import { focusArea } from '$lib/stores/focus';
    import { activeTab } from '$lib/stores/shortcuts';
    import { tick } from 'svelte';
    import { deleteNoteFile } from '$lib/stores/notes';
    import { Search, Pin, Trash2 } from 'lucide-svelte';

    let selectedIndex = $state(0);
    let listContainer = $state<HTMLElement>();
    let searchInput = $state<HTMLInputElement>();

    let sortedNotes = $derived([...$filteredTaskNotes].sort((a, b) => {
        if (a.id === $selectedTaskFileId) return -1;
        if (b.id === $selectedTaskFileId) return 1;
        return b.updated_at.localeCompare(a.updated_at);
    }));

    $effect(() => {
        if ($activeNoteId && sortedNotes.length > 0) {
            const index = sortedNotes.findIndex(n => n.id === $activeNoteId);
            if (index !== -1) selectedIndex = index;
        }
    });

    // Auto-focus search input when activeTab is tasks and we might want to search
    $effect(() => {
        if ($activeTab === 'tasks' && $focusArea === 'note-search' && searchInput) {
            tick().then(() => {
                if (searchInput && document.activeElement !== searchInput) {
                    searchInput.focus();
                }
            });
        }
    });

    // Auto-focus container when focusArea switches to 'list' on tasks tab
    $effect(() => {
        if ($activeTab === 'tasks' && $focusArea === 'list' && listContainer) {
            tick().then(() => {
                // contains() so focus on a child task item isn't stolen by the container
                if (listContainer && !listContainer.contains(document.activeElement) && document.activeElement !== searchInput) {
                    listContainer.focus({ preventScroll: true });
                }
            });
        }
    });

    function selectTaskFile(id: string) {
        activeNoteId.set(id);
    }

    function toggleOverlayPin(e: MouseEvent, id: string) {
        e.stopPropagation();
        selectedTaskFileId.set($selectedTaskFileId === id ? '' : id);
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
            if (note) selectTaskFile(note.id);
        }
    }

    async function scrollToSelected() {
        await tick();
        if (!listContainer) return;
        const selected = listContainer.querySelector('.task-item.selected') as HTMLElement;
        if (selected) {
            selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    async function handleDelete(e: MouseEvent, note: any) {
        e.stopPropagation();
        if (confirm(`Are you sure you want to delete "${note.title}"?`)) {
            await deleteNoteFile(note.id);
            if ($activeNoteId === note.id) activeNoteId.set(null);
            if ($selectedTaskFileId === note.id) selectedTaskFileId.set('');
        }
    }

    function countActiveTasks(content: string) {
        if (!content || !content.includes('[ ]')) return 0;
        const lines = content.split('\n');
        return lines.filter(line => {
            return line.match(/^(\s*)[-*]\s*\[\s* \s*\]\s*(.*)/) || 
                   line.match(/^(\s*)\[\s* \s*\]\s*(.*)/);
        }).length;
    }
</script>

<div class="tasks-sidebar-container">
    <div class="search-box">
        <div class="search-icon-wrapper">
            <Search size={14} color="#888" />
        </div>
        <input
            type="text"
            class:focused={$focusArea === 'note-search'}
            placeholder="Search tasks..."
            data-focus-area="note-search"
            bind:value={$taskSearchQuery}
            bind:this={searchInput}
            onfocus={() => focusArea.set('note-search')}
            onkeydown={(e) => {
                e.stopPropagation();
				if (e.key === 'Escape') {
					taskSearchQuery.set('');
					focusArea.set('list');
					listContainer?.focus();
				} else if (e.key === 'ArrowDown' || e.key === 'Enter') {
					e.preventDefault();
					focusArea.set('list');
					listContainer?.focus();
				}
			}}
        />
    </div>

    <div
        class="tasks-list"
        class:focused={$focusArea === 'list'}
        onkeydown={handleKeyDown}
        data-focus-area="list"
        tabindex="0"
        role="listbox"
        aria-label="Task Files List"
        bind:this={listContainer}
    >
        {#if sortedNotes.length === 0}
            <div class="empty">
                <p>{$taskSearchQuery ? 'No matches found' : 'No task lists found.'}</p>
                {#if !$taskSearchQuery}
                    <p class="hint">Notes containing "- [ ]" will appear here.</p>
                {/if}
            </div>
        {:else}
            {#each sortedNotes as note, i (note.id)}
                <div class="task-item-wrapper">
                    <button 
                        class="task-item"
                        class:active={$activeNoteId === note.id}
                        class:selected={i === selectedIndex}
                        class:pinned={note.id === $selectedTaskFileId}
                        onclick={() => {
                            selectedIndex = i;
                            selectTaskFile(note.id);
                        }}
                    >
                        <div class="item-main">
                            <div class="item-title-row">
                                <div class="item-title">{note.title || 'Untitled'}</div>
                                {#if note.id === $selectedTaskFileId}
                                    <span class="overlay-indicator" title="Pinned to Overlay"><Pin size={12} /></span>
                                {/if}
                            </div>
                            <div class="item-meta">
                                {countActiveTasks(note.content)} active tasks
                            </div>
                        </div>
                    </button>
                    
                    <div class="item-actions">
                        <button 
                            class="action-btn pin-btn" 
                            class:active={$selectedTaskFileId === note.id}
                            onclick={(e) => toggleOverlayPin(e, note.id)}
                            title={$selectedTaskFileId === note.id ? "Unpin from Overlay" : "Pin to Overlay"}
                        >
                            <Pin size={14} />
                        </button>
                        <button 
                            class="action-btn delete-btn" 
                            onclick={(e) => handleDelete(e, note)}
                            title="Delete Task List"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                </div>
            {/each}
        {/if}
    </div>
</div>

<style>
    .tasks-sidebar-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #09090b;
        gap: 2px;
    }

    .search-box {
        padding: 0.5rem;
        background: #09090b;
        box-sizing: border-box;
        position: relative;
    }

    .search-icon-wrapper {
        position: absolute;
        left: 1rem;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
    }

    .search-box input {
        width: 100%;
        padding: 0.4rem 0.6rem 0.4rem 2rem;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 4px;
        color: #fff;
        font-size: 0.8rem;
        outline: none;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
        box-sizing: border-box;
    }

    .search-box input:focus,
    .search-box input.focused {
        border-color: #a04dff;
        box-shadow: 0 0 0 2px rgba(160, 77, 255, 0.3);
    }

    .tasks-list {
        flex: 1;
        overflow-y: auto;
        scrollbar-width: thin;
        box-sizing: border-box;
        outline: none;
    }

    .tasks-list.focused {
        outline: 2px solid #a04dff;
        outline-offset: -2px;
    }

    .task-item-wrapper {
        position: relative;
        margin-bottom: 4px;
    }

    .task-item {
        width: 100%;
        padding: 0.75rem;
        background: transparent;
        border: none;
        border-left: 3px solid transparent;
        text-align: left;
        cursor: pointer;
        transition: all 0.15s;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        padding-right: 3rem; /* Space for actions */
    }

    .task-item:hover {
        background: rgba(255, 255, 255, 0.02);
    }

    .task-item.active {
        background: rgba(255, 255, 255, 0.04);
        border-left-color: #a04dff;
    }

    .task-item.selected {
        background: rgba(255, 255, 255, 0.03);
    }
    
    .task-item.pinned {
        background: rgba(160, 77, 255, 0.05);
    }

    .item-title-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
    }

    .item-title {
        color: #fff;
        font-weight: 500;
        font-size: 0.9rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .overlay-indicator {
        font-size: 0.75rem;
        opacity: 0.8;
    }

    .item-meta {
        font-size: 0.7rem;
        color: #666;
    }

    .item-actions {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        gap: 4px;
        opacity: 0;
        transition: opacity 0.2s;
    }

    .task-item-wrapper:hover .item-actions {
        opacity: 1;
    }

    .action-btn {
        background: #333;
        border: none;
        cursor: pointer;
        font-size: 0.8rem;
        padding: 4px 6px;
        border-radius: 4px;
        color: #888;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .action-btn:hover {
        background: #444;
        color: #fff;
    }

    .pin-btn.active {
        background: rgba(160, 77, 255, 0.2);
        color: #a04dff;
        opacity: 1;
    }

    .delete-btn:hover {
        background: rgba(255, 74, 74, 0.2);
        color: #ff4a4a;
    }

    .empty {
        padding: 2rem 1rem;
        text-align: center;
        color: #666;
        font-size: 0.8rem;
    }

    .hint {
        font-size: 0.7rem;
        margin-top: 0.5rem;
        opacity: 0.7;
    }
</style>
