import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { settingsStore } from './settings';
import { activeTab } from './shortcuts';

let myWindowLabel = '';
if (typeof window !== 'undefined') {
    try {
        myWindowLabel = getCurrentWebviewWindow().label;
    } catch (e) {}
}

export interface Note {
    id: string;
    title: string;
    content: string;
    path?: string;
    created_at: string;
    updated_at: string;
    tags: string[];
    color?: string; // Color code: 'default', 'red', 'yellow', 'green', 'blue', 'purple'
    pinned?: boolean;
}

// Notes directory path
export const notesDirectory = writable<string | null>(null);

// List of all notes
export const notesList = writable<Note[]>([]);

// List of all task-specific notes (from /tasks subfolder)
export const taskNotesList = writable<Note[]>([]);

// Currently active note ID
export const activeNoteId = writable<string | null>(null);

// Tab-specific last viewed stores
export const lastNoteId = writable<string | null>(null);
export const lastTaskId = writable<string | null>(null);

// Search Queries
export const searchQuery = writable<string>('');
export const taskSearchQuery = writable<string>('');

// Active Note Content (fetched dynamically for non-task notes)
export const activeNoteContent = writable<string>('');

// Bumped (with the changed file paths) whenever the notes folder is modified
// externally — by the local MCP server or OneDrive sync. Components watch this
// to refresh. See the Rust `start_notes_watcher` / `notes-changed` event.
export const externalChange = writable<{ seq: number; paths: string[] }>({ seq: 0, paths: [] });

/** Re-list notes + task notes from disk, preserving the current selection. */
export async function reloadFromDisk() {
    const dir = get(notesDirectory);
    if (!dir) return;
    await loadNotes(dir);
    await loadTaskNotes(dir);
}

/** (Re)start the Rust filesystem watcher on the notes directory. */
async function startNotesWatcher(directory: string) {
    if (!directory) return;
    try {
        await invoke('start_notes_watcher', { directory });
    } catch (e) {
        console.error('Failed to start notes watcher:', e);
    }
}

// Sync activeNoteId and selectedTaskFileId to settings for persistence
activeNoteId.subscribe(async (id: string | null) => {
    if (id) {
        const tab = get(activeTab);
        if (tab === 'notes') {
            lastNoteId.set(id);
            settingsStore.update(s => ({ ...s, lastActiveNoteId: id }));
        } else if (tab === 'tasks') {
            lastTaskId.set(id);
            settingsStore.update(s => ({ ...s, lastActiveTaskId: id }));
        }
        
        const notes = get(notesList);
        const tasks = get(taskNotesList);
        const note = notes.find(n => n.id === id) || tasks.find(n => n.id === id);
        
        if (note && note.path) {
             if (note.content && note.content.length > 0) {
                 activeNoteContent.set(note.content);
             } else {
                 try {
                     const rawFileContent = await invoke<string>('read_file', { path: note.path });
                     // Strip frontmatter since TipTap expects body text
                     let body = rawFileContent;
                     if (rawFileContent.startsWith('---')) {
                         const parts = rawFileContent.split('---');
                         if (parts.length >= 3) {
                             body = parts.slice(2).join('---').trimStart();
                         }
                     }
                     activeNoteContent.set(body);
                 } catch(e) {
                     console.error('Failed to lazy load note content:', e);
                     activeNoteContent.set('');
                 }
             }
        }
    } else {
        activeNoteContent.set('');
    }
});

// Currently selected task file for overlay
export const selectedTaskFileId = writable<string | null>(null);

selectedTaskFileId.subscribe((id: string | null) => {
    if (id !== undefined) {
        settingsStore.update(s => ({ ...s, selectedTaskFileId: id || '' }));
        settingsStore.save();
    }
});

