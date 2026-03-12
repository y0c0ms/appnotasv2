import { StateField, StateEffect, RangeSet } from '@codemirror/state';
import type { Extension, Range } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, keymap } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { setPendingProposals } from '$lib/stores/ai';

// Define effects for adding, accepting, and rejecting proposals
export const addProposal = StateEffect.define<{ from: number; to: number; id: string; originalText: string }>();
export const acceptProposal = StateEffect.define<string>(); // id
export const rejectProposal = StateEffect.define<string>(); // id

interface Proposal {
    from: number;
    to: number;
    id: string;
    originalText: string;
}

// Widget for the Accept/Reject buttons
class ProposalWidget extends WidgetType {
    constructor(readonly id: string) {
        super();
    }

    toDOM() {
        const wrap = document.createElement('div');
        wrap.className = 'cm-ai-proposal-widget';

        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'cm-ai-btn cm-ai-accept';
        acceptBtn.textContent = '✓ Accept (Ctrl+Shift+])';
        acceptBtn.onclick = (e) => {
            e.preventDefault();
            const event = new CustomEvent('ai-proposal-action', {
                bubbles: true,
                detail: { action: 'accept', id: this.id }
            });
            wrap.dispatchEvent(event);
        };

        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'cm-ai-btn cm-ai-reject';
        rejectBtn.textContent = '✕ Reject (Ctrl+Shift+[)';
        rejectBtn.onclick = (e) => {
            e.preventDefault();
            const event = new CustomEvent('ai-proposal-action', {
                bubbles: true,
                detail: { action: 'reject', id: this.id }
            });
            wrap.dispatchEvent(event);
        };

        wrap.appendChild(rejectBtn);
        wrap.appendChild(acceptBtn);
        return wrap;
    }

    ignoreEvent() { return true; }
}

// State field to track proposals
export const proposalField = StateField.define<DecorationSet>({
    create() {
        return Decoration.none;
    },
    update(decorations, tr) {
        decorations = decorations.map(tr.changes);

        for (const e of tr.effects) {
            if (e.is(addProposal)) {
                // console.log('[AIProposal] Processing addProposal effect:', e.value);
                const { from, to, id, originalText } = e.value;
                const mark = Decoration.mark({
                    class: 'cm-ai-proposal-mark',
                    attributes: { 'data-proposal-id': id, 'data-original-text': originalText }
                });
                const widget = Decoration.widget({
                    widget: new ProposalWidget(id),
                    side: 1,
                    block: true
                });

                decorations = decorations.update({
                    add: [
                        mark.range(from, to),
                        widget.range(to)
                    ]
                });
            } else if (e.is(acceptProposal)) {
                // Remove decorations for this ID
                decorations = decorations.update({
                    filter: (from, to, value) => {
                        if (value.spec.widget instanceof ProposalWidget) return value.spec.widget.id !== e.value;
                        return value.spec.attributes?.['data-proposal-id'] !== e.value;
                    }
                });
            } else if (e.is(rejectProposal)) {
                decorations = decorations.update({
                    filter: (from, to, value) => {
                        if (value.spec.widget instanceof ProposalWidget) return value.spec.widget.id !== e.value;
                        return value.spec.attributes?.['data-proposal-id'] !== e.value;
                    }
                });
            }
        }

        // Count widgets to update global store
        let count = 0;
        const iter = decorations.iter();
        while (iter.value) {
            if (iter.value.spec.widget instanceof ProposalWidget) count++;
            iter.next();
        }

        // Sync to store - wrap in requestAnimationFrame to avoid Svelte 5 state mutation issues during update
        requestAnimationFrame(() => {
            setPendingProposals(count);
        });

        return decorations;
    },
    provide: f => EditorView.decorations.from(f)
});

// Helper to find active proposal at cursor
export function getProposalAtCursor(state: any): { id: string, from: number, to: number, originalText: string } | null {
    const decos = state.field(proposalField);
    const cursor = state.selection.main.head;
    let found = null;
    decos.between(cursor, cursor, (from: number, to: number, value: Decoration) => {
        if (value.spec.attributes?.['data-proposal-id']) {
            found = { id: value.spec.attributes['data-proposal-id'], from, to, originalText: value.spec.attributes['data-original-text'] };
        }
    });
    return found;
}

// Helper to find the FIRST proposal (for queue)
export function getFirstProposal(state: any): { id: string, from: number, to: number, originalText: string } | null {
    let found = null;
    try {
        const iter = state.field(proposalField).iter();
        while (iter.value) {
            if (iter.value.spec.attributes?.['data-proposal-id']) {
                found = {
                    id: iter.value.spec.attributes['data-proposal-id'],
                    from: iter.from,
                    to: iter.to,
                    originalText: iter.value.spec.attributes['data-original-text']
                };
                if (found) break; // Found first
            }
            iter.next();
        }
    } catch (e) { console.error(e); }
    return found;
}

// Keymap
export const aiProposalKeymap = keymap.of([
    {
        key: 'Ctrl-Shift-]',
        run: (view) => {
            let proposal = getProposalAtCursor(view.state);
            if (!proposal) {
                proposal = getFirstProposal(view.state);
            }

            if (proposal) {
                view.dispatch({
                    effects: acceptProposal.of(proposal.id),
                    scrollIntoView: true,
                    selection: { anchor: proposal.from }
                });
                return true;
            }
            return false;
        }
    },
    {
        key: 'Ctrl-Shift-[',
        run: (view) => {
            let proposal = getProposalAtCursor(view.state);
            if (!proposal) {
                proposal = getFirstProposal(view.state);
            }

            if (proposal) {
                // Revert text
                view.dispatch({
                    changes: { from: proposal.from, to: proposal.to, insert: proposal.originalText },
                    effects: rejectProposal.of(proposal.id),
                    scrollIntoView: true,
                    selection: { anchor: proposal.from }
                });
                return true;
            }
            return false;
        }
    }
]);

export function aiProposalTheme() {
    return EditorView.baseTheme({
        '.cm-ai-proposal-mark': { backgroundColor: 'rgba(74, 158, 255, 0.2)' },
        '.cm-ai-proposal-widget': {
            backgroundColor: '#1c2128',
            border: '1px solid #30363d',
            borderRadius: '6px',
            padding: '4px 8px',
            marginTop: '4px',
            display: 'flex',
            gap: '8px',
            width: 'fit-content'
        },
        '.cm-ai-btn': {
            border: 'none',
            borderRadius: '4px',
            padding: '2px 8px',
            fontSize: '12px',
            cursor: 'pointer',
            fontWeight: 'bold'
        },
        '.cm-ai-accept': { backgroundColor: '#238636', color: 'white' },
        '.cm-ai-reject': { backgroundColor: '#da3633', color: 'white' }
    });
}

export const aiProposalExtension = [proposalField, aiProposalKeymap, aiProposalTheme()];
