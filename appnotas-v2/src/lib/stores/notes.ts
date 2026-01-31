import { writable, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export interface Note {
    id: string;
    title: string;
    content: string;
    path?: string;
    created_at: string;
    updated_at: string;
    tags: string[];
    color?: string; // Color code: 'default', 'red', 'yellow', 'green', 'blue', 'purple'
}

// Notes directory path
export const notesDirectory = writable<string | null>(null);

// List of all notes
export const notesList = writable<Note[]>([]);

// Currently active note ID
export const activeNoteId = writable<string | null>(null);

// Derived: Get the active note object
export const activeNote = derived(
    [notesList, activeNoteId],
    ([$notes, $activeId]) => {
        if (!$activeId) return null;
        return $notes.find(n => n.id === $activeId) || null;
    }
);

/**
 * Initialize notes system - load directory from config
 */
export async function initNotes() {
    try {
        const dir = await invoke<string | null>('get_notes_directory');
        if (dir) {
            notesDirectory.set(dir);
            await loadNotes(dir);
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
        await invoke('set_notes_directory', { directory });
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
            const stored = await invoke<string | null>('get_notes_directory');
            if (!stored) return;
            dir = stored;
        }

        const notes = await invoke<Note[]>('list_notes_files', { directory: dir });
        notesList.set(notes);
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
            const stored = await invoke<string | null>('get_notes_directory');
            if (!stored) {
                throw new Error('No notes directory set');
            }
            dir = stored;
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
        await invoke('save_note_to_file', { id, content });

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
 * Delete note file
 */
export async function deleteNoteFile(id: string) {
    try {
        await invoke('delete_note_file', { id });

        notesList.update(notes => notes.filter(n => n.id !== id));

        // If deleted note was active, clear active note
        activeNoteId.update(activeId => activeId === id ? null : activeId);
    } catch (error) {
        console.error('Failed to delete note:', error);
        throw error;
    }
}

/**
 * Search in note titles and content
 */
export function searchNotes(query: string) {
    return derived(notesList, $notes => {
        if (!query.trim()) return $notes;

        const lowerQuery = query.toLowerCase();
        return $notes.filter(note =>
            note.title.toLowerCase().includes(lowerQuery) ||
            note.content.toLowerCase().includes(lowerQuery) ||
            note.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
        );
    });
}
