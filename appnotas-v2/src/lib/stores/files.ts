import { writable, get } from 'svelte/store';

export interface OpenFile {
    path: string;
    content: string;
    modified: boolean;
    language: string;
    type?: 'text' | 'pdf';
}

export const openFiles = writable<OpenFile[]>([]);
export const activeFile = writable<OpenFile | null>(null);

// Unload content of inactive unmodified tabs to save memory
activeFile.subscribe((file) => {
    if (file) {
        openFiles.update(files => 
            files.map(f => {
                if (f.path !== file.path && !f.modified && f.content !== '') {
                    return { ...f, content: '' }; // drop payload
                }
                return f;
            })
        );
    }
});

export const currentDirectory = writable<string>('');
export const terminalVisible = writable<boolean>(true); // Terminal visible by default
export const terminalHeight = writable<number>(250); // Default terminal height in pixels

export const terminalCommandBus = writable<string | null>(null);
