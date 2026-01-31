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
                        name: (dom as HTMLElement).innerText,
                    };
                },
            },
        ];
    },

    addInputRules() {
        return [
            // Match @[filename](file:///path) followed by space
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

    renderHTML({ HTMLAttributes }) {
        return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-type': 'file-link' }), HTMLAttributes.name];
    },

    addNodeView() {
        return ({ node, HTMLAttributes, editor }) => {
            const dom = document.createElement('span');
            dom.classList.add('file-link-widget');
            dom.setAttribute('data-path', node.attrs.path);

            const icon = document.createElement('span');
            icon.innerHTML = '📄 ';
            dom.append(icon);

            const text = document.createElement('span');
            text.innerText = node.attrs.name;
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
