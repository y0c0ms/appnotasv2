<script lang="ts">
    import { settingsStore } from '../../stores/settings';
	import { NodeViewWrapper } from 'svelte-tiptap';

	export let node: any;
	export let updateAttributes: (attrs: any) => void;

	let resizing = false;
	let startWidth = 0;
	let startX = 0;
	let startY = 0;
    let aspectRatio = 1;
	let activeHandle: 'br' | 'tl' | null = null;

    $: zoom = $settingsStore.zoomLevel || 1.0;

	function onMouseDown(e: MouseEvent, handle: 'br' | 'tl') {
		e.preventDefault();
        e.stopPropagation();
		resizing = true;
        activeHandle = handle;
		startX = e.clientX;
		startY = e.clientY;
		
        const img = (e.target as HTMLElement).parentElement?.querySelector('img');
        if (img) {
            aspectRatio = img.naturalWidth / img.naturalHeight;
            startWidth = Number(node.attrs.width || img.clientWidth);
        }

		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'nwse-resize';
	}

	function onMouseMove(e: MouseEvent) {
		if (!resizing || !activeHandle) return;

		const physicalDx = e.clientX - startX;
        const logicalDx = physicalDx / zoom;
        
        // If resizing from TL, dragging LEFT (negative dx) increases width
        let change = activeHandle === 'br' ? logicalDx : -logicalDx;
        let newWidth = Math.max(50, Math.min(2000, startWidth + change));

		updateAttributes({
			width: Math.round(newWidth),
			height: Math.round(newWidth / aspectRatio)
		});
	}

	function onMouseUp() {
		resizing = false;
        activeHandle = null;
		window.removeEventListener('mousemove', onMouseMove);
		window.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
	}
</script>

<NodeViewWrapper>
	<div class="image-container" style="width: {node.attrs.width ? node.attrs.width + 'px' : 'auto'}; height: {node.attrs.height ? node.attrs.height + 'px' : 'auto'}">
		<img 
            src={node.attrs.src} 
            alt={node.attrs.alt} 
            title={node.attrs.title} 
            class="resizable-image"
        />
		<div 
            class="resizer-handle br" 
            on:mousedown={(e) => onMouseDown(e, 'br')}
            role="button"
            tabindex="0"
            aria-label="Resize from bottom right"
        ></div>
		<div 
            class="resizer-handle tl" 
            on:mousedown={(e) => onMouseDown(e, 'tl')}
            role="button"
            tabindex="0"
            aria-label="Resize from top left"
        ></div>
	</div>
</NodeViewWrapper>

<style>
	.image-container {
		position: relative;
		display: inline-block;
        border: 2px solid transparent;
        transition: border-color 0.2s;
        border-radius: 4px;
        overflow: visible;
        margin: 1rem 0;
	}

    .image-container:hover {
        border-color: rgba(74, 158, 255, 0.4);
    }

	.resizable-image {
		display: block;
		width: 100%;
		height: 100%;
        border-radius: 2px;
	}

	.resizer-handle {
		position: absolute;
		width: 12px;
		height: 12px;
		background: #4a9eff;
		border: 2px solid #fff;
		border-radius: 50%;
		cursor: nwse-resize;
		z-index: 10;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        opacity: 0;
        transition: opacity 0.2s;
	}

    .resizer-handle.br {
		bottom: -6px;
		right: -6px;
    }

    .resizer-handle.tl {
		top: -6px;
		left: -6px;
    }

	.image-container:hover .resizer-handle {
		opacity: 1;
	}
</style>
