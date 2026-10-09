import { describe, it, expect } from 'vitest';
import {
    normalizeUserFolderName,
    buildPostFolderName,
    getPostIndexFromFolderName,
} from './folder-namer.js';

describe('Folder Naming Utilities', () => {
    describe('normalizeUserFolderName', () => {
        it('removes class suffix after first underscore and converts spaces to underscore', () => {
            const folder = normalizeUserFolderName('Dummy Student_K16', '1001');
            expect(folder).toBe('Dummy_Student_1001');
        });

        it('normalizes Vietnamese diacritics to ASCII without spaces', () => {
            const folder = normalizeUserFolderName('Nguyen Van A_CDT2', '1002');
            expect(folder).toBe('Nguyen_Van_A_1002');
        });

        it('handles username without underscore correctly', () => {
            const folder = normalizeUserFolderName('AliceSmith', '1003');
            expect(folder).toBe('AliceSmith_1003');
        });

        it('handles empty username and missing uid with safe fallbacks', () => {
            expect(normalizeUserFolderName('', '')).toBe('user_unknown');
            expect(normalizeUserFolderName('_K16', '1004')).toBe('user_1004');
        });
    });

    describe('buildPostFolderName', () => {
        it('uses the stable post ID instead of a shifting chronological index', () => {
            expect(buildPostFolderName(1, '20001')).toBe('post_20001');
            expect(buildPostFolderName(2, '20050')).toBe('post_20050');
            expect(buildPostFolderName(12, '20100')).toBe('post_20100');
        });

        it('handles invalid index and empty postId gracefully', () => {
            expect(buildPostFolderName(0, '')).toBe('post_unknown');
        });
    });

    describe('getPostIndexFromFolderName', () => {
        it('extracts the initial session index from a post folder', () => {
            expect(getPostIndexFromFolderName('02_post_26183')).toBe(2);
            expect(getPostIndexFromFolderName('12_post_26268')).toBe(12);
        });

        it('falls back to session 1 for an invalid folder name', () => {
            expect(getPostIndexFromFolderName('unknown')).toBe(1);
        });
    });
});
