/**
 * Thread Parser Module
 * Pure In-Memory DOM parser: converts MyBB thread HTML into RawForumPost items
 * Extracts post metadata, clean plain text, filtered document links, and image URLs.
 * Detects malformed BBCode tags and glued/unlinked raw URLs.
 */
import * as cheerio from 'cheerio';
import type { PostAuthorSummary, PostEditSummary, RawForumPost } from '../types/post.js';
import { parseForumDateToIso } from '../utils/time-utils.js';

/**
 * Known image file extensions
 */
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$/i;

/**
 * Known image hosting domains (used to detect non-direct image viewer landing pages)
 */
const IMAGE_HOST_DOMAINS = [
    'postimg.cc',
    'i.postimg.cc',
    'imgur.com',
    'i.imgur.com',
    'imgbb.com',
    'i.ibb.co',
    'ibb.co',
    'cdn.upanhlaylink.com',
    'googleusercontent.com',
    'prnt.sc',
    'lightshot.com',
];

/**
 * Check if a URL points directly to an image file (must have valid image extension)
 */
export function isImageUrl(url: string): boolean {
    if (!url) return false;
    const lower = url.toLowerCase();

    // Ignore forum smilies / emoticons
    if (lower.includes('/images/smilies/')) {
        return false;
    }

    // Must have standard image file extension
    return IMAGE_EXTENSIONS.test(lower);
}

/**
 * Check if a URL points to an image hosting viewer page without direct image extension
 * (e.g. postimg.cc/abc, imgur.com/xyz, prnt.sc/123)
 */
export function isImageHostViewerUrl(url: string): boolean {
    if (!url || isImageUrl(url)) return false;
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        return IMAGE_HOST_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
        return false;
    }
}

/**
 * Clean candidate URL: strip trailing punctuation and validate URL format
 */
export function cleanUrlString(rawCandidate: string): string {
    let url = rawCandidate.trim();
    if (!url) return '';

    // Strip trailing punctuation, brackets, quotes
    url = url.replace(/[.,;:!?)>"'\]]+$/, '');

    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return url;
        }
    } catch {
        // Invalid URL format
    }

    return '';
}

/**
 * Convert HTML snippet into clean plain text with preserved line breaks
 */
export function htmlToPlainText(html: string): string {
    if (!html) return '';

    const withNewlines = html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n');

    const $ = cheerio.load(withNewlines);
    const rawText = $.text();

    return rawText
        .replace(/\u00A0/g, ' ')
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Options for thread post parsing
 */
export interface ThreadParserOptions {
    /** Custom forum base URL (e.g. "https://kisu4chaui.com") */
    baseUrl?: string;

    /** Whether to include raw fields (rawHtml and editedInfo.raw). Default: false */
    includeRaw?: boolean;
}

/**
 * Parse edit metadata from .post_edit text (supports English and Vietnamese)
 * Normalizes editedAt into standard ISO 8601 string
 */
export function parsePostEditSummary(
    rawText: string,
    includeRaw = false
): PostEditSummary | undefined {
    const trimmed = rawText.trim();
    if (!trimmed) return undefined;

    // Matches:
    // English: (This post was last modified: 29-09-2026, 22:06 by Nguyễn Tiến Đạt.)
    // Vietnamese: (Sửa đổi lần cuối: 09-29-2026, 10:06 PM bởi Nguyễn Văn A.)
    const match = trimmed.match(
        /(?:lần\s*cuối|last\s*modified)\s*:\s*(.+?)(?:\s+(?:bởi|by)\s+([^.)]+)|[.)]|$)/i
    );

    if (!match) {
        return includeRaw ? { raw: trimmed } : undefined;
    }

    const rawTime = match[1]?.trim();
    const editedBy = match[2]?.trim();
    const editedAt = rawTime ? parseForumDateToIso(rawTime) || rawTime : undefined;

    const result: PostEditSummary = {
        editedAt,
        editedBy,
    };

    if (includeRaw) {
        result.raw = trimmed;
    }

    return result;
}

/**
 * Automatically detect forum base URL from Cheerio DOM (logo link #logo a or author link)
 */
export function extractBaseUrlFromDom(
    $: cheerio.CheerioAPI,
    postEl?: ReturnType<cheerio.CheerioAPI>
): string {
    const candidateHref =
        $('#logo a, .logo a').first().attr('href') ||
        (postEl ? postEl.find('a[href*="member.php"]').first().attr('href') : undefined) ||
        $('a[href*="member.php"]').first().attr('href');

    if (candidateHref && candidateHref.startsWith('http')) {
        try {
            return new URL(candidateHref).origin;
        } catch {
            return 'https://kisu4chaui.com';
        }
    }

    return 'https://kisu4chaui.com';
}

