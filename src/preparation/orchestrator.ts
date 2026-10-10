/**
 * Thread Sync Pipeline Orchestrator
 * Coordinates the entire data preparation pipeline for a forum thread:
 * 1. Fetches/loads all thread posts from MyBB
 * 2. Synchronizes posts into `thread.json` manifest (delta & history tracking)
 * 3. Identifies new/outdated posts and executes `post-worker` in parallel
 * 4. Recalculates stats and updates final manifest state
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RawForumPost } from '../types/post.js';
import type { PostData, ThreadManifest, ThreadPostRecord } from './types/manifest.js';
import {
    loadThreadManifest,
    createEmptyManifest,
    syncThreadPostsIntoManifest,
    saveThreadManifest,
    recalculateManifestStats,
} from './manifest/manifest-manager.js';
import { processPost, type PostWorkerOptions } from './worker/post-worker.js';
import { fetchAllThreadPages } from '../network/mybb-client.js';
import { parseThreadPosts } from '../parser/thread-parser.js';
import { getMyBbCookie } from '../env.js';
import { withLogContext } from '../utils/logger.js';
import {
    ensureThreadConfig,
    loadThreadConfig,
    getThreadConfigPath,
    setThreadConfigSessionOverride,
    isPostIgnored,
    type ThreadConfig,
    type IgnoreConfig,
} from '../config/index.js';

export interface ThreadSyncProgressEvent {
    type:
        | 'fetch_start'
        | 'fetch_page'
        | 'posts_parsed'
        | 'manifest_updated'
        | 'post_start'
        | 'post_done'
        | 'completed';
    message: string;
    completed?: number;
    total?: number;
    post?: ThreadPostRecord;
}

export interface ThreadSyncOptions extends PostWorkerOptions {
    /** Data directory path (default: './data') */
    dataDir?: string;

    /** Only update manifest metadata and history without downloading assets (default: false) */
    metadataOnly?: boolean;

    /** Only process a specific post ID */
    targetPostId?: string;

    /** Ignore the first post (Thread Starter / OP) (default: true) */
    ignoreOp?: boolean;

    /** Concurrency limit for post asset downloads (default: 2) */
    concurrency?: number;

    /** Custom HTML string to parse directly instead of fetching from MyBB */
    htmlContent?: string;

    /** Custom path to config.json */
    configPath?: string;

    /** Loaded ThreadConfig or partial override */
    config?: ThreadConfig;

    /** Progress callback */
    onProgress?: (event: ThreadSyncProgressEvent) => void;

    /** Resolve a declared/inferred session conflict before processing a post. */
    onSessionConflict?: (
        record: ThreadPostRecord,
        declaredSession: number,
        inferredSession: number
    ) => number | undefined | Promise<number | undefined>;
}

export interface ThreadSyncSummary {
    threadId: string;
    manifest: ThreadManifest;
    totalDiscoveredPosts: number;
    newPostsCount: number;
    editedPostsCount: number;
    unchangedPostsCount: number;
    processedPostsCount: number;
    failedPostsCount: number;
    durationMs: number;
}

/** Whether a post must be excluded from asset processing (via manifest state or config ignore rules) */
export function isPostProcessingSkipped(
    dataDirOrRecord: string | ThreadPostRecord,
    threadIdOrIgnore?: string | IgnoreConfig,
    recordOrIgnore?: ThreadPostRecord | IgnoreConfig,
    ignoreConfigParam?: IgnoreConfig
): boolean {
    const record =
        typeof dataDirOrRecord === 'object'
            ? dataDirOrRecord
            : (recordOrIgnore as ThreadPostRecord);
    const ignoreConfig =
        typeof threadIdOrIgnore === 'object'
            ? (threadIdOrIgnore as IgnoreConfig)
            : ignoreConfigParam;

    if (!record) return false;
    if (record.skipProcessing === true) return true;
    if (ignoreConfig && isPostIgnored(record, ignoreConfig).ignored) return true;
    return false;
}

/**
 * Checks whether an already-synced post has an incomplete or failed asset summary.
 * This lets normal sync repair previous failures without forcing every post.
 */
export function needsPostAssetReprocessing(
    dataDir: string,
    threadId: string,
    record: ThreadPostRecord
): boolean {
    if (isPostProcessingSkipped(dataDir, threadId, record)) return false;

    const postDataPath = path.join(
        dataDir,
        threadId,
        record.userFolder,
        record.postFolder,
        'post.json'
    );
    const legacyPath = path.join(path.dirname(postDataPath), 'post_summary.json');
    const dataPath = fs.existsSync(postDataPath) ? postDataPath : legacyPath;

    if (record.forumStatus === 'deleted') return false;
    if (!fs.existsSync(dataPath)) return true;

    let summary: Partial<PostData>;
    try {
        summary = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as Partial<PostData>;
    } catch {
        return true;
    }

    if (summary.skipProcessing === true) return false;

    if (summary.postId !== record.postId) return true;
    if (summary.currentVersion !== record.current) return true;
    if (summary.sessionIndex !== record.sessionIndex) return true;
    const summarySessionOverride = summary.sessionOverride ?? undefined;
    if (summarySessionOverride !== record.sessionOverride) return true;
    if (!summary.driveFiles) return true;

    const imagePaths = (summary.forumImages || [])
        .map((image) => image.localPath)
        .filter((localPath): localPath is string => Boolean(localPath));
    if (new Set(imagePaths).size !== imagePaths.length) return true;

    const hasDriveLink = record.history[record.current - 1]?.links.some(
        (link) => link.includes('drive.google.com') || link.includes('docs.google.com')
    );
    if (hasDriveLink && ['failed', 'not_found'].includes(summary.driveFiles.status)) {
        return true;
    }

    return summary.forumImages?.some((image) => image.status === 'failed') ?? false;
}

