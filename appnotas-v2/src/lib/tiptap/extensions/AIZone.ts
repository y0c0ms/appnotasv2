import { Extension } from '@tiptap/core';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export interface AIZoneOptions {
    HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        aiZone: {
            setAIZone: (from: number, to: number) => ReturnType,
            unsetAIZone: () => ReturnType,
        }
    }
}

export const AIZone = Extension.create<AIZoneOptions>({
    name: 'aiZone',

    addOptions() {
        return {
            HTMLAttributes: {
                class: 'ai-improvement-zone',
            },
        };
    },

    addStorage() {
        return {
            zones: [] as { from: number; to: number }[],
        };
    },

    addCommands() {
        return {
            setAIZone: (from: number, to: number) => ({ tr, dispatch }) => {
                if (dispatch) {
                    this.storage.zones = [{ from, to }];
                    tr.setMeta('aiZone', { from, to });
                }
                return true;
            },
            unsetAIZone: () => ({ tr, dispatch }) => {
                if (dispatch) {
                    this.storage.zones = [];
                    tr.setMeta('aiZone', null);
                }
                return true;
            },
        };
    },

    addProseMirrorPlugins() {
        const { HTMLAttributes } = this.options;

        return [
            new Plugin({
                key: new PluginKey('aiZone'),
                state: {
                    init() {
                        return DecorationSet.empty;
                    },
                    apply: (tr, set) => {
                        // Map existing decorations through the transaction
                        set = set.map(tr.mapping, tr.doc);

                        const meta = tr.getMeta('aiZone');
                        if (meta === null) {
                            return DecorationSet.empty;
                        }

                        if (meta) {
                            const { from, to } = meta;
                            const decos = [
                                Decoration.inline(from, to, {
                                    class: HTMLAttributes.class,
                                }),
                                Decoration.widget(from, () => {
                                    const span = document.createElement('span');
                                    span.className = 'ai-zone-spinner';
                                    span.innerHTML = '✨';
                                    return span;
                                })
                            ];
                            return DecorationSet.create(tr.doc, decos);
                        }

                        return set;
                    },
                },
                props: {
                    decorations(state) {
                        return this.getState(state);
                    },
                },
            }),
        ];
    },
});
