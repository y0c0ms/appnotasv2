<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { EditorView, basicSetup } from 'codemirror';
	import { EditorState } from '@codemirror/state';
	import { markdown } from '@codemirror/lang-markdown';
	import { oneDark } from '@codemirror/theme-one-dark';
	import { activeNote, notesList, saveNoteToFile, setNoteColor } from '$lib/stores/notes';
	import {
		colorChangeRequested,
		codeInsertRequested,
		fileInsertRequested,
		listModeToggleRequested
	} from '$lib/stores/shortcuts';
	import { openFiles, activeFile } from '$lib/stores/files';
	import { invoke } from '@tauri-apps/api/core';
	import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
	import { richNoteDecorations, richNoteTheme } from '$lib/utils/rich-note-decorations';
	import CodeInsertDialog from './CodeInsertDialog.svelte';
	import CommandPalette from './CommandPalette.svelte';

	let title = $activeNote?.title || '';
	let editorContainer: HTMLElement;
	let editorView: EditorView | null = null;
	let saveTimeout: ReturnType<typeof setTimeout>;
	let showCommandPalette = false;
	let commandPalettePos = { x: 0, y: 0 };

	// Listen for color change requests
	$: if ($colorChangeRequested && $activeNote) {
		setNoteColor($activeNote.id, $colorChangeRequested);
		console.log('Note color changed to:', $colorChangeRequested);
	}

	// Listen for checklist mode toggle
	$: if ($listModeToggleRequested && editorView) {
		toggleChecklistMode();
	}

	// Get color class
	$: colorClass = $activeNote?.color || 'default';

	// Handle file mention clicks
	function handleFileClick(filepath: string) {
		console.log('Opening file from mention:', filepath);
		invoke<string>('read_file', { path: filepath })
			.then((content) => {
				const ext = filepath.split('.').pop() || 'text';
				const languageMap: Record<string, string> = {
					js: 'javascript',
					ts: 'typescript',
					py: 'python',
					rs: 'rust',
					md: 'markdown',
					json: 'json',
					html: 'html',
					css: 'css'
				};
				const language = languageMap[ext] || 'text';

				openFiles.update((files) => {
					if (files.some((f) => f.path === filepath)) {
						activeFile.set(files.find((f) => f.path === filepath)!);
						return files;
					}

					const newFile = {
						path: filepath,
						content,
						language,
						modified: false
					};

					activeFile.set(newFile);
					return [...files, newFile];
				});
			})
			.catch((error) => {
				console.error('Failed to open file mention:', error);
			});
	}

	// Toggle checklist mode - add [ ] to lines
	function toggleChecklistMode() {
		if (!editorView) return;

		const state = editorView.state;
		const selection = state.selection.main;
		const line = state.doc.lineAt(selection.from);
		const lineText = line.text;

		// Check if line already has checkbox
		if (lineText.trim().startsWith('[ ]') || lineText.trim().startsWith('[x]')) {
			// Remove checkbox
			const newText = lineText.replace(/^\s*\[[x ]\]\s*/, '');
			editorView.dispatch({
				changes: { from: line.from, to: line.to, insert: newText }
			});
		} else {
			// Add checkbox
			const indent = lineText.match(/^\s*/)?.[0] || '';
			const newText = indent + '[ ] ' + lineText.trim();
			editorView.dispatch({
				changes: { from: line.from, to: line.to, insert: newText }
			});
		}
	}

	// Handle @file command
	async function handleFileCommand(pos: number) {
		try {
			const selected = await openFileDialog({
				directory: false,
				multiple: false,
				title: 'Choose File to Link'
			});

			if (selected && typeof selected === 'string' && editorView) {
				const filename = selected.split(/[/\\]/).pop() || selected;
				const fileLink = `[${filename}](file:///${selected.replace(/\\/g, '/')})`;

				editorView.dispatch({
					changes: { from: pos - 5, to: pos, insert: fileLink }
				});
			}
		} catch (e) {
			console.error('Failed to select file:', e);
		}
	}

	// Handle code block updates
	function handleCodeUpdate(from: number, to: number, newCode: string) {
		if (!editorView) return;

		const doc = editorView.state.doc.toString();
		const match = doc.substring(from, to).match(/```(\w+)\n[\s\S]*?```/);
		if (!match) return;

		const lang = match[1];
		const newBlock = `\`\`\`${lang}\n${newCode}\n\`\`\``;

		editorView.dispatch({
			changes: { from, to, insert: newBlock }
		});
	}

	// Handle code block deletion
	function handleCodeDelete(from: number, to: number) {
		if (!editorView) return;

		editorView.dispatch({
			changes: { from, to, insert: '' }
		});
	}

	// Handle checkbox toggle
	function handleCheckboxToggle(pos: number) {
		if (!editorView) return;

		const doc = editorView.state.doc.toString();
		const checkbox = doc.substring(pos, pos + 3);

		const newCheckbox = checkbox.includes('x') ? '[ ]' : '[x]';

		editorView.dispatch({
			changes: { from: pos, to: pos + 3, insert: newCheckbox }
		});
	}

	// Auto-save after 1 second of no typing
	function scheduleSave() {
		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(async () => {
			if ($activeNote && editorView) {
				const content = editorView.state.doc.toString();

				if ($activeNote.path) {
					try {
						await saveNoteToFile($activeNote.id, content);
						console.log('File-based note auto-saved:', $activeNote.id);
					} catch (e) {
						console.error('Failed to save file-based note:', e);
					}
				} else {
					const updatedNote = {
						...$activeNote,
						title,
						content,
						updated_at: new Date().toISOString()
					};

					try {
						await invoke('save_note', { note: updatedNote });
						console.log('In-memory note auto-saved:', updatedNote.id);

						notesList.update((notes) =>
							notes.map((n) => (n.id === updatedNote.id ? updatedNote : n))
						);
					} catch (e) {
						console.error('Failed to save note:', e);
					}
				}
			}
		}, 1000);
	}

	// Create CodeMirror editor
	function createEditor(container: HTMLElement, initialContent: string) {
		const state = EditorState.create({
			doc: initialContent,
			extensions: [
				// Custom extensions instead of basicSetup to avoid line numbers
				EditorView.lineWrapping,
				markdown(),
				oneDark,
				richNoteDecorations(
					handleCodeUpdate,
					handleCodeDelete,
					handleCheckboxToggle,
					handleFileClick
				),
				richNoteTheme,
				EditorView.updateListener.of((update) => {
					if (update.docChanged) {
						scheduleSave();

						// Check for @ command trigger
						const changes = update.changes;
						changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
							const insertedText = inserted.toString();

							// Check if we just typed @
							if (insertedText === '@') {
								console.log('@ detected - showing command palette');
								showCommandPalette = true;
								// Don't auto-trigger codeInsertRequested here
								// Command palette will handle showing options
							}
						});
					}
				}),
				EditorView.theme({
					'&': {
						height: '100%',
						fontSize: '1rem',
						backgroundColor: 'transparent'
					},
					'.cm-scroller': {
						fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif',
						lineHeight: '1.8',
						padding: '1rem'
					},
					'.cm-content': {
						caretColor: '#4a9eff'
					},
					'.cm-gutters': {
						display: 'none' // Hide line numbers
					}
				})
			]
		});

		editorView = new EditorView({
			state,
			parent: container
		});

		return editorView;
	}

	// Listen for code block insert from dialog
	function handleCodeBlockInsert(event: CustomEvent) {
		if (!editorView) return;

		const { codeBlock } = event.detail;
		const state = editorView.state;
		const pos = state.selection.main.head;

		// Find and remove @code text
		const doc = state.doc.toString();
		const beforePos = doc.substring(0, pos);
		const codeIndex = beforePos.lastIndexOf('@code');

		if (codeIndex !== -1) {
			editorView.dispatch({
				changes: [
					{ from: codeIndex, to: pos, insert: '' },
					{ from: codeIndex, insert: codeBlock + '\n' }
				]
			});
		} else {
			// Just insert at cursor
			editorView.dispatch({
				changes: { from: pos, insert: codeBlock + '\n' }
			});
		}
	}

	// Reinitialize editor when note changes
	$: if ($activeNote && editorContainer) {
		title = $activeNote.title;

		// Destroy old editor
		if (editorView) {
			editorView.destroy();
		}

		// Create new editor with note content
		createEditor(editorContainer, $activeNote.content);
	}

	onMount(() => {
		if ($activeNote && editorContainer) {
			createEditor(editorContainer, $activeNote.content);
		}

		// Listen for code block insert events
		window.addEventListener('insertCodeBlock', handleCodeBlockInsert as EventListener);

		// Listen for dialog open events from command palette
		window.addEventListener('openCodeDialog', () => {
			// CodeInsertDialog will open automatically via its store
		});

		window.addEventListener('openFileDialog', async () => {
			if (editorView) {
				const pos = editorView.state.selection.main.head;
				await handleFileCommand(pos);
			}
		});

		return () => {
			window.removeEventListener('insertCodeBlock', handleCodeBlockInsert as EventListener);
			window.removeEventListener('openCodeDialog', () => {});
			window.removeEventListener('openFileDialog', () => {});
		};
	});

	onDestroy(() => {
		if (editorView) {
			editorView.destroy();
		}
	});
