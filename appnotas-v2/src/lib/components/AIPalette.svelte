<script lang="ts">
    import { createEventDispatcher, onMount } from 'svelte';
    import { geminiService, type AIContent } from '../services/geminiService';
    import { fade, slide, scale } from 'svelte/transition';
    import type { Editor } from '@tiptap/core';
    import { currentEditor } from '../stores/editorStore';
    import { get } from 'svelte/store';

    // Extended context type that includes full file content
    interface ExtendedAIContext extends AIContent {
        fullFileContent?: string;
        editor?: any; // TipTap instance carrier
        cmSelectionRange?: { from: number; to: number }; // CodeMirror selection range, pre-captured
    }

    export let context: ExtendedAIContext;
    export let editor: any = null; // TipTap editor instance (optional)
    export let codeMirrorEditor: any = null; // CodeMirror editor instance (optional)

    const dispatch = createEventDispatcher();
    let instruction = '';
    let loading = false;
    let error = '';

    let inputElement: HTMLInputElement;

    // Track selection for CodeMirror
    let cmSelection: { from: number; to: number } | null = null;

    onMount(() => {
        if (inputElement) inputElement.focus();
        // Capture CodeMirror selection at mount time
        if (codeMirrorEditor) {
            cmSelection = codeMirrorEditor.getSelection();
        }
    });

    const presets = [
        { label: 'Summarize', prompt: 'Summarize this content into concise bullet points.' },
        { label: 'Improve', prompt: 'Rewrite this text to be more professional, clear, and engaging.' },
        { label: 'Refactor', prompt: 'Refactor this code to improve efficiency, readability, and quality. Maintain identical functionality and ensure consistent indentation.' },
        { label: 'Grammar', prompt: 'Fix any grammar and spelling mistakes.' },
        { label: 'To List', prompt: 'Turn this text into a well-organized bulleted list.' },
    ];

    let generatedResponse = '';
    let isReviewing = false;

    $: console.log('[AIPalette] Editor prop updated:', !!editor);

    async function submit(customPrompt?: string) {
        const prompt = customPrompt || instruction;
        if (!prompt && !customPrompt) return;
        
        // Use PRE-CAPTURED selection from context (captured when triggerAI was called)
        // This avoids the issue of focus moving to the AIPalette input and resetting the selection
        let currentCmSelection: { from: number; to: number } | null = null;
        if (codeMirrorEditor && context.cmSelectionRange) {
            currentCmSelection = context.cmSelectionRange;
            console.log('[AIPalette] Using pre-captured CM selection:', currentCmSelection);
        }
        
        // Resolve TipTap editor ONLY if CodeMirror is NOT present
        let activeEditor = null;
        if (!codeMirrorEditor) {
            const globalEditor = get(currentEditor);
            const windowEditor = (window as any).tiptapEditor;
            activeEditor = editor || context.editor || globalEditor || windowEditor;
            if (!activeEditor) {
                console.error('[AIPalette] No TipTap editor instance found!');
            }
        }

        // Build enhanced context with file context
        let enhancedContext = { ...context };
        let enhancedPrompt = prompt;
        
        // If we have full file content, include it for context
        if (context.fullFileContent && context.text !== context.fullFileContent) {
            enhancedPrompt = `Here is the full file for context:\n\`\`\`\n${context.fullFileContent}\n\`\`\`\n\nThe selected code to work on is:\n\`\`\`\n${context.text}\n\`\`\`\n\n${prompt}\n\nRespond ONLY with the modified selected code, not the entire file.`;
        }

        // 1. Set visual progress indicator (blocking animation)
        // ONLY use CodeMirror OR TipTap, not both
        if (codeMirrorEditor && currentCmSelection) {
            codeMirrorEditor.setAIZone(currentCmSelection.from, currentCmSelection.to);
        } else if (activeEditor) {
            const { from, to } = activeEditor.state.selection;
            activeEditor.commands.setAIZone(from, to);
        }

        // 2. Close the palette immediately
        dispatch('close');

        // 3. Run generation in background
        runBackgroundGeneration(enhancedPrompt, enhancedContext, activeEditor, codeMirrorEditor, currentCmSelection);
    }
    
    // Detached function to handle response insertion
    async function runBackgroundGeneration(
        activePrompt: string, 
        activeContext: ExtendedAIContext, 
        tiptapEditor: any, 
        cmEditor: any, 
        cmSelect: { from: number, to: number } | null
    ) {
        try {
            const response = await geminiService.generateResponse(activePrompt, activeContext);
            console.log(`[AIPalette] Response received, length: ${response.length}`);

            if (!response.trim()) {
                console.warn('[AIPalette] Received empty response from AI. Aborting insertion.');
                loading = false;
                return;
            }
            
            // Strip markdown fences
            const finalContent = response.replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '');
            
            // CodeMirror Insertion Logic
            if (cmEditor) {
                console.log('[AIPalette] Processing CodeMirror insertion');
                cmEditor.unsetAIZone();
                
                if (cmSelect) {
                    // Start of selection + length of original text (roughly)
                    // We need the original text. context.text has it.
                    cmEditor.insertAIProposalWithRange(finalContent, cmSelect, activeContext.text);
                } else {
                    cmEditor.insertAIProposal(finalContent, activeContext.text);
                }
                return;
            }

            // TipTap Insertion Logic
            console.log('[AIPalette] Processing TipTap insertion. Editor present:', !!tiptapEditor);
            
            if (tiptapEditor) {
                // Find dynamic range from AIZone storage
                let targetRange = null;
                try {
                    const zones = tiptapEditor.storage.aiZone?.zones;
                    if (zones && zones.length > 0) {
                        targetRange = zones[0];
                        console.log('[AIPalette] Found AIZone range via storage:', targetRange);
                    } else {
                        console.warn('[AIPalette] No AIZone found in storage, defaulting to cursor');
                    }
                } catch (e) {
                    console.error('[AIPalette] Error accessing AIZone storage:', e);
                }

                console.log('[AIPalette] Unsetting AIZone and inserting proposal...');
                tiptapEditor.commands.unsetAIZone();

                if (targetRange) {
                    console.log('[AIPalette] Inserting proposal at range:', targetRange);
                    // Pass range explicitly to command to avoid TextSelection errors on block boundaries
                    const chain = tiptapEditor.chain().insertAIProposal(finalContent, undefined, targetRange);
                    console.log('[AIPalette] Chain created, running...');
                    chain.run();
                } else {
                    console.log('[AIPalette] Inserting proposal at cursor (fallback)');
                    const startSize = tiptapEditor.state.doc.textContent.length;
                    tiptapEditor.chain().focus().insertAIProposal(finalContent).run();
                    const endSize = tiptapEditor.state.doc.textContent.length;
                    console.log(`[AIPalette] Insertion complete. Doc size: ${startSize} -> ${endSize} (Diff: ${endSize - startSize})`);
                }
                console.log('[AIPalette] Insertion command sent.');
            } else {
                console.error('[AIPalette] TipTap editor instance is missing!');
            }

            // CodeMirror Insertion Logic
            if (cmEditor && cmSelect) {
                // Unblock CodeMirror
                cmEditor.unsetAIZone();
                
                // For now use original selection, but we could find the mapped range of the loading zone if we wanted perfection.
                // Assuming user doesn't edit much while waiting in CodeMirror for now.
                // TODO: use dynamic range from loading zone module (by exporting a helper in CodeMirrorEditor)
                cmEditor.insertAIProposal(finalContent, cmSelect);
            } 

        } catch (e) {
            console.error('AI Generation failed', e);
            if (tiptapEditor) {
                tiptapEditor.commands.unsetAIZone();
            }
            if (cmEditor) {
                cmEditor.unsetAIZone();
            }
        }
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
        } else if (e.key === 'Escape') {
            dispatch('close');
        }
    }
