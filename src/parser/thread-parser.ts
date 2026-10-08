/**
 * Thread Parser Module
 * Pure In-Memory DOM parser: converts MyBB thread HTML into RawForumPost items
 * Extracts post metadata, clean plain text, filtered document links, and image URLs.
 * Detects malformed BBCode tags and glued/unlinked raw URLs.
 */
import * as cheerio from 'cheerio';
import type { PostAuthorSummary, PostEditSummary, RawForumPost } from '../types/post.js';

/**
 * Known image file extensions
 */
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$/i;

/**
 * Known image hosting domains (both direct image CDNs and viewer landing pages)
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
 * Check if a URL points to an image file or an image host
 */
export function isImageUrl(url: string): boolean {
    if (!url) return false;
    const lower = url.toLowerCase();

    // 1. Check file extension
    if (IMAGE_EXTENSIONS.test(lower)) {
        return true;
    }

    // 2. Check known image host domain
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
 * Parse edit metadata from .post_edit text
 */
export function parsePostEditSummary(rawText: string): PostEditSummary | undefined {
    const trimmed = rawText.trim();
    if (!trimmed) return undefined;

    const timeMatch = trimmed.match(/lần\s*cuối:\s*([^bởi.)]+)/i);
    const byMatch = trimmed.match(/bởi\s+([^.)]+)[.)]/i);

    return {
        raw: trimmed,
        editedAt: timeMatch ? timeMatch[1].trim() : undefined,
        editedBy: byMatch ? byMatch[1].trim() : undefined,
    };
}

/**
 * Parse a single MyBB post element from Cheerio DOM
 */
export function parsePostElement(
    postEl: ReturnType<cheerio.CheerioAPI>,
    $: cheerio.CheerioAPI
): RawForumPost {
    // 1. Post ID
    const rawId = postEl.attr('id') || '';
    const postIdMatch = rawId.match(/post_(\d+)/);
    const postId = postIdMatch ? postIdMatch[1] : '';

    // 2. Post Number (#1, #2, #3...)
    const postHead = postEl.find('.post_head');
    const postNumText = postHead.find('.float_right strong a').first().text().trim();
    const postNumber = parseInt(postNumText.replace(/[^0-9]/g, ''), 10) || 0;
    const isThreadStarter = postNumber === 1;

    // 3. Author Information
    const authorSection = postEl.find('.post_author');
    const profileHref = authorSection.find('a[href*="uid="]').first().attr('href') || '';
    let uid = '';
    if (profileHref) {
        try {
            const urlObj = new URL(profileHref, 'https://kisu4chaui.com');
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
    const rawPostDate = postDateEl
        .contents()
        .first()
        .text()
        .replace(/[,\s]+$/, '')
        .trim();

    const editPostEl = postDateEl.find('.post_edit .edited_post');
    const editedInfo = editPostEl.length > 0 ? parsePostEditSummary(editPostEl.text()) : undefined;

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

    // URLs from rendered <a> tags
    postBodyEl.find('a[href^="http"]').each((_, a) => {
        const href = cleanUrlString($(a).attr('href') || '');
        if (href) {
            renderedAnchorHrefs.add(href);
            rawUrlCandidates.push(href);
        }
    });

    // URLs from rendered <img> tags
    postBodyEl.find('img[src^="http"]').each((_, img) => {
        const src = cleanUrlString($(img).attr('src') || '');
        if (src) {
            renderedImgSrcs.add(src);
            rawUrlCandidates.push(src);
        }
    });

    // URLs appearing in plain text (unrendered links, plain-text paste, or broken BBCode)
    // Stops before whitespace, brackets, or quotes to avoid capturing surrounding BBCode tags
    const textUrls = plainText.match(/https?:\/\/[^\s<>"'[\]]+/gi) || [];
    rawUrlCandidates.push(...textUrls);

    // 7. Sanitize, classify, and detect unrendered URLs
    const otherLinks = new Set<string>();
    const imageUrls = new Set<string>();
    let hasUnrenderedUrl = false;

    for (const raw of rawUrlCandidates) {
        const url = cleanUrlString(raw);
        if (!url || url.includes('...')) continue;

        // Check if this URL was rendered into an HTML tag (<a> or <img>)
        const isRendered = renderedAnchorHrefs.has(url) || renderedImgSrcs.has(url);
        if (!isRendered) {
            hasUnrenderedUrl = true;
        }

        if (isImageUrl(url)) {
            imageUrls.add(url);
        } else {
            otherLinks.add(url);
        }
    }

    const warnings: string[] = hasUnrenderedUrl ? ['UNRENDERED_URL'] : [];

    return {
        postId,
        postNumber,
        isThreadStarter,
        author,
        postDate: rawPostDate,
        editedInfo,
        plainText,
        links: Array.from(otherLinks),
        imageUrls: Array.from(imageUrls),
        warnings,
        rawHtml,
    };
}

/**
 * Parse an entire MyBB thread HTML document into RawForumPost array
 */
export function parseThreadPosts(htmlContent: string): RawForumPost[] {
    const $ = cheerio.load(htmlContent);
    const posts: RawForumPost[] = [];

    $('div.post').each((_, el) => {
        const postEl = $(el);
        const post = parsePostElement(postEl, $);
        posts.push(post);
    });

    return posts;
}
