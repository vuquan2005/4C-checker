/**
 * Google Drive Folder Item Provider
 * Fetches items via Google Drive API v3 (primary if configured)
 * with zero-config fallback to HTML scraping (_DRIVE_ivd).
 */
import { createLogger } from '../../utils/logger.js';
import { getGoogleApiKey } from '../../env.js';
import { type GDriveItem, type GDriveAccessStatus, DEFAULT_USER_AGENT } from './types.js';

const logger = createLogger('GDriveProvider');

/**
 * Lỗi định danh quyền truy cập hoặc tài nguyên Google Drive
 */
export class GDriveAccessError extends Error {
    constructor(
        message: string,
        public readonly status: GDriveAccessStatus,
        public readonly httpStatus?: number
    ) {
        super(message);
        this.name = 'GDriveAccessError';
    }
}

/**
 * Nhận diện trạng thái quyền truy cập từ HTML hoặc HTTP status của Google Drive
 */
export function detectHtmlAccessStatus(
    html: string,
    responseUrl?: string,
    httpStatus?: number
): { status: GDriveAccessStatus; reason?: string } {
    if (httpStatus === 404) {
        return {
            status: 'not_found',
            reason: 'DRIVE_NOT_FOUND',
        };
    }

    if (httpStatus === 401 || httpStatus === 403) {
        return {
            status: 'restricted',
            reason: 'DRIVE_ACCESS_DENIED',
        };
    }

    // Kiểm tra URL bị chuyển hướng đến trang đăng nhập Google Account
    if (
        responseUrl &&
        /accounts\.google\.com\/(ServiceLogin|signin|v3\/signin)/i.test(responseUrl)
    ) {
        return {
            status: 'restricted',
            reason: 'DRIVE_ACCESS_DENIED',
        };
    }

    // Kiểm tra các thông báo lỗi phân quyền phổ biến trong HTML Google Drive
    const hasRestrictedPhrases =
        /accounts\.google\.com\/(ServiceLogin|signin|v3\/signin)/i.test(html) ||
        /You need (access|permission)|Request access/i.test(html) ||
        /Bạn cần (có )?quyền truy cập|Yêu cầu quyền truy cập|Quyền truy cập bị từ chối/i.test(
            html
        ) ||
        /<title>[^<]*Access Denied[^<]*<\/title>/i.test(html) ||
        /<title>[^<]*Google Drive – Yêu cầu quyền truy cập[^<]*<\/title>/i.test(html);

    if (hasRestrictedPhrases && !html.includes('_DRIVE_ivd')) {
        return {
            status: 'restricted',
            reason: 'DRIVE_ACCESS_DENIED',
        };
    }

    // Kiểm tra các thông báo 404 / Không tìm thấy tệp trong HTML
    const hasNotFoundPhrases =
        /404\. That’s an error/i.test(html) ||
        /The requested URL was not found/i.test(html) ||
        /Không tìm thấy tệp|Tệp không tồn tại|File not found/i.test(html);

    if (hasNotFoundPhrases && !html.includes('_DRIVE_ivd')) {
        return {
            status: 'not_found',
            reason: 'DRIVE_NOT_FOUND',
        };
    }

    return { status: 'public' };
}

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

        const html = await res.text();
        const accessCheck = detectHtmlAccessStatus(html, res.url, res.status);

        if (accessCheck.status === 'restricted') {
            throw new GDriveAccessError(
                accessCheck.reason ||
                    'Thư mục bị hạn chế quyền truy cập (Học viên chưa bật "Bất kỳ ai có liên kết đều có thể xem")',
                'restricted',
                res.status
            );
        }

        if (accessCheck.status === 'not_found') {
            throw new GDriveAccessError(
                accessCheck.reason || 'Thư mục không tồn tại hoặc đã bị xóa',
                'not_found',
                res.status
            );
        }

        if (!res.ok) {
            throw new Error(`Google Drive returned HTTP ${res.status} ${res.statusText}`);
        }

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
    const fields = encodeURIComponent('files(id,name,mimeType,size,modifiedTime,md5Checksum)');
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&key=${apiKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
            if (res.status === 403) {
                throw new GDriveAccessError(
                    'Google Drive API: Quyền truy cập bị từ chối (403 Forbidden - Thư mục chưa được chia sẻ công khai)',
                    'restricted',
                    403
                );
            }
            if (res.status === 404) {
                throw new GDriveAccessError(
                    'Google Drive API: Không tìm thấy thư mục hoặc thư mục không công khai (404 Not Found)',
                    'not_found',
                    404
                );
            }
            throw new Error(`Google Drive API returned HTTP ${res.status} ${res.statusText}`);
        }

        const data = (await res.json()) as {
            files?: Array<{
                id: string;
                name: string;
                mimeType: string;
                size?: string;
                modifiedTime?: string;
                md5Checksum?: string;
            }>;
        };

        if (!data.files || !Array.isArray(data.files)) {
            return [];
        }

        return data.files.map((f) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            sizeBytes: f.size ? Number(f.size) : undefined,
            modifiedTime: f.modifiedTime,
            md5Checksum: f.md5Checksum,
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
            if (err instanceof GDriveAccessError) {
                logger.w(
                    `Google Drive API báo trạng thái "${err.status}": ${err.message}. Đang kiểm tra lại bằng public scraper...`
                );
            } else {
                logger.w(
                    `Google Drive API failed: ${(err as Error).message}. Falling back to public scraper...`
                );
            }
        }
    }

    return fetchFolderItemsScraper(folderId, timeoutMs);
}
