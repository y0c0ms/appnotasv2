<script lang="ts">
    import { onMount, onDestroy, tick } from 'svelte';
    import { get } from 'svelte/store';
    import { settingsStore } from '$lib/stores/settings';
    import { focusArea } from '$lib/stores/focus';
    import { terminalCommandBus } from '$lib/stores/files';
    import { Terminal } from 'xterm';
    import { FitAddon } from '@xterm/addon-fit';
    import { spawn } from 'tauri-pty';
    import { invoke } from '@tauri-apps/api/core';
    import { Plus, X, Terminal as TerminalIcon, Columns2 } from 'lucide-svelte';
    import 'xterm/css/xterm.css';

    interface Props {
        cwd?: string;
        visible?: boolean;
    }

    let { cwd = '', visible = true }: Props = $props();

    interface ShellOption {
        id: string;
        name: string;
        command: string;
        available: boolean;
    }

    interface TerminalSession {
        id: string;
        name: string;
        term: Terminal;
        fitAddon: FitAddon;
        pty: any;
        shell: ShellOption;
        groupId: string | null; // sessions split together share a groupId
    }

    let sessions = $state<TerminalSession[]>([]);
    let activeSessionId = $state<string | null>(null);
    let highlightedSessionId = $state<string | null>(null);
    let visibleSessionIds = $state<string[]>([]);
    let sessionCount = 0; // for unique ID generation
    
    // Elements mapped by session ID
    let sessionElements = $state<Record<string, HTMLElement>>({});
    let openedTerminals = new Set<string>();
    let wrapperEl = $state<HTMLElement>();
    let sidebarEl = $state<HTMLElement>();
    let resizeObserver: ResizeObserver | null = null;

    let showShellMenu = $state(false);
    // When set, the next shell picked from the menu splits beside this terminal
    // (instead of opening a standalone new terminal).
    let splitSourceId = $state<string | null>(null);
    let availableShells = $state<ShellOption[]>([]);
    let defaultShell = $state<ShellOption | null>(null);

    // Computed active session
    let currentSession = $derived(sessions.find(s => s.id === activeSessionId));

    // Split panes form a persistent group (shared groupId) so the grouping in
    // the tab bar survives opening other terminals. Cluster tabs by group,
    // preserving order; a group of 2+ renders inside one box.
    let tabClusters = $derived.by(() => {
        const clusters: { groupId: string | null; sessions: TerminalSession[] }[] = [];
        const indexByGroup = new Map<string, number>();
        for (const s of sessions) {
            if (s.groupId && indexByGroup.has(s.groupId)) {
                clusters[indexByGroup.get(s.groupId)!].sessions.push(s);
            } else if (s.groupId) {
                indexByGroup.set(s.groupId, clusters.length);
                clusters.push({ groupId: s.groupId, sessions: [s] });
            } else {
                clusters.push({ groupId: null, sessions: [s] });
            }
        }
        return clusters;
    });

    $effect(() => {
        if ($terminalCommandBus && currentSession && currentSession.pty) {
            const cmd = $terminalCommandBus;
            tick().then(() => terminalCommandBus.set(null));
            currentSession.pty.write(cmd);
        }
    });

    // Detect available shells on the system
    async function detectShells() {
        // Shell detection lives in Rust (`detect_shells`) so it's correct and
        // OS-agnostic: it finds installed shells via PATH/known locations and
        // only lists WSL when a distro is actually registered.
        let shells: ShellOption[] = [];
        try {
            shells = await invoke<ShellOption[]>('detect_shells');
        } catch (e) {
            console.error('Failed to detect shells:', e);
        }

        if (shells.length === 0) {
            // Fallback so a terminal can still open if detection fails.
            const isWindows = navigator.platform.includes('Win');
            shells = [{ id: 'default', name: 'Shell', command: isWindows ? 'powershell.exe' : '/bin/bash', available: true }];
        }

        availableShells = shells;

        const defaultShellId = get(settingsStore).defaultShell;
        defaultShell = shells.find(s => s.id === defaultShellId) || shells[0];
    }

    async function spawnNewSession(shellToUse?: ShellOption, splitWith: string | null = null) {
        const shell = shellToUse || defaultShell;
        if (!shell) return;
        
        sessionCount++;
        const sessionId = `term-${Date.now()}-${sessionCount}`;
        
        const term = new Terminal({
            cursorBlink: true,
            fontSize: 13,
            fontFamily: '"Fira Code", "Cascadia Code", Consolas, monospace',
            theme: {
                background: '#0d1117',
                foreground: '#c9d1d9',
                cursor: '#4a9eff',
                selectionBackground: 'rgba(74, 158, 255, 0.3)',
                black: '#0d1117',
                red: '#ff7b72',
                green: '#7ee787',
                yellow: '#ffa657',
                blue: '#79c0ff',
                magenta: '#d2a8ff',
                cyan: '#a5d6ff',
                white: '#c9d1d9',
            },
            allowTransparency: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        // Add to state temporarily without PTY to ensure rendering happens
        const initialSessionName = `${shell.name} ${sessionCount}`;

        // Determine the split group: splitting joins (or creates) the source's
        // group; a plain new terminal is standalone (groupId null).
        let groupId: string | null = null;
        if (splitWith) {
            const src = sessions.find(s => s.id === splitWith);
            groupId = src?.groupId ?? `grp-${sessionId}`;
        }

        const newSession: TerminalSession = {
            id: sessionId,
            name: initialSessionName,
            term,
            fitAddon,
            pty: null,
            shell,
            groupId
        };

        // Append the new session; if splitting, tag the source into the group.
        sessions = [
            ...sessions.map(s => (splitWith && s.id === splitWith && !s.groupId) ? { ...s, groupId } : s),
            newSession
        ];
        activeSessionId = sessionId;
        highlightedSessionId = sessionId;

        if (groupId) {
            // Show every pane in this group side by side.
            visibleSessionIds = sessions.filter(s => s.groupId === groupId).map(s => s.id);
        } else {
            // A standalone new terminal becomes the sole visible pane.
            visibleSessionIds = [sessionId];
        }

        // Custom key handler to allow app-wide focus shortcuts to bubble up
        term.attachCustomKeyEventHandler((e) => {
            // Let focus-switching shortcuts bubble up
            if (e.ctrlKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                return false;
            }
            return true;
        });

        // Remove manual mounting here, handled by effect below
        
        try {
            const spawnOptions = {
                cols: term.cols || 80,
                rows: term.rows || 24,
                cwd: cwd && cwd.trim().length > 0 ? cwd : undefined,
            };

            const pty = spawn(shell.command, [], spawnOptions);

            term.onData((data) => pty.write(data));
            term.onResize(({ cols, rows }) => pty.resize(cols, rows));
            
            pty.onData((data: any) => term.write(data));
            pty.onExit(({ exitCode }: { exitCode: number }) => {
                term.write(`\r\n\x1b[33m[${initialSessionName} exited with code ${exitCode}]\x1b[0m\r\n`);
                // Auto kill if close on exit is desired
            });

            // Update session with active PTY
            const activeIndex = sessions.findIndex(s => s.id === sessionId);
            if (activeIndex !== -1) {
                sessions[activeIndex].pty = pty;
                sessions = [...sessions]; // trigger reactivity
            }
        } catch (e) {
            console.error('Failed to spawn shell:', e);
            term.write(`\x1b[31mFailed to start ${shell.name}: ${e}\x1b[0m\r\n`);
        }
    }

    function killSession(id: string) {
        const sessionIndex = sessions.findIndex(s => s.id === id);
        if (sessionIndex === -1) return;

        const session = sessions[sessionIndex];
        
        // Cleanup resources
        session.pty?.kill();
        session.term.dispose();

        const gid = session.groupId;

        // Update list
        sessions = sessions.filter(s => s.id !== id);
        visibleSessionIds = visibleSessionIds.filter(vid => vid !== id);

        // A split group with a single survivor is no longer a split — dissolve it.
        if (gid) {
            const members = sessions.filter(s => s.groupId === gid);
            if (members.length === 1) {
                sessions = sessions.map(s => s.id === members[0].id ? { ...s, groupId: null } : s);
            }
        }

        // Pick a new active terminal if we closed the active one (or emptied the view).
        if (activeSessionId === id || visibleSessionIds.length === 0) {
            const fallback = sessions[sessionIndex - 1]?.id || sessions[0]?.id || null;
            activeSessionId = fallback;
            if (fallback) {
                const s = sessions.find(x => x.id === fallback);
                visibleSessionIds = s?.groupId
                    ? sessions.filter(x => x.groupId === s.groupId).map(x => x.id)
                    : [fallback];
            } else {
                visibleSessionIds = [];
            }
        }
    }

    function switchToSession(id: string, forceFocus: boolean = true) {
        activeSessionId = id;
        // Show the clicked terminal's whole split group, or just it if standalone.
        const s = sessions.find(x => x.id === id);
        visibleSessionIds = s?.groupId
            ? sessions.filter(x => x.groupId === s.groupId).map(x => x.id)
            : [id];

        tick().then(() => {
            currentSession?.fitAddon?.fit();
            if (forceFocus) {
                currentSession?.term?.focus();
                focusArea.set('terminal');
            }
        });
    }

    // Open the shell picker to split a terminal: the chosen shell spawns a new
    // pane beside `id` (instead of silently cloning the same shell).
    function openSplitMenu(id: string | null) {
        if (!id) return;
        splitSourceId = id;
        showShellMenu = true;
    }

    function selectShell(shell: ShellOption) {
        const splitWith = splitSourceId;
        showShellMenu = false;
        splitSourceId = null;
        spawnNewSession(shell, splitWith);
    }

    function handleResize() {
        if (visible && currentSession?.fitAddon) {
            currentSession.fitAddon.fit();
        }
    }

    // Open the shell picker to create a standalone new terminal.
    function openNewTerminalMenu() {
        splitSourceId = null;
        showShellMenu = !showShellMenu;
    }

    function handleClickOutside(e: MouseEvent) {
        const target = e.target as HTMLElement;
        if (!target.closest('.shell-selector')) {
            showShellMenu = false;
        }
    }

    onMount(async () => {
        await detectShells();
        window.addEventListener('resize', handleResize);
        document.addEventListener('click', handleClickOutside);

        // Track exact container flex sizing out-of-bounds of window rezise
        if (wrapperEl) {
            resizeObserver = new ResizeObserver(() => {
                handleResize();
            });
            resizeObserver.observe(wrapperEl);
        }
    });

    onDestroy(() => {
        window.removeEventListener('resize', handleResize);
        document.removeEventListener('click', handleClickOutside);
        resizeObserver?.disconnect();
        
        sessions.forEach(session => {
            session.pty?.kill();
            session.term?.dispose();
        });
    });

    // Handle initial visible mount
    $effect(() => {
        if (visible && sessions.length === 0 && defaultShell) {
            spawnNewSession(defaultShell);
        }
    });

    $effect(() => {
        if (visible && currentSession?.fitAddon) {
            const timer = setTimeout(() => {
                try {
                    currentSession.fitAddon.fit();
                } catch (e) {}
            }, 150);
            return () => clearTimeout(timer);
        }
    });

    $effect(() => {
        if ($focusArea === 'terminal' && currentSession?.term && visible) {
            tick().then(() => {
                currentSession.term?.focus();
            });
        }
    });

    // Handle Zoom
    $effect(() => {
        const zoom = $settingsStore.zoomLevel || 1;
        sessions.forEach(s => {
            if (s.term) {
                s.term.options.fontSize = Math.max(8, Math.round(13 * zoom));
                // Wait for DOM to catch up then fit
                tick().then(() => {
                    if (s.fitAddon) s.fitAddon.fit();
                });
            }
        });
    });

    // Handle session mounting reactively
    $effect(() => {
        sessions.forEach(s => {
            if (!openedTerminals.has(s.id) && sessionElements[s.id]) {
                openedTerminals.add(s.id);
                s.term.open(sessionElements[s.id]);
                tick().then(() => {
                    s.fitAddon?.fit();
                });
            }
        });
    });

    // Handle Split Layout Resizing
    $effect(() => {
        if (visibleSessionIds.length > 0) {
            // Wait for display: block to take effect
            tick().then(() => {
                visibleSessionIds.forEach(id => {
                    const session = sessions.find(s => s.id === id);
                    if (session && session.fitAddon) {
                        session.fitAddon.fit();
                    }
                });
            });
        }
    });

    // Handle focus changes to sync highlighted session
    $effect(() => {
        if ($focusArea === 'terminal-tabs' && !highlightedSessionId && activeSessionId) {
            highlightedSessionId = activeSessionId;
        }
    });

    // Focus sidebar when focusArea changes to terminal-tabs
    $effect(() => {
        if ($focusArea === 'terminal-tabs' && sidebarEl) {
            tick().then(() => {
                // contains() so focus on a child session tab isn't stolen
                if (sidebarEl && !sidebarEl.contains(document.activeElement)) {
                    sidebarEl.focus();
                }
            });
        }
    });

    // Handle Tab Bar Keyboard Navigation (horizontal)
    function handleTabbarKeyDown(e: KeyboardEvent) {
        if ($focusArea !== 'terminal-tabs') return;

        const goNext = e.key === 'ArrowRight' || e.key === 'ArrowDown';
        const goPrev = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
        if (goNext || goPrev) {
            e.preventDefault();
            const index = sessions.findIndex(s => s.id === (highlightedSessionId || activeSessionId));
            if (index === -1) {
                if (sessions.length > 0) highlightedSessionId = sessions[0].id;
                return;
            }

            const nextIndex = goNext
                ? (index + 1) % sessions.length
                : (index - 1 + sessions.length) % sessions.length;

            highlightedSessionId = sessions[nextIndex].id;
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (highlightedSessionId) switchToSession(highlightedSessionId, true);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            const targetId = highlightedSessionId || activeSessionId;
            if (targetId) killSession(targetId);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            focusArea.set('terminal');
        }
    }
</script>

<div 
    class="terminal-layout" 
    class:hidden={!visible} 
    class:focused={$focusArea === 'terminal'}
    class:sidebar-focused={$focusArea === 'terminal-tabs'}
    bind:this={wrapperEl}
>
    {#snippet tab(session: TerminalSession)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_interactive_supports_focus -->
        <div
            class="term-tab"
            role="button"
            tabindex="0"
            class:active={activeSessionId === session.id}
            class:highlighted={highlightedSessionId === session.id}
            onclick={(e) => { e.stopPropagation(); highlightedSessionId = session.id; switchToSession(session.id); }}
        >
            <TerminalIcon size={13} color={activeSessionId === session.id ? '#4a9eff' : (highlightedSessionId === session.id ? '#66b2ff' : '#888')} />
            <span class="tab-name">{session.name.toLowerCase()}</span>
            <button class="split-btn" onclick={(e) => { e.stopPropagation(); openSplitMenu(session.id); }} title="Split — choose a shell">
                <Columns2 size={15} />
            </button>
            <button class="kill-btn" onclick={(e) => { e.stopPropagation(); killSession(session.id); }} title="Close terminal">
                <X size={15} />
            </button>
        </div>
    {/snippet}

    {#snippet shellMenuItems()}
        <div class="shell-menu" style="right: 0;">
            {#each availableShells as shell}
                <button class="shell-option" onclick={(e) => { e.stopPropagation(); selectShell(shell); }}>
                    <TerminalIcon size={14} class="option-icon" />
                    <span class="option-name">{shell.name}</span>
                </button>
            {/each}
        </div>
    {/snippet}

    {#snippet shellAdd()}
        <div class="shell-selector">
            <button class="add-button" onclick={(e) => { e.stopPropagation(); openNewTerminalMenu(); }} title="New terminal">
                <Plus size={16} />
            </button>
            {#if showShellMenu}
                {@render shellMenuItems()}
            {/if}
        </div>
    {/snippet}

    <!-- Main Terminal View (full width) -->
    <div class="terminal-main">

        <!-- Top tab bar: only shown with more than one session -->
        {#if sessions.length > 1}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div
                class="terminal-tabbar"
                class:focused={$focusArea === 'terminal-tabs'}
                data-focus-area="terminal-tabs"
                tabindex="0"
                role="navigation"
                aria-label="Terminal sessions"
                bind:this={sidebarEl}
                onkeydown={handleTabbarKeyDown}
                onclick={() => focusArea.set('terminal-tabs')}
            >
                <div class="tab-strip">
                    {#each tabClusters as cluster (cluster.groupId ?? cluster.sessions[0].id)}
                        {#if cluster.groupId && cluster.sessions.length > 1}
                            <div class="tab-group" title="Split group">
                                {#each cluster.sessions as session (session.id)}
                                    {@render tab(session)}
                                {/each}
                            </div>
                        {:else}
                            {#each cluster.sessions as session (session.id)}
                                {@render tab(session)}
                            {/each}
                        {/if}
                    {/each}
                </div>
                <div class="tabbar-actions">
                    {@render shellAdd()}
                </div>
            </div>
        {/if}

        <div
            class="terminal-body-wrapper"
            class:split-mode={visibleSessionIds.length > 1}
            bind:this={wrapperEl}
            onclick={() => focusArea.set('terminal')}
            role="button"
            data-focus-area="terminal"
            tabindex="0"
            onkeydown={(e) => e.key === 'Enter' && focusArea.set('terminal')} 
            aria-label="Terminal Output"
        >
            {#each sessions as session (session.id)}
                <div 
                    class="terminal-session-container" 
                    class:active={activeSessionId === session.id}
                    bind:this={sessionElements[session.id]}
                    style="display: {visibleSessionIds.includes(session.id) ? 'block' : 'none'};"
                    role="none"
                    onmousedown={() => { activeSessionId = session.id; focusArea.set('terminal'); }}
                ></div>
            {/each}
            {#if sessions.length === 0}
                <div class="empty-terminal">
                   <TerminalIcon size={48} opacity={0.2} color="#fff" />
                   <p>No active terminal sessions</p>
                </div>
            {/if}

            <!-- Floating controls when at most one session (tab bar is hidden) -->
            {#if sessions.length <= 1}
                <div class="floating-controls" aria-label="Terminal controls">
                    <button class="add-button" onclick={(e) => { e.stopPropagation(); openSplitMenu(activeSessionId); }} title="Split — choose a shell">
                        <Columns2 size={16} />
                    </button>
                    {@render shellAdd()}
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    .terminal-layout {
        display: flex;
        height: calc(100% - 2px);
        width: calc(100% - 2px);
        margin: 1px;
        min-height: 100px;
        background: #09090b;
        position: relative;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        transition: all 0.2s ease;
        box-sizing: border-box;
    }

    .terminal-layout.focused {
        box-shadow: inset 0 0 0 2px #4a9eff, 0 0 15px rgba(74, 158, 255, 0.1);
        border-top-color: transparent;
    }

    .terminal-layout.sidebar-focused {
        border-top-color: rgba(255, 255, 255, 0.1);
    }

    .terminal-tabbar.focused {
        background: rgba(74, 158, 255, 0.05);
        box-shadow: inset 0 2px 0 #4a9eff;
    }

    .terminal-layout.hidden {
        display: none;
    }

    /* MAIN VIEW */
    .terminal-main {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    /* BODY */
    .terminal-body-wrapper {
        flex: 1;
        padding: 0.5rem;
        overflow: hidden;
        position: relative;
        display: flex;
        flex-direction: column;
    }

    .terminal-body-wrapper.split-mode {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 8px;
        padding: 8px;
        background: #111;
    }

    .terminal-session-container {
        height: 100%;
        width: 100%;
        min-height: 0;
        border-radius: 4px;
        overflow: hidden;
        border: 2px solid transparent;
        background: #000;
        transition: border-color 0.2s;
    }

    .split-mode .terminal-session-container.active {
        border-color: rgba(74, 158, 255, 0.4);
    }

    .empty-terminal {
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: #555;
        gap: 1rem;
    }

    :global(.terminal-session-container .xterm-viewport) {
        overflow-y: auto !important;
    }

    /* SHELL SELECTOR DIALOG */
    .shell-selector {
        position: relative;
    }

    .add-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        background: transparent;
        border: none;
        border-radius: 6px;
        color: #aaa;
        cursor: pointer;
        transition: all 0.15s;
    }

    .add-button:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
    }

    .shell-menu {
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 4px;
        min-width: 160px;
        background: #18181b;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        z-index: 100;
        overflow: hidden;
    }

    .shell-option {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        padding: 0.6rem 0.8rem;
        background: transparent;
        border: none;
        color: #ccc;
        font-size: 0.85rem;
        cursor: pointer;
        transition: all 0.1s;
    }

    .shell-option:hover {
        background: rgba(255, 255, 255, 0.05);
        color: #fff;
    }

    :global(.option-icon) {
        color: #4a9eff;
    }

    /* TOP TAB BAR */
    .terminal-tabbar {
        display: flex;
        align-items: center;
        height: 34px;
        flex-shrink: 0;
        background: #09090b;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        padding: 0 0.3rem;
        gap: 0.3rem;
        outline: none;
    }

    .tab-strip {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 2px;
        height: 100%;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: thin;
    }

    .tab-strip::-webkit-scrollbar { height: 4px; }
    .tab-strip::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 2px; }

    /* Grouped tabs for a split view — reads as one unit. */
    .tab-group {
        display: flex;
        align-items: center;
        gap: 1px;
        flex-shrink: 0;
        padding: 2px;
        border-radius: 8px;
        background: rgba(74, 158, 255, 0.08);
        box-shadow: inset 0 0 0 1px rgba(74, 158, 255, 0.35);
    }

    .tab-group .term-tab {
        border-radius: 5px;
    }

    .term-tab {
        display: flex;
        align-items: center;
        gap: 0.45rem;
        flex-shrink: 0;
        max-width: 200px;
        height: 30px;
        padding: 0 0.3rem 0 0.6rem;
        background: transparent;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.1s;
    }

    .term-tab:hover {
        background: rgba(255, 255, 255, 0.05);
    }

    .term-tab.active {
        background: rgba(74, 158, 255, 0.12);
    }

    .term-tab.highlighted {
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 -2px 0 rgba(74, 158, 255, 0.6);
    }

    .tab-name {
        font-size: 0.78rem;
        color: #bbb;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .term-tab.active .tab-name {
        color: #fff;
    }

    .tabbar-actions {
        display: flex;
        align-items: center;
        gap: 2px;
        flex-shrink: 0;
        padding-left: 0.3rem;
        border-left: 1px solid rgba(255, 255, 255, 0.05);
    }

    /* Floating controls shown in single-session mode (tab bar hidden) */
    .floating-controls {
        position: absolute;
        top: 8px;
        right: 12px;
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 2px;
        background: rgba(20, 20, 24, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 6px;
        backdrop-filter: blur(4px);
        opacity: 0.35;
        transition: opacity 0.15s;
        z-index: 20;
    }

    .terminal-body-wrapper:hover .floating-controls,
    .floating-controls:hover {
        opacity: 1;
    }

    .kill-btn,
    .split-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        background: transparent;
        border: none;
        border-radius: 5px;
        color: #888;
        cursor: pointer;
        opacity: 0.45;
        transition: all 0.15s;
        flex-shrink: 0;
    }

    .term-tab:hover .kill-btn,
    .term-tab.active .kill-btn,
    .term-tab:hover .split-btn,
    .term-tab.active .split-btn {
        opacity: 1;
    }

    .split-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
    }

    .kill-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #ff5c5c;
    }
</style>
