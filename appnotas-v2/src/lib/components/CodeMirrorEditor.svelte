<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
    import { get } from 'svelte/store';
    import { settingsStore } from '$lib/stores/settings';
    import { EditorView, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, highlightActiveLine, keymap } from '@codemirror/view';
    import { foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldKeymap, indentUnit, language as languageFacet } from '@codemirror/language';
    import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
    import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
    import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
    import { lintKeymap } from '@codemirror/lint';
	import { EditorState, Compartment, Prec } from '@codemirror/state';
	import { javascript } from '@codemirror/lang-javascript';
	import { python } from '@codemirror/lang-python';
	import { html } from '@codemirror/lang-html';
	import { css } from '@codemirror/lang-css';
	import { json } from '@codemirror/lang-json';
	import { markdown } from '@codemirror/lang-markdown';
	import { oneDark } from '@codemirror/theme-one-dark';
	import { rust } from '@codemirror/lang-rust';
	import { cpp } from '@codemirror/lang-cpp';
	import { java } from '@codemirror/lang-java';
	import { php } from '@codemirror/lang-php';
	import { go } from '@codemirror/lang-go';
	import { sql } from '@codemirror/lang-sql';
	import { yaml } from '@codemirror/lang-yaml';
	import { xml } from '@codemirror/lang-xml';

    import { aiProposalExtension, addProposal, acceptProposal, rejectProposal, proposalField, getProposalAtCursor } from '../codemirror/aiProposal';
    import { aiLoadingExtension, setLoadingZone, clearLoadingZone } from '../codemirror/aiLoading';

    interface Props {
        content?: string;
        language?: string;
        onUpdate?: (content: string) => void;
        onSave?: (() => void) | null;
        onAITrigger?: ((context: { text: string; fullContent: string; selectionRange?: { from: number; to: number } }) => void) | null;
    }

    let {
        content = '',
        language = 'javascript',
        onUpdate = () => {},
        onSave = null,
        onAITrigger = null
    }: Props = $props();

	let editorContainer = $state<HTMLElement>();
    // Use raw state for complex objects like EditorView to avoid proxy performance hits or issues
	let view = $state.raw<EditorView | null>(null);
	let languageCompartment = new Compartment();

	// Map language strings to CodeMirror language extensions
	function getLanguageExtension(lang: string) {
		const langMap: Record<string, () => any> = {
			javascript: () => javascript({ jsx: true, typescript: false }),
			typescript: () => javascript({ jsx: true, typescript: true }),
			jsx: () => javascript({ jsx: true }),
			tsx: () => javascript({ jsx: true, typescript: true }),
			python: () => python(),
			html: () => html(),
			css: () => css(),
			json: () => json(),
			markdown: () => markdown(),
			rust: () => rust(),
			cpp: () => cpp(),
			java: () => java(),
			php: () => php(),
			go: () => go(),
			sql: () => sql(),
			yaml: () => yaml(),
			xml: () => xml(),
			text: () => [],
		};
		const ext = langMap[lang]?.() || javascript();
        return ext;
	}

	onMount(() => {
		const saveKeymap = keymap.of([
			{
				key: 'Mod-s',
				run: () => {
					if (onSave) onSave();
					return true;
				}
			}
		]);

		const updateListener = EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				const newContent = update.state.doc.toString();
				onUpdate(newContent);
			}
		});

		const customTheme = EditorView.theme({
			'&': {
				height: '100%',
				fontSize: '14px',
				backgroundColor: '#0d1117',
			},
			'.cm-scroller': {
				fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
				lineHeight: '1.6',
			},
			'.cm-content': {
				caretColor: '#4a9eff',
				padding: '1rem 0',
			},
			'.cm-line': {
				padding: '0 1rem',
			},
			'.cm-gutters': {
				backgroundColor: '#0d1117',
				color: '#484f58',
				border: 'none',
				paddingRight: '8px',
			},
			'.cm-activeLineGutter': {
				backgroundColor: '#161b22',
			},
			'.cm-activeLine': {
				backgroundColor: 'rgba(56, 139, 253, 0.1)',
			},
			'&.cm-focused': {
				outline: 'none',
			},
            '.cm-selectionMatch': {
				backgroundColor: 'rgba(56, 139, 253, 0.3)',
			},
		});

		const state = EditorState.create({
			doc: content,
			extensions: [
                // Manual basicSetup equivalent to avoid clashes
                lineNumbers(),
                highlightActiveLineGutter(),
                highlightSpecialChars(),
                history(),
                foldGutter(),
                drawSelection(),
                dropCursor(),
                EditorState.allowMultipleSelections.of(true),
                indentOnInput(),
                syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
                bracketMatching(),
                closeBrackets(),
                rectangularSelection(),
                highlightActiveLine(),
                highlightSelectionMatches(),
                keymap.of([
                    ...closeBracketsKeymap,
                    ...defaultKeymap,
                    ...searchKeymap,
                    ...historyKeymap,
                    ...foldKeymap,
                    ...lintKeymap
                ] as any),

				languageCompartment.of(getLanguageExtension(language)),
				oneDark,
                indentUnit.of('    '),
				customTheme,
				saveKeymap,
				updateListener,
				EditorView.lineWrapping,
                aiProposalExtension,
                aiLoadingExtension,
                Prec.highest(createDynamicKeymap()),
			]
		});

		view = new EditorView({
			state,
			parent: editorContainer
		});
        
        const handleGlobalAITrigger = () => {
            if (document.activeElement?.closest('.codemirror-editor') === editorContainer) {
                triggerAI();
            }
        };

        const handleGlobalAIAccept = () => {
            if (document.activeElement?.closest('.codemirror-editor') === editorContainer && view) {
                const proposal = getProposalAtCursor(view.state);
                if (proposal) {
                    view.dispatch({ effects: acceptProposal.of(proposal.id) });
                }
            }
        };

        const handleGlobalAIReject = () => {
            if (document.activeElement?.closest('.codemirror-editor') === editorContainer && view) {
                const proposal = getProposalAtCursor(view.state);
                if (proposal) {
                     view.dispatch({
                        changes: { from: proposal.from, to: proposal.to, insert: proposal.originalText },
                        effects: rejectProposal.of(proposal.id)
                    });
                }
            }
        };

        window.addEventListener('app:ai-trigger', handleGlobalAITrigger);
        window.addEventListener('app:ai-accept', handleGlobalAIAccept);
        window.addEventListener('app:ai-reject', handleGlobalAIReject);

        // Event listener for AI actions
        if (editorContainer) {
            editorContainer.addEventListener('ai-proposal-action', handleProposalAction as EventListener);
        }

        return () => {
            window.removeEventListener('app:ai-trigger', handleGlobalAITrigger);
            window.removeEventListener('app:ai-accept', handleGlobalAIAccept);
            window.removeEventListener('app:ai-reject', handleGlobalAIReject);
            view?.destroy();
            if (editorContainer) {
                 editorContainer.removeEventListener('ai-proposal-action', handleProposalAction as EventListener);
            }
        };
	});

	onDestroy(() => {
        // onDestroy is mostly handled by the return from onMount in Svelte 5 pattern or explicit cleanup
	});

	// Update content when prop changes externally
    $effect(() => {
        if (view && content !== view.state.doc.toString()) {
            view.dispatch({
                changes: {
                    from: 0,
                    to: view.state.doc.length,
                    insert: content
                }
            });
        }
    });

	// Update language when prop changes
    $effect(() => {
        if (view && language) {
            view.dispatch({
                effects: languageCompartment.reconfigure(getLanguageExtension(language))
            });
        }
    });

	function triggerAI() {
		if (!view || !onAITrigger) {
            return;
        }
		
		const selection = view.state.selection.main;
		const selectedText = view.state.sliceDoc(selection.from, selection.to);
		const fullContent = view.state.doc.toString();
		
		onAITrigger({
			text: selectedText || fullContent,
			fullContent,
			selectionRange: { from: selection.from, to: selection.to }
		});
	}

	// Expose methods for parent components
	export function getContent(): string {
		return view?.state.doc.toString() || content;
	}

	export function getSelection(): { from: number; to: number; text: string } | null {
		if (!view) return null;
		const selection = view.state.selection.main;
		return {
			from: selection.from,
			to: selection.to,
			text: view.state.sliceDoc(selection.from, selection.to)
		};
	}

	export function insertAt(from: number, to: number, text: string) {
		view?.dispatch({
			changes: { from, to, insert: text }
		});
	}

	export function focus() {
		view?.focus();
	}

    // Expose AI methods
    export function setAIZone(from: number, to: number) {
        if (!view) {
            console.warn('[CodeMirrorEditor] setAIZone called but view is null');
            return;
        }
        view.dispatch({ effects: setLoadingZone.of({ from, to }) });
    }

    export function unsetAIZone() {
        if (!view) return;
        view.dispatch({ effects: clearLoadingZone.of(null as any) });
    }

    export function insertAIProposal(content: string, originalContent?: string) {
        if (!view) {
             console.warn('[CodeMirrorEditor] insertAIProposal called but view is null');
             return;
        }
        
        const selection = view.state.selection.main;
        const from = selection.from;
        const to = selection.to;
        const id = Math.random().toString(36).substr(2, 9);
        const originalText = originalContent !== undefined ? originalContent : view.state.sliceDoc(from, to);
        
        view.dispatch({
            changes: { from, to, insert: content },
            effects: addProposal.of({
                from,
                to: from + content.length,
                id,
                originalText
            })
        });
    }

    export function insertAIProposalWithRange(content: string, range: {from: number, to: number}, originalText: string) {
         if (!view) return;
         const id = Math.random().toString(36).substr(2, 9);
         view.dispatch({
            changes: { from: range.from, to: range.to, insert: content },
            effects: addProposal.of({
                from: range.from,
                to: range.from + content.length,
                id,
                originalText
            })
        });
    }

    function createDynamicKeymap() {
        const binds = get(settingsStore).keybinds;
        const accept = binds['aiAccept'] || 'Ctrl-Shift-]';
        const reject = binds['aiReject'] || 'Ctrl-Shift-[';
        const cmKey = (k: string) => k.replace(/\+/g, '-');
        
        return keymap.of([
            {
                key: cmKey(accept),
                run: (view) => {
                    const proposal = getProposalAtCursor(view.state);
                    if (proposal) {
                        view.dispatch({ effects: acceptProposal.of(proposal.id) });
                        return true;
                    }
                    return false;
                }
            },
            {
                key: cmKey(reject),
                run: (view) => {
                    const proposal = getProposalAtCursor(view.state);
                    if (proposal) {
                         view.dispatch({
                            changes: { from: proposal.from, to: proposal.to, insert: proposal.originalText },
                            effects: rejectProposal.of(proposal.id)
                        });
                        return true;
                    }
                    return false;
                }
            }
        ]);
    }

    function handleProposalAction(e: CustomEvent) {
        const { action, id } = e.detail;
        if (!view) return;
        
        const state = view.state;
        let proposal: { from: number; to: number; originalText: string; id: string } | null = null;
        
        try {
            const decorations = state.field(proposalField as any) as any;
            decorations.between(0, state.doc.length, (from: number, to: number, value: any) => {
                const attrs = (value.spec as any).attributes;
                if (attrs && attrs['data-proposal-id'] === id) {
                    proposal = { from, to, originalText: attrs['data-original-text'], id };
                    return false;
                }
            });
        } catch (e) {
            console.warn('Proposal field not found or error', e);
        }

        if (proposal) {
            if (action === 'accept') {
                 view.dispatch({ effects: acceptProposal.of(id) });
            } else if (action === 'reject') {
                 view.dispatch({
                    changes: { from: (proposal as any).from, to: (proposal as any).to, insert: (proposal as any).originalText },
                    effects: rejectProposal.of(id)
                 });
            }
        }
    }
