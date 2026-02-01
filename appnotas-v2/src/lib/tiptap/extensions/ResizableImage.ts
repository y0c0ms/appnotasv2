import Image from '@tiptap/extension-image';
import { SvelteNodeViewRenderer } from 'svelte-tiptap';
import ImageResize from '../../components/tiptap/ImageResize.svelte';

export const ResizableImage = Image.extend({
    name: 'resizableImage',

    addAttributes() {
        return {
            ...this.parent?.(),
            width: {
                default: null,
                renderHTML: (attributes) => {
                    if (!attributes.width) return {};
                    return { width: attributes.width };
                },
                parseHTML: (element) => element.getAttribute('width')
            },
            height: {
                default: null,
                renderHTML: (attributes) => {
                    if (!attributes.height) return {};
                    return { height: attributes.height };
                },
                parseHTML: (element) => element.getAttribute('height')
            }
        };
    },

    addNodeView() {
        return SvelteNodeViewRenderer(ImageResize);
    }
});
