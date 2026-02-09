import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
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
                    // console.log('[AIProposal] Inserting proposal:', content.substring(0, 20) + '...');
                    let from, to;

                    if (range) {
                        from = range.from;
                        to = range.to;
                    } else {
                        from = state.selection.from;
                        to = state.selection.to;
                    }

                    const originalText = originalContent !== undefined ? originalContent : state.doc.textBetween(from, to, '\n');

                    // Replace content
                    tr.insertText(content, from, to);

                    // Add proposal metadata
                    const newTo = from + content.length;
                    const id = Math.random().toString(36).substr(2, 9);

                    console.log('[AIProposal] Setting meta for proposal:', { id, from, to: newTo });

                    tr.setMeta('aiProposal', {
                        action: 'add',
                        id,
                        from,
                        to: newTo,
                        originalText
                    });
                }
                return true;
            },
            acceptAIProposal: () => ({ tr, dispatch, state }) => {
                // console.log('[AIProposal] Accepting proposal');
                const proposal = this.storage.proposals.find((p: any) => p.from <= state.selection.from && p.to >= state.selection.to);
                if (proposal && dispatch) {
                    tr.setMeta('aiProposal', { action: 'accept', id: proposal.id });
                    return true;
                }
                // Try finding any proposal if selection is inside
                const anyProposal = this.storage.proposals.find((p: any) =>
                    (state.selection.from >= p.from && state.selection.from <= p.to) ||
                    (p.from >= state.selection.from && p.to <= state.selection.to)
                );
                if (anyProposal && dispatch) {
                    tr.setMeta('aiProposal', { action: 'accept', id: anyProposal.id });
                    return true;
                }
                return false;
            },
            rejectAIProposal: () => ({ tr, dispatch, state }) => {
                const proposal = this.storage.proposals.find((p: any) => p.from <= state.selection.from && p.to >= state.selection.to);
                if (proposal && dispatch) {
                    // Revert text
                    tr.insertText(proposal.originalText, proposal.from, proposal.to);
                    tr.setMeta('aiProposal', { action: 'reject', id: proposal.id });
                    return true;
                }
                // Try finding any proposal if selection is inside
                const anyProposal = this.storage.proposals.find((p: any) =>
                    (state.selection.from >= anyProposal.from && state.selection.from <= anyProposal.to) ||
                    (anyProposal.from >= state.selection.from && anyProposal.to <= state.selection.to)
                );
                if (anyProposal && dispatch) {
                    // Revert text
                    tr.insertText(anyProposal.originalText, anyProposal.from, anyProposal.to);
                    tr.setMeta('aiProposal', { action: 'reject', id: anyProposal.id });
                    return true;
                }
                return false;
            }
        };
    },

    addStorage() {
        return {
            proposals: [] as { id: string, from: number, to: number, originalText: string }[],
        };
    },

    // Keyboard shortcuts handled in editor component for dynamic configuration
    addKeyboardShortcuts() {
        return {};
    },

    addProseMirrorPlugins() {
        const { HTMLAttributes } = this.options;
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
                        // Adjust existing decorations mapping
                        set = set.map(tr.mapping, tr.doc);

                        const meta = tr.getMeta('aiProposal');
                        if (meta) {
                            console.log('[AIProposal] Plugin received meta:', meta);
                            if (meta.action === 'add') {
                                const { id, from, to, originalText } = meta;
                                // Store in storage (hacky but works for command access)
                                this.storage.proposals.push({ id, from, to, originalText });

                                const decos: Decoration[] = [];

                                // Create inline decorations for each text node in the range
                                // This handles multiline content correctly
                                console.log(`[AIProposal] Traversing nodes from ${from} to ${to}`);
                                tr.doc.nodesBetween(from, to, (node, pos) => {
                                    console.log(`[AIProposal] Visiting node: ${node.type.name}, isText: ${node.isText}, pos: ${pos}, size: ${node.nodeSize}`);
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
                                console.log('[AIProposal] Generated decorations count:', decos.length);

                                // Add widget at the end
                                decos.push(Decoration.widget(to, (view, getPos) => {
                                    const div = document.createElement('div');
                                    div.className = 'ai-proposal-actions';

                                    const acceptBtn = document.createElement('button');
                                    acceptBtn.className = 'ai-btn ai-accept';
                                    acceptBtn.textContent = '✓ Accept (Ctrl+Shift+])';
                                    acceptBtn.onclick = (e) => {
                                        e.preventDefault();
                                        // Ensure selection is in proposal range or just pass ID
                                        const pos = getPos(); // Widget position is at 'to'
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
                                }, { side: 1 })); // side > 0 ensures it sticks after the text

                                set = set.add(tr.doc, decos);
                            } else if (meta.action === 'accept' || meta.action === 'reject') {
                                // Remove stored proposal
                                this.storage.proposals = this.storage.proposals.filter((p: any) => p.id !== meta.id);

                                // Remove decorations for this ID
                                // set = set.remove(set.find(undefined, undefined, spec => spec.data?.proposalId === meta.id));
                                // Re-create set without the match (filter is hard on DecorationSet)
                                // Actually simplistic approach: just clear everything if we assume 1 proposal at a time mostly
                                // or iterate. For now, let's filter:
                                // const newDecos = set.find().filter(d => d.spec['data-proposal-id'] !== meta.id && (d.spec as any).side !== 1); 
                                // Widget doesn't have data-proposal-id easily attached unless we add it to spec
                                // Simplest: return DecorationSet.empty if we only support single proposal.
                                return DecorationSet.empty;
                            }
                        }

                        // Sync count to store
                        setPendingProposals(this.storage.proposals.length);

                        return set;
                    }
                },
                props: {
                    decorations(state) {
                        const decos = pluginKey.getState(state);

                        return decos;
                    },
                },
            }),
        ];
    },
});