// Derived: Get the active note object
export const activeNote = derived(
    [notesList, taskNotesList, activeNoteId],
    ([$notes, $tasks, $activeId]) => {
        if (!$activeId) return null;
        const allNotes = [...$notes, ...$tasks];
        return allNotes.find(n => n.id === $activeId) || null;
    }
);

/**
 * Initialize notes system - load directory from settings
 */
export async function initNotes() {
    try {
        const settings = get(settingsStore);
        if (settings.notesDirectory) {
            notesDirectory.set(settings.notesDirectory);
            await loadNotes(settings.notesDirectory);
            await loadTaskNotes(settings.notesDirectory);
            await startNotesWatcher(settings.notesDirectory);
        }
        if (settings.selectedTaskFileId) {
            selectedTaskFileId.set(settings.selectedTaskFileId);
        }

        // Restore last active IDs
        lastNoteId.set(settings.lastActiveNoteId || null);
        lastTaskId.set(settings.lastActiveTaskId || null);
        
        // Set initial active note based on current tab
        const tab = get(activeTab);
        if (tab === 'notes') activeNoteId.set(settings.lastActiveNoteId || null);
        else if (tab === 'tasks') activeNoteId.set(settings.lastActiveTaskId || null);

        console.log('📡 Notes system initialized');
    } catch (error) {
        console.error('Failed to init notes:', error);
    }

    // Set up cross-window sync listener
    listen('notes-updated', async (event) => {
        const payload = event.payload as { source?: string };
        if (payload?.source === myWindowLabel) return;

        console.log('🔄 Sync event received from:', payload?.source || 'unknown');
        
        await settingsStore.init();
        const settings = get(settingsStore);
        
        if (settings.notesDirectory) {
            notesDirectory.set(settings.notesDirectory);
            await loadNotes(settings.notesDirectory);
            await loadTaskNotes(settings.notesDirectory);
        }

        if (settings.selectedTaskFileId) {
            selectedTaskFileId.set(settings.selectedTaskFileId);
        }
    });

    // External changes (MCP server / OneDrive) reported by the Rust watcher.
    listen('notes-changed', async (event) => {
        const paths = (event.payload as string[]) ?? [];
        console.log('🛰️ External notes change:', paths);
        await reloadFromDisk();
        // Signal components (e.g. the open editor) to reconcile.
        externalChange.update(c => ({ seq: c.seq + 1, paths }));
    });

    console.log('📡 Notes sync listener active');
}

// React to tab changes to swap active notes
activeTab.subscribe(tab => {
    if (tab === 'notes') {
        activeNoteId.set(get(lastNoteId));
    } else if (tab === 'tasks') {
        activeNoteId.set(get(lastTaskId));
    }
});

/**
 * Set notes directory and load notes from it
 */
export async function setNotesDirectory(directory: string) {
    try {
        settingsStore.update(s => ({ ...s, notesDirectory: directory }));
        await settingsStore.save();
        notesDirectory.set(directory);
        await loadNotes(directory);
        await loadTaskNotes(directory);
        await startNotesWatcher(directory);

        // Notify other windows to refresh their directory/notes
        await emit('notes-updated', {});
    } catch (error) {
        console.error('Failed to set notes directory:', error);
        throw error;
    }
}

/**
 * Load task-specific notes from the /tasks subfolder.
 * Creates the folder if it doesn't exist.
 */
export async function loadTaskNotes(rootDirectory: string) {
    try {
        // Use a more robust path join if possible, but simple slash is usually ok with Path::new in Rust
        const tasksPath = rootDirectory.replace(/[\\/]$/, '') + (rootDirectory.includes('\\') ? '\\tasks' : '/tasks');
        
        const notes = await invoke<Note[]>('list_notes_files', { directory: tasksPath, includeContent: true }).catch(async (err) => {
            console.warn('Tasks folder not accessible:', err);
            return [];
        });

        taskNotesList.set(notes);
    } catch (error) {
        console.error('Failed to load task notes:', error);
        taskNotesList.set([]);
    }
}

