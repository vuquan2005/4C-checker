import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadImage, downloadImages } from './image-downloader.js';

describe('Image Downloader Module', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '4c-img-test-'));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    describe('downloadImage (Tải đơn)', () => {
        it('downloads image and writes directly to disk', async () => {
            const fakeImageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
            const targetPath = path.join(tempDir, 'sub', 'test.png');

            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(fakeImageBytes, {
                    status: 200,
                    headers: { 'Content-Type': 'image/png' },
                })
            );

            const result = await downloadImage('https://example.com/photo.png', targetPath);

            expect(result.success).toBe(true);
            expect(result.destPath).toBe(targetPath);
            expect(result.sizeBytes).toBe(4);
            expect(fs.existsSync(targetPath)).toBe(true);
            expect(fs.readFileSync(targetPath)).toEqual(Buffer.from(fakeImageBytes));
        });

        it('skips downloading when target file already exists and skipIfExists is true', async () => {
            const targetPath = path.join(tempDir, 'exists.png');
            fs.writeFileSync(targetPath, Buffer.from([1, 2, 3]));

            const fetchSpy = vi.spyOn(globalThis, 'fetch');

            const result = await downloadImage('https://example.com/exists.png', targetPath, {
                skipIfExists: true,
            });

            expect(result.success).toBe(true);
            expect(result.skipped).toBe(true);
            expect(result.sizeBytes).toBe(3);
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it('re-downloads if skipIfExists is false even if file exists', async () => {
            const targetPath = path.join(tempDir, 're-download.png');
            fs.writeFileSync(targetPath, Buffer.from([1, 2, 3]));

            const newBytes = new Uint8Array([4, 5, 6, 7]);
            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(newBytes, { status: 200 })
            );

            const result = await downloadImage('https://example.com/re-download.png', targetPath, {
                skipIfExists: false,
            });

            expect(result.success).toBe(true);
            expect(result.skipped).toBeUndefined();
            expect(result.sizeBytes).toBe(4);
            expect(fs.readFileSync(targetPath)).toEqual(Buffer.from(newBytes));
        });

        it('handles HTTP error and cleans up partial file', async () => {
            const targetPath = path.join(tempDir, 'error.png');

            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response('Not Found', {
                    status: 404,
                    statusText: 'Not Found',
                })
            );

            const result = await downloadImage('https://example.com/404.png', targetPath);

            expect(result.success).toBe(false);
            expect(result.error).toContain('HTTP 404');
            expect(fs.existsSync(targetPath)).toBe(false);
        });
    });

    describe('downloadImages (Tải danh sách / Map)', () => {
        it('downloads images with task array and reports progress', async () => {
            const tasks = [
                { url: 'https://example.com/1.png', destPath: path.join(tempDir, '1.png') },
                { url: 'https://example.com/2.png', destPath: path.join(tempDir, '2.png') },
            ];

            vi.spyOn(globalThis, 'fetch')
                .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200 }))
                .mockResolvedValueOnce(new Response(new Uint8Array([2]), { status: 200 }));

            const progressReports: number[] = [];
            const results = await downloadImages(tasks, {
                concurrency: 2,
                delayMs: 0,
                onProgress: (completed, total) => {
                    progressReports.push(completed);
                    expect(total).toBe(2);
                },
            });

            expect(results).toHaveLength(2);
            expect(results[0].success).toBe(true);
            expect(results[1].success).toBe(true);
            expect(progressReports).toEqual([1, 2]);
            expect(fs.existsSync(tasks[0].destPath)).toBe(true);
            expect(fs.existsSync(tasks[1].destPath)).toBe(true);
        });

        it('supports Map<url, destPath> input format', async () => {
            const taskMap = new Map<string, string>([
                ['https://example.com/a.jpg', path.join(tempDir, 'a.jpg')],
                ['https://example.com/b.jpg', path.join(tempDir, 'b.jpg')],
            ]);

            vi.spyOn(globalThis, 'fetch')
                .mockResolvedValueOnce(new Response(new Uint8Array([10]), { status: 200 }))
                .mockResolvedValueOnce(new Response(new Uint8Array([20]), { status: 200 }));

            const results = await downloadImages(taskMap, { delayMs: 0 });

            expect(results).toHaveLength(2);
            expect(results.every((r) => r.success)).toBe(true);
            expect(fs.existsSync(taskMap.get('https://example.com/a.jpg')!)).toBe(true);
            expect(fs.existsSync(taskMap.get('https://example.com/b.jpg')!)).toBe(true);
        });

        it('supports Record<url, destPath> input format', async () => {
            const taskObj = {
                'https://example.com/x.jpg': path.join(tempDir, 'x.jpg'),
            };

            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
                new Response(new Uint8Array([99]), { status: 200 })
            );

            const results = await downloadImages(taskObj, { delayMs: 0 });

            expect(results).toHaveLength(1);
            expect(results[0].success).toBe(true);
            expect(fs.existsSync(taskObj['https://example.com/x.jpg'])).toBe(true);
        });

        it('returns empty array when task list is empty', async () => {
            const results = await downloadImages([]);
            expect(results).toEqual([]);
        });
    });
});
