// Test setup file
import { vi } from 'vitest';

// Mock Tauri APIs
global.window.__TAURI__ = {
    core: {
        invoke: vi.fn()
    }
};

// Mock DOM APIs
global.window.getSelection = vi.fn(() => ({
    getRangeAt: vi.fn(() => ({
        cloneRange: vi.fn(),
        insertNode: vi.fn(),
        collapse: vi.fn(),
        selectNodeContents: vi.fn(),
        setEnd: vi.fn(),
        toString: vi.fn(() => '@file')
    })),
    removeAllRanges: vi.fn(),
    addRange: vi.fn()
}));