/**
 * Load all notes from the directory
 */
export async function loadNotes(directory?: string) {
    try {
        let dir = directory;
        if (!dir) {
            const settings = get(settingsStore);
            if (!settings.notesDirectory) return;
            dir = settings.notesDirectory;
        }

        const notes = await invoke<Note[]>('list_notes_files', { directory: dir, includeContent: false });

        // Re-apply pinned state from settings
        const settings = get(settingsStore);
        const pinnedIds = settings.pinnedNoteIds || [];

        const mergedNotes = notes.map(note => ({
            ...note,
            pinned: pinnedIds.includes(note.id)
        }));

        notesList.set(mergedNotes);
    } catch (error) {
        console.error('Failed to load notes:', error);
        notesList.set([]);
    }
}

/**
 * Create a new note file
 */
export async function createNoteFile(title: string, subfolder?: string) {
    try {
        let dir = get(notesDirectory);
        const settings = get(settingsStore);
        if (!dir) {
            if (!settings.notesDirectory) {
                throw new Error('No notes directory set');
            }
            dir = settings.notesDirectory;
        }

        const targetDir = subfolder ? `${dir}/${subfolder}` : dir;

        const note = await invoke<Note>('create_note_file', {
            directory: targetDir,
            title
        });

        if (subfolder === 'tasks') {
            taskNotesList.update(notes => [note, ...notes]);
        } else {
            notesList.update(notes => [note, ...notes]);
        }
        
        activeNoteId.set(note.id);

        // Notify other windows
        await emit('notes-updated', { source: myWindowLabel });

        return note;
    } catch (error) {
        console.error('Failed to create note:', error);
        throw error;
    }
}

/**
 * Save note content to file
 */
export async function saveNoteToFile(id: string, content: string, newTitle?: string) {
    try {
        const notes = get(notesList);
        const tasks = get(taskNotesList);
        const note = notes.find(n => n.id === id) || tasks.find(n => n.id === id);
        
        if (!note || !note.path) throw new Error('Note or path not found');

        const titleToSave = newTitle !== undefined ? newTitle : note.title;

        await invoke('save_note_to_file', {
            path: note.path,
            content,
            title: titleToSave,
            // Pass current color; Rust preserves created/tags from disk and uses
            // this color (or keeps the on-disk one if null).
            color: note.color ?? null
        });

        // Update local state in both lists
        const updateFn = (nList: Note[]) => 
            nList.map(n => n.id === id
                ? { ...n, content, title: titleToSave, updated_at: new Date().toISOString() }
                : n
            );

        notesList.update(updateFn);
        taskNotesList.update(updateFn);
        
        // Also update the active session content if we are editing it
        if (get(activeNoteId) === id) {
             activeNoteContent.set(content);
        }

        // Notify other windows
        await emit('notes-updated', { source: myWindowLabel });
    } catch (error) {
        console.error('Failed to save note:', error);
        throw error;
    }
}

/**
 * Set note color
 */
export async function setNoteColor(id: string, color: string) {
    try {
        // Update local state
        notesList.update(notes =>
            notes.map(n => n.id === id ? { ...n, color } : n)
        );

        // Color will be saved with auto-save
    } catch (error) {
        console.error('Failed to set note color:', error);
        throw error;
    }
}

/**
 * Toggle note pin state
 */
export async function toggleNotePin(id: string) {
    try {
        // Update local state
        notesList.update(notes =>
            notes.map(n => n.id === id ? { ...n, pinned: !n.pinned } : n)
        );

        // Persist to settings
        const currentNotes = get(notesList);
        const pinnedIds = currentNotes.filter(n => n.pinned).map(n => n.id);

        settingsStore.update(s => ({ ...s, pinnedNoteIds: pinnedIds }));
        await settingsStore.save();

    } catch (error) {
        console.error('Failed to toggle note pin:', error);
        throw error;
    }
}

