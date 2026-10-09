/**
 * Thread Manifest Manager
 * Handles reading, delta detection, incremental version history snapshots,
 * and atomic saving of `data/<threadId>/thread.json`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RawForumPost } from '../../types/post.js';
import type { ThreadManifest, ThreadPostRecord, PostSnapshot } from '../types/manifest.js';
import { normalizeUserFolderName, buildPostFolderName } from '../utils/folder-namer.js';
import { getSessionForInference, resolveSession } from '../utils/session-resolver.js';
import { ensureDir } from '../../utils/file-utils.js';

export interface ManifestSyncOptions {
    /** Override current ISO 8601 timestamp (useful for testing) */
    now?: string;
    /** Thread title if available */
    title?: string;
    /** Forum thread URL if available */
    threadUrl?: string;
    /** Mark records absent from a complete crawl as deleted. */
    markMissing?: boolean;
    /** Root data directory used to rename downloaded deleted posts. */
    dataDir?: string;
}

export interface ManifestSyncResult {
    /** The updated manifest */
    manifest: ThreadManifest;
    /** Brand new posts discovered in this run */
    newPosts: RawForumPost[];
    /** Existing posts that were edited or updated on the forum */
    editedPosts: Array<{
        post: RawForumPost;
        prevVersion: number;
        newVersion: number;
        hasLinkChanges: boolean;
        hasImageChanges: boolean;
        hasTextChanges: boolean;
    }>;
    /** Posts that remain strictly identical to their last synced snapshot */
    unchangedPosts: RawForumPost[];
}

/**
 * Compare two string arrays for exact element-wise equality
 */
function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function inferSessionFromPreviousPost(
    manifest: ThreadManifest,
    userFolder: string,
    postNumber: number
): number | undefined {
    const previousPosts = Object.values(manifest.posts)
        .filter(
            (record) =>
                record.userFolder === userFolder &&
                record.postNumber < postNumber &&
                record.forumStatus !== 'deleted'
        )
        .sort((a, b) => b.postNumber - a.postNumber);

    const previousSession = previousPosts
        .map((record) => getSessionForInference(record))
        .find((session): session is number => session !== undefined);

    return previousSession === undefined ? undefined : previousSession + 1;
}

function markPostDeleted(
    dataDir: string | undefined,
    manifest: ThreadManifest,
    record: ThreadPostRecord
): void {
    if (record.forumStatus === 'deleted') return;

    const deletedFolder = `${record.postFolder}_deleted`;
    if (dataDir) {
        const currentPath = path.join(
            dataDir,
            manifest.threadId,
            record.userFolder,
            record.postFolder
        );
        const deletedPath = path.join(dataDir, manifest.threadId, record.userFolder, deletedFolder);
        if (fs.existsSync(currentPath) && !fs.existsSync(deletedPath)) {
            fs.renameSync(currentPath, deletedPath);
        }
    }

    record.postFolder = deletedFolder;
    record.forumStatus = 'deleted';
}

/**
 * Returns the absolute path to `thread.json` for a given threadId
 */
export function getThreadManifestPath(dataDir: string, threadId: string): string {
    return path.join(dataDir, threadId, 'thread.json');
}

/**
 * Load existing `thread.json` from disk, or return null if not found
 */
export function loadThreadManifest(dataDir: string, threadId: string): ThreadManifest | null {
    const manifestPath = getThreadManifestPath(dataDir, threadId);
    if (!fs.existsSync(manifestPath)) {
        return null;
    }

    try {
        const raw = fs.readFileSync(manifestPath, 'utf8');
        return JSON.parse(raw) as ThreadManifest;
    } catch {
        return null;
    }
}

/**
 * Create a new, blank manifest for a thread
 */
export function createEmptyManifest(
    threadId: string,
    options?: { title?: string; threadUrl?: string; now?: string }
): ThreadManifest {
    const nowIso = options?.now || new Date().toISOString();

    return {
        threadId,
        title: options?.title,
        threadUrl: options?.threadUrl,
        lastSyncedAt: nowIso,
        syncVersion: 1,
        stats: {
            totalPosts: 0,
            totalUsers: 0,
            syncedPosts: 0,
            outdatedPosts: 0,
            pendingPosts: 0,
            failedPosts: 0,
        },
        posts: {},
    };
}

/**
 * Recalculate summary statistics for a manifest
 */
export function recalculateManifestStats(manifest: ThreadManifest): void {
    const records = Object.values(manifest.posts);
    const users = new Set(records.map((r) => r.userFolder));

    manifest.stats = {
        totalPosts: records.length,
        totalUsers: users.size,
        syncedPosts: records.filter((r) => r.syncStatus === 'synced').length,
        outdatedPosts: records.filter((r) => r.syncStatus === 'outdated').length,
        pendingPosts: records.filter((r) => r.syncStatus === 'pending').length,
        failedPosts: records.filter((r) => r.syncStatus === 'failed').length,
    };
}

/**
 * Synchronize an array of raw forum posts into the thread manifest.
 * Detects new posts, incremental edits, and snapshots history cleanly.
 */