</script>

<div class="codemirror-editor" bind:this={editorContainer}></div>

<style>
	.codemirror-editor {
		height: 100%;
		width: 100%;
		overflow: hidden;
	}

	.codemirror-editor :global(.cm-editor) {
		height: 100%;
	}

    /* Force visibility of AI elements globally to bypass theme scoping/specificity issues */
    :global(.cm-ai-proposal-mark) {
        background-color: rgba(74, 158, 255, 0.3) !important;
        border-bottom: 2px solid #4a9eff !important;
    }

    :global(.cm-ai-proposal-widget) {
        background-color: #1c2128 !important;
        border: 1px solid #30363d !important;
        border-radius: 6px !important;
        padding: 4px 8px !important;
        margin-top: 4px !important;
        display: flex !important;
        gap: 8px !important;
        width: fit-content !important;
        pointer-events: auto !important;
        position: relative !important;
        z-index: 100 !important;
    }

    :global(.cm-ai-btn) {
        border: none !important;
        border-radius: 4px !important;
        padding: 4px 12px !important;
        font-size: 12px !important;
        cursor: pointer !important;
        font-weight: bold !important;
        color: white !important;
    }

    :global(.cm-ai-accept) {
        background-color: #238636 !important;
    }

    :global(.cm-ai-reject) {
        background-color: #da3633 !important;
    }
</style>