/**
 * Delete note file
 */
export async function deleteNoteFile(id: string) {
    try {
        const notes = get(notesList);
        const tasks = get(taskNotesList);
        const note = notes.find(n => n.id === id) || tasks.find(n => n.id === id);
        
        if (!note || !note.path) throw new Error('Note or path not found');

        await invoke('delete_note_file', { path: note.path });

        notesList.update(notes => notes.filter(n => n.id !== id));
        taskNotesList.update(notes => notes.filter(n => n.id !== id));

        // If deleted note was active, clear active note
        activeNoteId.update(activeId => activeId === id ? null : activeId);

        // Notify other windows
        await emit('notes-updated', { source: myWindowLabel });
    } catch (error) {
        console.error('Failed to delete note:', error);
        throw error;
    }
}

export interface SearchHit {
    id: string;
    title: string;
    path: string;
    snippet: string;
    match_count: number;
    title_match: boolean;
}

// Derived: filtered notes list. Search runs in Rust (`search_notes`), which
// scans the notes directory on disk — so it covers note *content* even though
// the in-memory list is loaded without content. Debounced, with a title-only
// fallback if the backend call fails.
export const filteredNotes = derived<
    [typeof notesList, typeof searchQuery, typeof notesDirectory],
    Note[]
>(
    [notesList, searchQuery, notesDirectory],
    ([$notes, $query, $dir], set) => {
        const q = $query.trim();
        if (!q) {
            set($notes);
            return;
        }
        if (!$dir) {
            const lq = q.toLowerCase();
            set($notes.filter(n => n.title.toLowerCase().includes(lq)));
            return;
        }

        let cancelled = false;
        const timer = setTimeout(() => {
            invoke<SearchHit[]>('search_notes', { directory: $dir, query: q })
                .then(hits => {
                    if (cancelled) return;
                    const byId = new Map($notes.map(n => [n.id, n] as const));
                    set(hits.map(h => byId.get(h.id)).filter((n): n is Note => !!n));
                })
                .catch(err => {
                    if (cancelled) return;
                    console.error('[notes] Rust search failed, falling back:', err);
                    const lq = q.toLowerCase();
                    set($notes.filter(n =>
                        n.title.toLowerCase().includes(lq) ||
                        n.content.toLowerCase().includes(lq)
                    ));
                });
        }, 120);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    },
    []
);

export const filteredTaskNotes = derived(
    [taskNotesList, taskSearchQuery],
    ([$tasks, $query]) => {
        if (!$query.trim()) return $tasks;

        const lowerQuery = $query.toLowerCase();
        return $tasks.filter(note =>
            note.title.toLowerCase().includes(lowerQuery) ||
            note.content.toLowerCase().includes(lowerQuery)
        );
    }
);

/**
 * Reload a note's content from disk (for diff comparison).
 * Returns the body content (without frontmatter) or null if the note has no path.
 */
export async function reloadNoteFromDisk(id: string): Promise<string | null> {
    const note = get(notesList).find(n => n.id === id) || get(taskNotesList).find(n => n.id === id);
    if (!note || !note.path) return null;

    try {
        const rawContent = await invoke<string>('read_file', { path: note.path });
        
        // Parse out frontmatter to get just the body
        if (rawContent.startsWith('---')) {
            const parts = rawContent.split('---');
            if (parts.length >= 3) {
                // parts[0] is empty, parts[1] is frontmatter, parts[2+] is body
                return parts.slice(2).join('---').trim();
            }
        }
        return rawContent.trim();
    } catch (error) {
        console.error('Failed to reload note from disk:', error);
        return null;
    }
}

/**
 * Apply externally changed content to a note in the store.
 */
export function applyExternalContent(id: string, newContent: string) {
    notesList.update(notes =>
        notes.map(n => n.id === id ? { ...n, content: newContent, updated_at: new Date().toISOString() } : n)
    );
}

