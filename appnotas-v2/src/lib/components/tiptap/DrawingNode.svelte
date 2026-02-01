<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import { NodeViewWrapper } from 'svelte-tiptap';
    import { settingsStore } from '../../stores/settings';

    export let node: any;
    export let updateAttributes: (attrs: any) => void;

    let canvas: HTMLCanvasElement;
    let container: HTMLElement;
    let isDrawing = false;
    let currentLine: any[] = [];
    let lines: any[] = [];
    let isResizing = false;
    let activeHandle: 'br' | 'tl' | null = null;
    let startX = 0;
    let startY = 0;
    let startWidth = 0;
    let startHeight = 0;

    $: width = node.attrs.width || 500;
    $: height = node.attrs.height || 300;
    $: zoom = $settingsStore.zoomLevel || 1.0;

    onMount(() => {
        // Parse lines once
        const nodeLines = node.attrs.lines;
        if (Array.isArray(nodeLines)) {
            lines = [...nodeLines];
        } else if (typeof nodeLines === 'string' && nodeLines.length > 0) {
            try { lines = JSON.parse(nodeLines); } catch { lines = []; }
        }

        syncSize();
        const observer = new ResizeObserver(syncSize);
        observer.observe(container);

        return () => observer.disconnect();
    });

    function syncSize() {
        if (!canvas || !container) return;
        const rect = container.getBoundingClientRect();
        if (rect.width === 0) return;
        canvas.width = rect.width;
        canvas.height = rect.height;
        draw();
    }

    function draw() {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#4a9eff';
        ctx.lineWidth = 2;

        lines.forEach((line: any) => {
            if (Array.isArray(line) && line.length > 0) {
                ctx.beginPath();
                line.forEach((point: any, index: number) => {
                    const x = (point.x / 500) * canvas.width;
                    const y = (point.y / height) * canvas.height;
                    if (index === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });
                ctx.stroke();
            }
        });
    }

    function onMouseDown(e: MouseEvent) {
        isDrawing = true;
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (500 / canvas.width);
        const y = (e.clientY - rect.top) * (height / canvas.height);
        currentLine = [{ x, y }];
        lines = [...lines, currentLine];
    }

    function onMouseMove(e: MouseEvent) {
        if (!isDrawing) return;
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (500 / canvas.width);
        const y = (e.clientY - rect.top) * (height / canvas.height);
        currentLine.push({ x, y });
        lines = lines; // trigger Svelte update if needed
        draw();
    }

    function stopDrawing() {
        if (!isDrawing) return;
        isDrawing = false;
        updateAttributes({ lines: [...lines] });
    }

    function startResize(e: MouseEvent, handle: 'br' | 'tl') {
        e.preventDefault();
        e.stopPropagation();
        isResizing = true;
        activeHandle = handle;
        startX = e.clientX;
        startY = e.clientY;
        startWidth = width;
        startHeight = height;

        window.addEventListener('mousemove', handleResize);
        window.addEventListener('mouseup', stopResize);
    }

    function handleResize(e: MouseEvent) {
        if (!isResizing || !activeHandle) return;
        const dx = (e.clientX - startX) / zoom;
        const dy = (e.clientY - startY) / zoom;
        const factor = activeHandle === 'br' ? 1 : -1;

        const newWidth = Math.max(100, Math.min(1000, startWidth + (dx * factor)));
        const newHeight = Math.max(100, Math.min(800, startHeight + (dy * factor)));

        updateAttributes({ width: newWidth, height: newHeight });
        syncSize();
    }

    function stopResize() {
        isResizing = false;
        activeHandle = null;
        window.removeEventListener('mousemove', handleResize);
        window.removeEventListener('mouseup', stopResize);
    }
</script>

<NodeViewWrapper class="drawing-node-wrapper">
    <div 
        class="drawing-node" 
        bind:this={container}
        style="width: {width}px;"
    >
        <div class="drawing-container" style="height: {height}px;">
            <canvas
                bind:this={canvas}
                on:mousedown={onMouseDown}
                on:mousemove={onMouseMove}
                on:mouseup={stopDrawing}
                on:mouseleave={stopDrawing}
                style="cursor: crosshair; display: block;"
            ></canvas>
        </div>

        <div 
            class="drawing-resize-handle br" 
            on:mousedown={(e) => startResize(e, 'br')}
            role="button"
            tabindex="0"
            aria-label="Resize from bottom right"
        ></div>
        <div 
            class="drawing-resize-handle tl" 
            on:mousedown={(e) => startResize(e, 'tl')}
            role="button"
            tabindex="0"
            aria-label="Resize from top left"
        ></div>
    </div>
</NodeViewWrapper>

<style>
    .drawing-node-wrapper {
        margin: 2rem 0;
        display: flex;
        justify-content: center;
    }

    .drawing-node {
        position: relative;
        background: #1c2128;
        border: 1px solid #3a3a3a;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        transition: border-color 0.2s;
        overflow: visible;
    }

    .drawing-node:hover {
        border-color: rgba(74, 158, 255, 0.4);
    }

    .drawing-container {
        width: 100%;
        position: relative;
        overflow: hidden;
        border-radius: 12px;
    }

    canvas {
        width: 100%;
        height: 100%;
    }

    .drawing-resize-handle {
        position: absolute;
        width: 12px;
        height: 12px;
        background: #4a9eff;
        border: 2px solid #fff;
        border-radius: 50%;
        cursor: nwse-resize;
        z-index: 10;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        opacity: 0;
        transition: opacity 0.2s;
    }

    .drawing-node:hover .drawing-resize-handle {
        opacity: 1;
    }

    .drawing-resize-handle.br {
        bottom: -6px;
        right: -6px;
    }

    .drawing-resize-handle.tl {
        top: -6px;
        left: -6px;
    }
</style>
