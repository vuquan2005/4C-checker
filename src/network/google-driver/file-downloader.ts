/**
 * File Downloader & Batch Coordinator
 * Streams binaries to disk with atomic rename, handles virus scan tokens,
 * concurrency queueing, and zip auto-extraction.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { ensureDir, extractArchive, archiveOldFile } from '../../utils/file-utils.js';
import { createLogger } from '../../utils/logger.js';
import { parseGDriveUrl } from './url-parser.js';
import {
    resolveTargetFiles,
    fetchSubmissionMetadata,
    diffSubmissionManifest,
} from './tree-resolver.js';
import { detectHtmlAccessStatus, GDriveAccessError } from './folder-provider.js';
import {
    type GDriveDownloadOptions,
    type GDriveDownloadResult,
    type GDriveItem,
    type GDriveSubmissionMetadata,
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

        // Xử lý cảnh báo quét virus với file lớn (> 100MB) hoặc trang HTML báo lỗi phân quyền
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
                const accessCheck = detectHtmlAccessStatus(html, res.url, res.status);
                if (accessCheck.status === 'restricted') {
                    throw new GDriveAccessError(
                        accessCheck.reason ||
                            'Tệp bị hạn chế quyền truy cập (Học viên chưa bật "Bất kỳ ai có liên kết đều có thể xem")',
                        'restricted',
                        res.status
                    );
                }
                if (accessCheck.status === 'not_found') {
                    throw new GDriveAccessError(
                        accessCheck.reason || 'Tệp không tồn tại hoặc đã bị xóa trên Google Drive',
                        'not_found',
                        res.status
                    );
                }
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

        // Detect the archive signature because Drive files are sometimes mislabeled as .zip.
        const archiveExtensions = new Set(['.zip', '.rar']);
        if (autoExtractZip && archiveExtensions.has(path.extname(destPath).toLowerCase())) {
            try {
                const targetDir = path.dirname(destPath);
                const archiveType = await extractArchive(destPath, targetDir, true);
                logger.i(
                    `Đã tự động giải nén ${archiveType.toUpperCase()} "${fileName}" vào ${targetDir}`
                );
            } catch (err) {
                logger.w(`Không thể giải nén archive "${fileName}": ${(err as Error).message}`);
            }
        }

        return { sizeBytes: stat.size, skipped: false };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Tải toàn bộ bài nộp Google Drive (File hoặc Folder lồng nhau) vào thư mục chỉ định.
 * Hỗ trợ đồng bộ vi sai (Incremental Sync) thông qua .gdrive-manifest.json và nhận diện phân quyền.
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
            accessStatus: 'invalid_url',
            downloadedFiles: [],
            skippedFiles: [],
            failedFiles: [],
            totalBytes: 0,
            warnings: ['DRIVE_INVALID_URL'],
        };
    }

    ensureDir(destDir);

    const {
        concurrency = 2,
        delayMs = 300,
        onProgress,
        incremental = true,
        archiveOldVersions = true,
        backupDirName = '_history',
    } = options;

    const manifestPath = options.manifestPath || path.join(destDir, '.gdrive-manifest.json');

    // Trường hợp 1: Link là File đơn lẻ (ví dụ .zip hoặc .ipt trực tiếp)
    if (parsed.type === 'file') {
        const fileName = `submission_${parsed.id}.zip`;
        const destPath = path.join(destDir, fileName);

        try {
            const dlRes = await downloadGDriveFile(parsed.id, fileName, destPath, options);
            const downloadedFiles: string[] = [];
            const skippedFiles: string[] = [];
            if (dlRes.skipped) {
                skippedFiles.push(destPath);
            } else {
                downloadedFiles.push(destPath);
            }
            if (onProgress) onProgress(1, 1, fileName);

            const manifest: GDriveSubmissionMetadata = {
                url,
                type: 'file',
                accessStatus: 'public',
                fetchedAt: new Date().toISOString(),
                files: [
                    {
                        id: parsed.id,
                        name: fileName,
                        sizeBytes: dlRes.sizeBytes,
                    },
                ],
                totalFiles: 1,
                totalBytes: dlRes.sizeBytes,
                warnings: [],
            };

            if (incremental) {
                try {
                    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
                } catch (err) {
                    logger.w(`Không thể lưu file manifest: ${(err as Error).message}`);
                }
            }

            return {
                success: true,
                accessStatus: 'public',
                hasChanges: !dlRes.skipped,
                downloadedFiles,
                skippedFiles,
                failedFiles: [],
                totalBytes: dlRes.sizeBytes,
                warnings: [],
                manifest,
            };
        } catch (err) {
            const accessStatus = err instanceof GDriveAccessError ? err.status : 'restricted';
            return {
                success: false,
                accessStatus,
                downloadedFiles: [],
                skippedFiles: [],
                failedFiles: [{ name: fileName, error: (err as Error).message }],
                totalBytes: 0,
                warnings: [
                    accessStatus === 'not_found' ? 'DRIVE_NOT_FOUND' : 'DRIVE_ACCESS_DENIED',
                ],
            };
        }
    }

    // Trường hợp 2: Link là Folder hoặc Unknown
    if (incremental) {
        const metadata = await fetchSubmissionMetadata(url, options);

        // 1. Kiểm tra quyền truy cập (Restricted / Not Found)
        if (metadata.accessStatus !== 'public') {
            const warningCode =
                metadata.accessStatus === 'restricted'
                    ? 'DRIVE_ACCESS_DENIED'
                    : metadata.accessStatus === 'not_found'
                      ? 'DRIVE_NOT_FOUND'
                      : 'DRIVE_INVALID_URL';

            return {
                success: false,
                accessStatus: metadata.accessStatus,
                matchedFolder: metadata.targetFolderName,
                downloadedFiles: [],
                updatedFiles: [],
                skippedFiles: [],
                failedFiles: [],
                totalBytes: 0,
                warnings: metadata.warnings.length > 0 ? metadata.warnings : [warningCode],
                manifest: metadata,
            };
        }

        // 2. Kiểm tra nếu thư mục không có file hợp lệ
        if (metadata.files.length === 0) {
            return {
                success: false,
                accessStatus: 'public',
                matchedFolder: metadata.targetFolderName,
                downloadedFiles: [],
                updatedFiles: [],
                skippedFiles: [],
                failedFiles: [],
                totalBytes: 0,
                warnings: metadata.warnings.length > 0 ? metadata.warnings : ['DRIVE_NO_CAD_FILES'],
                manifest: metadata,
            };
        }

        // 3. So khớp với Manifest phiên bản cũ đã lưu trước đó (nếu có)
        let oldManifest = null;
        if (fs.existsSync(manifestPath)) {
            try {
                oldManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            } catch {
                logger.w(
                    `File manifest cũ tại ${manifestPath} bị lỗi format, sẽ tải lại và tạo mới.`
                );
            }
        }

        const diff = diffSubmissionManifest(oldManifest, metadata);

        // Kiểm tra xem các file unchanged có thực sự tồn tại trên ổ đĩa không
        const existingUnchangedPaths: string[] = [];
        const missingUnchangedItems: GDriveItem[] = [];

        for (const item of diff.unchanged) {
            const localPath = path.join(destDir, item.name);
            if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
                existingUnchangedPaths.push(localPath);
            } else {
                missingUnchangedItems.push(item);
            }
        }

        // Nếu hoàn toàn không có thay đổi và các file cục bộ đều nguyên vẹn
        if (!diff.hasChanges && missingUnchangedItems.length === 0) {
            logger.i(`Tất cả file đều đã đồng bộ và không có thay đổi trên Drive. Bỏ qua tải.`);
            return {
                success: true,
                accessStatus: 'public',
                matchedFolder: metadata.targetFolderName,
                hasChanges: false,
                downloadedFiles: [],
                updatedFiles: [],
                skippedFiles: existingUnchangedPaths,
                failedFiles: [],
                totalBytes: 0,
                warnings: metadata.warnings,
                manifest: metadata,
            };
        }

        // Tạo hàng đợi tải: gồm file mới (added), file bị sửa đổi (modified) và file bị thiếu cục bộ
        const modifiedSet = new Set(diff.modified.map((m) => m.id));
        const queue: Array<GDriveItem & { isModified?: boolean }> = [
            ...diff.added,
            ...diff.modified.map((m) => ({ ...m, isModified: true })),
            ...missingUnchangedItems,
        ];

        const downloadedFiles: string[] = [];
        const updatedFiles: string[] = [];
        const archivedFiles: Array<{ originalPath: string; archivedPath: string }> = [];
        const skippedFiles: string[] = [...existingUnchangedPaths];
        const failedFiles: { name: string; error: string; code?: string }[] = [];
        let totalBytes = 0;
        const totalFiles = queue.length;
        let completedCount = 0;

        async function worker() {
            while (queue.length > 0) {
                const item = queue.shift();
                if (!item) break;

                const destPath = path.join(destDir, item.name);
                const isModified = Boolean(item.isModified || modifiedSet.has(item.id));

                try {
                    // Nếu là file bị sửa đổi và file cũ đang tồn tại trên ổ đĩa -> sao lưu sang thư mục backup trước
                    if (isModified && fs.existsSync(destPath) && archiveOldVersions !== false) {
                        const backupDir = path.join(destDir, backupDirName);
                        const previousStat = fs.statSync(destPath);
                        const archivedPath = archiveOldFile(destPath, backupDir);
                        if (archivedPath) {
                            archivedFiles.push({
                                originalPath: destPath,
                                archivedPath,
                            });
                            logger.i(
                                `Đã sao lưu phiên bản cũ của "${item.name}" sang "${path.relative(destDir, archivedPath)}"`
                            );
                            if (!metadata.history) {
                                metadata.history = [];
                            }
                            metadata.history.push({
                                fileName: item.name,
                                archivedPath: path.relative(destDir, archivedPath),
                                archivedAt: new Date().toISOString(),
                                previousSizeBytes: previousStat.size,
                            });
                        }
                    }

                    // Tải bản mới (với file bị sửa đổi thì skipIfExists = false)
                    const res = await downloadGDriveFile(item.id, item.name, destPath, {
                        ...options,
                        skipIfExists: !isModified && options.skipIfExists !== false,
                    });
                    totalBytes += res.sizeBytes;
                    if (res.skipped) {
                        skippedFiles.push(destPath);
                    } else if (isModified) {
                        updatedFiles.push(destPath);
                    } else {
                        downloadedFiles.push(destPath);
                    }
                } catch (err) {
                    const error = err as Error;
                    const code =
                        err instanceof GDriveAccessError
                            ? err.status
                            : (err as { code?: string })?.code;
                    failedFiles.push({
                        name: item.name,
                        error: error.message,
                        code,
                    });
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

        // Giữ lại lịch sử lưu trữ từ manifest cũ (nếu có)
        if (oldManifest && Array.isArray((oldManifest as { history?: unknown[] }).history)) {
            const previousHistory =
                (oldManifest as { history: typeof metadata.history }).history || [];
            metadata.history = [...previousHistory, ...(metadata.history || [])];
        }

        // Lưu manifest snapshot mới sau khi tải/đồng bộ thành công
        if (downloadedFiles.length > 0 || updatedFiles.length > 0 || skippedFiles.length > 0) {
            try {
                fs.writeFileSync(manifestPath, JSON.stringify(metadata, null, 2), 'utf8');
            } catch (err) {
                logger.w(`Không thể lưu file manifest: ${(err as Error).message}`);
            }
        }

        return {
            success:
                downloadedFiles.length > 0 || updatedFiles.length > 0 || skippedFiles.length > 0,
            accessStatus: 'public',
            matchedFolder: metadata.targetFolderName,
            hasChanges: downloadedFiles.length > 0 || updatedFiles.length > 0,
            downloadedFiles,
            updatedFiles,
            archivedFiles,
            skippedFiles,
            failedFiles,
            totalBytes,
            warnings: metadata.warnings,
            manifest: metadata,
        };
    }

    // Trường hợp không dùng incremental (incremental = false)
    const resolved = await resolveTargetFiles(parsed.id, options);
    const warnings: string[] = [...resolved.warnings];

    if (resolved.accessStatus !== 'public' || !resolved.files.length) {
        return {
            success: false,
            accessStatus: resolved.accessStatus,
            matchedFolder: resolved.matchedFolderName,
            downloadedFiles: [],
            skippedFiles: [],
            failedFiles: [],
            totalBytes: 0,
            warnings,
        };
    }

    const downloadedFiles: string[] = [];
    const skippedFiles: string[] = [];
    const failedFiles: { name: string; error: string }[] = [];
    let totalBytes = 0;
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
        accessStatus: 'public',
        matchedFolder: resolved.matchedFolderName,
        downloadedFiles,
        skippedFiles,
        failedFiles,
        totalBytes,
        warnings,
    };
}