/**
 * Derived store that filters notes that appear to be task lists or are designated.
 * It now uses the dedicated 'taskNotesList' for clean separation.
 */
export const taskNotes = derived(taskNotesList, ($tasks) => {
    return $tasks;
});

// --- Task Overlay Logic ---

export interface TaskItem {
    id: string; // Note ID
    taskId: string; // Unique task ID (noteId:lineIndex)
    noteTitle: string;
    text: string;
    checked: boolean;
    lineIndex: number; // For pinpointing in content
}

/**
 * Derived store that aggregates tasks. 
 * If a specific task file is selected, it only returns tasks from that file.
 */
export const allTasks = derived(
    [notesList, taskNotesList, selectedTaskFileId], 
    ([$notes, $tasks, $selectedId]) => {
        const tasks: TaskItem[] = [];
        
        const allAvailableNotes = [...$notes, ...$tasks];
        
        const targetNotes = $selectedId 
            ? allAvailableNotes.filter(n => n.id === $selectedId)
            : allAvailableNotes;

        targetNotes.forEach(note => {
            const content = note.content;
            if (!content || (!content.includes('[ ]') && !content.includes('[x]') && !content.includes('[X]'))) {
                return;
            }
            const lines = content.split('\n');
            lines.forEach((line, index) => {
                const taskMatch = line.match(/^(\s*)[-*]\s*\[\s*([ xX])\s*\]\s*(.*)/);
                if (taskMatch) {
                    tasks.push({
                        id: note.id,
                        taskId: `${note.id}:${index}`,
                        noteTitle: note.title,
                        text: taskMatch[3].trim(),
                        checked: taskMatch[2].toLowerCase() === 'x',
                        lineIndex: index
                    });
                } else {
                    const plainMatch = line.match(/^(\s*)\[\s*([ xX])\s*\]\s*(.*)/);
                    if (plainMatch) {
                        tasks.push({
                            id: note.id,
                            taskId: `${note.id}:${index}`,
                            noteTitle: note.title,
                            text: plainMatch[3].trim(),
                            checked: plainMatch[2].toLowerCase() === 'x',
                            lineIndex: index
                        });
                    }
                }
            });
        });
        return tasks;
    }
);

/**
 * Toggle a task's state in its source note and save it.
 */
export async function toggleTask(noteId: string, lineIndex: number, currentState: boolean) {
    const notes = get(notesList);
    const tasks = get(taskNotesList);
    const note = notes.find(n => n.id === noteId) || tasks.find(n => n.id === noteId);
    
    if (!note) return;

    const lines = note.content.split('\n');
    const line = lines[lineIndex];
    if (line) {
        // Toggle [ ] to [x] or vice versa
        const newState = !currentState;
        lines[lineIndex] = line.replace(/\[[ xX]\]/, newState ? '[x]' : '[ ]');
        const newContent = lines.join('\n');
        
        await saveNoteToFile(noteId, newContent);
    }
}

/**
 * Update a task's text in its source note and save it.
 */
export async function updateTaskText(noteId: string, lineIndex: number, newText: string) {
    const notes = get(notesList);
    const tasks = get(taskNotesList);
    const note = notes.find(n => n.id === noteId) || tasks.find(n => n.id === noteId);
    
    if (!note) return;

    const lines = note.content.split('\n');
    const line = lines[lineIndex];
    if (line !== undefined) {
        // Find the prefix (e.g., "- [ ] " or "  - [x] ")
        const prefixMatch = line.match(/^(\s*[-*]?\s*\[\s*[ xX]\s*\]\s*)/);
        const prefix = prefixMatch ? prefixMatch[1] : (line.startsWith(' ') ? line.match(/^\s*/)?.[0] || '' : '');
        
        lines[lineIndex] = `${prefix}${newText}`;
        const newContent = lines.join('\n');
        
        await saveNoteToFile(noteId, newContent);
    }
}
