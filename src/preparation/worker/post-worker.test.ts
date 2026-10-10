import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ThreadPostRecord, PostSnapshot } from '../types/manifest.js';
import { processPost } from './post-worker.js';

describe('Post Ingestion Worker', () => {
    let tempDir: string;
    const sampleCadPath = path.resolve(process.cwd(), 'sample/template.ipt');

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '4c-worker-test-'));
    });

    afterEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    const createDummyRecord = (): { record: ThreadPostRecord; snapshot: PostSnapshot } => {
        const snapshot: PostSnapshot = {
            version: 1,
            syncedAt: '2026-10-01T12:00:00+07:00',
            postDate: '2026-10-01T10:00:00+07:00',
            plainText: 'Dummy post plain text',
            links: ['https://drive.google.com/file/d/mock123/view'],
            imageUrls: ['https://example.com/mock.png'],
            warnings: [],
        };

        const record: ThreadPostRecord = {
            postId: '3001',
            postNumber: 2,
            postUrl: 'https://example.com/showthread.php?tid=999&pid=3001',
            author: { username: 'Student A_K16', uid: '5001' },
            userFolder: 'Student_A_5001',
            postFolder: 'post_3001',
            postDate: '2026-10-01T10:00:00+07:00',
            firstSeenAt: '2026-10-01T12:00:00+07:00',
            lastSyncedAt: '2026-10-01T12:00:00+07:00',
            syncStatus: 'pending',
            current: 1,
            history: [snapshot],
        };

        return { record, snapshot };
    };

    it('creates folder structure and writes post.json without network calls', async () => {
        const { record, snapshot } = createDummyRecord();

        const result = await processPost(tempDir, '999', record, snapshot, {
            downloadDrive: false,
            downloadImages: false,
            extractCad: false,
        });

        expect(fs.existsSync(result.postDir)).toBe(true);
        expect(fs.existsSync(path.join(result.postDir, 'student_images'))).toBe(true);
        expect(fs.existsSync(path.join(result.postDir, 'drive_files'))).toBe(true);
        expect(fs.existsSync(path.join(result.postDir, 'cad_previews'))).toBe(true);
        expect(fs.existsSync(result.summaryPath)).toBe(true);

        const summaryContent = JSON.parse(fs.readFileSync(result.summaryPath, 'utf8'));
        expect(summaryContent.postId).toBe('3001');
        expect(summaryContent.currentVersion).toBe(1);
        expect(summaryContent.userFolder).toBe('Student_A_5001');
        expect(summaryContent.sessionIndex).toBeUndefined();
        expect(summaryContent.sessionOverride).toBeNull();
        expect(summaryContent.warnings).toContain('SESSION_OVERRIDE_REQUIRED');
        expect(record.syncStatus).toBe('synced');
    });

    it('scans and parses CAD file in drive_files, extracting 3D preview', async () => {
        const { record, snapshot } = createDummyRecord();

        // Pre-create drive_files directory and copy sample template.ipt
        const driveDir = path.join(
            tempDir,
            '999',
            record.userFolder,
            record.postFolder,
            'drive_files'
        );
        fs.mkdirSync(driveDir, { recursive: true });

        if (fs.existsSync(sampleCadPath)) {
            fs.copyFileSync(sampleCadPath, path.join(driveDir, 'part.ipt'));
        }

        const result = await processPost(tempDir, '999', record, snapshot, {
            downloadDrive: false,
            downloadImages: false,
            extractCad: true,
        });

        if (fs.existsSync(sampleCadPath)) {
            expect(result.summary.cadSummaries.length).toBeGreaterThan(0);
            const cad = result.summary.cadSummaries[0];
            expect(cad.fileName).toBe('part.ipt');
            expect(cad.localPath).toBe('drive_files/part.ipt');

            // If template has preview, verify preview is extracted into cad_previews
            if (cad.hasPreview && cad.previewPath) {
                expect(cad.previewPath).toBe('cad_previews/part.png');
                expect(fs.existsSync(path.join(result.postDir, cad.previewPath))).toBe(true);
            }
        }
    });

    it('uses unique paths when image URLs share the same basename', async () => {
        const { record, snapshot } = createDummyRecord();
        snapshot.imageUrls = [
            'https://example.com/first/image.png',
            'https://example.com/second/image.png',
            'https://example.com/third/image.png',
        ];

        vi.spyOn(globalThis, 'fetch').mockImplementation(
            async () =>
                new Response(new Uint8Array([1, 2, 3]), {
                    status: 200,
                    headers: { 'Content-Type': 'image/png' },
                })
        );

        const result = await processPost(tempDir, '999', record, snapshot, {
            downloadDrive: false,
            downloadImages: true,
            extractCad: false,
        });

        expect(result.summary.forumImages.map((image) => image.fileName)).toEqual([
            'image.png',
            'image_02.png',
            'image_03.png',
        ]);
        expect(new Set(result.summary.forumImages.map((image) => image.localPath)).size).toBe(3);
    });
});
