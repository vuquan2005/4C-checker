import { describe, expect, it } from 'vitest';
import type { PlagiarizedFileRef } from '../types/index.js';
import {
    compareCadFiles,
    detectBorrowedFootprint,
    isWhitelistedTemplate,
    normalizeGeometrySignature,
    normalizeRseSignature,
} from './similarity-matcher.js';

describe('Similarity Matcher', () => {
    const mockRse1 = [
        'Bv5nuzad35ivxlv5densgrhyljh',
        'Bssa53xbqxc22hoi2n422g23lfe',
        'Bq54hcyc4ynjg5s34fn3wuamkfi',
        'Brkal6rh21vqpjj2rnspjpb16jo',
        'Bgxofp5captddro4quj5mjh2dnk',
        'Bj4rjgggheq5hdqmvviqrzew3bd',
        'Btuxc6ddqkx3oskhr4rcn4mkfnh',
        'Bljcniwcbxpi4saraffmic15lni',
    ];

    const mockRse2 = [
        'Bgpya2ecpeqt4igmcekykz5brnf',
        'Bso22wif6r1zv1fu64rt1woxpfn',
        'Brramtddipz2ynxkb45hnh6ohbn',
        'Bhnprszegqibcxhbafp4tcbz5jk',
        'Bzyacpicbkuujzwqi3op4glvxfj',
        'Buro3hhgwt6jc56rwu1e4xpstjk',
        'Bvejdgcavw4bo4frkfm1jnhu6jp',
        'Bwlpll1fjw3bcgcas3m5ortljfb',
    ];

    const studentAFile: PlagiarizedFileRef = {
        postId: '101',
        postNumber: 1,
        author: { uid: '201', username: 'Ha Phuc Khanh' },
        sessionIndex: 1,
        postDate: '2026-10-01T10:00:00Z',
        fileName: 'part1.ipt',
        filePath: '/data/part1.ipt',
        fileSizeBytes: 280000,
        creationDate: '10/01/2026 09:00:00',
        lastSavedDate: '10/01/2026 09:30:00',
        lastSavedByWindowsUser: 'HPK-PC',
        rseSegmentIds: mockRse1,
        geometryFingerprint: {
            totalStreams: 8,
            brepStreamSizes: [1000, 200],
            contentHash: 'hash123',
        },
    };

    const studentBFile: PlagiarizedFileRef = {
        postId: '102',
        postNumber: 2,
        author: { uid: '202', username: 'Nguyen Van Phuc' },
        sessionIndex: 1,
        postDate: '2026-10-01T14:00:00Z',
        fileName: 'bai1.ipt',
        filePath: '/data/bai1.ipt',
        fileSizeBytes: 280000,
        creationDate: '10/01/2026 09:00:00',
        lastSavedDate: '10/01/2026 13:00:00',
        lastSavedByWindowsUser: 'HPK-PC',
        originalFilePath: 'C:\\Users\\Ha Phuc Khanh\\Desktop\\part1.ipt',
        rseSegmentIds: [...mockRse1].reverse(), // reversed order
        geometryFingerprint: {
            totalStreams: 8,
            brepStreamSizes: [1000, 200],
            contentHash: 'hash123',
        },
    };

    it('normalizes RSe segment IDs regardless of order and case', () => {
        const sigA = normalizeRseSignature(mockRse1);
        const sigB = normalizeRseSignature([...mockRse1].reverse());
        expect(sigA).toBe(sigB);
    });

    it('identifies whitelisted templates', () => {
        expect(isWhitelistedTemplate(mockRse1, [mockRse1])).toBe(true);
        expect(isWhitelistedTemplate(mockRse1, [mockRse2])).toBe(false);
        expect(isWhitelistedTemplate(undefined, [mockRse1])).toBe(false);
    });

    it('normalizes geometry signature', () => {
        const geomSig = normalizeGeometrySignature({
            totalStreams: 8,
            brepStreamSizes: [100, 200],
            contentHash: 'abc',
        });
        expect(geomSig).toBe('geom:abc:100,200');
    });

    it('detects borrowed Windows footprint from other students', () => {
        const detected = detectBorrowedFootprint(studentBFile, 'Ha Phuc Khanh');
        expect(detected.borrowedPath).toBe(true);
    });

    it('compares two CAD files and extracts matching evidence', () => {
        const comparison = compareCadFiles(studentAFile, studentBFile);
        expect(comparison.matched).toBe(true);
        expect(comparison.matchTypes).toContain('identical_rse_segments');
        expect(comparison.matchTypes).toContain('identical_geometry');
        expect(comparison.matchTypes).toContain('identical_creation_date');
        expect(comparison.matchTypes).toContain('borrowed_original_path');
    });

    it('ignores RSe matching if it matches a template whitelist', () => {
        const comparison = compareCadFiles(studentAFile, studentBFile, [mockRse1]);
        expect(comparison.matchTypes).not.toContain('identical_rse_segments');
    });
});
