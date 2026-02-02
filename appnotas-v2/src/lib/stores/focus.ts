import { writable } from 'svelte/store';

export type FocusArea = 'list' | 'editor' | 'file-tabs' | 'settings';

export const focusArea = writable<FocusArea>('list');

export function nextFocusArea(current: FocusArea): FocusArea {
    const areas: FocusArea[] = ['list', 'editor', 'file-tabs'];
    const index = areas.indexOf(current);
    return areas[(index + 1) % areas.length];
}

export function prevFocusArea(current: FocusArea): FocusArea {
    const areas: FocusArea[] = ['list', 'editor', 'file-tabs'];
    const index = areas.indexOf(current);
    return areas[(index - 1 + areas.length) % areas.length];
}
