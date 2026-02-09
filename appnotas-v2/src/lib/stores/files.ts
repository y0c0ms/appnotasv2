import { writable } from 'svelte/store';

export interface OpenFile {
    path: string;
    content: string;
    modified: boolean;
    language: string;
    type?: 'text' | 'pdf';
}

export const openFiles = writable<OpenFile[]>([]);
export const activeFile = writable<OpenFile | null>(null);
export const currentDirectory = writable<string>('');
export const terminalVisible = writable<boolean>(true); // Terminal visible by default
export const terminalHeight = writable<number>(250); // Default terminal height in pixels