/**
 * Parse a single MyBB post element from Cheerio DOM
 */
export function parsePostElement(
    postEl: ReturnType<cheerio.CheerioAPI>,
    $: cheerio.CheerioAPI,
    optionsOrBaseUrl?: string | ThreadParserOptions
): RawForumPost {
    const options: ThreadParserOptions =
        typeof optionsOrBaseUrl === 'string'
            ? { baseUrl: optionsOrBaseUrl }
            : optionsOrBaseUrl || {};

    const baseUrl = options.baseUrl || extractBaseUrlFromDom($, postEl);
    const includeRaw = Boolean(options.includeRaw);
    // 1. Post ID
    const rawId = postEl.attr('id') || '';
    const postIdMatch = rawId.match(/post_(\d+)/);
    const postId = postIdMatch ? postIdMatch[1] : '';

    // 2. Post Number (#1, #2, #3...) and Direct Post URL
    const postHead = postEl.find('.post_head');
    const postLinkEl = postHead.find('.float_right strong a').first();
    const postNumText = postLinkEl.text().trim();
    const postNumber = parseInt(postNumText.replace(/[^0-9]/g, ''), 10) || 0;

    let postUrl = '';
    const rawPostHref = postLinkEl.attr('href')?.trim() || '';
    if (rawPostHref && rawPostHref !== '#' && !rawPostHref.startsWith('javascript:')) {
        try {
            postUrl = new URL(rawPostHref, baseUrl).href;
        } catch {
            postUrl = rawPostHref;
        }
    } else if (postId) {
        postUrl = `${baseUrl.replace(/\/$/, '')}/showthread.php?pid=${postId}#pid${postId}`;
    }

    // 3. Author Information
    const authorSection = postEl.find('.post_author');
    const profileHref = authorSection.find('a[href*="uid="]').first().attr('href') || '';
    let uid = '';
    if (profileHref) {
        try {
            const urlObj = new URL(profileHref, baseUrl);
            uid = urlObj.searchParams.get('uid') || '';
        } catch {
            const match = profileHref.match(/[?&]uid=(\d+)/);
            uid = match ? match[1] : '';
        }
    }

    const username = authorSection.find('.author_information .largetext a').first().text().trim();
    const author: PostAuthorSummary = {
        username,
        uid,
    };

    // 4. Post Date & Edit Info
    const postDateEl = postHead.find('.post_date');

    const editPostEl = postDateEl.find('.post_edit .edited_post');
    let editedInfo: PostEditSummary | undefined;
    if (editPostEl.length > 0) {
        const editClone = editPostEl.clone();
        editClone.find('span[title]').each((_, s) => {
            const title = $(s).attr('title');
            if (title) $(s).replaceWith(title);
        });
        editedInfo = parsePostEditSummary(editClone.text(), includeRaw);
    }

    // Extract post date (replace <span title="...">Yesterday</span> with title if present)
    const dateClone = postDateEl.clone();
    dateClone.find('.post_edit').remove();
    dateClone.find('span[title]').each((_, s) => {
        const title = $(s).attr('title');
        if (title) $(s).replaceWith(title);
    });
    const rawPostDate = dateClone
        .text()
        .replace(/[,\s]+$/, '')
        .trim();
    const postDate = parseForumDateToIso(rawPostDate) || rawPostDate;

    // 5. Post Body & Plain Text
    const postBodyEl = postEl.find('.post_body').first();
    const rawHtml = postBodyEl.html() || '';
    const plainText = htmlToPlainText(rawHtml);

    // 6. Collect URLs:
    // - Rendered URLs: <a> href and <img> src
    // - Plain text URLs: URLs found in post plain text
    const renderedAnchorHrefs = new Set<string>();
    const renderedImgSrcs = new Set<string>();
    const rawUrlCandidates: string[] = [];

    // URLs from rendered <img> tags (skipping forum smilies/emoticons)
    postBodyEl.find('img[src^="http"]').each((_, img) => {
        const $img = $(img);
        if ($img.hasClass('smilie')) return;
        const src = cleanUrlString($img.attr('src') || '');
        if (src && isImageUrl(src)) {
            renderedImgSrcs.add(src);
            rawUrlCandidates.push(src);
        }
    });

    // URLs from rendered <a> tags
    postBodyEl.find('a[href^="http"]').each((_, a) => {
        const $a = $(a);
        const href = cleanUrlString($a.attr('href') || '');
        if (!href) return;

        renderedAnchorHrefs.add(href);

        // If this <a> tag wraps an <img> tag and the href is an image host or direct image,
        // skip adding href to candidates to avoid duplicate image entries.
        // The wrapped <img> already provides the direct image source.
        const wrapsImg = $a.find('img').length > 0;
        if (wrapsImg && (isImageUrl(href) || isImageHostViewerUrl(href))) {
            return;
        }

        rawUrlCandidates.push(href);
    });

    // URLs appearing in plain text (unrendered links, plain-text paste, or broken BBCode)
    // Stops before whitespace, brackets, or quotes to avoid capturing surrounding BBCode tags
    const textUrls = plainText.match(/https?:\/\/[^\s<>"'[\]]+/gi) || [];
    rawUrlCandidates.push(...textUrls);

    // 7. Sanitize and classify URLs
    const otherLinks = new Set<string>();
    const imageUrls = new Set<string>();
    let hasInvalidImageUrl = false;

    for (const raw of rawUrlCandidates) {
        const url = cleanUrlString(raw);
        if (!url || url.includes('...')) continue;

        if (isImageUrl(url)) {
            imageUrls.add(url);
        } else if (isImageHostViewerUrl(url)) {
            // Image hosting viewer page without direct image file extension (e.g. postimg.cc/abc)
            // Cannot be previewed directly on web or curled in one step -> flag as invalid image URL
            hasInvalidImageUrl = true;
        } else {
            otherLinks.add(url);
        }
    }

    // 8. Detect warnings
    // a) Unrendered URLs in plain text:
    //    - Any image URL in plain text is problematic (in MyBB, rendered <img> has no text,
    //      so an image URL appearing in plainText indicates unrendered raw URL or broken BBCode)
    //    - Any non-image URL in plain text that was NOT rendered into an <a> tag
    let hasUnrenderedUrl = false;
    for (const raw of textUrls) {
        const url = cleanUrlString(raw);
        if (!url || url.includes('...')) continue;

        if (isImageUrl(url) || isImageHostViewerUrl(url)) {
            hasUnrenderedUrl = true;
        } else if (!renderedAnchorHrefs.has(url)) {
            hasUnrenderedUrl = true;
        }
    }

    // b) Malformed / leftover BBCode tags in plain text (e.g. [/url], [url=...], [/img], [img])
    const hasMalformedBbcode = /\[\/?(?:url|img)[^\]]*\]/i.test(plainText);

    const warnings: string[] = [];
    if (hasUnrenderedUrl) {
        warnings.push('UNRENDERED_URL');
    }
    if (hasInvalidImageUrl) {
        warnings.push('INVALID_IMAGE_URL');
    }
    if (hasMalformedBbcode) {
        warnings.push('MALFORMED_BBCODE');
    }

    const post: RawForumPost = {
        postId,
        postNumber,
        postUrl,
        author,
        postDate,
        editedInfo,
        plainText,
        links: Array.from(otherLinks),
        imageUrls: Array.from(imageUrls),
        warnings,
    };

    if (includeRaw) {
        post.rawHtml = rawHtml;
    }

    return post;
}

/**
 * Parse an entire MyBB thread HTML document into RawForumPost array
 */
export function parseThreadPosts(
    htmlContent: string,
    optionsOrBaseUrl?: string | ThreadParserOptions
): RawForumPost[] {
    const options: ThreadParserOptions =
        typeof optionsOrBaseUrl === 'string'
            ? { baseUrl: optionsOrBaseUrl }
            : optionsOrBaseUrl || {};

    const $ = cheerio.load(htmlContent);
    const baseUrl = options.baseUrl || extractBaseUrlFromDom($);
    const resolvedOptions: ThreadParserOptions = {
        ...options,
        baseUrl,
    };

    const posts: RawForumPost[] = [];

    $('div.post').each((_, el) => {
        const postEl = $(el);
        // Skip deleted post placeholders (e.g. <div class="post deleted_post_hidden">)
        if (
            postEl.hasClass('deleted_post_hidden') ||
            postEl.hasClass('deleted_post') ||
            postEl.find('.post_head').length === 0
        ) {
            return;
        }

        const post = parsePostElement(postEl, $, resolvedOptions);
        posts.push(post);
    });

    return posts;
}
