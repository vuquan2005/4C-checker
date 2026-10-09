/**
 * MyBB Forum Post and Thread Types
 * Raw and plain text data models without business-level field extraction
 */

export interface PostAuthorSummary {
    username: string;
    uid: string;
}

export interface PostEditSummary {
    /** Raw edit text from forum (optional, omitted when raw is disabled) */
    raw?: string;
    /** Standard ISO 8601 datetime string when post was last modified */
    editedAt?: string;
    editedBy?: string;
}

export interface RawForumPost {
    /** Unique Post ID (e.g. "26091") */
    postId: string;

    /** Post order in thread (#1, #2, #3...) */
    postNumber: number;

    /** Direct permalink URL to the post (e.g. "https://kisu4chaui.com/showthread.php?tid=1336&pid=26106#pid26106") */
    postUrl: string;

    /** Is this the first post / thread starter (OP)? */
    isThreadStarter: boolean;

    /** Author username and forum UID */
    author: PostAuthorSummary;

    /** Standard ISO 8601 post datetime string (e.g. "2026-09-29T18:00:00+07:00") */
    postDate: string;

    /** Information about last edit if edited */
    editedInfo?: PostEditSummary;

    /** Clean plain text representation of post body (newlines preserved) */
    plainText: string;

    /** Document / Assignment hyperlinks (Google Drive, GitHub, etc.) - FILTERED FROM IMAGES */
    links: string[];

    /** All image URLs found in the post (from <img>, BBCode, or image hosts) */
    imageUrls: string[];

    /** Syntax warnings (e.g. malformed BBCode tags, glued URLs, unlinked raw URLs) */
    warnings: string[];

    /** Raw HTML of post body (optional, omitted when raw is disabled) */
    rawHtml?: string;
}
