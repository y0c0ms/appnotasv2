import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import css from 'highlight.js/lib/languages/css';
import html from 'highlight.js/lib/languages/xml';
import json from 'highlight.js/lib/languages/json';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', html);
hljs.registerLanguage('json', json);

/**
 * Widget for markdown code blocks - styled like old app
 */
class CodeBlockWidget extends WidgetType {
    constructor(
        readonly lang: string,
        readonly code: string,
        readonly onUpdate: (newCode: string) => void,
        readonly onDelete: () => void
    ) {
        super();
    }

    toDOM() {
        const wrapper = document.createElement('div');
        wrapper.className = 'cm-code-block-widget';
        wrapper.contentEditable = 'false';

        // Create line numbers
        const lines = this.code.split('\n');
        const lineNumbers = lines.map((_, i) => i + 1).join('\n');

        // Highlight code
        let highlightedCode = this.code;
        try {
            if (hljs.getLanguage(this.lang)) {
                highlightedCode = hljs.highlight(this.code, { language: this.lang }).value;
            }
        } catch (e) {
            console.warn('Failed to highlight code:', e);
        }

        wrapper.innerHTML = `
            <div class="code-block-header">
                <span class="code-block-lang">${this.lang}</span>
                <div class="code-block-actions">
                    <button class="code-btn code-copy" title="Copy code">📋</button>
                    <button class="code-btn code-delete" title="Delete block">🗑️</button>
                </div>
            </div>
            <div class="code-block-content">
                <pre class="code-line-numbers">${lineNumbers}</pre>
                <pre class="code-editor" contenteditable="true" spellcheck="false">${this.code}</pre>
            </div>
        `;

        // Add event listeners
        const copyBtn = wrapper.querySelector('.code-copy');
        const deleteBtn = wrapper.querySelector('.code-delete');
        const editor = wrapper.querySelector('.code-editor');

        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(this.code);
            });
        }

        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                this.onDelete();
            });
        }

        if (editor) {
            editor.addEventListener('blur', (e) => {
                const target = e.target as HTMLElement;
                const newCode = target.textContent || '';
                this.onUpdate(newCode);
            });

            editor.addEventListener('input', (e) => {
                const target = e.target as HTMLElement;
                // Update line numbers
                const lines = (target.textContent || '').split('\n');
                const lineNumbersEl = wrapper.querySelector('.code-line-numbers');
                if (lineNumbersEl) {
                    lineNumbersEl.textContent = lines.map((_, i) => i + 1).join('\n');
                }
            });
        }

        return wrapper;
    }
}

/**
 * Widget for clickable checkboxes
 */
class CheckboxWidget extends WidgetType {
    constructor(readonly checked: boolean, readonly onToggle: () => void) {
        super();
    }

    toDOM() {
        const wrapper = document.createElement('span');
        wrapper.className = 'cm-checkbox-widget';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = this.checked;
        checkbox.className = 'cm-checkbox';

        checkbox.addEventListener('click', (e) => {
            e.preventDefault();
            this.onToggle();
        });

        wrapper.appendChild(checkbox);
        return wrapper;
    }
}

/**
 * Widget for file mentions
 */
class FileLinkWidget extends WidgetType {
    constructor(readonly filename: string, readonly filepath: string, readonly onClick: () => void) {
        super();
    }

    toDOM() {
        const link = document.createElement('a');
        link.className = 'cm-file-link';
        link.textContent = this.filename;
        link.href = '#';

        link.addEventListener('click', (e) => {
            e.preventDefault();
            this.onClick();
        });

        return link;
    }
}

/**
 * Parse markdown code blocks and create decorations
 */
