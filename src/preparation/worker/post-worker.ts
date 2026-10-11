/**
 * Post Ingestion Worker
 * Processes an individual post:
 * 1. Prepares user and post folder structure
 * 2. Downloads forum BBCode images into `student_images/`
 * 3. Downloads Google Drive submissions into `drive_files/`
 * 4. Parses CAD metadata and extracts 3D previews into `cad_previews/`
 * 5. Generates and saves `post.json`
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
    ThreadPostRecord,
    PostSnapshot,
    PostData,
    ForumImageDownloadSummary,
    DriveDownloadSummary,
    CadFileSummary,
} from '../types/manifest.js';
import { ensureDir, findFilesByExtension } from '../../utils/file-utils.js';
import { readImageDimensions } from '../../utils/image-utils.js';
import { downloadImages } from '../../network/image-downloader.js';
import { downloadGDriveSubmission } from '../../network/google-driver/index.js';
import { parseCadMetadata } from '../../cad/ole-parser.js';
import { savePreviewToFile } from '../../cad/preview-extractor.js';
import { resolveSession } from '../utils/session-resolver.js';
import { DEFAULT_SESSION_KEYWORDS } from '../../config/config-manager.js';

export interface PostWorkerOptions {
    /** Whether to download forum BBCode images (default: true) */
    downloadImages?: boolean;

    /** Whether to download Google Drive project files (default: true) */
    downloadDrive?: boolean;

    /** Whether to scan and extract CAD metadata & previews (default: true) */
    extractCad?: boolean;

    /** Force re-download even if already present locally (default: false) */
    force?: boolean;

    /** Whitelist file extensions allowed for download from Drive */
    allowedExtensions?: string[];

    /** Custom session keyword patterns */
    sessionKeywords?: string[];
}

export interface PostWorkerResult {
    /** Generated post data */
    summary: PostData;

    /** Absolute path to post directory */
    postDir: string;

    /** Absolute path to post.json */
    summaryPath: string;

    /** Updated ThreadPostRecord reflecting the ingested version */
    record: ThreadPostRecord;
}

/**
 * Process a single forum post snapshot, downloading its assets and generating `post.json`
 */
