/**
 * MyBB Forum Post and Thread Types
 * Raw and plain text data models without business-level field extraction
 */

export interface PostAuthorSummary {
    username: string;
    uid: string;
}

export interface PostEditSummary {
    raw: string;
    editedAt?: string;
    editedBy?: string;
}

export interface RawForumPost {
    /** Unique Post ID (e.g. "26091") */
    postId: string;

    /** Post order in thread (#1, #2, #3...) */
    postNumber: number;

    /** Is this the first post / thread starter (OP)? */
    isThreadStarter: boolean;

    /** Author username and forum UID */
    author: PostAuthorSummary;

    /** Display post date (e.g. "09-29-2026, 06:00 PM") */
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

    /** Raw HTML of post body */
    rawHtml: string;
}
