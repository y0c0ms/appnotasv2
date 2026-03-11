<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { fade } from 'svelte/transition';

    const dispatch = createEventDispatcher();

    interface Props {
        oldContent: string;
        newContent: string;
        noteTitle: string;
    }

    let { oldContent, newContent, noteTitle }: Props = $props();

    interface DiffLine {
        type: 'added' | 'removed' | 'unchanged';
        content: string;
        lineNum: number;
    }

    let diffLines = $derived(computeDiff(oldContent, newContent));
    let addedCount = $derived(diffLines.filter(l => l.type === 'added').length);
    let removedCount = $derived(diffLines.filter(l => l.type === 'removed').length);

    function computeDiff(oldText: string, newText: string): DiffLine[] {
        const oldLines = oldText.split('\n');
        const newLines = newText.split('\n');
        const result: DiffLine[] = [];
        
        // Simple LCS-based diff
        const lcs = computeLCS(oldLines, newLines);
        let oi = 0, ni = 0, li = 0;
        let lineNum = 1;

        while (oi < oldLines.length || ni < newLines.length) {
            if (li < lcs.length && oi < oldLines.length && ni < newLines.length && 
                oldLines[oi] === lcs[li] && newLines[ni] === lcs[li]) {
                result.push({ type: 'unchanged', content: oldLines[oi], lineNum: lineNum++ });
                oi++; ni++; li++;
            } else if (oi < oldLines.length && (li >= lcs.length || oldLines[oi] !== lcs[li])) {
                result.push({ type: 'removed', content: oldLines[oi], lineNum: lineNum++ });
                oi++;
            } else if (ni < newLines.length && (li >= lcs.length || newLines[ni] !== lcs[li])) {
                result.push({ type: 'added', content: newLines[ni], lineNum: lineNum++ });
                ni++;
            } else {
                break; // Safety
            }
        }

        return result;
    }

    function computeLCS(a: string[], b: string[]): string[] {
        const m = a.length, n = b.length;
        // Limit LCS computation for very large files
        if (m > 2000 || n > 2000) {
            return []; // Fall back to showing everything as changed
        }
        const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
        
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (a[i - 1] === b[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        const result: string[] = [];
        let i = m, j = n;
        while (i > 0 && j > 0) {
            if (a[i - 1] === b[j - 1]) {
                result.unshift(a[i - 1]);
                i--; j--;
            } else if (dp[i - 1][j] > dp[i][j - 1]) {
                i--;
            } else {
                j--;
            }
        }
        return result;
    }

    function accept() {
        dispatch('accept');
    }

    function reject() {
        dispatch('reject');
    }
</script>

<div class="overlay" transition:fade={{ duration: 150 }} onclick={(e) => { if (e.target === e.currentTarget) reject(); }} onkeydown={(e) => { if (e.key === 'Escape') reject(); }} tabindex="0" role="dialog" aria-modal="true" aria-label="File changes detected">
    <div class="modal">
        <div class="modal-header">
            <div class="header-info">
                <h2>📄 External Changes Detected</h2>
                <p class="subtitle">The file for <strong>"{noteTitle}"</strong> was modified externally</p>
            </div>
            <button class="close-btn" onclick={reject}>✕</button>
        </div>

        <div class="diff-stats">
            <span class="stat added">+{addedCount} added</span>
            <span class="stat removed">−{removedCount} removed</span>
        </div>

        <div class="diff-container">
            {#each diffLines as line}
                <div class="diff-line {line.type}">
                    <span class="line-marker">
                        {#if line.type === 'added'}+{:else if line.type === 'removed'}−{:else}&nbsp;{/if}
                    </span>
                    <span class="line-content">{line.content || '\u00A0'}</span>
                </div>
            {/each}
            {#if diffLines.length === 0}
                <div class="no-diff">No visible text differences detected (formatting may have changed)</div>
            {/if}
        </div>

        <div class="modal-actions">
            <button class="btn-reject" onclick={reject}>
                Keep Current Version
            </button>
            <button class="btn-accept" onclick={accept}>
                ✓ Accept External Changes
            </button>
        </div>
    </div>
</div>

<style>
    .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    }

    .modal {
        background: #1e1e2e;
        border: 1px solid #313244;
        border-radius: 12px;
        width: min(700px, 90vw);
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        overflow: hidden;
    }

    .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: 1.25rem 1.5rem;
        border-bottom: 1px solid #313244;
        background: #181825;
    }

    .header-info h2 {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
        color: #cdd6f4;
    }

    .subtitle {
        margin: 0.3rem 0 0 0;
        font-size: 0.85rem;
        color: #6c7086;
    }

    .close-btn {
        background: none;
        border: none;
        color: #6c7086;
        font-size: 1.2rem;
        cursor: pointer;
        padding: 0.3rem;
        border-radius: 4px;
        transition: all 0.15s;
    }

    .close-btn:hover {
        background: rgba(255, 255, 255, 0.05);
        color: #cdd6f4;
    }

    .diff-stats {
        display: flex;
        gap: 1rem;
        padding: 0.75rem 1.5rem;
        border-bottom: 1px solid #313244;
        font-size: 0.8rem;
        font-weight: 600;
    }

    .stat.added { color: #a6e3a1; }
    .stat.removed { color: #f38ba8; }

    .diff-container {
        flex: 1;
        overflow-y: auto;
        padding: 0.5rem 0;
        font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
        font-size: 0.8rem;
        line-height: 1.6;
        max-height: 50vh;
    }

    .diff-container::-webkit-scrollbar {
        width: 6px;
    }

    .diff-container::-webkit-scrollbar-thumb {
        background: #45475a;
        border-radius: 3px;
    }

    .diff-line {
        display: flex;
        padding: 0 1.5rem;
        min-height: 1.6em;
    }

    .diff-line.added {
        background: rgba(166, 227, 161, 0.1);
        color: #a6e3a1;
    }

    .diff-line.removed {
        background: rgba(243, 139, 168, 0.1);
        color: #f38ba8;
        text-decoration: line-through;
        opacity: 0.8;
    }

    .diff-line.unchanged {
        color: #585b70;
    }

    .line-marker {
        width: 1.5rem;
        flex-shrink: 0;
        text-align: center;
        user-select: none;
        font-weight: 700;
    }

    .line-content {
        flex: 1;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .no-diff {
        padding: 2rem;
        text-align: center;
        color: #6c7086;
        font-style: italic;
        font-family: inherit;
    }

    .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.75rem;
        padding: 1rem 1.5rem;
        border-top: 1px solid #313244;
        background: #181825;
    }

    .btn-reject {
        padding: 0.6rem 1.2rem;
        background: #313244;
        border: 1px solid #45475a;
        border-radius: 8px;
        color: #cdd6f4;
        font-size: 0.85rem;
        cursor: pointer;
        transition: all 0.15s;
    }

    .btn-reject:hover {
        background: #45475a;
        border-color: #585b70;
    }

    .btn-accept {
        padding: 0.6rem 1.2rem;
        background: #a6e3a1;
        border: none;
        border-radius: 8px;
        color: #1e1e2e;
        font-size: 0.85rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
    }

    .btn-accept:hover {
        background: #94e2a5;
        box-shadow: 0 0 12px rgba(166, 227, 161, 0.3);
    }
</style>
