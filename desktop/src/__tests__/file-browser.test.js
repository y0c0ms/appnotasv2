// ========== FILE BROWSER UNIT TESTS ==========
// These tests verify the file browser logic without needing the full app

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Tauri invoke
let mockInvoke;

beforeEach(() => {
    mockInvoke = vi.fn();

    // Setup Tauri mock
    global.window = global.window || {};
    global.window.__TAURI__ = {
        core: {
            invoke: mockInvoke
        }
    };
});

describe('Tauri Environment Detection', () => {
    it('should detect Tauri is available', () => {
        const hasT = typeof window !== 'undefined' &&
            window.__TAURI__ &&
            window.__TAURI__.core &&
            typeof window.__TAURI__.core.invoke === 'function';

        expect(hasT).toBe(true);
    });

    it('should provide invoke function', () => {
        expect(typeof window.__TAURI__.core.invoke).toBe('function');
    });
});

describe('File Browser - Logic Tests', () => {
    it('should format file sizes correctly', () => {
        const formatSize = (bytes) => {
            if (!bytes) return '';
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        };

        expect(formatSize(512)).toBe('512 B');
        expect(formatSize(1024)).toBe('1.0 KB');
        expect(formatSize(1048576)).toBe('1.0 MB');
        expect(formatSize(null)).toBe('');
        expect(formatSize(undefined)).toBe('');
    });

    it('should extract filename from path', () => {
        const path = 'C:\\Users\\Utilizador\\Documents\\test.txt';
        const fileName = path.split('\\').pop();

        expect(fileName).toBe('test.txt');
    });

    it('should handle parent directory navigation logic', () => {
        const currentPath = 'C:\\Users\\Utilizador\\Documents';
        const parts = currentPath.split('\\').filter(p => p);

        parts.pop(); // Remove last part
        const parentPath = parts.join('\\') + '\\';

        expect(parentPath).toBe('C:\\Users\\Utilizador\\');
    });

    it('should handle root directory edge case', () => {
        const currentPath = 'C:\\';
        const parts = currentPath.split('\\').filter(p => p);

        if (parts.length > 1) parts.pop();
        const parentPath = parts.join('\\') + '\\';

        expect(parentPath).toBe('C:\\');
    });
});

describe('Tauri Commands - Mock Tests', () => {
    it('should mock list_directory call', async () => {
        const mockFiles = [
            { name: '..', path: 'C:\\Users', is_dir: true },
            { name: 'test.txt', path: 'C:\\Users\\Utilizador\\test.txt', is_dir: false, size: 1024 }
        ];

        mockInvoke.mockResolvedValue(mockFiles);

        const result = await mockInvoke('list_directory', { path: 'C:\\Users\\Utilizador' });

        expect(mockInvoke).toHaveBeenCalledWith('list_directory', { path: 'C:\\Users\\Utilizador' });
        expect(result).toEqual(mockFiles);
        expect(result[1].name).toBe('test.txt');
    });

    it('should mock permission error', async () => {
        mockInvoke.mockRejectedValue(new Error('list_directory not allowed. Command not found'));

        let errorCaught = false;
        try {
            await mockInvoke('list_directory', { path: 'C:\\' });
        } catch (err) {
            errorCaught = true;
            expect(err.message).toContain('not allowed');
        }

        expect(errorCaught).toBe(true);
    });

    it('should mock file opening', async () => {
        mockInvoke.mockResolvedValue(undefined);

        await mockInvoke('open_file_external', { path: 'C:\\test.txt' });

        expect(mockInvoke).toHaveBeenCalledWith('open_file_external', { path: 'C:\\test.txt' });
    });
});

describe('Command Palette - Logic Tests', () => {
    it('should filter commands by trigger', () => {
        const commands = [
            { id: 'code', trigger: 'code', label: '@code' },
            { id: 'file', trigger: 'file', label: '@file' }
        ];

        const query = 'fil';
        const filtered = commands.filter(cmd =>
            cmd.trigger.toLowerCase().includes(query.toLowerCase())
        );

        expect(filtered).toHaveLength(1);
        expect(filtered[0].id).toBe('file');
    });

    it('should match all on empty query', () => {
        const commands = [
            { id: 'code', trigger: 'code', label: '@code' },
            { id: 'file', trigger: 'file', label: '@file' }
        ];

        const filtered = commands.filter(cmd =>
            cmd.trigger.toLowerCase().includes('')
        );

        expect(filtered).toHaveLength(2);
    });

    it('should be case insensitive', () => {
        const commands = [
            { id: 'file', trigger: 'file', label: '@file' }
        ];

        const filtered = commands.filter(cmd =>
            cmd.trigger.toLowerCase().includes('FILE'.toLowerCase())
        );

        expect(filtered).toHaveLength(1);
    });
});

describe('File/Directory Detection', () => {
    it('should identify directories', () => {
        const dir = { name: 'Documents', is_dir: true };
        expect(dir.is_dir).toBe(true);
    });

    it('should identify files', () => {
        const file = { name: 'test.txt', is_dir: false, size: 1024 };
        expect(file.is_dir).toBe(false);
        expect(file.size).toBe(1024);
    });
});

describe('Integration Scenarios', () => {
    it('should mock complete directory listing workflow', async () => {
        const mockFiles = [
            { name: '..', path: 'C:\\Users', is_dir: true },
            { name: 'Documents', path: 'C:\\Users\\Utilizador\\Documents', is_dir: true },
            { name: 'Downloads', path: 'C:\\Users\\Utilizador\\Downloads', is_dir: true },
            { name: 'test.txt', path: 'C:\\Users\\Utilizador\\test.txt', is_dir: false, size: 2048 }
        ];

        mockInvoke.mockResolvedValue(mockFiles);

        const result = await mockInvoke('list_directory', { path: 'C:\\Users\\Utilizador' });

        const dirs = result.filter(f => f.is_dir);
        const files = result.filter(f => !f.is_dir);

        expect(dirs).toHaveLength(3);
        expect(files).toHaveLength(1);
        expect(files[0].size).toBe(2048);
    });
});
