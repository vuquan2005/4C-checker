import { describe, it, expect } from 'vitest';
import {
    removeDiacritics,
    normalizeName,
    extractStudentId,
    stripBBCode,
    stringSimilarity,
} from './text-utils.js';

describe('text-utils', () => {
    it('removeDiacritics removes Vietnamese accents correctly', () => {
        expect(removeDiacritics('Hà Phúc Khánh')).toBe('Ha Phuc Khanh');
        expect(removeDiacritics('Đặng Bá Đạo')).toBe('Dang Ba Dao');
        expect(removeDiacritics('Cơ điện tử 2')).toBe('Co dien tu 2');
    });

    it('normalizeName cleans and normalizes student name', () => {
        expect(normalizeName('  Hà  Phúc  Khánh  ')).toBe('ha phuc khanh');
        expect(normalizeName('NGUYỄN VĂN A')).toBe('nguyen van a');
    });

    it('extractStudentId extracts 10-digit student ID', () => {
        expect(extractStudentId('MSSV: 2021601234')).toBe('2021601234');
        expect(extractStudentId('Sinh viên Hà Phúc Khánh, mã 2021605555 lớp K16')).toBe(
            '2021605555'
        );
        expect(extractStudentId('Không có mã nào ở đây')).toBeNull();
    });

    it('stripBBCode cleans BBCode markup', () => {
        const input = '[b]Họ và tên:[/b] Hà Phúc Khánh\n[img]https://example.com/pic.png[/img]';
        const cleaned = stripBBCode(input);
        expect(cleaned).toContain('Họ và tên: Hà Phúc Khánh');
        expect(cleaned).not.toContain('[b]');
    });

    it('stringSimilarity computes similarity score accurately', () => {
        expect(stringSimilarity('Hà Phúc Khánh', 'Ha Phuc Khanh')).toBe(1.0);
        expect(stringSimilarity('Hà Phúc Khánh', 'Hà Phúc')).toBeGreaterThan(0.5);
        expect(stringSimilarity('Nguyen Van A', 'Tran Van B')).toBeLessThan(0.7);
    });
});
