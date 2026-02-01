<script lang="ts">
    import { createEventDispatcher, onMount } from 'svelte';
    import { geminiService, type AIContent } from '../services/geminiService';
    import { fade, scale } from 'svelte/transition';

    export let context: AIContent;
    export let editor: any; // TipTap editor instance

    const dispatch = createEventDispatcher();
    let instruction = '';
    let loading = false;
    let error = '';

    let inputElement: HTMLInputElement;

    onMount(() => {
        if (inputElement) inputElement.focus();
    });

    const presets = [
        { label: 'Summarize', prompt: 'Summarize this content into concise bullet points.' },
        { label: 'Improve', prompt: 'Rewrite this text to be more professional, clear, and engaging.' },
        { label: 'Refactor', prompt: 'Refactor this code to improve efficiency, readability, and quality. Maintain identical functionality and ensure consistent indentation.' },
        { label: 'Grammar', prompt: 'Fix any grammar and spelling mistakes.' },
        { label: 'To List', prompt: 'Turn this text into a well-organized bulleted list.' },
    ];

    async function submit(customPrompt?: string) {
        const prompt = customPrompt || instruction;
        if (!prompt && !customPrompt) return;

        loading = true;
        error = '';

        // Capture selection for insertion
        const { from, to, $from } = editor.state.selection;
        const isParentCode = $from.parent.type.name === 'codeBlock';
        const isNodeCode = (editor.state.selection as any).node?.type?.name === 'codeBlock';
        const inCodeContext = isParentCode || isNodeCode;
        const mode = editor.options.parentElement?.closest('.file-editor') ? 'code' : 'markdown';

        try {
            // Set visual progress indicator
            editor.commands.setAIZone(from, to);
            
            // Dispatch close early if we want non-blocking (user can keep editing)
            const responseP = geminiService.generateResponse(prompt, context);
            
            dispatch('close');

            const response = await responseP;
            
            // Remove visual progress
            editor.commands.unsetAIZone();

            // Insert response into editor at original position
            if (editor) {
                let finalContent = response;
                
                // If we are INSIDE a code block or replacing one
                if (mode === 'code' || inCodeContext) {
                    // Strip markdown fences if AI included them
                    finalContent = response.replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '');
                    
                    if (isNodeCode) {
                        // If we are replacing the whole node, we should maintain the node type
                        editor.chain().focus().insertContentAt({ from, to }, { 
                            type: 'codeBlock', 
                            content: [{ type: 'text', text: finalContent }] 
                        }).run();
                    } else {
                        // Just text inside existing block
                        editor.chain().focus().insertContentAt({ from, to }, { type: 'text', text: finalContent }).run();
                    }
                } else {
                    editor.chain().focus().insertContentAt({ from, to }, finalContent).run();
                }
            }
        } catch (e) {
            editor.commands.unsetAIZone();
            error = e instanceof Error ? e.message : 'AI request failed';
            console.error(e);
            // Re-open palette if error? Or show notification.
            alert(`AI Error: ${error}`);
        } finally {
            loading = false;
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
    <div class="ai-palette-modal" transition:scale={{ start: 0.95, duration: 200 }}>
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
                {#if loading}
                    <div class="loader"></div>
                {:else}
                    <button class="send-btn" on:click={() => submit()} disabled={!instruction}>➔</button>
                {/if}
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

    .loader {
        position: absolute;
        right: 0.75rem;
        width: 1.25rem;
        height: 1.25rem;
        border: 2px solid #4a9eff;
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
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
        color: #666;
    }

    kbd {
        background: #333;
        color: #999;
        padding: 1px 4px;
        border-radius: 3px;
        font-family: inherit;
    }
</style>