export async function processPost(
    dataDir: string,
    threadId: string,
    record: ThreadPostRecord,
    snapshot?: PostSnapshot,
    options?: PostWorkerOptions
): Promise<PostWorkerResult> {
    // Default to the latest snapshot in history if not specified
    const targetSnapshot = snapshot || record.history[record.history.length - 1];

    // 1. Setup folder paths
    const postDir = path.join(dataDir, threadId, record.userFolder, record.postFolder);
    const imagesDir = path.join(postDir, 'student_images');
    const driveDir = path.join(postDir, 'drive_files');
    const cadPreviewsDir = path.join(postDir, 'cad_previews');

    ensureDir(postDir);
    ensureDir(imagesDir);
    ensureDir(driveDir);
    ensureDir(cadPreviewsDir);

    // 2. Download forum BBCode images
    const forumImages: ForumImageDownloadSummary[] = [];
    const shouldDownloadImages = options?.downloadImages !== false;

    if (shouldDownloadImages && targetSnapshot.imageUrls.length > 0) {
        const usedFileNames = new Set<string>();
        const tasks = targetSnapshot.imageUrls.map((url, idx) => {
            let fileName = `img_${String(idx + 1).padStart(2, '0')}`;
            try {
                const parsedUrl = new URL(url);
                const ext = path.extname(parsedUrl.pathname) || '.png';
                const base = path.basename(parsedUrl.pathname, ext);
                fileName = base ? `${base}${ext}` : `${fileName}${ext}`;
            } catch {
                fileName = `${fileName}.png`;
            }

            const parsedName = path.parse(fileName);
            let uniqueFileName = fileName;
            let duplicateIndex = 2;
            while (usedFileNames.has(uniqueFileName)) {
                uniqueFileName = `${parsedName.name}_${String(duplicateIndex).padStart(2, '0')}${parsedName.ext}`;
                duplicateIndex++;
            }
            usedFileNames.add(uniqueFileName);

            return {
                url,
                destPath: path.join(imagesDir, uniqueFileName),
            };
        });

        const downloadResults = await downloadImages(tasks, {
            skipIfExists: !options?.force,
        });

        for (const item of downloadResults) {
            let width: number | undefined;
            let height: number | undefined;
            if (item.success && item.destPath && fs.existsSync(item.destPath)) {
                const dims = readImageDimensions(item.destPath);
                if (dims) {
                    width = dims.width;
                    height = dims.height;
                }
            }
            forumImages.push({
                originalUrl: item.url,
                localPath: item.destPath ? path.relative(postDir, item.destPath) : undefined,
                fileName: item.destPath ? path.basename(item.destPath) : undefined,
                fileSizeBytes: item.sizeBytes,
                width,
                height,
                status: item.success ? 'downloaded' : 'failed',
                error: item.error,
            });
        }
    }

    // 3. Download Google Drive submission
    let driveSummary: DriveDownloadSummary;
    const shouldDownloadDrive = options?.downloadDrive !== false;

    const driveUrl = targetSnapshot.links.find(
        (link) => link.includes('drive.google.com') || link.includes('docs.google.com')
    );
    const session = resolveSession(
        targetSnapshot.plainText,
        record.inferredSession,
        record.sessionOverride,
        options?.sessionKeywords
    );
    const { warnings: sessionWarnings, ...sessionFields } = session;
    Object.assign(record, sessionFields, { sessionWarnings });
    const sessionIndex = session.sessionIndex;

    if (shouldDownloadDrive && driveUrl) {
        try {
            const sessionKeywordsList =
                options?.sessionKeywords && options.sessionKeywords.length > 0
                    ? options.sessionKeywords
                    : DEFAULT_SESSION_KEYWORDS;

            const driveKeywords =
                sessionIndex === undefined
                    ? undefined
                    : [
                          ...new Set(
                              sessionKeywordsList.flatMap((kw) => [
                                  `${kw} ${sessionIndex}`,
                                  `${kw}${sessionIndex}`,
                              ])
                          ),
                      ];

            const gdriveRes = await downloadGDriveSubmission(driveUrl, driveDir, {
                incremental: !options?.force,
                skipIfExists: !options?.force,
                autoExtractZip: true,
                allowedExtensions: options?.allowedExtensions,
                keywords: driveKeywords,
            });

            const allFiles = [
                ...gdriveRes.downloadedFiles,
                ...(gdriveRes.updatedFiles || []),
                ...gdriveRes.skippedFiles,
            ];

            driveSummary = {
                driveUrl,
                status: gdriveRes.success ? 'downloaded' : 'failed',
                localDir: path.relative(postDir, driveDir),
                totalFiles: allFiles.length,
                downloadedFiles: allFiles.map((f) => path.relative(postDir, f)),
                error: gdriveRes.warnings.length > 0 ? gdriveRes.warnings.join('; ') : undefined,
            };
        } catch (err) {
            driveSummary = {
                driveUrl,
                status: 'failed',
                localDir: path.relative(postDir, driveDir),
                totalFiles: 0,
                downloadedFiles: [],
                error: (err as Error).message,
            };
        }
    } else if (driveUrl) {
        driveSummary = {
            driveUrl,
            status: 'skipped',
            localDir: path.relative(postDir, driveDir),
            totalFiles: 0,
            downloadedFiles: [],
        };
    } else {
        driveSummary = {
            status: 'not_found',
            totalFiles: 0,
            downloadedFiles: [],
        };
    }

    // 4. Scan CAD files & extract 3D previews
    const cadSummaries: CadFileSummary[] = [];
    const shouldExtractCad = options?.extractCad !== false;

    if (shouldExtractCad && fs.existsSync(driveDir)) {
        const cadFilePaths = findFilesByExtension(driveDir, ['.ipt', '.iam', '.ipn']);

        for (const cadFilePath of cadFilePaths) {
            try {
                const metadata = parseCadMetadata(cadFilePath);
                let previewPath: string | undefined;

                if (metadata.hasPreview) {
                    const parsedName = path.parse(cadFilePath).name;
                    const previewOut = path.join(cadPreviewsDir, `${parsedName}.png`);

                    const saved = savePreviewToFile(cadFilePath, previewOut);
                    if (saved) {
                        previewPath = path.relative(postDir, previewOut);
                    }
                }

                cadSummaries.push({
                    ...metadata,
                    localPath: path.relative(postDir, cadFilePath),
                    previewPath,
                });
            } catch {
                // If a file is unreadable or corrupted, record basic fallback
                cadSummaries.push({
                    filePath: cadFilePath,
                    fileName: path.basename(cadFilePath),
                    fileExtension: path.extname(cadFilePath).toLowerCase(),
                    fileSizeBytes: fs.statSync(cadFilePath).size,
                    hasPreview: false,
                    rseSegmentIds: [],
                    localPath: path.relative(postDir, cadFilePath),
                });
            }
        }
    }

    // 5. Construct PostData
    const summary: PostData = {
        postId: record.postId,
        postNumber: record.postNumber,
        sessionIndex,
        declaredSession: session.declaredSession,
        inferredSession: session.inferredSession,
        sessionOverride: session.sessionOverride ?? null,
        sessionSource: session.sessionSource,
        forumStatus: record.forumStatus,
        postUrl: record.postUrl,
        author: { ...record.author },
        postDate: record.postDate,
        editedInfo: targetSnapshot.editedInfo ? { ...targetSnapshot.editedInfo } : undefined,
        currentVersion: targetSnapshot.version,
        syncedAt: new Date().toISOString(),
        userFolder: record.userFolder,
        postFolder: record.postFolder,
        skipProcessing: record.skipProcessing,
        skipReason: record.skipReason,
        forumImages,
        driveFiles: driveSummary,
        cadSummaries,
        warnings: [...new Set([...targetSnapshot.warnings, ...sessionWarnings])],
    };

    // 6. Save post.json
    const summaryPath = path.join(postDir, 'post.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

    // 7. Update record status
    record.current = targetSnapshot.version;
    record.syncStatus = 'synced';
    record.lastSyncedAt = new Date().toISOString();

    return {
        summary,
        postDir,
        summaryPath,
        record,
    };
}
