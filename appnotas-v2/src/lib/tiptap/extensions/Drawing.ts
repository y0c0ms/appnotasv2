import { Node, mergeAttributes } from '@tiptap/core';
import { SvelteNodeViewRenderer } from 'svelte-tiptap';
import DrawingNode from '../../components/tiptap/DrawingNode.svelte';

export const Drawing = Node.create({
    name: 'drawing',

    group: 'block',

    atom: true,

    addAttributes() {
        return {
            lines: {
                default: [],
                renderHTML: attributes => ({
                    'data-lines': JSON.stringify(attributes.lines),
                }),
                parseHTML: element => {
                    const data = element.getAttribute('data-lines');
                    try {
                        return data ? JSON.parse(data) : [];
                    } catch {
                        return [];
                    }
                },
            },
            width: {
                default: 500,
                renderHTML: attributes => ({
                    style: `width: ${attributes.width}px`,
                }),
                parseHTML: element => parseInt(element.style.width) || 500,
            },
            height: {
                default: 300,
                renderHTML: attributes => ({
                    style: `height: ${attributes.height}px`,
                }),
                parseHTML: element => parseInt(element.style.height) || 300,
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'div[data-type="drawing"]',
            },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'drawing' })];
    },

    addNodeView() {
        return SvelteNodeViewRenderer(DrawingNode);
    },
});
