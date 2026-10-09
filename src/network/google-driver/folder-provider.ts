/**
 * Google Drive Folder Item Provider
 * Fetches items via Google Drive API v3 (primary if configured)
 * with zero-config fallback to HTML scraping (_DRIVE_ivd).
 */
import { createLogger } from '../../utils/logger.js';
import { getGoogleApiKey } from '../../env.js';
import { type GDriveItem, DEFAULT_USER_AGENT } from './types.js';

const logger = createLogger('GDriveProvider');

/**
 * Bóc tách danh sách file/folder từ biến nhúng _DRIVE_ivd trong HTML Google Drive
 */
export function extractItemsFromIvdHtml(html: string): GDriveItem[] {
    const match = html.match(/_DRIVE_ivd[^=]*=\s*['"]([^'"]+)['"]/);
    if (!match || !match[1]) {
        return [];
    }

    try {
        const rawEscaped = match[1];
        // Giải mã các ký tự hex \xHH sang ký tự thực tế
        const unescaped = rawEscaped.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16))
        );

        const parsed = JSON.parse(unescaped);
        if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) {
            return [];
        }

        const items: GDriveItem[] = [];
        for (const item of parsed[0]) {
            if (!Array.isArray(item) || item.length < 4) continue;

            const id = String(item[0]);
            const name = String(item[2]);
            const mimeType = String(item[3]);
            const sizeBytes = typeof item[13] === 'number' ? item[13] : undefined;
            const parentIds = Array.isArray(item[1]) ? (item[1] as string[]) : undefined;
            const isFolder = mimeType === 'application/vnd.google-apps.folder';

            items.push({
                id,
                name,
                mimeType,
                sizeBytes,
                isFolder,
                parentIds,
            });
        }

        return items;
    } catch (err) {
        logger.w(`Failed to parse _DRIVE_ivd data: ${(err as Error).message}`);
        return [];
    }
}

/**
 * Lấy danh sách item trong folder công khai bằng Web Scraper (_DRIVE_ivd)
 */
export async function fetchFolderItemsScraper(
    folderId: string,
    timeoutMs = 20000
): Promise<GDriveItem[]> {
    const url = `https://drive.google.com/drive/folders/${folderId}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': DEFAULT_USER_AGENT,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            signal: controller.signal,
        });

        if (!res.ok) {
            throw new Error(`Google Drive returned HTTP ${res.status} ${res.statusText}`);
        }

        const html = await res.text();
        return extractItemsFromIvdHtml(html);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Lấy danh sách item trong folder thông qua Google Drive API v3 chính thống
 */
export async function fetchFolderItemsApi(
    folderId: string,
    apiKey: string,
    timeoutMs = 20000
): Promise<GDriveItem[]> {
    const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const fields = encodeURIComponent('files(id,name,mimeType,size)');
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&key=${apiKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
            throw new Error(`Google Drive API returned HTTP ${res.status} ${res.statusText}`);
        }

        const data = (await res.json()) as {
            files?: Array<{ id: string; name: string; mimeType: string; size?: string }>;
        };

        if (!data.files || !Array.isArray(data.files)) {
            return [];
        }

        return data.files.map((f) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            sizeBytes: f.size ? Number(f.size) : undefined,
            isFolder: f.mimeType === 'application/vnd.google-apps.folder',
        }));
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Lấy danh sách item trong folder với cơ chế tự động Fallback (API v3 -> Scraper)
 */
export async function fetchFolderItems(
    folderId: string,
    options?: { apiKey?: string; timeoutMs?: number }
): Promise<GDriveItem[]> {
    const apiKey = options?.apiKey || getGoogleApiKey();
    const timeoutMs = options?.timeoutMs || 20000;

    if (apiKey) {
        try {
            return await fetchFolderItemsApi(folderId, apiKey, timeoutMs);
        } catch (err) {
            logger.w(
                `Google Drive API failed: ${(err as Error).message}. Falling back to public scraper...`
            );
        }
    }

    return fetchFolderItemsScraper(folderId, timeoutMs);
}
