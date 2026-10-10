import { describe, expect, it } from 'vitest';
import type { PlagiarizedFileRef } from '../types/index.js';
import { buildPlagiarismClusters } from './cluster-builder.js';

describe('Plagiarism Cluster Builder', () => {
    const mockRse1 = [
        'B11111111111111111111111111',
        'B22222222222222222222222222',
        'B33333333333333333333333333',
        'B44444444444444444444444444',
        'B55555555555555555555555555',
        'B66666666666666666666666666',
        'B77777777777777777777777777',
        'B88888888888888888888888888',
    ];

    const mockRse2 = [
        'C11111111111111111111111111',
        'C22222222222222222222222222',
        'C33333333333333333333333333',
        'C44444444444444444444444444',
        'C55555555555555555555555555',
        'C66666666666666666666666666',
        'C77777777777777777777777777',
        'C88888888888888888888888888',
    ];

    it('does not create clusters for multiple files belonging to the same student', () => {
        const files: PlagiarizedFileRef[] = [
            {
                postId: '1',
                postNumber: 1,
                author: { uid: '100', username: 'Student A' },
                sessionIndex: 1,
                postDate: '2026-10-01T10:00:00Z',
                fileName: 'part1.ipt',
                filePath: '/part1.ipt',
                fileSizeBytes: 1000,
                rseSegmentIds: mockRse1,
            },
            {
                postId: '2',
                postNumber: 2,
                author: { uid: '100', username: 'Student A' }, // same author
                sessionIndex: 1,
                postDate: '2026-10-01T11:00:00Z',
                fileName: 'part2.ipt',
                filePath: '/part2.ipt',
                fileSizeBytes: 1000,
                rseSegmentIds: mockRse1,
            },
        ];

        const clusters = buildPlagiarismClusters(files);
        expect(clusters).toHaveLength(0);
    });

    it('builds clusters and identifies suspected original and copies chronologically by postDate', () => {
        const files: PlagiarizedFileRef[] = [
            {
                postId: '2',
                postNumber: 2,
                author: { uid: '200', username: 'Student B' },
                sessionIndex: 1,
                postDate: '2026-10-01T14:00:00Z', // later
                fileName: 'bai1_copy.ipt',
                filePath: '/bai1_copy.ipt',
                fileSizeBytes: 1000,
                rseSegmentIds: mockRse1,
            },
            {
                postId: '1',
                postNumber: 1,
                author: { uid: '100', username: 'Student A' },
                sessionIndex: 1,
                postDate: '2026-10-01T08:00:00Z', // earlier
                fileName: 'bai1_original.ipt',
                filePath: '/bai1_original.ipt',
                fileSizeBytes: 1000,
                rseSegmentIds: mockRse1,
            },
        ];

        const clusters = buildPlagiarismClusters(files);
        expect(clusters).toHaveLength(1);
        const cluster = clusters[0];
        expect(cluster.clusterId).toBe('cluster_1');
        expect(cluster.severity).toBe('high');
        expect(cluster.sessionIndex).toBe(1);
        expect(cluster.matchTypes).toContain('identical_rse_segments');
        expect(cluster.suspectedOriginal?.author.uid).toBe('100');
        expect(cluster.suspectedCopies).toHaveLength(1);
        expect(cluster.suspectedCopies[0].author.uid).toBe('200');
    });

    it('breaks ties using lastSavedDate when postDate is identical', () => {
        const files: PlagiarizedFileRef[] = [
            {
                postId: '1',
                postNumber: 1,
                author: { uid: '100', username: 'Student A' },
                sessionIndex: 1,
                postDate: '2026-10-01T12:00:00Z',
                lastSavedDate: '2026-10-01T11:45:00Z', // saved later
                fileName: 'f1.ipt',
                filePath: '/f1.ipt',
                fileSizeBytes: 1000,
                rseSegmentIds: mockRse1,
            },
            {
                postId: '2',
                postNumber: 2,
                author: { uid: '200', username: 'Student B' },
                sessionIndex: 1,
                postDate: '2026-10-01T12:00:00Z', // identical postDate
                lastSavedDate: '2026-10-01T09:00:00Z', // saved earlier!
                fileName: 'f2.ipt',
                filePath: '/f2.ipt',
                fileSizeBytes: 1000,
                rseSegmentIds: mockRse1,
            },
        ];

        const clusters = buildPlagiarismClusters(files);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].suspectedOriginal?.author.uid).toBe('200');
        expect(clusters[0].suspectedCopies[0].author.uid).toBe('100');
    });

    it('ignores files that match whitelisted template RSe signatures', () => {
        const files: PlagiarizedFileRef[] = [
            {
                postId: '1',
                postNumber: 1,
                author: { uid: '100', username: 'Student A' },
                sessionIndex: 1,
                postDate: '2026-10-01T10:00:00Z',
                fileName: 'template.ipt',
                filePath: '/template.ipt',
                fileSizeBytes: 1000,
                rseSegmentIds: mockRse1,
            },
            {
                postId: '2',
                postNumber: 2,
                author: { uid: '200', username: 'Student B' },
                sessionIndex: 1,
                postDate: '2026-10-01T12:00:00Z',
                fileName: 'template2.ipt',
                filePath: '/template2.ipt',
                fileSizeBytes: 1000,
                rseSegmentIds: mockRse1,
            },
        ];

        // mockRse1 is whitelisted
        const clusters = buildPlagiarismClusters(files, [mockRse1]);
        expect(clusters).toHaveLength(0);
    });

    it('identifies cross-session plagiarism clusters', () => {
        const files: PlagiarizedFileRef[] = [
            {
                postId: '1',
                postNumber: 1,
                author: { uid: '100', username: 'Student A' },
                sessionIndex: 1,
                postDate: '2026-10-01T10:00:00Z',
                fileName: 'f1.ipt',
                filePath: '/f1.ipt',
                fileSizeBytes: 1000,
                rseSegmentIds: mockRse1,
            },
            {
                postId: '2',
                postNumber: 2,
                author: { uid: '200', username: 'Student B' },
                sessionIndex: 2, // Different session!
                postDate: '2026-10-02T10:00:00Z',
                fileName: 'f2.ipt',
                filePath: '/f2.ipt',
                fileSizeBytes: 1000,
                rseSegmentIds: mockRse1,
            },
        ];

        const clusters = buildPlagiarismClusters(files);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].sessionIndex).toBeUndefined(); // cross-session cluster
    });

    it('detects geometry clusters when RSe is absent but geometry is identical', () => {
        const files: PlagiarizedFileRef[] = [
            {
                postId: '1',
                postNumber: 1,
                author: { uid: '100', username: 'Student A' },
                sessionIndex: 3,
                postDate: '2026-10-01T10:00:00Z',
                fileName: 'geom_a.ipt',
                filePath: '/geom_a.ipt',
                fileSizeBytes: 5000,
                rseSegmentIds: mockRse1, // different RSe
                geometryFingerprint: {
                    totalStreams: 8,
                    brepStreamSizes: [500, 300],
                    contentHash: 'brep_hash_999',
                },
            },
            {
                postId: '2',
                postNumber: 2,
                author: { uid: '200', username: 'Student B' },
                sessionIndex: 3,
                postDate: '2026-10-01T12:00:00Z',
                fileName: 'geom_b.ipt',
                filePath: '/geom_b.ipt',
                fileSizeBytes: 5000,
                rseSegmentIds: mockRse2, // different RSe!
                geometryFingerprint: {
                    totalStreams: 8,
                    brepStreamSizes: [500, 300],
                    contentHash: 'brep_hash_999',
                },
            },
        ];

        const clusters = buildPlagiarismClusters(files);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].matchTypes).toContain('identical_geometry');
        expect(clusters[0].severity).toBe('high');
        expect(clusters[0].suspectedOriginal?.author.uid).toBe('100');
        expect(clusters[0].suspectedCopies[0].author.uid).toBe('200');
    });

    it('does not duplicate files into geometry clusters if already clustered by RSe', () => {
        const files: PlagiarizedFileRef[] = [
            {
                postId: '1',
                postNumber: 1,
                author: { uid: '100', username: 'Student A' },
                sessionIndex: 1,
                postDate: '2026-10-01T10:00:00Z',
                fileName: 'part1.ipt',
                filePath: '/part1.ipt',
                fileSizeBytes: 1000,
                rseSegmentIds: mockRse1,
                geometryFingerprint: {
                    totalStreams: 8,
                    brepStreamSizes: [100, 200],
                    contentHash: 'hash123',
                },
            },
            {
                postId: '2',
                postNumber: 2,
                author: { uid: '200', username: 'Student B' },
                sessionIndex: 1,
                postDate: '2026-10-01T12:00:00Z',
                fileName: 'part2.ipt',
                filePath: '/part2.ipt',
                fileSizeBytes: 1000,
                rseSegmentIds: mockRse1, // Identical RSe
                geometryFingerprint: {
                    totalStreams: 8,
                    brepStreamSizes: [100, 200],
                    contentHash: 'hash123', // Also identical geometry
                },
            },
        ];

        const clusters = buildPlagiarismClusters(files);
        // Should only be 1 cluster (the RSe cluster, which also accumulates the geometry match)
        expect(clusters).toHaveLength(1);
        expect(clusters[0].matchTypes).toContain('identical_rse_segments');
        expect(clusters[0].matchTypes).toContain('identical_geometry');
    });
});
