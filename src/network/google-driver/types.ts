/**
 * Types and Constants for Google Drive Downloader
 */

export interface GDriveItem {
    id: string;
    name: string;
    mimeType: string;
    sizeBytes?: number;
    isFolder: boolean;
    parentIds?: string[];
}

export interface ParsedGDriveUrl {
    type: 'file' | 'folder' | 'unknown';
    id: string;
    originalUrl: string;
}

export interface GDriveDownloadOptions {
    /** Danh sách từ khóa ưu tiên để tìm folder buổi (ví dụ: ['buổi 1', 'b1', 'buoi-01']) */
    keywords?: string[];

    /** Whitelist phần mở rộng cần tải (mặc định: .ipt, .iam, .ipj, .idw, .dwg, .zip, .rar) */
    allowedExtensions?: string[];

    /** Bỏ qua nếu file cục bộ đã tồn tại và có dung lượng > 0 (mặc định: true) */
    skipIfExists?: boolean;

    /** Tự động giải nén file .zip sau khi tải về (mặc định: true) */
    autoExtractZip?: boolean;

    /** Số luồng tải đồng thời (mặc định: 2) */
    concurrency?: number;

    /** Khoảng nghỉ giữa các lượt tải để tránh rate limit (ms, mặc định: 300) */
    delayMs?: number;

    /** Thời gian chờ tối đa cho mỗi request tính bằng ms (mặc định: 30000) */
    timeoutMs?: number;

    /** Google API Key (nếu không truyền sẽ tự đọc từ .env hoặc fallback scraper) */
    googleApiKey?: string;

    /** Callback thông báo tiến độ sau mỗi file hoàn thành */
    onProgress?: (completed: number, total: number, fileName: string) => void;
}

export interface GDriveDownloadResult {
    success: boolean;
    matchedFolder?: string;
    downloadedFiles: string[];
    skippedFiles: string[];
    failedFiles: { name: string; error: string }[];
    totalBytes: number;
    warnings: string[];
}

export const DEFAULT_ALLOWED_EXTENSIONS = [
    '.ipt',
    '.iam',
    '.ipj',
    '.idw',
    '.dwg',
    '.ipn',
    '.zip',
    '.rar',
];

export const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