function createDecorations(
    view: EditorView,
    onCodeUpdate: (from: number, to: number, newCode: string) => void,
    onCodeDelete: (from: number, to: number) => void,
    onCheckboxToggle: (pos: number) => void,
    onFileClick: (path: string) => void
) {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = view.state.doc;
    const text = doc.toString();

    console.log('🔍 Creating decorations, text length:', text.length);

    // Match code blocks ```lang\ncode\n```
    const codeRegex = /```(\w+)\n([\s\S]*?)```/g;
    let match;
    let codeBlockCount = 0;

    while ((match = codeRegex.exec(text)) !== null) {
        codeBlockCount++;
        const from = match.index;
        const to = from + match[0].length;
        const lang = match[1];
        const code = match[2].trim();

        console.log(`📦 Code block ${codeBlockCount} found:`, {
            from,
            to,
            lang,
            codeLength: code.length
        });

        builder.add(
            from,
            to,
            Decoration.replace({
                widget: new CodeBlockWidget(
                    lang,
                    code,
                    (newCode) => onCodeUpdate(from, to, newCode),
                    () => onCodeDelete(from, to)
                )
            })
        );
    }

    console.log(`✅ Found ${codeBlockCount} code blocks`);

    // Match checkboxes [ ] and [x]
    const checkboxRegex = /\[([ x])\]/gi;
    const lines = text.split('\n');
    let offset = 0;

    for (const line of lines) {
        let lineMatch;
        while ((lineMatch = checkboxRegex.exec(line)) !== null) {
            const pos = offset + lineMatch.index;
            const checked = lineMatch[1].toLowerCase() === 'x';

            builder.add(
                pos,
                pos + 3,
                Decoration.replace({
                    widget: new CheckboxWidget(checked, () => onCheckboxToggle(pos))
                })
            );
        }
        offset += line.length + 1; // +1 for newline
    }

    // Match markdown links [text](file:///path)
    const linkRegex = /\[([^\]]+)\]\(file:\/\/\/([^)]+)\)/g;
    while ((match = linkRegex.exec(text)) !== null) {
        const from = match.index;
        const to = from + match[0].length;
        const filename = match[1];
        const filepath = match[2];

        builder.add(
            from,
            to,
            Decoration.replace({
                widget: new FileLinkWidget(filename, filepath, () => onFileClick(filepath))
            })
        );
    }

    return builder.finish();
}

/**
 * ViewPlugin for rich decorations
 */
export function richNoteDecorations(
    onCodeUpdate: (from: number, to: number, newCode: string) => void,
    onCodeDelete: (from: number, to: number) => void,
    onCheckboxToggle: (pos: number) => void,
    onFileClick: (path: string) => void
) {
    return ViewPlugin.fromClass(
        class {
            decorations;

            constructor(view: EditorView) {
                this.decorations = createDecorations(
                    view,
                    onCodeUpdate,
                    onCodeDelete,
                    onCheckboxToggle,
                    onFileClick
                );
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = createDecorations(
                        update.view,
                        onCodeUpdate,
                        onCodeDelete,
                        onCheckboxToggle,
                        onFileClick
                    );
                }
            }
        },
        {
            decorations: (v) => v.decorations
        }
    );
}

/**
 * Theme for rich decorations - styled like old app
 */
export const richNoteTheme = EditorView.theme({
    '.cm-code-block-widget': {
        margin: '1rem 0',
        borderRadius: '6px',
        overflow: 'hidden',
        backgroundColor: '#1e1e1e',
        border: '1px solid #3a3a3a'
    },
    '.code-block-header': {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0.5rem 1rem',
        backgroundColor: '#2a2a2a',
        borderBottom: '1px solid #3a3a3a'
    },
    '.code-block-lang': {
        color: '#4a9eff',
        fontWeight: '500',
        textTransform: 'uppercase',
        fontSize: '0.75rem'
    },
    '.code-block-actions': {
        display: 'flex',
        gap: '0.5rem'
    },
    '.code-btn': {
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontSize: '0.9rem',
        opacity: '0.7',
        transition: 'opacity 0.2s',
        '&:hover': {
            opacity: '1'
        }
    },
    '.code-block-content': {
        display: 'flex',
        overflow: 'auto'
    },
    '.code-line-numbers': {
        padding: '1rem 0.75rem',
        margin: '0',
        color: '#666',
        textAlign: 'right',
        userSelect: 'none',
        borderRight: '1px solid #3a3a3a',
        fontFamily: '"Courier New", monospace',
        fontSize: '0.9rem',
        lineHeight: '1.6'
    },
    '.code-editor': {
        flex: '1',
        padding: '1rem',
        margin: '0',
        color: '#ccc',
        fontFamily: '"Courier New", monospace',
        fontSize: '0.9rem',
        lineHeight: '1.6',
        outline: 'none',
        whiteSpace: 'pre'
    },
    '.cm-checkbox-widget': {
        display: 'inline-flex',
        alignItems: 'center',
        marginRight: '0.5rem',
        verticalAlign: 'middle'
    },
    '.cm-checkbox': {
        cursor: 'pointer',
        width: '1.1rem',
        height: '1.1rem',
        accentColor: '#4a9eff'
    },
    '.cm-checkbox-line': {
        display: 'flex',
        alignItems: 'center',
        padding: '0.25rem 0',
        '&.completed': {
            textDecoration: 'line-through',
            opacity: '0.6',
            color: '#888'
        }
    },
    '.cm-file-link': {
        color: '#4a9eff',
        textDecoration: 'none',
        padding: '0.2rem 0.5rem',
        background: 'rgba(74, 158, 255, 0.1)',
        borderRadius: '3px',
        border: '1px solid rgba(74, 158, 255, 0.3)',
        cursor: 'pointer',
        transition: 'all 0.2s',
        '&:hover': {
            background: 'rgba(74, 158, 255, 0.2)',
            borderColor: 'rgba(74, 158, 255, 0.5)'
        }
    }
});
