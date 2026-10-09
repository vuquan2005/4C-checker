/**
 * Thread Manifest & Data Preparation Types
 * Defines data structures for delta sync, post history snapshots,
 * and individual post summaries.
 */
import type { PostAuthorSummary, PostEditSummary } from '../../types/post.js';
import type { CadMetadata } from '../../types/cad.js';

/**
 * Snapshot of a forum post at a specific point in time
 * Preserves historical content across edits
 */
export interface PostSnapshot {
    /** 1-based sequential version number (1, 2, 3...) */
    version: number;

    /** ISO 8601 timestamp when this snapshot was captured */
    syncedAt: string;

    /** ISO 8601 post datetime string from forum */
    postDate: string;

    /** Information about last edit on forum at the time of snapshot */
    editedInfo?: PostEditSummary;

    /** Clean plain text representation of post body at this version */
    plainText: string;

    /** Document / download links found in the post (e.g. Google Drive) */
    links: string[];

    /** BBCode image URLs found in the post */
    imageUrls: string[];

    /** Syntax or BBCode warnings detected */
    warnings: string[];
}

/**
 * Sync status for an individual post
 */
export type PostSyncStatus = 'synced' | 'pending' | 'outdated' | 'failed';

export type ForumStatus = 'active' | 'deleted';

export type SessionSource = 'declared' | 'inferred' | 'override';

/**
 * Master record of a post within thread.json
 */
export interface ThreadPostRecord {
    /** Unique MyBB Post ID (e.g. "26091") */
    postId: string;

    /** Post number in thread (#1, #2, #3...) */
    postNumber: number;

    /** Direct permalink URL to the post */
    postUrl: string;

    /** Author username and forum UID */
    author: PostAuthorSummary;

    /** Normalized folder name for author: e.g. "Ha_Phuc_Khanh_12345" */
    userFolder: string;

    /** Stable folder name for this post: e.g. "post_26091" */
    postFolder: string;

    /** Session number written in the student's post. */
    declaredSession?: number;

    /** Session inferred from the previous active post by this student. */
    inferredSession?: number;

    /** Manual session value that takes precedence during Drive lookup. */
    sessionOverride?: number;

    /** Session selected for the current Drive lookup. */
    sessionIndex?: number;

    /** Origin of sessionIndex. */
    sessionSource?: SessionSource;

    /** Warnings produced while resolving the session. */
    sessionWarnings?: string[];

    /** Whether this post still exists on the forum. */
    forumStatus?: ForumStatus;

    /** ISO 8601 post datetime string */
    postDate: string;

    /** Information about last edit if edited on forum */
    editedInfo?: PostEditSummary;

    /** ISO 8601 timestamp when first discovered */
    firstSeenAt: string;

    /** ISO 8601 timestamp of most recent sync */
    lastSyncedAt: string;

    /** Current sync status */
    syncStatus: PostSyncStatus;

    /** Manually skip asset downloads and CAD analysis for this post. */
    skipProcessing?: boolean;

    /** Current active version number (index pointer into history, e.g. 1, 2...) */
    current: number;

    /** Complete version history snapshots across all sync runs */
    history: PostSnapshot[];
}

/**
 * Master thread manifest saved at `data/<threadId>/thread.json`
 */
export interface ThreadManifest {
    /** Forum Thread ID */
    threadId: string;

    /** Forum Thread Title if available */
    title?: string;

    /** Base forum URL */
    threadUrl?: string;

    /** ISO 8601 timestamp of last sync run */
    lastSyncedAt: string;

    /** Sync counter incremented on each thread sync */
    syncVersion: number;

    /** Thread-level aggregation statistics */
    stats: {
        totalPosts: number;
        totalUsers: number;
        syncedPosts: number;
        outdatedPosts: number;
        pendingPosts: number;
        failedPosts: number;
    };

    /** Map of postId -> ThreadPostRecord */
    posts: Record<string, ThreadPostRecord>;
}

/**
 * Download status for a forum BBCode image
 */
export interface ForumImageDownloadSummary {
    originalUrl: string;
    localPath?: string;
    fileName?: string;
    fileSizeBytes?: number;
    status: 'downloaded' | 'failed' | 'skipped';
    error?: string;
}

/**
 * Download status for student's Google Drive submission
 */
export interface DriveDownloadSummary {
    driveUrl?: string;
    status: 'downloaded' | 'failed' | 'skipped' | 'not_found';
    localDir?: string;
    totalFiles: number;
    downloadedFiles: string[];
    error?: string;
}

/**
 * Metadata and preview summary for a CAD file inside student's submission
 */
export interface CadFileSummary extends CadMetadata {
    /** Relative path from post folder to CAD file */
    localPath: string;

    /** Relative path from post folder to extracted 3D PNG preview if available */
    previewPath?: string;
}

/**
 * Complete post data file stored in each post folder:
 * `data/<threadId>/<userFolder>/<postFolder>/post.json`
 */
export interface PostData {
    postId: string;
    postNumber: number;
    /** Session selected for the current Drive lookup, if unambiguous. */
    sessionIndex?: number;
    declaredSession?: number;
    inferredSession?: number;
    /** Set this value manually and rerun preparation when session detection conflicts. */
    sessionOverride: number | null;
    sessionSource?: SessionSource;
    forumStatus?: ForumStatus;
    postUrl: string;
    author: PostAuthorSummary;
    postDate: string;
    editedInfo?: PostEditSummary;
    currentVersion: number;
    syncedAt: string;
    userFolder: string;
    postFolder: string;

    /** Manually skip future asset downloads and CAD analysis for this post. */
    skipProcessing?: boolean;

    /** BBCode images downloaded from forum post */
    forumImages: ForumImageDownloadSummary[];

    /** Files downloaded from Google Drive */
    driveFiles: DriveDownloadSummary;

    /** CAD models parsed with extracted 3D previews */
    cadSummaries: CadFileSummary[];

    /** Forum syntax or formatting warnings */
    warnings: string[];
}
