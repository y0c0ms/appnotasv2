import { Node, mergeAttributes, InputRule } from '@tiptap/core';

export interface FileLinkOptions {
    HTMLAttributes: Record<string, any>;
    onFileClick?: (path: string) => void;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        fileLink: {
            /**
             * Set a file link
             */
            setFileLink: (attributes: { path: string, name: string }) => ReturnType,
        }
    }
}

export const FileLink = Node.create<FileLinkOptions>({
    name: 'fileLink',

    group: 'inline',

    inline: true,

    selectable: true,

    draggable: true,

    addAttributes() {
        return {
            path: {
                default: null,
            },
            name: {
                default: null,
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'span[data-type="file-link"]',
                getAttrs: (dom) => {
                    if (typeof dom === 'string') return null;
                    return {
                        path: (dom as HTMLElement).getAttribute('data-path'),
                        name: (dom as HTMLElement).getAttribute('data-name') || (dom as HTMLElement).innerText,
                    };
                },
            },
            {
                // Catch markdown-like text if it appears as a node
                tag: 'span',
                getAttrs: (dom) => {
                    const text = (dom as HTMLElement).innerText;
                    const match = text.match(/^@\[(.+)\]\((.+)\)$/);
                    if (match) {
                        return { name: match[1], path: match[2] };
                    }
                    return false;
                }
            }
        ];
    },

    addInputRules() {
        return [
            // Match @[filename](path) (with or without file:/// prefix)
            new InputRule({
                find: /@\[(.+)\]\((?!file:\/\/)(.+)\)\s$/,
                handler: ({ state, range, match }) => {
                    const [, name, path] = match;
                    const { tr } = state;
                    if (path && name) {
                        tr.replaceWith(range.from, range.to, this.type.create({ path, name }));
                    }
                },
            }),
             new InputRule({
                find: /@\[(.+)\]\(file:\/\/\/(.+)\)\s$/,
                handler: ({ state, range, match }) => {
                    const [, name, path] = match;
                    const { tr } = state;
                    if (path && name) {
                        tr.replaceWith(range.from, range.to, this.type.create({ path, name }));
                    }
                },
            }),
        ];
    },

    renderHTML({ node, HTMLAttributes }) {
        const name = node.attrs.name || node.attrs.path?.split(/[\\/]/).pop() || 'File';
        return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-type': 'file-link' }), name];
    },

    addNodeView() {
        return ({ node, HTMLAttributes, editor }) => {
            const dom = document.createElement('span');
            dom.classList.add('file-link-widget');
            dom.setAttribute('data-path', node.attrs.path);

            const icon = document.createElement('span');
            icon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline; vertical-align:middle; margin-right:4px;"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>';
            dom.append(icon);

            const text = document.createElement('span');
            text.innerText = node.attrs.name || node.attrs.path?.split(/[\\/]/).pop() || 'File';
            dom.append(text);

            dom.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.options.onFileClick) {
                    this.options.onFileClick(node.attrs.path);
                }
            });

            return {
                dom,
            };
        };
    },

    addStorage() {
        return {
            markdown: {
                serialize(state: any, node: any) {
                    const name = node.attrs.name || node.attrs.path?.split(/[\\/]/).pop() || 'File';
                    state.write(`@[${name}](${node.attrs.path})`);
                },
                parse: {
                    setup(markdownit: any) {
                        markdownit.use((md: any) => {
                            md.inline.ruler.before('emphasis', 'file_link', (state: any, silent: any) => {
                                const match = state.src.slice(state.pos).match(/^@\[([^\]]+)\]\(([^)]+)\)/);
                                if (!match) return false;
                                
                                if (!silent) {
                                    const token = state.push('file_link', 'span', 0);
                                    token.attrs = [['data-path', match[2]], ['data-name', match[1]], ['data-type', 'file-link']];
                                    token.content = match[1];
                                }
                                state.pos += match[0].length;
                                return true;
                            });
                        });
                    }
                }
            }
        };
    },

    addCommands() {
        return {
            setFileLink: attributes => ({ commands }) => {
                return commands.insertContent({
                    type: this.name,
                    attrs: attributes,
                });
            },
        };
    },
});
