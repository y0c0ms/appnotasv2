import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { settingsStore } from './settings';

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

// Currently active note ID
export const activeNoteId = writable<string | null>(null);

// Search Query
export const searchQuery = writable<string>('');

// Sync activeNoteId to settings for persistence
activeNoteId.subscribe(id => {
    if (id) {
        settingsStore.update(s => ({ ...s, lastActiveNoteId: id }));
        settingsStore.save();
    }
});

// Derived: Get the active note object
export const activeNote = derived(
    [notesList, activeNoteId],
    ([$notes, $activeId]) => {
        if (!$activeId) return null;
        return $notes.find(n => n.id === $activeId) || null;
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
        }
    } catch (error) {
        console.error('Failed to init notes:', error);
    }
}

/**
 * Set notes directory and load notes from it
 */
export async function setNotesDirectory(directory: string) {
    try {
        settingsStore.update(s => ({ ...s, notesDirectory: directory }));
        await settingsStore.save();
        notesDirectory.set(directory);
        await loadNotes(directory);
    } catch (error) {
        console.error('Failed to set notes directory:', error);
        throw error;
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

        const notes = await invoke<Note[]>('list_notes_files', { directory: dir });

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
export async function createNoteFile(title: string, directory?: string) {
    try {
        let dir = directory;
        if (!dir) {
            const settings = get(settingsStore);
            if (!settings.notesDirectory) {
                throw new Error('No notes directory set');
            }
            dir = settings.notesDirectory;
        }

        const note = await invoke<Note>('create_note_file', {
            directory: dir,
            title
        });

        notesList.update(notes => [note, ...notes]);
        activeNoteId.set(note.id);

        return note;
    } catch (error) {
        console.error('Failed to create note:', error);
        throw error;
    }
}

/**
 * Save note content to file
 */
export async function saveNoteToFile(id: string, content: string) {
    try {
        const notes = get(notesList);
        const note = notes.find(n => n.id === id);
        if (!note || !note.path) throw new Error('Note or path not found');

        await invoke('save_note_to_file', {
            path: note.path,
            content,
            title: note.title
        });

        // Update local state
        notesList.update(notes =>
            notes.map(n => n.id === id
                ? { ...n, content, updated_at: new Date().toISOString() }
                : n
            )
        );
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
        const note = notes.find(n => n.id === id);
        if (!note || !note.path) throw new Error('Note or path not found');

        await invoke('delete_note_file', { path: note.path });

        notesList.update(notes => notes.filter(n => n.id !== id));

        // If deleted note was active, clear active note
        activeNoteId.update(activeId => activeId === id ? null : activeId);
    } catch (error) {
        console.error('Failed to delete note:', error);
        throw error;
    }
}

// Derived: Get the filtered notes list
export const filteredNotes = derived(
    [notesList, searchQuery],
    ([$notes, $query]) => {
        if (!$query.trim()) return $notes;

        const lowerQuery = $query.toLowerCase();
        return $notes.filter(note =>
            note.title.toLowerCase().includes(lowerQuery) ||
            note.content.toLowerCase().includes(lowerQuery)
        );
    }
);
