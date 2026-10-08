/**
 * MyBB HTTP Client Module
 * Handles HTTP requests to the forum, session cookies, user-agent headers, and pagination
 * Does NOT perform DOM parsing or data extraction.
 */
import * as cheerio from 'cheerio';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('MyBbClient');

export interface MyBbClientOptions {
    /** Base URL of the forum (default: https://kisu4chaui.com) */
    baseUrl?: string;

    /** Session cookie header (e.g. mybbuser=...; sid=...) */
    cookie?: string;

    /** Custom User-Agent header */
    userAgent?: string;

    /** Request timeout in milliseconds (default: 15000) */
    timeoutMs?: number;
}

export interface FetchAllPagesOptions extends MyBbClientOptions {
    /** Delay in milliseconds between consecutive page requests (default: 300) */
    delayMs?: number;

    /** Maximum pages to fetch (0 for unlimited) */
    maxPages?: number;
}

export interface ThreadPageResult {
    page: number;
    url: string;
    html: string;
}

const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/**
 * Fetch a single page of a thread
 */
export async function fetchThreadPage(
    threadId: number | string,
    page = 1,
    options: MyBbClientOptions = {}
): Promise<string> {
    const {
        baseUrl = 'https://kisu4chaui.com',
        cookie,
        userAgent = DEFAULT_USER_AGENT,
        timeoutMs = 15000,
    } = options;

    const cleanBase = baseUrl.replace(/\/$/, '');
    const url = `${cleanBase}/showthread.php?tid=${threadId}&page=${page}`;

    const headers: Record<string, string> = {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
    };

    if (cookie) {
        headers['Cookie'] = cookie;
    }

    logger.d(`Fetching thread ${threadId} (page ${page}) from ${url}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers,
            signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
            throw new Error(
                `Failed to fetch thread ${threadId} page ${page}: HTTP ${response.status} ${response.statusText}`
            );
        }

        return await response.text();
    } catch (err) {
        clearTimeout(timer);
        if ((err as Error).name === 'AbortError') {
            throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`, { cause: err });
        }
        throw err;
    }
}

/**
 * Detect total page count from MyBB pagination HTML
 */
export function extractTotalPages(html: string): number {
    if (!html) return 1;

    try {
        const $ = cheerio.load(html);
        const pagination = $('.pagination').first();
        if (pagination.length === 0) return 1;

        // 1. Try pagination_last link (e.g. href="...&page=5")
        const lastPageHref = pagination.find('.pagination_last').attr('href') || '';
        const matchLast = lastPageHref.match(/page=(\d+)/);
        if (matchLast) {
            return parseInt(matchLast[1], 10);
        }

        // 2. Try scanning all page links in .pagination_page
        let maxPage = 1;
        pagination.find('.pagination_page, .pagination_current').each((_, el) => {
            const num = parseInt($(el).text().trim(), 10);
            if (!isNaN(num) && num > maxPage) {
                maxPage = num;
            }
        });

        // 3. Try parsing text like "(Trang 1 / 4)" or "Pages (4):"
        const pagesText = pagination.find('.pages').text().trim();
        const slashMatch = pagesText.match(/\/\s*(\d+)/);
        if (slashMatch) {
            const num = parseInt(slashMatch[1], 10);
            if (!isNaN(num) && num > maxPage) {
                maxPage = num;
            }
        }

        return maxPage;
    } catch {
        return 1;
    }
}

/**
 * Fetch all pages of a thread sequentially with polite throttling
 */
export async function fetchAllThreadPages(
    threadId: number | string,
    options: FetchAllPagesOptions = {}
): Promise<ThreadPageResult[]> {
    const { delayMs = 300, maxPages = 0 } = options;
    const cleanBase = (options.baseUrl || 'https://kisu4chaui.com').replace(/\/$/, '');

    // 1. Fetch Page 1 first
    const page1Html = await fetchThreadPage(threadId, 1, options);
    const results: ThreadPageResult[] = [
        {
            page: 1,
            url: `${cleanBase}/showthread.php?tid=${threadId}&page=1`,
            html: page1Html,
        },
    ];

    // 2. Discover total pages
    const detectedTotal = extractTotalPages(page1Html);
    const totalToFetch = maxPages > 0 ? Math.min(detectedTotal, maxPages) : detectedTotal;

    logger.i(`Thread ${threadId} has ${detectedTotal} pages. Fetching ${totalToFetch} pages...`);

    // 3. Sequentially fetch remaining pages with delay
    for (let page = 2; page <= totalToFetch; page++) {
        if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        const html = await fetchThreadPage(threadId, page, options);
        results.push({
            page,
            url: `${cleanBase}/showthread.php?tid=${threadId}&page=${page}`,
            html,
        });
    }

    return results;
}
