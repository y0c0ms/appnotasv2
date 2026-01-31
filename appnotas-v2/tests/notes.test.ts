import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { notes, activeNote } from '../src/lib/stores/notes';
import type { Note } from '../src/lib/stores/notes';

describe('Notes Store', () => {
    beforeEach(() => {
        notes.set([]);
        activeNote.set(null);
    });

    it('should initialize with empty array', () => {
        expect(get(notes)).toEqual([]);
    });

    it('should be able to add notes', () => {
        const testNotes: Note[] = [
            {
                id: 1,
                title: 'Test Note',
                content: 'Test Content',
                created_at: '2026-01-30T00:00:00Z',
                updated_at: '2026-01-30T00:00:00Z',
            },
        ];

        notes.set(testNotes);
        expect(get(notes)).toEqual(testNotes);
    });

    it('should be able to set active note', () => {
        const testNote: Note = {
            id: 1,
            title: 'Active Note',
            content: 'Active Content',
            created_at: '2026-01-30T00:00:00Z',
            updated_at: '2026-01-30T00:00:00Z',
        };

        activeNote.set(testNote);
        expect(get(activeNote)).toEqual(testNote);
    });
});
