import { describe, it, expect } from 'vitest';
import { parseThreadIdInput } from './network.js';

describe('parseThreadIdInput', () => {
    it('returns thread ID when given a numeric string', () => {
        expect(parseThreadIdInput('1336')).toBe('1336');
        expect(parseThreadIdInput('  1336  ')).toBe('1336');
    });

    it('extracts thread ID from full MyBB thread URLs', () => {
        expect(parseThreadIdInput('https://kisu4chaui.com/showthread.php?tid=1336')).toBe('1336');
        expect(parseThreadIdInput('https://kisu4chaui.com/showthread.php?tid=1336&page=2')).toBe(
            '1336'
        );
        expect(
            parseThreadIdInput('https://kisu4chaui.com/showthread.php?action=lastpost&tid=999')
        ).toBe('999');
    });

    it('returns original input when no tid pattern matches', () => {
        expect(parseThreadIdInput('custom-id')).toBe('custom-id');
    });
});
