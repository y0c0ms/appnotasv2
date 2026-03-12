export function detectLanguage(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const map: Record<string, string> = {
        // JavaScript family
        js: 'javascript',
        jsx: 'javascript',
        mjs: 'javascript',
        cjs: 'javascript',

        // TypeScript
        ts: 'typescript',
        tsx: 'typescript',

        // Web
        html: 'html',
        htm: 'html',
        css: 'css',
        scss: 'css',
        sass: 'css',
        less: 'css',

        // Markdown
        md: 'markdown',
        markdown: 'markdown',

        // Python
        py: 'python',
        pyw: 'python',
        pyi: 'python',

        // Rust
        rs: 'rust',

        // C/C++
        c: 'cpp',
        cpp: 'cpp',
        h: 'cpp',
        hpp: 'cpp',
        cc: 'cpp',
        hh: 'cpp',

        // Java
        java: 'java',
        class: 'java',

        // PHP
        php: 'php',

        // Go
        go: 'go',

        // Data formats
        json: 'json',
        xml: 'xml',
        svg: 'xml',
        yaml: 'yaml',
        yml: 'yaml',
        sql: 'sql',
        toml: 'text',

        // Config files
        gitignore: 'text',
        env: 'text',
        txt: 'text'
    };
    return map[ext || ''] || 'text';
}

export function formatFileSize(bytes: number | null): string {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function getFilename(path: string): string {
    return path.split(/[/\\]/).pop() || path;
}
