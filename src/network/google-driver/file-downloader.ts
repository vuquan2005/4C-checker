/**
 * File Downloader & Batch Coordinator
 * Streams binaries to disk with atomic rename, handles virus scan tokens,
 * concurrency queueing, and zip auto-extraction.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { ensureDir, extractZipArchive } from '../../utils/file-utils.js';
import { createLogger } from '../../utils/logger.js';
import { parseGDriveUrl } from './url-parser.js';
import { resolveTargetFiles } from './tree-resolver.js';
import {
    type GDriveDownloadOptions,
    type GDriveDownloadResult,
    DEFAULT_USER_AGENT,
} from './types.js';

const logger = createLogger('GDriveDownloader');

/**
 * Tải một file đơn từ Google Drive bằng stream trực tiếp xuống ổ đĩa
 */
export async function downloadGDriveFile(
    fileId: string,
    fileName: string,
    destPath: string,
    options: GDriveDownloadOptions = {}
): Promise<{ sizeBytes: number; skipped?: boolean }> {
    const { skipIfExists = true, timeoutMs = 30000, autoExtractZip = true } = options;

    if (skipIfExists && fs.existsSync(destPath)) {
        const stat = fs.statSync(destPath);
        if (stat.size > 0) {
            return { sizeBytes: stat.size, skipped: true };
        }
    }

    ensureDir(path.dirname(destPath));

    const downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        let res = await fetch(downloadUrl, {
            headers: { 'User-Agent': DEFAULT_USER_AGENT },
            signal: controller.signal,
        });

        // Xử lý cảnh báo quét virus với file lớn (> 100MB)
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/html')) {
            const html = await res.text();
            const confirmMatch = html.match(/confirm=([0-9A-Za-z_-]+)/);
            if (confirmMatch) {
                const confirmToken = confirmMatch[1];
                const confirmUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirmToken}`;
                res = await fetch(confirmUrl, {
                    headers: { 'User-Agent': DEFAULT_USER_AGENT },
                    signal: controller.signal,
                });
            } else {
                throw new Error(
                    `Google Drive returned HTML instead of binary (file may be private or restricted)`
                );
            }
        }

        if (!res.ok) {
            throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }

        if (!res.body) {
            throw new Error('Response body is empty');
        }

        // Tải vào file tạm thời rồi rename để đảm bảo nguyên tử (atomic write)
        const tempPath = `${destPath}.tmp_${Date.now()}`;
        const fileStream = fs.createWriteStream(tempPath);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await pipeline(Readable.fromWeb(res.body as any), fileStream);

        fs.renameSync(tempPath, destPath);
        const stat = fs.statSync(destPath);

        // Nếu file tải về là .zip và bật autoExtractZip -> tự động giải nén
        if (autoExtractZip && path.extname(destPath).toLowerCase() === '.zip') {
            try {
                const targetDir = path.dirname(destPath);
                extractZipArchive(destPath, targetDir, true);
                logger.i(`Đã tự động giải nén "${fileName}" vào ${targetDir}`);
            } catch (err) {
                logger.w(`Không thể giải nén zip "${fileName}": ${(err as Error).message}`);
            }
        }

        return { sizeBytes: stat.size, skipped: false };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Tải toàn bộ bài nộp Google Drive (File hoặc Folder lồng nhau) vào thư mục chỉ định
 */
export async function downloadGDriveSubmission(
    url: string,
    destDir: string,
    options: GDriveDownloadOptions = {}
): Promise<GDriveDownloadResult> {
    const parsed = parseGDriveUrl(url);
    if (!parsed) {
        return {
            success: false,
            downloadedFiles: [],
            skippedFiles: [],
            failedFiles: [],
            totalBytes: 0,
            warnings: [`URL không hợp lệ hoặc không phải định dạng Google Drive: "${url}"`],
        };
    }

    ensureDir(destDir);

    const { concurrency = 2, delayMs = 300, onProgress } = options;

    const downloadedFiles: string[] = [];
    const skippedFiles: string[] = [];
    const failedFiles: { name: string; error: string }[] = [];
    let totalBytes = 0;
    const warnings: string[] = [];

    // Trường hợp 1: Link là File đơn lẻ (ví dụ .zip hoặc .ipt trực tiếp)
    if (parsed.type === 'file') {
        const fileName = `submission_${parsed.id}.zip`;
        const destPath = path.join(destDir, fileName);

        try {
            const dlRes = await downloadGDriveFile(parsed.id, fileName, destPath, options);
            totalBytes += dlRes.sizeBytes;
            if (dlRes.skipped) {
                skippedFiles.push(destPath);
            } else {
                downloadedFiles.push(destPath);
            }
            if (onProgress) onProgress(1, 1, fileName);

            return {
                success: true,
                downloadedFiles,
                skippedFiles,
                failedFiles,
                totalBytes,
                warnings,
            };
        } catch (err) {
            return {
                success: false,
                downloadedFiles: [],
                skippedFiles: [],
                failedFiles: [{ name: fileName, error: (err as Error).message }],
                totalBytes: 0,
                warnings: [(err as Error).message],
            };
        }
    }

    // Trường hợp 2: Link là Folder hoặc Unknown -> Phân giải cây thư mục
    const resolved = await resolveTargetFiles(parsed.id, options);
    warnings.push(...resolved.warnings);

    if (!resolved.files.length) {
        return {
            success: false,
            matchedFolder: resolved.matchedFolderName,
            downloadedFiles: [],
            skippedFiles: [],
            failedFiles: [],
            totalBytes: 0,
            warnings,
        };
    }

    // Hàng đợi tải song song với Worker Pool
    const totalFiles = resolved.files.length;
    let completedCount = 0;
    const queue = [...resolved.files];

    async function worker() {
        while (queue.length > 0) {
            const item = queue.shift();
            if (!item) break;

            const destPath = path.join(destDir, item.name);

            try {
                const res = await downloadGDriveFile(item.id, item.name, destPath, options);
                totalBytes += res.sizeBytes;
                if (res.skipped) {
                    skippedFiles.push(destPath);
                } else {
                    downloadedFiles.push(destPath);
                }
            } catch (err) {
                failedFiles.push({ name: item.name, error: (err as Error).message });
            } finally {
                completedCount++;
                if (onProgress) {
                    onProgress(completedCount, totalFiles, item.name);
                }
            }

            if (delayMs > 0 && queue.length > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }

    const workerCount = Math.min(concurrency, totalFiles);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return {
        success: downloadedFiles.length > 0 || skippedFiles.length > 0,
        matchedFolder: resolved.matchedFolderName,
        downloadedFiles,
        skippedFiles,
        failedFiles,
        totalBytes,
        warnings,
    };
}