</script>

<CodeInsertDialog />
<CommandPalette />

<div class="note-editor color-{colorClass}">
	<input
		class="note-title"
		bind:value={title}
		on:input={scheduleSave}
		placeholder="Note title..."
	/>

	<div class="editor-wrapper">
		<div class="editor-container" bind:this={editorContainer}></div>
	</div>

	<div class="note-hints">
		<span>
			Auto-save enabled
			{#if $activeNote?.color}• {$activeNote.color}{/if}
			• Type @ for commands • Ctrl+L for checklists
		</span>
		<span>{editorView?.state.doc.length || 0} characters</span>
	</div>
</div>

<style>
	.note-editor {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: 2rem;
		overflow: hidden;
		background: #1a1a1a;
		transition: background-color 0.3s ease;
	}

	/* Color themes */
	.note-editor.color-red {
		background: linear-gradient(135deg, #1a1212 0%, #2a1515 100%);
	}

	.note-editor.color-yellow {
		background: linear-gradient(135deg, #1a1810 0%, #2a2418 100%);
	}

	.note-editor.color-green {
		background: linear-gradient(135deg, #101a12 0%, #152a18 100%);
	}

	.note-editor.color-blue {
		background: linear-gradient(135deg, #101418 0%, #15202a 100%);
	}

	.note-title {
		width: 100%;
		padding: 0.5rem;
		font-size: 1.5rem;
		font-weight: 600;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: #fff;
		margin-bottom: 1rem;
		transition: border-color 0.2s;
	}

	.note-title:focus {
		outline: none;
		border-bottom-color: #4a9eff;
	}

	.editor-wrapper {
		flex: 1;
		position: relative;
		overflow: hidden;
	}

	.editor-container {
		height: 100%;
		border: 1px solid #2a2a2a;
		border-radius: 4px;
		overflow: hidden;
	}

	.note-hints {
		display: flex;
		justify-content: space-between;
		margin-top: 0.5rem;
		padding: 0.5rem;
		font-size: 0.75rem;
		color: #666;
	}
</style>
