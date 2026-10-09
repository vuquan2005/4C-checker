import { describe, it, expect } from 'vitest';
import { parseForumDateToIso } from './time-utils.js';

describe('Time Utilities (parseForumDateToIso)', () => {
    describe('Absolute Date Parsing', () => {
        it('parses DD-MM-YYYY, HH:mm format (24-hour)', () => {
            expect(parseForumDateToIso('29-09-2026, 18:00')).toBe('2026-09-29T18:00:00+07:00');
            expect(parseForumDateToIso('30-09-2026, 10:55')).toBe('2026-09-30T10:55:00+07:00');
            expect(parseForumDateToIso('08-10-2026, 00:02')).toBe('2026-10-08T00:02:00+07:00');
        });

        it('parses 12-hour format with AM/PM', () => {
            expect(parseForumDateToIso('09-29-2026, 10:06 PM')).toBe('2026-09-29T22:06:00+07:00');
            expect(parseForumDateToIso('01-10-2026, 08:30 AM')).toBe('2026-10-01T08:30:00+07:00');
            expect(parseForumDateToIso('01-10-2026, 12:00 AM')).toBe('2026-10-01T00:00:00+07:00');
            expect(parseForumDateToIso('01-10-2026, 12:30 PM')).toBe('2026-10-01T12:30:00+07:00');
        });

        it('parses date-only strings defaulting time to 00:00:00', () => {
            expect(parseForumDateToIso('01-10-2026')).toBe('2026-10-01T00:00:00+07:00');
            expect(parseForumDateToIso('2026-10-01')).toBe('2026-10-01T00:00:00+07:00');
        });

        it('supports ISO YYYY-MM-DD, HH:mm format', () => {
            expect(parseForumDateToIso('2026-10-08, 14:30')).toBe('2026-10-08T14:30:00+07:00');
        });

        it('returns existing valid ISO 8601 string unchanged', () => {
            expect(parseForumDateToIso('2026-10-08T00:02:00+07:00')).toBe(
                '2026-10-08T00:02:00+07:00'
            );
            expect(parseForumDateToIso('2026-10-07T17:02:00.000Z')).toBe(
                '2026-10-07T17:02:00.000Z'
            );
        });
    });

    describe('Relative Date Parsing', () => {
        // Reference: 2026-10-09T11:00:00+07:00 (Friday)
        const mockRefDate = new Date('2026-10-09T04:00:00Z');

        it('parses "Yesterday, HH:mm" in English', () => {
            const iso = parseForumDateToIso('Yesterday, 00:02', {
                referenceDate: mockRefDate,
            });
            expect(iso).toBe('2026-10-08T00:02:00+07:00');
        });

        it('parses "Today, HH:mm" in English', () => {
            const iso = parseForumDateToIso('Today, 11:30', {
                referenceDate: mockRefDate,
            });
            expect(iso).toBe('2026-10-09T11:30:00+07:00');
        });

        it('parses "Hôm qua, HH:mm" in Vietnamese', () => {
            const iso = parseForumDateToIso('Hôm qua, 22:15', {
                referenceDate: mockRefDate,
            });
            expect(iso).toBe('2026-10-08T22:15:00+07:00');
        });

        it('parses "Hôm nay, HH:mm" in Vietnamese', () => {
            const iso = parseForumDateToIso('Hôm nay, 08:45', {
                referenceDate: mockRefDate,
            });
            expect(iso).toBe('2026-10-09T08:45:00+07:00');
        });
    });

    describe('Edge Cases & Error Handling', () => {
        it('returns null for empty or non-date strings', () => {
            expect(parseForumDateToIso('')).toBeNull();
            expect(parseForumDateToIso('   ')).toBeNull();
            expect(parseForumDateToIso('not-a-date')).toBeNull();
        });
    });
});
