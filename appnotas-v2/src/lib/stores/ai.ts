import { writable } from 'svelte/store';

export interface AIState {
    pendingProposals: number;
}

export const aiState = writable<AIState>({
    pendingProposals: 0
});

export function setPendingProposals(count: number) {
    aiState.update(s => ({ ...s, pendingProposals: count }));
}
