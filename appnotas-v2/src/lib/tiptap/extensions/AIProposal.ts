import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Slice } from '@tiptap/pm/model';
import { setPendingProposals } from '$lib/stores/ai';

export interface AIProposalOptions {
    HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        aiProposal: {
            insertAIProposal: (content: string, originalContent?: string, range?: any) => ReturnType,
            acceptAIProposal: () => ReturnType,
            rejectAIProposal: () => ReturnType,
        }
    }
}

export const AIProposal = Extension.create<AIProposalOptions>({
    name: 'aiProposal',

    addOptions() {
        return {
            HTMLAttributes: {
                class: 'ai-proposal-highlight',
            },
        };
    },

    addCommands() {
        return {
            insertAIProposal: (content: string, originalContent?: string, range?: any) => ({ tr, dispatch, state }) => {
                if (dispatch) {
                    let from: number, to: number;

                    if (range) {
                        from = range.from;
                        to = range.to;
                    } else {
                        from = state.selection.from;
                        to = state.selection.to;
                    }

                    // Save original content as a ProseMirror Slice (preserves task lists, headings, etc.)
                    const originalSlice = state.doc.slice(from, to);
                    const originalSliceJSON = JSON.stringify(originalSlice.toJSON());

                    // Insert the AI response as plain text (reliable insertion)
                    // The key fix is in REJECT where we restore the structured Slice
                    tr.insertText(content, from, to);

                    const newTo = from + content.length;
                    const id = Math.random().toString(36).substr(2, 9);

                    console.log('[AIProposal] Setting meta for proposal:', { id, from, to: newTo });

                    tr.setMeta('aiProposal', {
                        action: 'add',
                        id,
                        from,
                        to: newTo,
                        originalSliceJSON
                    });
                }
                return true;
            },
            acceptAIProposal: () => ({ tr, dispatch, state }) => {
                const findProposal = (p: any) =>
                    (p.from <= state.selection.from && p.to >= state.selection.to) ||
                    (state.selection.from >= p.from && state.selection.from <= p.to) ||
                    (p.from >= state.selection.from && p.to <= state.selection.to);

                const proposal = this.storage.proposals.find(findProposal);
                if (proposal && dispatch) {
                    tr.setMeta('aiProposal', { action: 'accept', id: proposal.id });
                    return true;
                }
                return false;
            },
            rejectAIProposal: () => ({ tr, dispatch, state, editor }) => {
                const findProposal = (p: any) =>
                    (p.from <= state.selection.from && p.to >= state.selection.to) ||
                    (state.selection.from >= p.from && state.selection.from <= p.to) ||
                    (p.from >= state.selection.from && p.to <= state.selection.to);

                const proposal = this.storage.proposals.find(findProposal);
                if (proposal && dispatch) {
                    // Restore original content from saved ProseMirror Slice (preserves structure!)
                    try {
                        const sliceJSON = JSON.parse(proposal.originalSliceJSON);
                        const originalSlice = Slice.fromJSON(editor.schema, sliceJSON);
                        tr.replace(proposal.from, proposal.to, originalSlice);
                    } catch (e) {
                        console.error('[AIProposal] Failed to restore from slice:', e);
                    }
                    tr.setMeta('aiProposal', { action: 'reject', id: proposal.id });
                    return true;
                }
                return false;
            }
        };
    },

    addStorage() {
        return {
            proposals: [] as { id: string, from: number, to: number, originalSliceJSON: string }[],
        };
    },

    addKeyboardShortcuts() {
        return {};
    },

    addProseMirrorPlugins() {
        const editor = this.editor;
        const pluginKey = new PluginKey('aiProposal');

        return [
            new Plugin({
                key: pluginKey,
                state: {
                    init() {
                        return DecorationSet.empty;
                    },
                    apply: (tr, set) => {
                        set = set.map(tr.mapping, tr.doc);

                        const meta = tr.getMeta('aiProposal');
                        if (meta) {
                            console.log('[AIProposal] Plugin received meta:', meta);
                            if (meta.action === 'add') {
                                const { id, from, to, originalSliceJSON } = meta;
                                this.storage.proposals.push({ id, from, to, originalSliceJSON });

                                const decos: Decoration[] = [];

                                tr.doc.nodesBetween(from, to, (node, pos) => {
                                    if (node.isText) {
                                        const nodeFrom = Math.max(from, pos);
                                        const nodeTo = Math.min(to, pos + node.nodeSize);

                                        if (nodeFrom < nodeTo) {
                                            decos.push(Decoration.inline(nodeFrom, nodeTo, {
                                                class: 'ai-proposal-highlight',
                                                'data-proposal-id': id
                                            }));
                                        }
                                    }
                                });

                                decos.push(Decoration.widget(to, (view, getPos) => {
                                    const div = document.createElement('div');
                                    div.className = 'ai-proposal-actions';

                                    const acceptBtn = document.createElement('button');
                                    acceptBtn.className = 'ai-btn ai-accept';
                                    acceptBtn.textContent = '✓ Accept (Ctrl+Shift+])';
                                    acceptBtn.onclick = (e) => {
                                        e.preventDefault();
                                        const pos = getPos();
                                        if (typeof pos === 'number') {
                                            view.dispatch(view.state.tr.setSelection((view.state.selection.constructor as any).near(view.state.doc.resolve(pos - 1))));
                                            editor.commands.acceptAIProposal();
                                        }
                                    };

                                    const rejectBtn = document.createElement('button');
                                    rejectBtn.className = 'ai-btn ai-reject';
                                    rejectBtn.textContent = '✕ Reject (Ctrl+Shift+[)';
                                    rejectBtn.onclick = (e) => {
                                        e.preventDefault();
                                        const pos = getPos();
                                        if (typeof pos === 'number') {
                                            view.dispatch(view.state.tr.setSelection((view.state.selection.constructor as any).near(view.state.doc.resolve(pos - 1))));
                                            editor.commands.rejectAIProposal();
                                        }
                                    };

                                    div.appendChild(rejectBtn);
                                    div.appendChild(acceptBtn);
                                    return div;
                                }, { side: 1 }));

                                set = set.add(tr.doc, decos);
                            } else if (meta.action === 'accept' || meta.action === 'reject') {
                                this.storage.proposals = this.storage.proposals.filter((p: any) => p.id !== meta.id);
                                return DecorationSet.empty;
                            }
                        }

                        requestAnimationFrame(() => {
                            setPendingProposals(this.storage.proposals.length);
                        });
                        return set;
                    }
                },
                props: {
                    decorations(state) {
                        return pluginKey.getState(state);
                    },
                },
            }),
        ];
    },
});
