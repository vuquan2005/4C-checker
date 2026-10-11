import { describe, expect, it } from 'vitest';
import type { ThreadConfig } from '../../config/types.js';
import type { PlagiarismCluster, PlagiarizedFileRef, PostAnalysisResult } from '../types/index.js';
import { aggregateSessionSummaries } from './session-aggregator.js';
import { aggregateStudentSummaries } from './student-aggregator.js';
import { aggregateSummaryStats } from './stats-aggregator.js';

describe('Aggregator Module', () => {
    const mockPost1: PostAnalysisResult = {
        postId: '101',
        postNumber: 1,
        postUrl: 'https://forum.example.com/post-101',
        author: { uid: 'u1', username: 'Nguyen Van A' },
        userFolder: 'u1_nguyen_van_a',
        postFolder: 'p1',
        postDate: '2026-10-01T10:00:00Z',
        sessionIndex: 1,
        sessionOverride: null,
        cadEvaluation: {
            totalCadFiles: 2,
            validCadFiles: 2,
            files: [],
            detectedInventorVersions: ['2024'],
        },
        imageCount: 2,
        validImageCount: 2,
        driveStatus: 'success',
        isLate: false,
        passedCriteria: true,
        criteriaViolations: [],
        warnings: [],
        urlWarnings: [],
        sessionWarnings: [],
        driveWarnings: [],
        imageWarnings: [],
        involvedClusterIds: ['cluster_1'],
    };

    const mockPost2: PostAnalysisResult = {
        postId: '102',
        postNumber: 2,
        postUrl: 'https://forum.example.com/post-102',
        author: { uid: 'u2', username: 'Tran Van B' },
        userFolder: 'u2_tran_van_b',
        postFolder: 'p2',
        postDate: '2026-10-02T15:00:00Z',
        sessionIndex: 1,
        sessionOverride: null,
        cadEvaluation: {
            totalCadFiles: 1,
            validCadFiles: 1,
            files: [],
            detectedInventorVersions: ['2024'],
        },
        imageCount: 1,
        validImageCount: 0,
        driveStatus: 'success',
        isLate: true,
        passedCriteria: false,
        criteriaViolations: ['IMAGE_TOO_SMALL'],
        warnings: [],
        urlWarnings: [],
        sessionWarnings: [],
        driveWarnings: [],
        imageWarnings: ['IMAGE_TOO_SMALL'],
        involvedClusterIds: ['cluster_1'],
    };

    const mockPost3: PostAnalysisResult = {
        postId: '103',
        postNumber: 3,
        postUrl: 'https://forum.example.com/post-103',
        author: { uid: 'u1', username: 'Nguyen Van A' }, // same author as post1, session 2
        userFolder: 'u1_nguyen_van_a',
        postFolder: 'p3',
        postDate: '2026-10-05T10:00:00Z',
        sessionIndex: 2,
        sessionOverride: null,
        cadEvaluation: {
            totalCadFiles: 1,
            validCadFiles: 1,
            files: [],
            detectedInventorVersions: ['2024'],
        },
        imageCount: 1,
        validImageCount: 1,
        driveStatus: 'success',
        isLate: false,
        passedCriteria: true,
        criteriaViolations: [],
        warnings: [],
        urlWarnings: [],
        sessionWarnings: [],
        driveWarnings: [],
        imageWarnings: [],
        involvedClusterIds: [],
    };

    const mockCluster1: PlagiarismCluster = {
        clusterId: 'cluster_1',
        sessionIndex: 1,
        matchTypes: ['identical_rse_segments'],
        severity: 'high',
        evidence: ['RSE_SEGMENT_MATCH:p1.ipt:p2.ipt'],
        signature: 'rse123',
        suspectedCopies: [],
    };

    const mockClusterCross: PlagiarismCluster = {
        clusterId: 'cluster_2',
        sessionIndex: undefined, // cross-session
        matchTypes: ['identical_geometry'],
        severity: 'medium',
        evidence: ['GEOMETRY_MATCH:geom123:p1.ipt:p3.ipt'],
        signature: 'geom123',
        suspectedCopies: [],
    };

    const mockConfig: ThreadConfig = {
        title: 'Course Test',
        threadId: '1336',
        analysis: {
            templateRseWhitelists: [],
            sessions: {
                '1': {
                    title: 'Buổi 1: Giới thiệu',
                    deadline: '2026-10-02T12:00:00Z',
                    minCadFiles: 1,
                    minImages: 1,
                    maxAllowedInventorVersion: 2025,
                },
            },
            defaultSessionCriteria: {
                title: 'Buổi mặc định',
                minCadFiles: 1,
            },
        },
    };

    describe('aggregateSessionSummaries', () => {
        it('aggregates posts and clusters into sessions correctly', () => {
            const sessions = aggregateSessionSummaries(
                [mockPost1, mockPost2, mockPost3],
                [mockCluster1, mockClusterCross],
                mockConfig
            );

            expect(Object.keys(sessions)).toEqual(['1', '2']);

            // Session 1 checks
            const s1 = sessions['1'];
            expect(s1.sessionIndex).toBe(1);
            expect(s1.title).toBe('Buổi 1: Giới thiệu');
            expect(s1.totalSubmissions).toBe(2);
            expect(s1.passedSubmissionsCount).toBe(1);
            expect(s1.failedSubmissionsCount).toBe(1);
            expect(s1.lateSubmissionsCount).toBe(1);
            expect(s1.clustersCount).toBe(1);
            expect(s1.clusterIds).toEqual(['cluster_1']);

            // Session 2 checks (fallback to default criteria)
            const s2 = sessions['2'];
            expect(s2.sessionIndex).toBe(2);
            expect(s2.title).toBe('Buổi mặc định');
            expect(s2.totalSubmissions).toBe(1);
            expect(s2.passedSubmissionsCount).toBe(1);
            expect(s2.clustersCount).toBe(0);
        });

        it('handles posts with undefined sessionIndex as session 0', () => {
            const unassignedPost: PostAnalysisResult = {
                ...mockPost1,
                postId: '999',
                sessionIndex: undefined,
            };

            const sessions = aggregateSessionSummaries([unassignedPost], [], mockConfig);
            expect(sessions['0']).toBeDefined();
            expect(sessions['0'].sessionIndex).toBe(0);
            expect(sessions['0'].totalSubmissions).toBe(1);
        });
    });

    describe('aggregateStudentSummaries', () => {
        it('aggregates submission records per student across multiple sessions', () => {
            const students = aggregateStudentSummaries([mockPost1, mockPost2, mockPost3]);

            expect(Object.keys(students)).toHaveLength(2);

            // Student 1 (Nguyen Van A) submitted posts in session 1 and session 2
            const st1 = students['u1'];
            expect(st1.username).toBe('Nguyen Van A');
            expect(st1.totalSubmissions).toBe(2);
            expect(st1.submittedSessions).toEqual([1, 2]);
            expect(st1.lateSubmissionsCount).toBe(0);
            expect(st1.criteriaFailedCount).toBe(0);
            expect(st1.plagiarismInvolvementCount).toBe(1);
            expect(st1.involvedClusterIds).toEqual(['cluster_1']);

            // Student 2 (Tran Van B) failed criteria, submitted late, involved in cluster 1
            const st2 = students['u2'];
            expect(st2.username).toBe('Tran Van B');
            expect(st2.totalSubmissions).toBe(1);
            expect(st2.submittedSessions).toEqual([1]);
            expect(st2.lateSubmissionsCount).toBe(1);
            expect(st2.criteriaFailedCount).toBe(1);
            expect(st2.plagiarismInvolvementCount).toBe(1);
            expect(st2.involvedClusterIds).toEqual(['cluster_1']);
        });
    });

    describe('aggregateSummaryStats', () => {
        it('calculates global thread stats accurately', () => {
            const students = aggregateStudentSummaries([mockPost1, mockPost2, mockPost3]);
            const mockCadFiles: PlagiarizedFileRef[] = [
                {
                    postId: '101',
                    postNumber: 1,
                    author: { uid: 'u1', username: 'Nguyen Van A' },
                    postDate: '2026-10-01T10:00:00Z',
                    fileName: 'part1.ipt',
                    filePath: '/part1.ipt',
                    fileSizeBytes: 1000,
                },
                {
                    postId: '102',
                    postNumber: 2,
                    author: { uid: 'u2', username: 'Tran Van B' },
                    postDate: '2026-10-02T15:00:00Z',
                    fileName: 'part2.ipt',
                    filePath: '/part2.ipt',
                    fileSizeBytes: 0, // empty CAD file
                },
            ];

            const stats = aggregateSummaryStats({
                totalPostsDiscovered: 4,
                postResults: [mockPost1, mockPost2, mockPost3],
                skippedPostsCount: 1,
                students,
                allCadFiles: mockCadFiles,
                allClusters: [mockCluster1, mockClusterCross],
            });

            expect(stats.totalPostsDiscovered).toBe(4);
            expect(stats.totalPostsAnalyzed).toBe(3);
            expect(stats.totalPostsSkipped).toBe(1);
            expect(stats.totalStudents).toBe(2);
            expect(stats.totalCadFiles).toBe(2);
            expect(stats.totalValidCadFiles).toBe(1); // only 1 has fileSizeBytes > 0
            expect(stats.totalClustersDetected).toBe(2);
            expect(stats.highSeverityClustersCount).toBe(1);
            expect(stats.mediumSeverityClustersCount).toBe(1);
            expect(stats.lowSeverityClustersCount).toBe(0);
            expect(stats.suspiciousStudentsCount).toBe(2);
        });
    });
});
