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
        const pluginKey = new PluginKey('aiZone');

        return [
            new Plugin({
                key: pluginKey,
                state: {
                    init() {
                        return DecorationSet.empty;
                    },
                    apply: (tr, set) => {
                        set = set.map(tr.mapping, tr.doc);
                        const meta = tr.getMeta('aiZone');
                        if (meta === null) return DecorationSet.empty;
                        if (meta) {
                            const { from, to } = meta;
                            const decos = [
                                Decoration.inline(from, to, { class: 'ai-improvement-zone' })
                            ];
                            return DecorationSet.create(tr.doc, decos);
                        }
                        return set;
                    },
                },
                props: {
                    decorations(state) {
                        return pluginKey.getState(state);
                    },
                    handleKeyDown(view, event) {
                        const dr = pluginKey.getState(view.state);
                        if (!dr || dr.find().length === 0) return false;
                        const { selection } = view.state;
                        const isOverlapping = dr.find().some((deco: any) => 
                            (selection.from >= deco.from && selection.from <= deco.to) ||
                            (selection.to >= deco.from && selection.to <= deco.to)
                        );
                        if (isOverlapping && event.key !== 'Escape') return true;
                        return false;
                    },
                },
            }),
        ];
    },
});
