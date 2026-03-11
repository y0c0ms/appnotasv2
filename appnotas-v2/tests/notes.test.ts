import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { notesList, activeNote, activeNoteId } from '../src/lib/stores/notes';
import type { Note } from '../src/lib/stores/notes';

describe('Notes Store', () => {
    beforeEach(() => {
        notesList.set([]);
        activeNoteId.set(null);
    });

    it('should initialize with empty array', () => {
        expect(get(notesList)).toEqual([]);
    });

    it('should be able to add notes', () => {
        const testNotes: Note[] = [
            {
                id: '1',
                title: 'Test Note',
                content: 'Test Content',
                created_at: '2026-01-30T00:00:00Z',
                updated_at: '2026-01-30T00:00:00Z',
                tags: []
            },
        ];

        notesList.set(testNotes);
        expect(get(notesList)).toEqual(testNotes);
    });

    it('should be able to set active note', () => {
        const testNote: Note = {
            id: '1',
            title: 'Active Note',
            content: 'Active Content',
            created_at: '2026-01-30T00:00:00Z',
            updated_at: '2026-01-30T00:00:00Z',
            tags: []
        };

        notesList.set([testNote]);
        activeNoteId.set('1');

        expect(get(activeNote)).toEqual(testNote);
    });
});