</script>

<div 
    class="ai-palette-overlay" 
    on:click|self={() => dispatch('close')} 
    on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
    transition:fade={{ duration: 150 }}
    role="button"
    tabindex="0"
    aria-label="Close AI Assistant"
>
    <div 
        class="ai-palette-modal"
        transition:scale={{ duration: 200, start: 0.96 }}
    >
        {#if loading}
            <div class="loading-state">
                <div class="spinner"></div>
                <h3>Generating response...</h3>
                <p>This may take a moment</p>
            </div>
        {:else}
            <div class="header">
                <span class="sparkle">✨</span>
                <h3>Gemini AI Assistant</h3>
            </div>

            <div class="content">
                {#if context.images?.length || context.drawings?.length}
                    <div class="context-preview">
                        <span>Including {context.images?.length || 0} images and {context.drawings?.length || 0} drawings as context</span>
                    </div>
                {/if}

                <div class="input-wrapper">
                    <input 
                        bind:this={inputElement}
                        bind:value={instruction}
                        placeholder="Ask AI to summarize, rewrite, or explain..."
                        on:keydown={handleKeyDown}
                        disabled={loading}
                    />
                    <button class="send-btn" on:click={() => submit()} disabled={!instruction}>➔</button>
                </div>

                {#if error}
                    <div class="error-msg">{error}</div>
                {/if}

                <div class="presets">
                    {#each presets as preset}
                        <button class="preset-btn" on:click={() => submit(preset.prompt)} disabled={loading}>
                            {preset.label}
                        </button>
                    {/each}
                </div>
            </div>

            <div class="footer">
                <kbd>Enter</kbd> to run • <kbd>Esc</kbd> to cancel
            </div>
        {/if}
    </div>
</div>

<style>
    .ai-palette-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        backdrop-filter: blur(2px);
    }

    .ai-palette-modal {
        width: 450px;
        background: #1e1e1e;
        border: 1px solid #333;
        border-radius: 12px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .header {
        padding: 1rem 1.25rem;
        background: #252525;
        border-bottom: 1px solid #333;
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .header h3 {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        color: #fff;
    }

    .sparkle {
        font-size: 1.2rem;
    }

    .content {
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .context-preview {
        font-size: 0.75rem;
        color: #888;
        background: rgba(74, 158, 255, 0.1);
        padding: 0.5rem 0.75rem;
        border-radius: 6px;
        border: 1px solid rgba(74, 158, 255, 0.2);
    }

    .input-wrapper {
        position: relative;
        display: flex;
        align-items: center;
    }

    .input-wrapper input {
        width: 100%;
        padding: 0.85rem 3rem 0.85rem 1rem;
        background: #121212;
        border: 1px solid #444;
        border-radius: 8px;
        color: #fff;
        font-size: 0.95rem;
        outline: none;
        transition: border-color 0.2s;
    }

    .input-wrapper input:focus {
        border-color: #4a9eff;
    }

    .send-btn {
        position: absolute;
        right: 0.5rem;
        padding: 0.4rem 0.6rem;
        background: #4a9eff;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        opacity: 0.8;
        transition: opacity 0.2s;
    }

    .send-btn:hover:not(:disabled) {
        opacity: 1;
    }

    .send-btn:disabled {
        background: #333;
        cursor: not-allowed;
    }


    .error-msg {
        font-size: 0.85rem;
        color: #ff4a4a;
        padding: 0.5rem;
        background: rgba(255, 74, 74, 0.1);
        border-radius: 4px;
        border: 1px solid rgba(255, 74, 74, 0.2);
    }

    .presets {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
    }

    .preset-btn {
        padding: 0.4rem 0.75rem;
        background: #2a2a2a;
        border: 1px solid #3a3a3a;
        border-radius: 6px;
        color: #bbb;
        font-size: 0.8rem;
        cursor: pointer;
        transition: all 0.2s;
    }

    .preset-btn:hover:not(:disabled) {
        background: #3a3a3a;
        color: #fff;
        border-color: #555;
    }

    .footer {
        padding: 0.75rem 1.25rem;
        background: #252525;
        border-top: 1px solid #333;
        font-size: 0.75rem;
        color: #888;
        display: flex;
        justify-content: center;
        gap: 0.5rem;
    }

    .footer kbd {
        background: #333;
        padding: 0.1rem 0.3rem;
        border-radius: 4px;
        font-family: inherit;
        border: 1px solid #444;
    }

    /* Review UI Styles */
    .loading-state {
        padding: 3rem 2rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        color: #e0e0e0;
        text-align: center;
    }

    .loading-state h3 {
        margin: 0;
        font-weight: 500;
        color: #fff;
    }

    .loading-state p {
        margin: 0;
        color: #888;
        font-size: 0.9rem;
    }
    
    .loading-state .spinner {
        width: 40px;
        height: 40px;
        border: 3px solid #333;
        border-top: 3px solid #4a9eff;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }


    /* Button variants */
</style>
