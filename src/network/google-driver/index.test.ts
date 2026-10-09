import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
    parseGDriveUrl,
    extractItemsFromIvdHtml,
    matchFolderByKeywords,
    downloadGDriveSubmission,
    detectHtmlAccessStatus,
    diffSubmissionManifest,
    fetchSubmissionMetadata,
    type GDriveItem,
    type GDriveSubmissionMetadata,
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

        it('detects restricted permission and returns warning instead of downloading', async () => {
            const restrictedHtml = `
                <html>
                    <head><title>Google Drive – Access Denied</title></head>
                    <body>
                        <form action="https://accounts.google.com/ServiceLogin">
                            <p>You need access</p>
                        </form>
                    </body>
                </html>
            `;
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'text/html' }),
                text: async () => restrictedHtml,
                url: 'https://drive.google.com/drive/folders/private_folder_123',
            });
            globalThis.fetch = fetchMock;

            const folderUrl = 'https://drive.google.com/drive/folders/private_folder_123';
            const result = await downloadGDriveSubmission(folderUrl, tempDir);

            expect(result.success).toBe(false);
            expect(result.accessStatus).toBe('restricted');
            expect(result.warnings.some((w) => w.includes('hạn chế quyền truy cập'))).toBe(true);
        });

        it('saves .gdrive-manifest.json and skips unchanged files on subsequent runs in incremental mode', async () => {
            const folderHtml = `
                <script>
                    _DRIVE_ivd'] = '\\x5b\\x5b\\x5b\\x22file_abc\\x22,\\x5b\\x22root\\x22\\x5d,\\x22truc.ipt\\x22,\\x22application\\/octet-stream\\x22,0,null,0,0,0,0,0,null,null,100\\x5d\\x5d\\x5d';
                </script>
            `;
            const fileStream = new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('mock-cad-binary'));
                    controller.close();
                },
            });

            // Mock fetch: folder HTML vs binary file download
            globalThis.fetch = vi.fn().mockImplementation((url: string) => {
                if (url.includes('drive/folders/')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        headers: new Headers({ 'content-type': 'text/html' }),
                        text: async () => folderHtml,
                        url,
                    });
                }
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    headers: new Headers({ 'content-type': 'application/octet-stream' }),
                    body: fileStream,
                });
            });

            const folderUrl = 'https://drive.google.com/drive/folders/test_folder_inc';

            // Run 1: First download creates manifest
            const run1 = await downloadGDriveSubmission(folderUrl, tempDir, { incremental: true });
            expect(run1.success).toBe(true);
            expect(run1.downloadedFiles.length).toBe(1);

            const manifestPath = path.join(tempDir, '.gdrive-manifest.json');
            expect(fs.existsSync(manifestPath)).toBe(true);
            const savedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            expect(savedManifest.files.length).toBe(1);
            expect(savedManifest.files[0].name).toBe('truc.ipt');

            // Run 2: Second run detects no changes, skips downloading
            const run2 = await downloadGDriveSubmission(folderUrl, tempDir, { incremental: true });
            expect(run2.success).toBe(true);
            expect(run2.hasChanges).toBe(false);
            expect(run2.downloadedFiles.length).toBe(0);
            expect(run2.skippedFiles.length).toBe(1);
        });

        it('archives old version into _history with timestamp when a modified file is updated', async () => {
            let currentSize = 100;
            let currentContent = 'v1-content';

            globalThis.fetch = vi.fn().mockImplementation((url: string) => {
                if (url.includes('drive/folders/')) {
                    const html = `
                        <script>
                            _DRIVE_ivd'] = '\\x5b\\x5b\\x5b\\x22file_1\\x22,\\x5b\\x22root\\x22\\x5d,\\x22truc.ipt\\x22,\\x22application\\/octet-stream\\x22,0,null,0,0,0,0,0,null,null,${currentSize}\\x5d\\x5d\\x5d';
                        </script>
                    `;
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        headers: new Headers({ 'content-type': 'text/html' }),
                        text: async () => html,
                        url,
                    });
                }
                const stream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(currentContent));
                        controller.close();
                    },
                });
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    headers: new Headers({ 'content-type': 'application/octet-stream' }),
                    body: stream,
                });
            });

            const folderUrl = 'https://drive.google.com/drive/folders/test_folder_archive';

            // Run 1: tải bản v1
            const res1 = await downloadGDriveSubmission(folderUrl, tempDir, { incremental: true });
            expect(res1.success).toBe(true);
            const mainFile = path.join(tempDir, 'truc.ipt');
            expect(fs.readFileSync(mainFile, 'utf8')).toBe('v1-content');

            // Giả lập học viên sửa bài: dung lượng đổi thành 200, nội dung v2-content
            currentSize = 200;
            currentContent = 'v2-content';

            // Run 2: tải lại, phát hiện file bị sửa đổi
            const res2 = await downloadGDriveSubmission(folderUrl, tempDir, {
                incremental: true,
                archiveOldVersions: true,
                backupDirName: '_history',
            });
            expect(res2.success).toBe(true);
            expect(res2.updatedFiles?.length).toBe(1);
            expect(res2.archivedFiles?.length).toBe(1);

            // Kiểm tra file chính đã được cập nhật bản v2
            expect(fs.readFileSync(mainFile, 'utf8')).toBe('v2-content');

            // Kiểm tra thư mục _history có chứa bản sao lưu của file v1
            const historyDir = path.join(tempDir, '_history');
            expect(fs.existsSync(historyDir)).toBe(true);
            const backupFiles = fs.readdirSync(historyDir);
            expect(backupFiles.length).toBe(1);
            expect(backupFiles[0]).toMatch(/^truc_\d{8}_\d{6}\.ipt$/);
            expect(fs.readFileSync(path.join(historyDir, backupFiles[0]), 'utf8')).toBe(
                'v1-content'
            );

            // Kiểm tra manifest lưu thông tin lịch sử
            const manifest = JSON.parse(
                fs.readFileSync(path.join(tempDir, '.gdrive-manifest.json'), 'utf8')
            );
            expect(manifest.history?.length).toBe(1);
            expect(manifest.history[0].fileName).toBe('truc.ipt');
        });
    });

    describe('detectHtmlAccessStatus', () => {
        it('identifies restricted access when redirecting to accounts.google.com', () => {
            const result = detectHtmlAccessStatus(
                '<html></html>',
                'https://accounts.google.com/ServiceLogin'
            );
            expect(result.status).toBe('restricted');
            expect(result.reason).toContain('hạn chế quyền truy cập');
        });

        it('identifies restricted access from English and Vietnamese warning phrases', () => {
            const enHtml = '<div>You need access to this folder. Request access.</div>';
            expect(detectHtmlAccessStatus(enHtml).status).toBe('restricted');

            const vnHtml = '<div>Bạn cần có quyền truy cập vào thư mục này.</div>';
            expect(detectHtmlAccessStatus(vnHtml).status).toBe('restricted');
        });

        it('identifies not_found from 404 HTTP status or 404 HTML text', () => {
            expect(detectHtmlAccessStatus('', undefined, 404).status).toBe('not_found');
            expect(
                detectHtmlAccessStatus(
                    '<b>404. That’s an error. The requested URL was not found</b>'
                ).status
            ).toBe('not_found');
        });

        it('identifies public folder when _DRIVE_ivd is present', () => {
            const publicHtml = '<script>_DRIVE_ivd = "...";</script>';
            expect(detectHtmlAccessStatus(publicHtml).status).toBe('public');
        });
    });

    describe('diffSubmissionManifest', () => {
        const baseMetadata: GDriveSubmissionMetadata = {
            url: 'https://drive.google.com/drive/folders/xyz',
            type: 'folder',
            accessStatus: 'public',
            fetchedAt: '2026-10-09T10:00:00.000Z',
            files: [
                {
                    id: '1',
                    name: 'part1.ipt',
                    sizeBytes: 100,
                    modifiedTime: '2026-10-09T09:00:00Z',
                },
                {
                    id: '2',
                    name: 'part2.ipt',
                    sizeBytes: 200,
                    modifiedTime: '2026-10-09T09:00:00Z',
                },
            ],
            totalFiles: 2,
            totalBytes: 300,
            warnings: [],
        };

        it('treats all items as added when old manifest is null', () => {
            const diff = diffSubmissionManifest(null, baseMetadata);
            expect(diff.hasChanges).toBe(true);
            expect(diff.added.length).toBe(2);
            expect(diff.modified.length).toBe(0);
            expect(diff.unchanged.length).toBe(0);
        });

        it('detects no changes when metadata matches', () => {
            const diff = diffSubmissionManifest(baseMetadata, baseMetadata);
            expect(diff.hasChanges).toBe(false);
            expect(diff.unchanged.length).toBe(2);
            expect(diff.added.length).toBe(0);
            expect(diff.modified.length).toBe(0);
        });

        it('detects modified file when size or modifiedTime changes', () => {
            const updatedMetadata: GDriveSubmissionMetadata = {
                ...baseMetadata,
                files: [
                    {
                        id: '1',
                        name: 'part1.ipt',
                        sizeBytes: 150,
                        modifiedTime: '2026-10-09T09:00:00Z',
                    }, // size changed
                    {
                        id: '2',
                        name: 'part2.ipt',
                        sizeBytes: 200,
                        modifiedTime: '2026-10-09T09:00:00Z',
                    },
                ],
            };

            const diff = diffSubmissionManifest(baseMetadata, updatedMetadata);
            expect(diff.hasChanges).toBe(true);
            expect(diff.modified.length).toBe(1);
            expect(diff.modified[0].name).toBe('part1.ipt');
            expect(diff.unchanged.length).toBe(1);
            expect(diff.unchanged[0].name).toBe('part2.ipt');
        });

        it('detects added and deleted files', () => {
            const modifiedMetadata: GDriveSubmissionMetadata = {
                ...baseMetadata,
                files: [
                    {
                        id: '1',
                        name: 'part1.ipt',
                        sizeBytes: 100,
                        modifiedTime: '2026-10-09T09:00:00Z',
                    },
                    {
                        id: '3',
                        name: 'part3.ipt',
                        sizeBytes: 300,
                        modifiedTime: '2026-10-09T10:00:00Z',
                    }, // new
                ],
            };

            const diff = diffSubmissionManifest(baseMetadata, modifiedMetadata);
            expect(diff.hasChanges).toBe(true);
            expect(diff.added.length).toBe(1);
            expect(diff.added[0].name).toBe('part3.ipt');
            expect(diff.deleted.length).toBe(1);
            expect(diff.deleted[0].name).toBe('part2.ipt');
            expect(diff.unchanged.length).toBe(1);
        });
    });

    describe('fetchSubmissionMetadata', () => {
        it('returns restricted access status when folder requires permission', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'text/html' }),
                text: async () =>
                    '<html><body>You need permission to access this page</body></html>',
                url: 'https://drive.google.com/drive/folders/private_folder',
            });

            const meta = await fetchSubmissionMetadata(
                'https://drive.google.com/drive/folders/private_folder'
            );
            expect(meta.accessStatus).toBe('restricted');
            expect(meta.totalFiles).toBe(0);
            expect(meta.warnings[0]).toContain('quyền truy cập');
        });

        it('returns public metadata with file list when folder is accessible', async () => {
            const folderHtml = `
                <script>
                    _DRIVE_ivd'] = '\\x5b\\x5b\\x5b\\x22file_1\\x22,\\x5b\\x22root\\x22\\x5d,\\x22truc.ipt\\x22,\\x22application\\/octet-stream\\x22,0,null,0,0,0,0,0,null,null,500\\x5d\\x5d\\x5d';
                </script>
            `;
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Headers({ 'content-type': 'text/html' }),
                text: async () => folderHtml,
                url: 'https://drive.google.com/drive/folders/public_folder',
            });

            const meta = await fetchSubmissionMetadata(
                'https://drive.google.com/drive/folders/public_folder'
            );
            expect(meta.accessStatus).toBe('public');
            expect(meta.totalFiles).toBe(1);
            expect(meta.files[0].name).toBe('truc.ipt');
            expect(meta.files[0].sizeBytes).toBe(500);
        });
    });
});
