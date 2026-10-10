/**
 * Post Ignore Rule Evaluator
 * Tests forum posts against multi-criteria ignore configurations (post ID, post number, UID, username, OP).
 */
import type { IgnoreConfig } from './types.js';

export interface PostMatchTarget {
    postId: string;
    postNumber: number;
    author: {
        uid: string;
        username: string;
    };
}

export interface PostIgnoreEvaluation {
    ignored: boolean;
    reason?: string;
}

/**
 * Converts a simple glob-like pattern with `*` into a case-insensitive regular expression
 */
function patternToRegExp(pattern: string): RegExp {
    const escaped = pattern
        .trim()
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Checks if a username matches any username rule (literal or wildcard like "GV_*")
 */
function matchesUsername(username: string, patterns: string[]): string | null {
    const normalizedUser = username.trim();
    for (const pattern of patterns) {
        const trimmed = pattern.trim();
        if (!trimmed) continue;

        if (trimmed.includes('*')) {
            if (patternToRegExp(trimmed).test(normalizedUser)) {
                return trimmed;
            }
        } else if (normalizedUser.toLowerCase() === trimmed.toLowerCase()) {
            return trimmed;
        }
    }
    return null;
}

/**
 * Evaluates whether a post matches any configured ignore criteria
 */
export function isPostIgnored(
    post: PostMatchTarget,
    ignoreConfig?: IgnoreConfig
): PostIgnoreEvaluation {
    if (!ignoreConfig) {
        return { ignored: false };
    }

    // 1. Thread opener (#1) rule
    if (ignoreConfig.ignoreOp !== false && post.postNumber === 1) {
        return {
            ignored: true,
            reason: 'IGNORED_OP: Thread starter post #1',
        };
    }

    // 2. Post number rule
    if (ignoreConfig.postNumbers && ignoreConfig.postNumbers.length > 0) {
        if (ignoreConfig.postNumbers.includes(post.postNumber)) {
            return {
                ignored: true,
                reason: `IGNORED_POST_NUMBER: #${post.postNumber}`,
            };
        }
    }

    // 3. Post ID rule
    if (ignoreConfig.postIds && ignoreConfig.postIds.length > 0) {
        const targetPid = post.postId.trim();
        if (ignoreConfig.postIds.some((pid) => pid.trim() === targetPid)) {
            return {
                ignored: true,
                reason: `IGNORED_POST_ID: ${targetPid}`,
            };
        }
    }

    // 4. Author UID rule
    if (ignoreConfig.uids && ignoreConfig.uids.length > 0) {
        const targetUid = post.author.uid.trim();
        if (ignoreConfig.uids.some((uid) => uid.trim() === targetUid)) {
            return {
                ignored: true,
                reason: `IGNORED_UID: ${targetUid}`,
            };
        }
    }

    // 5. Author Username rule
    if (ignoreConfig.usernames && ignoreConfig.usernames.length > 0) {
        const matchedPattern = matchesUsername(post.author.username, ignoreConfig.usernames);
        if (matchedPattern) {
            return {
                ignored: true,
                reason: `IGNORED_USERNAME: matched "${matchedPattern}"`,
            };
        }
    }

    return { ignored: false };
}