export function syncThreadPostsIntoManifest(
    manifest: ThreadManifest,
    posts: RawForumPost[],
    options?: ManifestSyncOptions
): ManifestSyncResult {
    const nowIso = options?.now || new Date().toISOString();

    if (options?.title && !manifest.title) {
        manifest.title = options.title;
    }
    if (options?.threadUrl && !manifest.threadUrl) {
        manifest.threadUrl = options.threadUrl;
    }

    const newPosts: RawForumPost[] = [];
    const editedPosts: ManifestSyncResult['editedPosts'] = [];
    const unchangedPosts: RawForumPost[] = [];

    // Sort posts by postNumber ascending to preserve chronological order
    const sortedPosts = [...posts].sort((a, b) => a.postNumber - b.postNumber);

    for (const post of sortedPosts) {
        const existingRecord = manifest.posts[post.postId];

        if (!existingRecord) {
            // 1. BRAND NEW POST
            const userFolder = normalizeUserFolderName(post.author.username, post.author.uid);

            // Count existing posts belonging to this same user
            const existingUserPostsCount = Object.values(manifest.posts).filter(
                (r) => r.userFolder === userFolder
            ).length;
            const postFolder = buildPostFolderName(existingUserPostsCount + 1, post.postId);
            const inferredSession = inferSessionFromPreviousPost(
                manifest,
                userFolder,
                post.postNumber
            );
            const session = resolveSession(post.plainText, inferredSession);
            const { warnings: sessionWarnings, ...sessionFields } = session;

            const initialSnapshot: PostSnapshot = {
                version: 1,
                syncedAt: nowIso,
                postDate: post.postDate,
                editedInfo: post.editedInfo,
                plainText: post.plainText,
                links: [...post.links],
                imageUrls: [...post.imageUrls],
                warnings: [...post.warnings, ...sessionWarnings],
            };

            const record: ThreadPostRecord = {
                postId: post.postId,
                postNumber: post.postNumber,
                postUrl: post.postUrl,
                author: { ...post.author },
                userFolder,
                postFolder,
                ...sessionFields,
                sessionWarnings,
                forumStatus: 'active',
                postDate: post.postDate,
                editedInfo: post.editedInfo ? { ...post.editedInfo } : undefined,
                firstSeenAt: nowIso,
                lastSyncedAt: nowIso,
                syncStatus: 'pending',
                current: 1,
                history: [initialSnapshot],
            };

            manifest.posts[post.postId] = record;
            newPosts.push(post);
        } else {
            if (existingRecord.forumStatus === 'deleted') {
                unchangedPosts.push(post);
                continue;
            }

            // 2. EXISTING POST: Check if it was edited or modified
            const inferredSession = inferSessionFromPreviousPost(
                manifest,
                existingRecord.userFolder,
                post.postNumber
            );
            const session = resolveSession(
                post.plainText,
                inferredSession,
                existingRecord.sessionOverride
            );
            const { warnings: sessionWarnings, ...sessionFields } = session;
            Object.assign(existingRecord, {
                ...sessionFields,
                sessionWarnings,
                forumStatus: 'active',
            });
            const lastSnapshot = existingRecord.history[existingRecord.history.length - 1];

            const editedAtChanged =
                Boolean(post.editedInfo?.editedAt) &&
                post.editedInfo?.editedAt !== lastSnapshot.editedInfo?.editedAt;

            const textChanged = post.plainText !== lastSnapshot.plainText;
            const linksChanged = !arraysEqual(post.links, lastSnapshot.links);
            const imagesChanged = !arraysEqual(post.imageUrls, lastSnapshot.imageUrls);

            const isModified = editedAtChanged || textChanged || linksChanged || imagesChanged;

            if (isModified) {
                const prevVersion = existingRecord.current;
                const newVersion = existingRecord.history.length + 1;
                const newSnapshot: PostSnapshot = {
                    version: newVersion,
                    syncedAt: nowIso,
                    postDate: post.postDate,
                    editedInfo: post.editedInfo ? { ...post.editedInfo } : undefined,
                    plainText: post.plainText,
                    links: [...post.links],
                    imageUrls: [...post.imageUrls],
                    warnings: [...post.warnings, ...sessionWarnings],
                };

                existingRecord.history.push(newSnapshot);
                existingRecord.editedInfo = post.editedInfo ? { ...post.editedInfo } : undefined;
                existingRecord.lastSyncedAt = nowIso;

                if (linksChanged || imagesChanged) {
                    // Links or images changed -> local files on disk are outdated
                    existingRecord.syncStatus = 'outdated';
                } else {
                    // Only text changed -> no file re-download needed, auto advance current version
                    existingRecord.current = newVersion;
                    if (existingRecord.syncStatus !== 'failed') {
                        existingRecord.syncStatus = 'synced';
                    }
                }
                editedPosts.push({
                    post,
                    prevVersion,
                    newVersion,
                    hasLinkChanges: linksChanged,
                    hasImageChanges: imagesChanged,
                    hasTextChanges: textChanged,
                });
            } else {
                // UNCHANGED POST
                unchangedPosts.push(post);
            }
        }
    }

    if (options?.markMissing) {
        const seenPostIds = new Set(sortedPosts.map((post) => post.postId));
        for (const record of Object.values(manifest.posts)) {
            if (!seenPostIds.has(record.postId)) {
                markPostDeleted(options.dataDir, manifest, record);
            }
        }
    }

    manifest.lastSyncedAt = nowIso;
    manifest.syncVersion += 1;
    recalculateManifestStats(manifest);

    return {
        manifest,
        newPosts,
        editedPosts,
        unchangedPosts,
    };
}

/**
 * Atomically save `thread.json` to disk (writes to temp file then renames)
 */
export function saveThreadManifest(dataDir: string, manifest: ThreadManifest): string {
    const threadDir = path.join(dataDir, manifest.threadId);
    ensureDir(threadDir);

    const targetFile = path.join(threadDir, 'thread.json');
    const tempFile = path.join(
        threadDir,
        `thread.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    );

    const json = JSON.stringify(manifest, null, 2);
    fs.writeFileSync(tempFile, json, 'utf8');
    fs.renameSync(tempFile, targetFile);

    return targetFile;
}
