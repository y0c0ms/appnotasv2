import { StateField, StateEffect } from '@codemirror/state';
import { EditorView, Decoration, showTooltip } from '@codemirror/view';
import type { DecorationSet, Tooltip } from '@codemirror/view';

// Effects to set/unset the loading zone
export const setLoadingZone = StateEffect.define<{ from: number; to: number }>();
export const clearLoadingZone = StateEffect.define<void>();

export const loadingField = StateField.define<DecorationSet>({
    create() {
        return Decoration.none;
    },
    update(decorations, tr) {
        decorations = decorations.map(tr.changes);

        for (const e of tr.effects) {
            if (e.is(setLoadingZone)) {
                const { from, to } = e.value;
                if (from < to) {
                    decorations = Decoration.set([
                        Decoration.mark({
                            class: 'cm-ai-loading-zone'
                        }).range(from, to)
                    ], true);
                } else {
                    decorations = Decoration.none;
                }
            } else if (e.is(clearLoadingZone)) {
                decorations = Decoration.none;
            }
        }
        return decorations;
    },
    provide: f => EditorView.decorations.from(f)
});

// Tooltip provider
export const loadingTooltipState = StateField.define<Tooltip | null>({
    create: () => null,
    update(tooltip, tr) {
        for (const e of tr.effects) {
            if (e.is(setLoadingZone)) {
                const { from, to } = e.value;
                return {
                    pos: from + Math.floor((to - from) / 2), // Center of range
                    above: true,
                    strictSide: true,
                    create: () => {
                        const dom = document.createElement('div');
                        dom.className = 'cm-ai-loading-tooltip';
                        dom.innerHTML = '<div class="spinner"></div> AI Working...';
                        return { dom };
                    }
                };
            } else if (e.is(clearLoadingZone)) {
                return null;
            }
        }
        // Map position if exists
        if (tooltip) {
            return { ...tooltip, pos: tr.changes.mapPos(tooltip.pos) };
        }
        return null;
    },
    provide: f => showTooltip.from(f)
});

export const aiLoadingTheme = EditorView.baseTheme({
    '.cm-ai-loading-zone': {
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        filter: 'blur(2px) grayscale(0.5)',
        transition: 'all 0.5s ease'
    },
    '.cm-ai-loading-tooltip': {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        background: 'rgba(30, 30, 30, 0.95)',
        padding: '8px 16px',
        borderRadius: '20px',
        border: '1px solid #555',
        boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
        color: '#e0e0e0',
        fontSize: '0.85rem',
        fontWeight: '500',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: '200'
    },
    '.cm-ai-loading-tooltip .spinner': {
        width: '16px',
        height: '16px',
        border: '2px solid #555',
        borderTopColor: '#4a9eff',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite'
    },
    '@keyframes spin': {
        'from': { transform: 'rotate(0deg)' },
        'to': { transform: 'rotate(360deg)' }
    }
});

export const aiLoadingExtension = [loadingField, loadingTooltipState, aiLoadingTheme];
