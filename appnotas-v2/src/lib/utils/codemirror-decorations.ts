import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

/**
 * Widget for @code inline code snippets
 */
class CodeWidget extends WidgetType {
    constructor(readonly code: string) {
        super();
    }

    toDOM() {
        const span = document.createElement('span');
        span.className = 'cm-inline-code';
        span.textContent = this.code;
        return span;
    }
}

/**
 * Widget for @file clickable links
 */
class FileWidget extends WidgetType {
    constructor(readonly filepath: string, readonly onClick: (path: string) => void) {
        super();
    }

    toDOM() {
        const link = document.createElement('a');
        link.className = 'cm-file-mention';
        link.textContent = this.filepath;
        link.href = '#';
        link.onclick = (e) => {
            e.preventDefault();
            this.onClick(this.filepath);
        };
        return link;
    }
}

/**
 * Widget for checkboxes
 */
class CheckboxWidget extends WidgetType {
    constructor(readonly checked: boolean) {
        super();
    }

    toDOM() {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = this.checked;
        input.disabled = true;
        input.className = 'cm-checkbox';
        return input;
    }
}

/**
 * Create decorations for @code, @file, and checkboxes
 */
function createDecorations(view: EditorView, onFileClick: (path: string) => void) {
    const builder = new RangeSetBuilder<Decoration>();
    const text = view.state.doc.toString();

    // Match @code{...}
    const codeRegex = /@code\{([^}]+)\}/g;
    let match;

    while ((match = codeRegex.exec(text)) !== null) {
        const from = match.index;
        const to = from + match[0].length;
        const code = match[1];

        // Replace the entire @code{...} with a widget
        builder.add(
            from,
            to,
            Decoration.replace({
                widget: new CodeWidget(code)
            })
        );
    }

    // Match @file{...}
    const fileRegex = /@file\{([^}]+)\}/g;
    while ((match = fileRegex.exec(text)) !== null) {
        const from = match.index;
        const to = from + match[0].length;
        const filepath = match[1];

        builder.add(
            from,
            to,
            Decoration.replace({
                widget: new FileWidget(filepath, onFileClick)
            })
        );
    }

    // Match checkboxes [ ] and [x]
    const checkboxRegex = /\[([ x])\]/gi;
    while ((match = checkboxRegex.exec(text)) !== null) {
        const from = match.index;
        const to = from + match[0].length;
        const checked = match[1].toLowerCase() === 'x';

        builder.add(
            from,
            to,
            Decoration.replace({
                widget: new CheckboxWidget(checked)
            })
        );
    }

    return builder.finish();
}

/**
 * ViewPlugin for inline decorations
 */
export function inlineDecorations(onFileClick: (path: string) => void) {
    return ViewPlugin.fromClass(
        class {
            decorations;

            constructor(view: EditorView) {
                this.decorations = createDecorations(view, onFileClick);
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = createDecorations(update.view, onFileClick);
                }
            }
        },
        {
            decorations: (v) => v.decorations
        }
    );
}

/**
 * Theme for inline decorations
 */
export const inlineDecorationsTheme = EditorView.theme({
    '.cm-inline-code': {
        backgroundColor: '#2a2a2a',
        padding: '0.2rem 0.4rem',
        borderRadius: '3px',
        fontFamily: 'Courier New, monospace',
        color: '#4af',
        fontSize: '0.9em'
    },
    '.cm-file-mention': {
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
    },
    '.cm-checkbox': {
        marginRight: '0.5rem',
        cursor: 'not-allowed'
    }
});
