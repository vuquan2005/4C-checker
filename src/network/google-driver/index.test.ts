import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
    parseGDriveUrl,
    extractItemsFromIvdHtml,
    matchFolderByKeywords,
    downloadGDriveSubmission,
    type GDriveItem,
} from './index.js';

describe('GDrive Downloader Module', () => {
    let tempDir: string;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '4c-gdrive-test-'));
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        vi.restoreAllMocks();
    });

    describe('parseGDriveUrl', () => {
        it('parses standard folder URL', () => {
            const parsed = parseGDriveUrl(
                'https://drive.google.com/drive/folders/1p2uG6onvBmAxsCSdTW4zNwLs9tHlHEAS'
            );
            expect(parsed).toEqual({
                type: 'folder',
                id: '1p2uG6onvBmAxsCSdTW4zNwLs9tHlHEAS',
                originalUrl:
                    'https://drive.google.com/drive/folders/1p2uG6onvBmAxsCSdTW4zNwLs9tHlHEAS',
            });
        });

        it('parses user-indexed folder URL (u/0/folders/)', () => {
            const parsed = parseGDriveUrl(
                'https://drive.google.com/drive/u/0/folders/1p2uG6onvBmAxsCSdTW4zNwLs9tHlHEAS?usp=sharing'
            );
            expect(parsed?.type).toBe('folder');
            expect(parsed?.id).toBe('1p2uG6onvBmAxsCSdTW4zNwLs9tHlHEAS');
        });

        it('parses single file URL (file/d/)', () => {
            const parsed = parseGDriveUrl(
                'https://drive.google.com/file/d/12V1UAQG1qefrYWEJKZLI90rVLChXOiyj/view?usp=drive_link'
            );
            expect(parsed).toEqual({
                type: 'file',
                id: '12V1UAQG1qefrYWEJKZLI90rVLChXOiyj',
                originalUrl:
                    'https://drive.google.com/file/d/12V1UAQG1qefrYWEJKZLI90rVLChXOiyj/view?usp=drive_link',
            });
        });

        it('parses export download URL (uc?id=)', () => {
            const parsed = parseGDriveUrl(
                'https://drive.google.com/uc?export=download&id=abc1234567890123456789012'
            );
            expect(parsed?.type).toBe('file');
            expect(parsed?.id).toBe('abc1234567890123456789012');
        });

        it('parses open?id= URL as unknown', () => {
            const parsed = parseGDriveUrl(
                'https://drive.google.com/open?id=14tl5qpwUohDaPRcMstpC__eErQMSVBKy'
            );
            expect(parsed?.type).toBe('unknown');
            expect(parsed?.id).toBe('14tl5qpwUohDaPRcMstpC__eErQMSVBKy');
        });

        it('returns null for non-drive URL or invalid string', () => {
            expect(parseGDriveUrl('')).toBeNull();
            expect(parseGDriveUrl('https://example.com/file.zip')).toBeNull();
            expect(parseGDriveUrl('not-a-url')).toBeNull();
        });
    });

    describe('extractItemsFromIvdHtml', () => {
        it('extracts folder and file items from escaped _DRIVE_ivd snippet', () => {
            // Mock _DRIVE_ivd snippet with hex encoding \x5b = [, \x5d = ], \x22 = "
            const snippet = `
                <script>
                    _DRIVE_ivd'] = '\\x5b\\x5b\\x5b\\x22folder_1\\x22,\\x5b\\x22root\\x22\\x5d,\\x22Bu\\u1ed5i 2_ Nguy\\u1ec5n Minh Tri\\u1ebft\\x22,\\x22application\\/vnd.google-apps.folder\\x22,0,null,0,0,0,0,0,null,null,null\\x5d,\\x5b\\x22file_1\\x22,\\x5b\\x22root\\x22\\x5d,\\x22bai 1.ipt\\x22,\\x22application\\/octet-stream\\x22,0,null,0,0,0,0,0,null,null,221696\\x5d\\x5d\\x5d';
                </script>
            `;

            const items = extractItemsFromIvdHtml(snippet);
            expect(items).toHaveLength(2);

            expect(items[0]).toEqual({
                id: 'folder_1',
                name: 'Buổi 2_ Nguyễn Minh Triết',
                mimeType: 'application/vnd.google-apps.folder',
                isFolder: true,
                sizeBytes: undefined,
                parentIds: ['root'],
            });

            expect(items[1]).toEqual({
                id: 'file_1',
                name: 'bai 1.ipt',
                mimeType: 'application/octet-stream',
                isFolder: false,
                sizeBytes: 221696,
                parentIds: ['root'],
            });
        });

        it('returns empty array when _DRIVE_ivd is absent or invalid', () => {
            expect(extractItemsFromIvdHtml('<html><body>No data</body></html>')).toEqual([]);
            expect(extractItemsFromIvdHtml("_DRIVE_ivd'] = 'invalid_json';")).toEqual([]);
        });
    });

    describe('matchFolderByKeywords', () => {
        const sampleFolders: GDriveItem[] = [
            {
                id: 'f1',
                name: 'Buổi 3_ Nguyễn Minh Triết_4CHaui_Inventor1_K20',
                mimeType: 'application/vnd.google-apps.folder',
                isFolder: true,
            },
            {
                id: 'f2',
                name: 'Buổi1_ Nguyễn Minh Triết_4CHaUI_Inventor 1_K20',
                mimeType: 'application/vnd.google-apps.folder',
                isFolder: true,
            },
            {
                id: 'f3',
                name: 'Buổi2_Nguyễn Minh Triết_4CHaui_Inventor1_K20',
                mimeType: 'application/vnd.google-apps.folder',
                isFolder: true,
            },
        ];

        it('matches Buổi 1 using normalized keywords [buoi 1, b1]', () => {
            const matched = matchFolderByKeywords(sampleFolders, ['buoi 1', 'b1']);
            expect(matched?.id).toBe('f2');
            expect(matched?.name).toContain('Buổi1');
        });

        it('matches Buổi 2 using [buổi 2, buoi-02]', () => {
            const matched = matchFolderByKeywords(sampleFolders, ['buổi 2', 'buoi-02']);
            expect(matched?.id).toBe('f3');
            expect(matched?.name).toContain('Buổi2');
        });

        it('matches Buổi 3 using regex session number [b03]', () => {
            const matched = matchFolderByKeywords(sampleFolders, ['b03']);
            expect(matched?.id).toBe('f1');
        });

        it('returns null when no keywords match', () => {
            const matched = matchFolderByKeywords(sampleFolders, ['buoi 5', 'b5']);
            expect(matched).toBeNull();
        });
    });

    describe('downloadGDriveSubmission execution', () => {
        it('handles invalid URL gracefully', async () => {
            const result = await downloadGDriveSubmission('https://google.com', tempDir);
            expect(result.success).toBe(false);
            expect(result.warnings[0]).toContain('URL không hợp lệ');
        });

        it('downloads single file directly using mocked stream', async () => {
            const mockContent = 'mock-file-content';
            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(mockContent));
                    controller.close();
                },
            });

            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'application/octet-stream' }),
                body: stream,
            });
            globalThis.fetch = fetchMock;

            const fileUrl = 'https://drive.google.com/file/d/test_file_id_12345/view';
            const result = await downloadGDriveSubmission(fileUrl, tempDir, {
                autoExtractZip: false,
            });

            expect(result.success).toBe(true);
            expect(result.downloadedFiles.length).toBe(1);
            expect(fs.existsSync(result.downloadedFiles[0])).toBe(true);
            expect(fs.readFileSync(result.downloadedFiles[0], 'utf8')).toBe(mockContent);
        });

        it('skips existing file when skipIfExists is true', async () => {
            const destFile = path.join(tempDir, 'submission_test_file_exist.zip');
            fs.writeFileSync(destFile, 'already-downloaded');

            const fileUrl = 'https://drive.google.com/file/d/test_file_exist/view';
            const result = await downloadGDriveSubmission(fileUrl, tempDir, { skipIfExists: true });

            expect(result.success).toBe(true);
            expect(result.skippedFiles).toContain(destFile);
            expect(result.downloadedFiles).toHaveLength(0);
        });
    });
});
