import { writable } from 'svelte/store';

export interface LogEntry {
	timestamp: Date;
	type: 'log' | 'info' | 'warn' | 'error';
	message: string;
}

const MAX_LOGS = 150;

function createConsoleStore() {
	const { subscribe, update, set } = writable<LogEntry[]>([]);

	let initialized = false;

	return {
		subscribe,
		clear: () => set([]),
		init: () => {
			if (initialized) return;
			initialized = true;

			const originalLog = console.log;
			const originalInfo = console.info;
			const originalWarn = console.warn;
			const originalError = console.error;

			let isIntercepting = false;
			const addLog = (type: LogEntry['type'], ...args: any[]) => {
				if (isIntercepting) return;
				isIntercepting = true;
				
				try {
					const message = args.map(arg => {
						if (arg instanceof Error) {
							return `${arg.name}: ${arg.message}\n${arg.stack || ''}`;
						} else if (typeof arg === 'object' && arg !== null) {
							try {
								return JSON.stringify(arg);
							} catch (e) {
								return `[Object: ${arg?.constructor?.name || 'Unknown'}]`;
							}
						}
						return String(arg);
					}).join(' ');

					// Filter out noisy framework logs and Svelte compiler/warnings to prevent async layout loops
					if (message.includes('[vite]') || message.includes('<svelte') || message.includes('a11y-')) {
						return;
					}

					update(logs => {
						const lastLog = logs[logs.length - 1];
						// Anti-spam: ignore identical messages within 2 seconds
						if (lastLog && lastLog.message === message && lastLog.type === type) {
							const timeDiff = new Date().getTime() - lastLog.timestamp.getTime();
							if (timeDiff < 2000) return logs; 
						}

						const newLogs = [...logs, { timestamp: new Date(), type, message }];
						if (newLogs.length > MAX_LOGS) {
							return newLogs.slice(newLogs.length - MAX_LOGS);
						}
						return newLogs;
					});
				} finally {
					isIntercepting = false;
				}
			};

			console.log = (...args) => {
				addLog('log', ...args);
				originalLog.apply(console, args);
			};

			console.info = (...args) => {
				addLog('info', ...args);
				originalInfo.apply(console, args);
			};

			console.warn = (...args) => {
				addLog('warn', ...args);
				originalWarn.apply(console, args);
			};

			console.error = (...args) => {
				addLog('error', ...args);
				originalError.apply(console, args);
			};
		}
	};
}

export const consoleStore = createConsoleStore();
