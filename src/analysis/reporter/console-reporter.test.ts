import { describe, expect, it, vi } from 'vitest';
import type { ThreadAnalysisReport } from '../types/index.js';
import {
    extractWarnedPosts,
    printAnalysisConsoleReport,
    printOverviewStats,
    printPlagiarismClusters,
    printSessionSummaries,
    printWarnedPosts,
} from './console-reporter.js';

describe('Console Reporter', () => {
    const mockReport: ThreadAnalysisReport = {
        threadId: '1336',
        title: 'CAD 2026',
        analyzedAt: '2026-10-10T08:00:00Z',
        stats: {
            totalPostsDiscovered: 10,
            totalPostsAnalyzed: 8,
            totalPostsSkipped: 2,
            totalStudents: 5,
            totalCadFiles: 15,
            totalValidCadFiles: 14,
            totalClustersDetected: 1,
            highSeverityClustersCount: 1,
            mediumSeverityClustersCount: 0,
            lowSeverityClustersCount: 0,
            suspiciousStudentsCount: 2,
        },
        sessions: {
            '1': {
                sessionIndex: 1,
                title: 'Buổi 1: Giới thiệu',
                totalSubmissions: 4,
                passedSubmissionsCount: 3,
                failedSubmissionsCount: 1,
                lateSubmissionsCount: 0,
                clustersCount: 1,
                posts: [
                    {
                        postId: '101',
                        postNumber: 1,
                        postUrl: 'https://example.com/p1',
                        author: { uid: 'u1', username: 'Nguyen Van A' },
                        userFolder: 'u1',
                        postFolder: 'p1',
                        postDate: '2026-10-01T10:00:00Z',
                        sessionIndex: 1,
                        sessionOverride: null,
                        cadEvaluation: {
                            totalCadFiles: 1,
                            validCadFiles: 1,
                            files: [],
                            detectedInventorVersions: [],
                        },
                        imageCount: 1,
                        validImageCount: 1,
                        driveStatus: 'success',
                        passedCriteria: true,
                        criteriaViolations: [],
                        warnings: [],
                        urlWarnings: [],
                        sessionWarnings: [],
                        driveWarnings: [],
                        imageWarnings: [],
                        involvedClusterIds: ['cluster_1'],
                    },
                    {
                        postId: '102',
                        postNumber: 2,
                        postUrl: 'https://example.com/p2',
                        author: { uid: 'u2', username: 'Tran Van B' },
                        userFolder: 'u2',
                        postFolder: 'p2',
                        postDate: '2026-10-01T11:00:00Z',
                        sessionIndex: 1,
                        sessionOverride: 1,
                        cadEvaluation: {
                            totalCadFiles: 1,
                            validCadFiles: 1,
                            files: [],
                            detectedInventorVersions: [],
                        },
                        imageCount: 0,
                        validImageCount: 0,
                        driveStatus: 'failed',
                        passedCriteria: false,
                        criteriaViolations: ['INSUFFICIENT_IMAGES:0/1'],
                        warnings: [],
                        urlWarnings: ['URL_BBCODE_UNPARSED'],
                        sessionWarnings: ['SESSION_OVERRIDE_APPLIED:1'],
                        driveWarnings: ['DRIVE_NOT_FOUND'],
                        imageWarnings: [],
                        involvedClusterIds: ['cluster_1'],
                    },
                ],
                clusterIds: ['cluster_1'],
            },
        },
        crossSessionClusters: [],
        students: {},
        allClusters: [
            {
                clusterId: 'cluster_1',
                sessionIndex: 1,
                matchTypes: ['identical_rse_segments'],
                severity: 'high',
                evidence: ['RSE_SEGMENT_MATCH:part1.ipt:part1_copy.ipt'],
                signature: 'rse_sig_1',
                suspectedOriginal: {
                    postId: '101',
                    postNumber: 1,
                    author: { uid: 'u1', username: 'Nguyen Van A' },
                    postDate: '2026-10-01T10:00:00Z',
                    fileName: 'part1.ipt',
                    filePath: '/part1.ipt',
                    fileSizeBytes: 1000,
                },
                suspectedCopies: [
                    {
                        postId: '102',
                        postNumber: 2,
                        author: { uid: 'u2', username: 'Tran Van B' },
                        postDate: '2026-10-01T11:00:00Z',
                        fileName: 'part1_copy.ipt',
                        filePath: '/part1_copy.ipt',
                        fileSizeBytes: 1000,
                    },
                ],
            },
        ],
    };

    it('extracts warned posts from sessions correctly', () => {
        const warned = extractWarnedPosts(mockReport.sessions);
        expect(warned).toHaveLength(1);
        expect(warned[0].postId).toBe('102');
        expect(warned[0].criteriaViolations).toContain('INSUFFICIENT_IMAGES:0/1');
    });

    it('prints console report without throwing errors', () => {
        const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {});

        expect(() => printOverviewStats(mockReport.stats)).not.toThrow();
        expect(() =>
            printPlagiarismClusters(mockReport.allClusters, mockReport.stats)
        ).not.toThrow();
        expect(() => printSessionSummaries(mockReport.sessions)).not.toThrow();
        expect(() => printWarnedPosts(mockReport.sessions)).not.toThrow();
        expect(() => printAnalysisConsoleReport(mockReport)).not.toThrow();

        expect(spyLog).toHaveBeenCalled();
        spyLog.mockRestore();
    });

    it('handles empty clusters and empty warned posts gracefully', () => {
        const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {});

        const emptyReport: ThreadAnalysisReport = {
            ...mockReport,
            allClusters: [],
            stats: {
                ...mockReport.stats,
                totalClustersDetected: 0,
                highSeverityClustersCount: 0,
                suspiciousStudentsCount: 0,
            },
            sessions: {
                '1': {
                    ...mockReport.sessions['1'],
                    posts: [mockReport.sessions['1'].posts[0]], // only valid post
                },
            },
        };

        expect(() =>
            printPlagiarismClusters(emptyReport.allClusters, emptyReport.stats)
        ).not.toThrow();
        expect(() => printWarnedPosts(emptyReport.sessions)).not.toThrow();

        spyLog.mockRestore();
    });
});
