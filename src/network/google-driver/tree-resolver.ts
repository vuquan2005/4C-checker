/**
 * Tree Resolver for Google Drive Folders
 * Handles session keyword matching, buffer folder penetration, and file whitelisting.
 */
import path from 'node:path';
import { removeDiacritics } from '../../utils/text-utils.js';
import { createLogger } from '../../utils/logger.js';
import { fetchFolderItems } from './folder-provider.js';
import {
    type GDriveItem,
    type GDriveDownloadOptions,
    DEFAULT_ALLOWED_EXTENSIONS,
} from './types.js';

const logger = createLogger('GDriveResolver');

/**
 * So khớp tên folder với danh sách từ khóa ưu tiên (hỗ trợ normalize bỏ dấu tiếng Việt và regex số buổi)
 */
export function matchFolderByKeywords(
    subfolders: GDriveItem[],
    keywords: string[]
): GDriveItem | null {
    if (!subfolders.length || !keywords.length) return null;

    const normalizedKeywords = keywords.map((k) => removeDiacritics(k).toLowerCase().trim());

    // 1. So khớp Regex chính xác buổi: ví dụ 'buoi 1' -> /\b(buoi|b)\s*0?1\b/i
    for (const kw of normalizedKeywords) {
        const numMatch = kw.match(/(?:buoi|b)\s*0?(\d+)/i);
        if (numMatch) {
            const sessionNum = numMatch[1];
            const sessionPattern = new RegExp(`(?:buoi|b)\\s*0?${sessionNum}(?:[^0-9]|$)`, 'i');
            for (const folder of subfolders) {
                const normName = removeDiacritics(folder.name).toLowerCase();
                if (sessionPattern.test(normName)) {
                    return folder;
                }
            }
        }
    }

    // 2. So khớp substring chứa từ khóa
    for (const folder of subfolders) {
        const normName = removeDiacritics(folder.name).toLowerCase();
        for (const kw of normalizedKeywords) {
            if (normName.includes(kw)) {
                return folder;
            }
        }
    }

    return null;
}

/**
 * Kiểm tra xem tên file có nằm trong whitelist cho phép không
 */
export function isFileAllowed(fileName: string, allowedExtensions: string[]): boolean {
    const ext = path.extname(fileName).toLowerCase();
    if (!ext) return false;

    // Bỏ qua các file tạm/khóa của Autodesk Inventor
    if (fileName.startsWith('~$') || ext === '.lock' || ext === '.tmp') {
        return false;
    }

    const normalizedAllowed = allowedExtensions.map((e) =>
        e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`
    );
    return normalizedAllowed.includes(ext);
}

/**
 * Duyệt cây thư mục Drive theo từ khóa và vượt qua các thư mục đệm (Buffer Folders)
 */
export async function resolveTargetFiles(
    folderId: string,
    options: GDriveDownloadOptions,
    currentDepth = 0
): Promise<{ matchedFolderName?: string; files: GDriveItem[]; warnings: string[] }> {
    const allowedExts = options.allowedExtensions || DEFAULT_ALLOWED_EXTENSIONS;
    const warnings: string[] = [];

    const items = await fetchFolderItems(folderId, {
        apiKey: options.googleApiKey,
        timeoutMs: options.timeoutMs,
    });

    if (!items.length) {
        return { files: [], warnings: ['Thư mục rỗng hoặc không có quyền truy cập công khai'] };
    }

    const activeItems = items;

    // Ở cấp gốc (depth 0), nếu có từ khóa ưu tiên và tồn tại folder con -> tìm nhánh buổi tương ứng
    if (currentDepth === 0 && options.keywords && options.keywords.length > 0) {
        const childFolders = items.filter((it) => it.isFolder);
        if (childFolders.length > 0) {
            const matched = matchFolderByKeywords(childFolders, options.keywords);
            if (matched) {
                logger.i(`Đã khớp thư mục buổi: "${matched.name}" (ID: ${matched.id})`);
                // Đi sâu vào thư mục buổi đã chọn
                const subRes = await resolveTargetFiles(
                    matched.id,
                    { ...options, keywords: undefined }, // Xóa keywords để các tầng sau không so khớp lại
                    currentDepth + 1
                );
                return {
                    ...subRes,
                    matchedFolderName: matched.name,
                };
            } else {
                warnings.push(
                    `Không tìm thấy thư mục con nào khớp với từ khóa: [${options.keywords.join(', ')}]`
                );
            }
        }
    }

    // Xuyên qua thư mục đệm (Buffer Folder):
    // Nếu trong folder hiện tại KHÔNG có file CAD nào, nhưng chỉ có ĐÚNG 1 thư mục con (ví dụ 'Buoi2')
    const allowedInCurrent = activeItems.filter(
        (it) => !it.isFolder && isFileAllowed(it.name, allowedExts)
    );
    const subFolders = activeItems.filter(
        (it) => it.isFolder && it.name.toLowerCase() !== 'oldversions'
    );

    if (allowedInCurrent.length === 0 && subFolders.length === 1 && currentDepth < 3) {
        const bufferFolder = subFolders[0];
        logger.i(`Tự động xuyên qua thư mục đệm: "${bufferFolder.name}"`);
        const subResult = await resolveTargetFiles(bufferFolder.id, options, currentDepth + 1);
        return {
            matchedFolderName: subResult.matchedFolderName,
            files: subResult.files,
            warnings: [...warnings, ...subResult.warnings],
        };
    }

    // Lọc lấy các file hợp lệ (bỏ qua thư mục OldVersions và các định dạng không nằm trong whitelist)
    const validFiles = activeItems.filter(
        (it) => !it.isFolder && isFileAllowed(it.name, allowedExts)
    );

    if (validFiles.length === 0) {
        warnings.push(
            `Không tìm thấy file CAD hợp lệ trong thư mục này (${allowedExts.join(', ')})`
        );
    }

    return {
        files: validFiles,
        warnings,
    };
}
