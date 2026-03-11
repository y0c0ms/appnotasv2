import { writable } from 'svelte/store';

export type FocusArea = 'list' | 'editor' | 'file-tabs' | 'settings' | 'terminal' | 'file-search' | 'note-search' | 'file-tree';

export const focusArea = writable<FocusArea>('list');

// Order: search → list → editor → terminal → file-tabs (cycle)
// 'file-search' and 'note-search' occupy the same slot - which one is used depends on active tab
export function nextFocusArea(current: FocusArea): FocusArea {
    // Map both search types to a generic position in the cycle
    const normalized = (current === 'file-search' || current === 'note-search') ? 'search' : current;
    const areas = ['search', 'list', 'editor', 'terminal', 'file-tabs'];
    const index = areas.indexOf(normalized);
    if (index === -1) return 'list';
    const nextKey = areas[(index + 1) % areas.length];
    // 'search' is just a placeholder, actual focus area will be determined by shortcuts.ts
    return nextKey as FocusArea;
}

export function prevFocusArea(current: FocusArea): FocusArea {
    const normalized = (current === 'file-search' || current === 'note-search') ? 'search' : current;
    const areas = ['search', 'list', 'editor', 'terminal', 'file-tabs'];
    const index = areas.indexOf(normalized);
    if (index === -1) return 'list';
    const prevKey = areas[(index - 1 + areas.length) % areas.length];
    return prevKey as FocusArea;
}