/**
 * Execute the full synchronization and data preparation pipeline for a forum thread
 */
export async function syncThread(
    threadId: string,
    options: ThreadSyncOptions = {}
): Promise<ThreadSyncSummary> {
    const startTime = Date.now();
    const dataDir = options.dataDir
        ? path.resolve(process.cwd(), options.dataDir)
        : path.resolve(process.cwd(), 'data');

    // 0. Load thread configuration or defaults
    const threadConfig =
        options.config ||
        loadThreadConfig({
            dataDir,
            threadId,
            customPath: options.configPath,
        });

    const prepConfig = threadConfig.prepare || {};
    const ignoreConfig: IgnoreConfig = { ...(prepConfig.ignore || {}) };

    if (options.ignoreOp !== undefined) {
        ignoreConfig.ignoreOp = options.ignoreOp;
    }

    const concurrency = Math.max(1, options.concurrency ?? prepConfig.network?.concurrency ?? 2);
    const ignoreOp = ignoreConfig.ignoreOp !== false;
    const downloadImages =
        options.downloadImages !== undefined
            ? options.downloadImages
            : prepConfig.network?.downloadImages !== false;
    const downloadDrive =
        options.downloadDrive !== undefined
            ? options.downloadDrive
            : prepConfig.network?.downloadDrive !== false;
    const extractCad =
        options.extractCad !== undefined
            ? options.extractCad
            : prepConfig.network?.extractCad !== false;
    const allowedExtensions = options.allowedExtensions ?? prepConfig.drive?.allowedExtensions;
    const sessionKeywords = options.sessionKeywords ?? prepConfig.session?.keywords;
    const sessionOverrides = { ...(prepConfig.session?.overrides || {}) };

    // 1. Fetch and parse forum posts
    let allPosts: RawForumPost[];

    if (options.htmlContent) {
        options.onProgress?.({
            type: 'posts_parsed',
            message: 'Parsing posts from provided HTML content...',
        });
        allPosts = parseThreadPosts(options.htmlContent);
    } else {
        options.onProgress?.({
            type: 'fetch_start',
            message: `Fetching thread #${threadId} from forum...`,
        });

        const cookie = getMyBbCookie();
        const pages = await fetchAllThreadPages(threadId, {
            cookie: cookie || undefined,
        });

        const postMap = new Map<string, RawForumPost>();
        for (const page of pages) {
            const pagePosts = parseThreadPosts(page.html);
            for (const p of pagePosts) {
                if (!postMap.has(p.postId)) {
                    postMap.set(p.postId, p);
                }
            }
        }
        allPosts = Array.from(postMap.values());
    }

    // Filter OP if requested
    if (ignoreOp) {
        allPosts = allPosts.filter((p) => p.postNumber !== 1);
    }

    // Filter by specific post ID if specified
    if (options.targetPostId) {
        const target = options.targetPostId.replace(/^#/, '').trim();
        allPosts = allPosts.filter(
            (p) => p.postId === target || p.postNumber.toString() === target
        );
    }

    options.onProgress?.({
        type: 'posts_parsed',
        message: `Parsed ${allPosts.length} submissions from thread.`,
        total: allPosts.length,
    });

    // 2. Load existing or initialize new manifest
    const manifest = loadThreadManifest(dataDir, threadId) || createEmptyManifest(threadId);

    // 3. Sync posts into manifest (detecting new vs edited vs unchanged)
    const syncDiff = syncThreadPostsIntoManifest(manifest, allPosts, {
        markMissing: !options.targetPostId,
        dataDir,
        ignoreConfig,
        sessionKeywords,
        sessionOverrides,
    });

    // Persist manifest state immediately
    saveThreadManifest(dataDir, manifest);

    options.onProgress?.({
        type: 'manifest_updated',
        message: `Manifest updated: ${syncDiff.newPosts.length} new, ${syncDiff.editedPosts.length} edited, ${syncDiff.unchangedPosts.length} unchanged.`,
    });

    let processedCount = 0;
    let failedCount = 0;

    // 4. Asset ingestion via post-worker (unless metadataOnly is enabled)
    if (!options.metadataOnly && allPosts.length > 0) {
        // Determine candidate posts that need asset processing
        const candidatePostIds = new Set<string>();

        if (options.force) {
            for (const p of allPosts) candidatePostIds.add(p.postId);
        } else {
            // New posts need ingestion
            for (const p of syncDiff.newPosts) candidatePostIds.add(p.postId);

            // Edited posts with changes need ingestion
            for (const e of syncDiff.editedPosts) {
                if (e.hasLinkChanges || e.hasImageChanges) {
                    candidatePostIds.add(e.post.postId);
                }
            }

            // Any post in manifest still in pending or outdated state
            for (const rec of Object.values(manifest.posts)) {
                if (rec.syncStatus === 'pending' || rec.syncStatus === 'outdated') {
                    candidatePostIds.add(rec.postId);
                }
                if (needsPostAssetReprocessing(dataDir, threadId, rec)) {
                    candidatePostIds.add(rec.postId);
                }
            }
        }

        const candidateRecords = Object.values(manifest.posts).filter(
            (record) =>
                record.forumStatus !== 'deleted' &&
                candidatePostIds.has(record.postId) &&
                !isPostProcessingSkipped(dataDir, threadId, record, ignoreConfig)
        );

        if (candidateRecords.length > 0) {
            for (const record of candidateRecords) {
                const conflict = record.sessionWarnings?.find((warning) =>
                    warning.startsWith('SESSION_CONFLICT:')
                );
                if (!conflict || record.sessionOverride !== undefined) continue;

                const [declaredSession, inferredSession] = conflict
                    .slice('SESSION_CONFLICT:'.length)
                    .split('->')
                    .map(Number);
                if (!declaredSession || !inferredSession) continue;

                const sessionOverride = await options.onSessionConflict?.(
                    record,
                    declaredSession,
                    inferredSession
                );
                if (sessionOverride !== undefined) {
                    record.sessionOverride = sessionOverride;
                    const configFilePath =
                        options.configPath || getThreadConfigPath(dataDir, threadId);
                    try {
                        setThreadConfigSessionOverride(
                            configFilePath,
                            record.postId,
                            sessionOverride
                        );
                    } catch {
                        // Ignore write failures in mock environments
                    }
                }
            }
            saveThreadManifest(dataDir, manifest);

            let currentIndex = 0;
            let nextCompletionIndex = 0;
            const completedTasks = new Map<number, ThreadPostRecord>();

            const flushCompletedTasks = (): void => {
                while (completedTasks.has(nextCompletionIndex)) {
                    const completedPost = completedTasks.get(nextCompletionIndex)!;
                    completedTasks.delete(nextCompletionIndex);
                    options.onProgress?.({
                        type: 'post_done',
                        message: `Finished post #${completedPost.postNumber}`,
                        completed: nextCompletionIndex + 1,
                        total: candidateRecords.length,
                        post: completedPost,
                    });
                    nextCompletionIndex++;
                }
            };

            const workerPool = async (): Promise<void> => {
                while (currentIndex < candidateRecords.length) {
                    const taskIndex = currentIndex++;
                    const record = candidateRecords[taskIndex];

                    options.onProgress?.({
                        type: 'post_start',
                        message: `Processing [${taskIndex + 1}/${candidateRecords.length}] post #${record.postNumber} (${record.author.username})...`,
                        completed: taskIndex,
                        total: candidateRecords.length,
                        post: record,
                    });

                    try {
                        await withLogContext(
                            {
                                post: `post#${record.postNumber} ${record.author.username}`,
                                postUrl: record.postUrl,
                            },
                            () =>
                                processPost(dataDir, threadId, record, undefined, {
                                    downloadImages,
                                    downloadDrive,
                                    extractCad,
                                    force: options.force,
                                    allowedExtensions,
                                    sessionKeywords,
                                })
                        );
                        processedCount++;
                    } catch (err) {
                        record.syncStatus = 'failed';
                        failedCount++;
                        console.error(
                            `Error processing post ${record.postId} (${record.author.username}): ${(err as Error).message}`
                        );
                    }

                    completedTasks.set(taskIndex, record);
                    flushCompletedTasks();
                }
            };

            const poolSize = Math.min(concurrency, candidateRecords.length);
            const workers = Array.from({ length: poolSize }, () => workerPool());
            await Promise.all(workers);

            // 5. Finalize manifest recalculations and save
            recalculateManifestStats(manifest);
            saveThreadManifest(dataDir, manifest);
        }
    }

    // Ensure thread config template is initialized on disk if not provided custom path
    if (!options.configPath) {
        ensureThreadConfig(dataDir, threadId, {
            title: manifest.title,
        });
    }

    const durationMs = Date.now() - startTime;

    options.onProgress?.({
        type: 'completed',
        message: `Thread #${threadId} synchronization completed in ${(durationMs / 1000).toFixed(1)}s.`,
    });

    return {
        threadId,
        manifest,
        totalDiscoveredPosts: allPosts.length,
        newPostsCount: syncDiff.newPosts.length,
        editedPostsCount: syncDiff.editedPosts.length,
        unchangedPostsCount: syncDiff.unchangedPosts.length,
        processedPostsCount: processedCount,
        failedPostsCount: failedCount,
        durationMs,
    };
}
