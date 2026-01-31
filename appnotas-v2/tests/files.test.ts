import { describe, it, expect } from 'vitest';
import { detectLanguage, formatFileSize, getFilename } from '../src/lib/utils/files';

describe('File Utils', () => {
    it('should detect language from filename', () => {
        expect(detectLanguage('test.js')).toBe('javascript');
        expect(detectLanguage('test.ts')).toBe('typescript');
        expect(detectLanguage('test.md')).toBe('markdown');
        expect(detectLanguage('test.py')).toBe('python');
        expect(detectLanguage('test.rs')).toBe('rust');
        expect(detectLanguage('unknown.xyz')).toBe('text');
    });

    it('should format file sizes correctly', () => {
        expect(formatFileSize(null)).toBe('');
        expect(formatFileSize(500)).toBe('500 B');
        expect(formatFileSize(1024)).toBe('1.0 KB');
        expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
        expect(formatFileSize(1536)).toBe('1.5 KB');
    });

    it('should extract filename from path', () => {
        expect(getFilename('C:\\Users\\Test\\file.txt')).toBe('file.txt');
        expect(getFilename('/home/user/file.txt')).toBe('file.txt');
        expect(getFilename('file.txt')).toBe('file.txt');
    });
});
