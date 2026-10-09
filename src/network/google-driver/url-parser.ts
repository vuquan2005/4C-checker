/**
 * URL Parser for Google Drive Links
 */
import type { ParsedGDriveUrl } from './types.js';

/**
 * Phân tích URL Google Drive để trích xuất ID và phân loại (File vs Folder)
 */
export function parseGDriveUrl(url: string): ParsedGDriveUrl | null {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!trimmed) return null;

    // Định dạng Thư mục (Folder)
    const folderMatch = trimmed.match(
        /drive\.google\.com\/(?:drive\/(?:u\/\d+\/|mobile\/)?folders\/)([a-zA-Z0-9_-]+)/
    );
    if (folderMatch) {
        return { type: 'folder', id: folderMatch[1], originalUrl: trimmed };
    }

    // Định dạng File cụ thể (file/d/... hoặc uc?id=...)
    const fileMatch = trimmed.match(
        /drive\.google\.com\/(?:file\/d\/|uc\?(?:[^&]*&)*id=)([a-zA-Z0-9_-]+)/
    );
    if (fileMatch) {
        return { type: 'file', id: fileMatch[1], originalUrl: trimmed };
    }

    // Định dạng open?id=... (có thể là file hoặc folder)
    const openMatch = trimmed.match(/drive\.google\.com\/open\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)/);
    if (openMatch) {
        return { type: 'unknown', id: openMatch[1], originalUrl: trimmed };
    }

    // Chuỗi ID trực tiếp
    if (/^[a-zA-Z0-9_-]{25,}$/.test(trimmed)) {
        return { type: 'unknown', id: trimmed, originalUrl: trimmed };
    }

    return null;
}
