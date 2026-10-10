/**
 * Post Evaluator Helpers
 * Utility functions for version parsing, error normalization, and ignore filtering.
 */
import type { AnalysisIgnoreConfig } from '../../config/types.js';

/**
 * Checks whether a specific warning or violation is ignored/suppressed by config
 */
export function isIgnored(
    codeOrMessage: string,
    postId: string,
    ignoreConfig?: AnalysisIgnoreConfig
): boolean {
    if (!ignoreConfig) return false;
    const globalWarnings = ignoreConfig.warnings ?? [];
    const globalViolations = ignoreConfig.violations ?? [];
    const postIgnores = ignoreConfig.byPost?.[postId] ?? [];

    const isMatch = (pattern: string) => {
        const p = pattern.trim().toLowerCase();
        const c = codeOrMessage.trim().toLowerCase();
        return c === p || c.startsWith(`${p}:`) || c.startsWith(p) || c.includes(p);
    };

    return (
        globalWarnings.some(isMatch) || globalViolations.some(isMatch) || postIgnores.some(isMatch)
    );
}

/**
 * Extracts the 4-digit major year from an Inventor softwareVersion string
 * e.g. "2025.5 (Build 295498000, 498)" -> 2025
 */
export function extractInventorMajorVersion(versionString?: string): number | undefined {
    if (!versionString) return undefined;
    const match = versionString.match(/\b(20\d{2})\b/);
    if (match) {
        return Number(match[1]);
    }
    return undefined;
}

/**
 * Extracts normalized Google Drive error codes from raw warning/error strings
 */
export function extractDriveErrorCodes(rawError?: string): string[] {
    if (!rawError) return [];
    const parts = rawError
        .split(';')
        .map((p) => p.trim())
        .filter(Boolean);
    const codes: string[] = [];

    for (const part of parts) {
        const lower = part.toLowerCase();
        if (
            lower.includes('không tìm thấy thư mục con nào khớp') ||
            lower.includes('subfolder_not_found')
        ) {
            const match = part.match(/\[(.*?)\]/);
            const kw = match ? match[1].trim() : '';
            codes.push(kw ? `DRIVE_SUBFOLDER_NOT_FOUND:${kw}` : 'DRIVE_SUBFOLDER_NOT_FOUND');
        } else if (
            lower.includes('không tìm thấy file cad hợp lệ') ||
            lower.includes('no_cad_files')
        ) {
            codes.push('DRIVE_NO_CAD_FILES');
        } else if (lower.includes('thư mục rỗng') || lower.includes('empty_folder')) {
            codes.push('DRIVE_EMPTY_FOLDER');
        } else if (lower.includes('url không hợp lệ') || lower.includes('invalid_url')) {
            codes.push('DRIVE_INVALID_URL');
        } else if (
            lower.includes('hạn chế quyền truy cập') ||
            lower.includes('quyền truy cập') ||
            lower.includes('access_denied') ||
            lower.includes('cần quyền đăng nhập')
        ) {
            codes.push('DRIVE_ACCESS_DENIED');
        } else if (part.startsWith('DRIVE_')) {
            codes.push(part);
        } else {
            codes.push(`DRIVE_ERROR:${part}`);
        }
    }

    return codes.length > 0 ? codes : ['DRIVE_ERROR'];
}
