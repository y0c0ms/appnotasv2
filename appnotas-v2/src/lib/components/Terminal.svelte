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
    import { Plus, X, Terminal as TerminalIcon, ChevronDown, Trash2, Columns2 } from 'lucide-svelte';
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
    let availableShells = $state<ShellOption[]>([]);
    let defaultShell = $state<ShellOption | null>(null);

    // Computed active session
    let currentSession = $derived(sessions.find(s => s.id === activeSessionId));

    $effect(() => {
        if ($terminalCommandBus && currentSession && currentSession.pty) {
            const cmd = $terminalCommandBus;
            tick().then(() => terminalCommandBus.set(null));
            currentSession.pty.write(cmd);
        }
    });

    // Detect available shells on the system
    async function detectShells() {
        const isWindows = navigator.platform.includes('Win');
        const shells: ShellOption[] = [];

        if (isWindows) {
            shells.push({ id: 'powershell', name: 'PowerShell', command: 'powershell.exe', available: true });
            shells.push({ id: 'cmd', name: 'Command Prompt', command: 'cmd.exe', available: true });

            try {
                const gitBashPaths = [
                    'C:\\Program Files\\Git\\bin\\bash.exe',
                    'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
                ];
                for (const path of gitBashPaths) {
                    try {
                        const exists = await invoke<boolean>('plugin:fs|exists', { path });
                        if (exists) {
                            shells.push({ id: 'gitbash', name: 'Git Bash', command: path, available: true });
                            break;
                        }
                    } catch (e) {
                        // ignore error
                    }
                }
            } catch (e) {}

            try {
                shells.push({ id: 'wsl', name: 'WSL (Ubuntu)', command: 'wsl.exe', available: true });
            } catch (e) {}
        } else {
            shells.push({ id: 'bash', name: 'Bash', command: '/bin/bash', available: true });
            shells.push({ id: 'zsh', name: 'Zsh', command: '/bin/zsh', available: true });
        }

        availableShells = shells;
        
        const defaultShellId = get(settingsStore).defaultShell;
        const preferredShell = shells.find(s => s.id === defaultShellId);
        defaultShell = preferredShell || shells[0];
    }

    async function spawnNewSession(shellToUse?: ShellOption) {
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
        const newSession: TerminalSession = {
            id: sessionId,
            name: initialSessionName,
            term,
            fitAddon,
            pty: null,
            shell
        };
        
        sessions = [...sessions, newSession];
        activeSessionId = sessionId;
        highlightedSessionId = sessionId;
        if (visibleSessionIds.length <= 1) {
            visibleSessionIds = [sessionId];
        } else {
            visibleSessionIds = [...visibleSessionIds, sessionId];
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

        // Update list
        sessions = sessions.filter(s => s.id !== id);
        visibleSessionIds = visibleSessionIds.filter(vid => vid !== id);

        // Handle Active fallback
        if (activeSessionId === id || visibleSessionIds.length === 0) {
            if (sessions.length > 0) {
                activeSessionId = sessions[sessionIndex - 1]?.id || sessions[0]?.id;
                if (visibleSessionIds.length === 0) visibleSessionIds = [activeSessionId!];
            } else {
                activeSessionId = null;
                visibleSessionIds = [];
            }
        }
    }

    function switchToSession(id: string, forceFocus: boolean = true) {
        activeSessionId = id;
        if (visibleSessionIds.length <= 1) {
            visibleSessionIds = [id];
        } else if (!visibleSessionIds.includes(id)) {
            // Keep existing splits but replace the first one if it's too many?
            // Actually, usually switching just changes the "active" one.
            // If in split mode, we stay in split mode.
        }
        
        tick().then(() => {
            currentSession?.fitAddon?.fit();
            if (forceFocus) {
                currentSession?.term?.focus();
                focusArea.set('terminal');
            }
        });
    }

    function splitTerminal(id: string) {
        const session = sessions.find(s => s.id === id);
        if (!session) return;
        
        spawnNewSession(session.shell);
    }

    function toggleSplitMode() {
        if (visibleSessionIds.length > 1) {
            // Unsplit - keep only active
            if (activeSessionId) visibleSessionIds = [activeSessionId];
        } else {
            // Split - find another one or create one
            if (activeSessionId) splitTerminal(activeSessionId);
        }
    }

    function selectShell(shell: ShellOption) {
        showShellMenu = false;
        spawnNewSession(shell);
    }

    function handleResize() {
        if (visible && currentSession?.fitAddon) {
            currentSession.fitAddon.fit();
        }
    }

    function toggleShellMenu() {
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
                sidebarEl?.focus();
            });
        }
    });

    // Handle Sidebar Keyboard Navigation
    function handleSidebarKeyDown(e: KeyboardEvent) {
        if ($focusArea !== 'terminal-tabs') return;

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const index = sessions.findIndex(s => s.id === (highlightedSessionId || activeSessionId));
            if (index === -1) {
                if (sessions.length > 0) highlightedSessionId = sessions[0].id;
                return;
            }
            
            let nextIndex = index;
            if (e.key === 'ArrowDown') nextIndex = (index + 1) % sessions.length;
            else nextIndex = (index - 1 + sessions.length) % sessions.length;
            
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
    <!-- Left: Main Terminal View -->
    <div class="terminal-main">

        <div 
            class="terminal-body-wrapper" 
            class:split-mode={visibleSessionIds.length > 1}
            bind:this={wrapperEl} 
            onclick={() => focusArea.set('terminal')} 
            role="button" 
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
                    onmousedown={() => { activeSessionId = session.id; focusArea.set('terminal'); }}
                ></div>
            {/each}
            {#if sessions.length === 0}
                <div class="empty-terminal">
                   <TerminalIcon size={48} opacity={0.2} color="#fff" />
                   <p>No active terminal sessions</p>
                </div>
            {/if}
        </div>
    </div>

    <!-- Right: Terminal Sidebar (Tabs) -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div 
        class="terminal-sidebar" 
        class:focused={$focusArea === 'terminal-tabs'}
        tabindex="0"
        bind:this={sidebarEl}
        onkeydown={handleSidebarKeyDown}
        onclick={() => focusArea.set('terminal-tabs')}
    >
        <div class="sidebar-header">
            <h3>TERMINALS</h3>
            <div class="shell-selector">
                <button class="add-button" onclick={(e) => { e.stopPropagation(); toggleShellMenu(); }}>
                    <Plus size={14} />
                </button>
                {#if showShellMenu}
                    <div class="shell-menu" style="right: 0;">
                        {#each availableShells as shell}
                            <button class="shell-option" onclick={(e) => { e.stopPropagation(); selectShell(shell); }}>
                                <TerminalIcon size={14} class="option-icon" />
                                <span class="option-name">{shell.name}</span>
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
        <div class="session-list">
            {#each sessions as session}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_interactive_supports_focus -->
                <div 
                    class="session-tab" 
                    role="button"
                    tabindex="0"
                    class:active={activeSessionId === session.id} 
                    class:highlighted={highlightedSessionId === session.id}
                    onclick={(e) => { 
                        e.stopPropagation(); 
                        highlightedSessionId = session.id;
                        switchToSession(session.id); 
                    }}
                >
                    <TerminalIcon size={14} color={activeSessionId === session.id ? '#4a9eff' : (highlightedSessionId === session.id ? '#66b2ff' : '#888')} />
                    <span class="tab-name">{session.name.toLowerCase()}</span>
                    <button class="split-btn" onclick={(e) => { e.stopPropagation(); splitTerminal(session.id); }} title="Split Terminal">
                        <Columns2 size={12} />
                    </button>
                    <button class="kill-btn" onclick={(e) => { e.stopPropagation(); killSession(session.id); }} title="Kill Terminal">
                        <Trash2 size={12} />
                    </button>
                </div>
            {/each}
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

    .terminal-sidebar.focused {
        background: rgba(74, 158, 255, 0.05);
        box-shadow: inset 2px 0 0 #4a9eff;
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
        width: 24px;
        height: 24px;
        background: transparent;
        border: none;
        border-radius: 4px;
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

    .option-icon {
        color: #4a9eff;
    }

    /* SIDEBAR TABS */
    .terminal-sidebar {
        width: 180px;
        display: flex;
        flex-direction: column;
        background: #09090b;
        border-left: 1px solid rgba(255, 255, 255, 0.05);
        overflow-y: auto;
    }

    .sidebar-header {
        padding: 0.5rem 0.8rem;
        height: 38px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    
    .sidebar-header h3 {
        font-size: 0.65rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        color: #666;
        margin: 0;
    }

    .session-list {
        display: flex;
        flex-direction: column;
        padding: 0.3rem;
        gap: 2px;
    }

    .session-tab {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.4rem 0.6rem;
        background: transparent;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.1s;
        text-align: left;
    }

    .session-tab:hover {
        background: rgba(255, 255, 255, 0.05);
    }

    .session-tab.active {
        background: rgba(74, 158, 255, 0.1);
    }

    .session-tab.highlighted {
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 2px 0 0 rgba(74, 158, 255, 0.5);
    }

    .tab-name {
        flex: 1;
        font-size: 0.8rem;
        color: #bbb;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .session-tab.active .tab-name {
        color: #fff;
    }

    .kill-btn,
    .split-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        background: transparent;
        border: none;
        border-radius: 4px;
        color: #666;
        cursor: pointer;
        opacity: 0;
        transition: all 0.15s;
    }

    .session-tab:hover .kill-btn,
    .session-tab:hover .split-btn {
        opacity: 1;
    }

    .kill-btn:hover,
    .split-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
    }

    .kill-btn:hover {
        color: #ff5c5c;
    }
</style>
