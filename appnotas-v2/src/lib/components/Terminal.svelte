<script lang="ts">
    import { onMount, onDestroy, tick } from 'svelte';
    import { get } from 'svelte/store';
    import { settingsStore } from '$lib/stores/settings';
    import { focusArea } from '$lib/stores/focus';
    import { Terminal } from 'xterm';
    import { FitAddon } from '@xterm/addon-fit';
    import { spawn } from 'tauri-pty';
    import { invoke } from '@tauri-apps/api/core';
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

    let terminalEl = $state<HTMLElement>();
    let terminal = $state<Terminal | null>(null);
    let fitAddon = $state<FitAddon | null>(null);
    let pty = $state<any>(null);
    let showShellMenu = $state(false);
    let availableShells = $state<ShellOption[]>([]);
    let currentShell = $state<ShellOption | null>(null);

    // Detect available shells on the system
    async function detectShells() {
        const isWindows = navigator.platform.includes('Win');
        const shells: ShellOption[] = [];

        if (isWindows) {
            // PowerShell (always available on Windows)
            shells.push({
                id: 'powershell',
                name: 'PowerShell',
                command: 'powershell.exe',
                available: true
            });

            // Command Prompt
            shells.push({
                id: 'cmd',
                name: 'Command Prompt',
                command: 'cmd.exe',
                available: true
            });

            // Git Bash - check common installation paths
            try {
                const gitBashPaths = [
                    'C:\\Program Files\\Git\\bin\\bash.exe',
                    'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
                ];
                for (const path of gitBashPaths) {
                    try {
                        const exists = await invoke<boolean>('plugin:fs|exists', { path });
                        if (exists) {
                            shells.push({
                                id: 'gitbash',
                                name: 'Git Bash',
                                command: path,
                                available: true
                            });
                            break;
                        }
                    } catch (e) {
                        // Path check failed, try next
                    }
                }
            } catch (e) {
                console.log('Git Bash check skipped');
            }

            // WSL - check if available
            try {
                shells.push({
                    id: 'wsl',
                    name: 'WSL (Ubuntu)',
                    command: 'wsl.exe',
                    available: true // We'll assume it exists if user wants to try it
                });
            } catch (e) {
                console.log('WSL check skipped');
            }
        } else {
            // Unix-like systems
            shells.push({
                id: 'bash',
                name: 'Bash',
                command: '/bin/bash',
                available: true
            });
            
            shells.push({
                id: 'zsh',
                name: 'Zsh',
                command: '/bin/zsh',
                available: true
            });
        }

        availableShells = shells;
        
        // Select default shell from settings
        const defaultShellId = get(settingsStore).defaultShell;
        const preferredShell = shells.find(s => s.id === defaultShellId);
        currentShell = preferredShell || shells[0]; // Fallback to first available
    }

    async function initTerminal() {
        if (!terminalEl || terminal) return;

        // Create xterm.js terminal
        // Note: Terminal constructor might modify DOM, ensure it runs client-side (onMount or effect)
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

        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(terminalEl);
        fit.fit();
        
        terminal = term;
        fitAddon = fit;

        await spawnShell();

        // Send input to PTY
        term.onData((data) => {
            pty?.write(data);
        });

        // Handle resize
        term.onResize(({ cols, rows }) => {
            pty?.resize(cols, rows);
        });
    }

    async function spawnShell() {
        if (!terminal || !currentShell) return;

        // Kill existing PTY if any
        if (pty) {
            pty.kill();
            pty = null;
        }

        terminal.clear();
        terminal.write(`\x1b[36mStarting ${currentShell.name}...\x1b[0m\r\n`);

        try {
            const spawnOptions = {
                cols: terminal.cols,
                rows: terminal.rows,
                cwd: cwd && cwd.trim().length > 0 ? cwd : undefined,
                // env: process.env // Removed process.env as it is not available in browser
            };
            
            console.log(`Spawning ${currentShell.name} with options:`, spawnOptions);

            const newPty = spawn(currentShell.command, [], spawnOptions);
            pty = newPty; // Assign to state

            // Listen for data from PTY
            newPty.onData((data: any) => {
                terminal?.write(data);
            });

            // Listen for exit
            newPty.onExit(({ exitCode }: { exitCode: number }) => {
                terminal?.write(`\r\n\x1b[33m[${currentShell?.name} exited with code ${exitCode}]\x1b[0m\r\n`);
            });

            console.log(`Spawned ${currentShell.name}`);
        } catch (e) {
            console.error('Failed to spawn shell:', e);
            terminal.write(`\x1b[31mFailed to start ${currentShell.name}: ${e}\x1b[0m\r\n`);
        }
    }

    function selectShell(shell: ShellOption) {
        currentShell = shell;
        showShellMenu = false;
        spawnShell();
    }

    function handleResize() {
        if (fitAddon && visible) {
            fitAddon.fit();
        }
    }

    function toggleShellMenu() {
        showShellMenu = !showShellMenu;
    }

    onMount(async () => {
        await detectShells();
        // Effect will trigger initTerminal logic when terminalEl is bound and visible
        window.addEventListener('resize', handleResize);
        document.addEventListener('click', handleClickOutside);
    });

    onDestroy(() => {
        window.removeEventListener('resize', handleResize);
        document.removeEventListener('click', handleClickOutside);
        pty?.kill();
        terminal?.dispose();
    });

    function handleClickOutside(e: MouseEvent) {
        const target = e.target as HTMLElement;
        if (!target.closest('.shell-selector')) {
            showShellMenu = false;
        }
    }

    $effect(() => {
        if (visible && !terminal && terminalEl) {
            initTerminal();
        }
    });

    $effect(() => {
        if (visible && fitAddon && terminal) {
            // Delay fit to ensure terminal is fully initialized
            const timer = setTimeout(() => {
                try {
                    fitAddon?.fit();
                } catch (e) {
                    // Ignore fit errors during initialization
                    console.debug('[Terminal] Fit skipped:', e);
                }
            }, 150);
            return () => clearTimeout(timer); // Cleanup timeout
        }
    });

    // Auto-focus terminal when focusArea switches to 'terminal'
    $effect(() => {
        if ($focusArea === 'terminal' && terminal && visible) {
            tick().then(() => {
                terminal?.focus();
            });
        }
    });
