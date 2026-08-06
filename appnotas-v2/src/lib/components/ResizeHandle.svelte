<script lang="ts">
	/**
	 * Vertical drag grip for resizing a side panel.
	 *
	 * The parent owns the width: `onmove` receives the pointer's viewport X so it
	 * can derive the new width from whichever edge it lives on, and `onstep` gives
	 * keyboard users the same control (arrow keys, 16px per press).
	 */
	interface Props {
		onmove: (clientX: number) => void;
		onstep: (deltaPx: number) => void;
		onend?: () => void;
		label: string;
		/** Which edge of the parent the grip sits on. */
		edge: 'left' | 'right';
	}

	let { onmove, onstep, onend, label, edge }: Props = $props();

	const STEP_PX = 16;

	let dragging = $state(false);

	function start(event: MouseEvent) {
		event.preventDefault();
		dragging = true;

		const move = (e: MouseEvent) => onmove(e.clientX);
		const stop = () => {
			window.removeEventListener('mousemove', move);
			window.removeEventListener('mouseup', stop);
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
			dragging = false;
			onend?.();
		};

		// Locking the cursor and disabling selection keeps the drag from turning
		// into a text selection once the pointer leaves the 6px grip.
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
		window.addEventListener('mousemove', move);
		window.addEventListener('mouseup', stop);
	}

	function key(event: KeyboardEvent) {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		const towardsWider = edge === 'left' ? event.key === 'ArrowLeft' : event.key === 'ArrowRight';
		onstep(towardsWider ? STEP_PX : -STEP_PX);
		onend?.();
	}
</script>

<button
	type="button"
	class="resize-handle {edge}"
	class:dragging
	aria-label={label}
	title={label}
	onmousedown={start}
	onkeydown={key}
></button>

<style>
	.resize-handle {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 6px;
		padding: 0;
		border: none;
		background: transparent;
		cursor: col-resize;
		z-index: 20;
	}

	.resize-handle.left {
		left: 0;
	}

	.resize-handle.right {
		right: 0;
	}

	.resize-handle:hover,
	.resize-handle.dragging,
	.resize-handle:focus-visible {
		background: rgba(74, 158, 255, 0.55);
	}
</style>
