import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PostData, ThreadManifest } from '../preparation/types/manifest.js';
import { analyzeThread } from './orchestrator.js';

describe('Thread Analysis Orchestrator', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '4c-analysis-test-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    const mockRseIds = [
        'B11111111111111111111111111',
        'B22222222222222222222222222',
        'B33333333333333333333333333',
        'B44444444444444444444444444',
        'B55555555555555555555555555',
        'B66666666666666666666666666',
        'B77777777777777777777777777',
        'B88888888888888888888888888',
    ];

    it('throws when thread manifest is not found', async () => {
        await expect(analyzeThread('999', { dataDir: tempDir })).rejects.toThrow(
            /Thread manifest not found/
        );
    });

    it('analyzes thread, matches plagiarism clusters, and writes analysis.json', async () => {
        const threadDir = path.join(tempDir, '999');
        fs.mkdirSync(threadDir, { recursive: true });

        // Setup Manifest
        const manifest = {
            threadId: '999',
            title: 'Khóa Học Inventor K16',
            lastSyncedAt: new Date().toISOString(),
            syncVersion: 1,
            stats: {
                totalPosts: 3,
                totalUsers: 2,
                syncedPosts: 2,
                outdatedPosts: 0,
                pendingPosts: 0,
                failedPosts: 0,
                skippedPosts: 1,
            },
            posts: {
                '101': {
                    postId: '101',
                    postNumber: 1,
                    postUrl: 'https://example.com/101',
                    author: { uid: '201', username: 'Student Alpha' },
                    userFolder: 'Student_Alpha_201',
                    postFolder: 'post_101',
                    syncStatus: 'synced',
                },
                '102': {
                    postId: '102',
                    postNumber: 2,
                    postUrl: 'https://example.com/102',
                    author: { uid: '202', username: 'Student Beta' },
                    userFolder: 'Student_Beta_202',
                    postFolder: 'post_102',
                    syncStatus: 'synced',
                },
                '103': {
                    postId: '103',
                    postNumber: 3,
                    postUrl: 'https://example.com/103',
                    author: { uid: '203', username: 'Student Gamma' },
                    userFolder: 'Student_Gamma_203',
                    postFolder: 'post_103',
                    syncStatus: 'synced',
                    skipProcessing: true,
                    skipReason: 'MANUAL_IGNORE',
                },
            },
        } as unknown as ThreadManifest;
        fs.writeFileSync(path.join(threadDir, 'thread.json'), JSON.stringify(manifest));

        // Setup Post 101 (Student Alpha)
        const post101Dir = path.join(threadDir, 'Student_Alpha_201', 'post_101');
        fs.mkdirSync(post101Dir, { recursive: true });
        const post101Data: PostData = {
            postId: '101',
            postNumber: 1,
            sessionIndex: 1,
            sessionOverride: null,
            postUrl: 'https://example.com/101',
            author: { uid: '201', username: 'Student Alpha' },
            postDate: '2026-10-01T10:00:00Z',
            currentVersion: 1,
            syncedAt: '2026-10-01T10:05:00Z',
            userFolder: 'Student_Alpha_201',
            postFolder: 'post_101',
            forumImages: [],
            driveFiles: {
                status: 'downloaded',
                totalFiles: 1,
                downloadedFiles: ['drive_files/model.ipt'],
            },
            cadSummaries: [
                {
                    filePath: path.join(post101Dir, 'drive_files', 'model.ipt'),
                    fileName: 'model.ipt',
                    localPath: 'drive_files/model.ipt',
                    fileExtension: '.ipt',
                    fileSizeBytes: 250000,
                    hasPreview: true,
                    creationDate: '10/01/2026 09:00:00',
                    lastSavedDate: '10/01/2026 09:30:00',
                    lastSavedByWindowsUser: 'AlphaUser',
                    rseSegmentIds: mockRseIds,
                },
            ],
            warnings: [],
        };
        fs.writeFileSync(path.join(post101Dir, 'post.json'), JSON.stringify(post101Data));

        // Setup Post 102 (Student Beta - copied Alpha's file)
        const post102Dir = path.join(threadDir, 'Student_Beta_202', 'post_102');
        fs.mkdirSync(post102Dir, { recursive: true });
        const post102Data: PostData = {
            postId: '102',
            postNumber: 2,
            sessionIndex: 1,
            sessionOverride: null,
            postUrl: 'https://example.com/102',
            author: { uid: '202', username: 'Student Beta' },
            postDate: '2026-10-01T12:00:00Z', // Submitted 2 hours later
            currentVersion: 1,
            syncedAt: '2026-10-01T12:05:00Z',
            userFolder: 'Student_Beta_202',
            postFolder: 'post_102',
            forumImages: [],
            driveFiles: {
                status: 'downloaded',
                totalFiles: 1,
                downloadedFiles: ['drive_files/part1.ipt'],
            },
            cadSummaries: [
                {
                    filePath: path.join(post102Dir, 'drive_files', 'part1.ipt'),
                    fileName: 'part1.ipt',
                    localPath: 'drive_files/part1.ipt',
                    fileExtension: '.ipt',
                    fileSizeBytes: 250000,
                    hasPreview: true,
                    creationDate: '10/01/2026 09:00:00',
                    lastSavedDate: '10/01/2026 11:30:00',
                    lastSavedByWindowsUser: 'BetaPC',
                    rseSegmentIds: mockRseIds, // Same RSe IDs!
                },
            ],
            warnings: [],
        };
        fs.writeFileSync(path.join(post102Dir, 'post.json'), JSON.stringify(post102Data));

        // Run analysis
        const report = await analyzeThread('999', {
            dataDir: tempDir,
            config: {
                threadId: '999',
                analysis: {
                    sessions: {
                        '1': {
                            title: 'Buổi 1: Khởi động',
                            minCadFiles: 1,
                            deadline: '2026-10-02T00:00:00Z',
                        },
                    },
                },
            },
        });

        // Verification
        expect(report.stats.totalPostsDiscovered).toBe(3);
        expect(report.stats.totalPostsAnalyzed).toBe(2);
        expect(report.stats.totalPostsSkipped).toBe(1);
        expect(report.stats.totalStudents).toBe(2);
        expect(report.stats.totalClustersDetected).toBe(1);
        expect(report.stats.highSeverityClustersCount).toBe(1);
        expect(report.stats.suspiciousStudentsCount).toBe(2);

        // Check cluster details
        const cluster = report.allClusters[0];
        expect(cluster.sessionIndex).toBe(1);
        expect(cluster.severity).toBe('high');
        expect(cluster.suspectedOriginal?.author.uid).toBe('201'); // Student Alpha is original
        expect(cluster.suspectedCopies[0].author.uid).toBe('202'); // Student Beta is copy

        // Check post link back
        const post101Result = report.sessions['1'].posts.find((p) => p.postId === '101');
        const post102Result = report.sessions['1'].posts.find((p) => p.postId === '102');
        expect(post101Result?.involvedClusterIds).toContain(cluster.clusterId);
        expect(post102Result?.involvedClusterIds).toContain(cluster.clusterId);

        // Check analysis.json created on disk
        const analysisJsonPath = path.join(threadDir, 'analysis.json');
        expect(fs.existsSync(analysisJsonPath)).toBe(true);
        const savedJson = JSON.parse(fs.readFileSync(analysisJsonPath, 'utf8'));
        expect(savedJson.stats.totalClustersDetected).toBe(1);
    });
});