</script>

<div class={['terminal-container', !visible && 'hidden'].filter(Boolean).join(' ')}>
    <div class="terminal-header">
        <div class="shell-selector">
            <button class="shell-button" onclick={(e) => { e.stopPropagation(); toggleShellMenu(); }}>
                <span class="shell-icon">&gt;_</span>
                <span class="shell-name">{currentShell?.name || 'Select Shell'}</span>
                <span class="dropdown-arrow">▼</span>
            </button>
            {#if showShellMenu}
                <div class="shell-menu">
                    {#each availableShells as shell}
                        <button 
                            class="shell-option"
                            class:active={currentShell?.id === shell.id}
                            onclick={(e) => { e.stopPropagation(); selectShell(shell); }}
                        >
                            <span class="option-icon">&gt;_</span>
                            <span class="option-name">{shell.name}</span>
                            {#if currentShell?.id === shell.id}
                                <span class="check">✓</span>
                            {/if}
                        </button>
                    {/each}
                </div>
            {/if}
        </div>
        <span class="terminal-cwd" title={cwd}>{cwd ? `📁 ${cwd.split(/[\\/]/).pop()}` : ''}</span>
    </div>
    <div 
        class="terminal-body" 
        class:focused={$focusArea === 'terminal'}
        bind:this={terminalEl}
        onclick={() => focusArea.set('terminal')}
        onkeydown={(e) => e.key === 'Enter' && focusArea.set('terminal')}
        role="button"
        tabindex="0"
        aria-label="Terminal Output"
    ></div>
</div>

<style>
    .terminal-container {
        display: flex;
        flex-direction: column;
        height: 200px;
        min-height: 100px;
        border-top: 1px solid #2a2a2a;
        background: #0d1117;
        position: relative; /* Added for z-index context */
    }

    .terminal-container.hidden {
        display: none;
    }


    .terminal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.4rem 1rem;
        background: #161b22;
        border-bottom: 1px solid #2a2a2a;
    }

    .shell-selector {
        position: relative;
    }

    .shell-button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.3rem 0.6rem;
        background: #21262d;
        border: 1px solid #30363d;
        border-radius: 4px;
        color: #ccc;
        font-size: 0.8rem;
        cursor: pointer;
        transition: all 0.15s;
    }

    .shell-button:hover {
        background: #2d333b;
        border-color: #4a9eff;
    }

    .shell-icon {
        color: #4a9eff;
        font-family: 'Fira Code', monospace;
        font-weight: 700;
    }

    .shell-name {
        font-weight: 500;
    }

    .dropdown-arrow {
        font-size: 0.6rem;
        color: #666;
        margin-left: 0.25rem;
    }

    .shell-menu {
        position: absolute;
        top: 100%;
        left: 0;
        margin-top: 4px;
        min-width: 180px;
        background: #21262d;
        border: 1px solid #30363d;
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
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
        text-align: left;
        cursor: pointer;
        transition: all 0.1s;
    }

    .shell-option:hover {
        background: #2d333b;
    }

    .shell-option.active {
        background: rgba(74, 158, 255, 0.1);
        color: #4a9eff;
    }

    .option-icon {
        color: #4a9eff;
        font-family: 'Fira Code', monospace;
        font-size: 0.8rem;
    }

    .option-name {
        flex: 1;
    }

    .check {
        color: #7ee787;
        font-size: 0.8rem;
    }

    .terminal-cwd {
        font-size: 0.75rem;
        color: #666;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .terminal-body {
        flex: 1;
        padding: 0.5rem;
        overflow: hidden;
    }

    .terminal-body {
        flex: 1;
        padding: 0.5rem;
        overflow: hidden;
    }

    .terminal-body.focused {
        outline: 2px solid #4a9eff;
        outline-offset: -2px;
    }

    .terminal-body :global(.xterm) {
        height: 100%;
    }

    .terminal-body :global(.xterm-viewport) {
        overflow-y: auto !important;
    }
</style>
