import { marked } from 'marked';
import { openFiles, activeFile } from './files';
import { invoke } from '@tauri-apps/api/core';

/**
 * Custom renderer for @code and @file mentions
 */
const renderer = new marked.Renderer();

// Override text rendering to handle @code and @file
const originalText = renderer.text.bind(renderer);
renderer.text = (text) => {
    // Handle @file mentions - clickable links to open files
    text = text.replace(/@file\{([^}]+)\}/g, (match, filepath) => {
        return `<a href="#" class="file-mention" data-filepath="${filepath.trim()}">${filepath.trim()}</a>`;
    });

    // Handle @code mentions - inline code with syntax highlighting
    text = text.replace(/@code\{([^}]+)\}/g, (match, code) => {
        return `<code class="inline-code">${code.trim()}</code>`;
    });

    return originalText(text);
};

marked.setOptions({
    renderer,
    breaks: true,
    gfm: true
});

/**
 * Render markdown with @code and @file support
 */
export function renderMarkdown(content: string): string {
    let html = marked(content) as string;

    // Process checkboxes for to-do lists
    html = html.replace(/\[ \]/g, '<input type="checkbox" disabled />');
    html = html.replace(/\[x\]/gi, '<input type="checkbox" checked disabled />');

    return html;
}

/**
 * Handle clicks on file mentions
 */
export function setupFileMentionHandlers(container: HTMLElement) {
    container.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement;

        if (target.classList.contains('file-mention')) {
            e.preventDefault();
            const filepath = target.getAttribute('data-filepath');

            if (filepath) {
                try {
                    // Read file content
                    const content = await invoke<string>('read_file', { path: filepath });

                    // Determine language from extension
                    const ext = filepath.split('.').pop() || 'text';
                    const languageMap: Record<string, string> = {
                        'js': 'javascript',
                        'ts': 'typescript',
                        'py': 'python',
                        'rs': 'rust',
                        'md': 'markdown',
                        'json': 'json',
                        'html': 'html',
                        'css': 'css'
                    };
                    const language = languageMap[ext] || 'text';

                    // Open in editor
                    openFiles.update(files => {
                        // Check if already open
                        if (files.some(f => f.path === filepath)) {
                            activeFile.set(files.find(f => f.path === filepath)!);
                            return files;
                        }

                        const newFile = {
                            path: filepath,
                            content,
                            language,
                            modified: false
                        };

                        activeFile.set(newFile);
                        return [...files, newFile];
                    });

                    console.log('Opened file from mention:', filepath);
                } catch (error) {
                    console.error('Failed to open file mention:', error);
                }
            }
        }
    });
}
