/**
 * Tree Resolver for Google Drive Folders
 * Handles session keyword matching, buffer folder penetration, and file whitelisting.
 */
import path from 'node:path';
import { removeDiacritics } from '../../utils/text-utils.js';
import { createLogger } from '../../utils/logger.js';
import { getGoogleApiKey } from '../../env.js';
import { fetchFolderItems, detectHtmlAccessStatus, GDriveAccessError } from './folder-provider.js';
import { parseGDriveUrl } from './url-parser.js';
import {
    type GDriveItem,
    type GDriveDownloadOptions,
    type GDriveSubmissionMetadata,
    type GDriveManifestDiff,
    type GDriveAccessStatus,
    DEFAULT_ALLOWED_EXTENSIONS,
    DEFAULT_USER_AGENT,
} from './types.js';

const logger = createLogger('GDriveResolver');

export interface ResolveTargetFilesResult {
    matchedFolderName?: string;
    targetFolderId?: string;
    files: GDriveItem[];
    warnings: string[];
    accessStatus: GDriveAccessStatus;
    accessReason?: string;
}

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
): Promise<ResolveTargetFilesResult> {
    const allowedExts = options.allowedExtensions || DEFAULT_ALLOWED_EXTENSIONS;
    const warnings: string[] = [];

    let items: GDriveItem[];
    try {
        items = await fetchFolderItems(folderId, {
            apiKey: options.googleApiKey,
            timeoutMs: options.timeoutMs,
        });
    } catch (err) {
        if (err instanceof GDriveAccessError) {
            return {
                targetFolderId: folderId,
                files: [],
                warnings: [err.message],
                accessStatus: err.status,
                accessReason: err.message,
            };
        }
        throw err;
    }

    if (!items.length) {
        return {
            targetFolderId: folderId,
            files: [],
            warnings: ['Thư mục rỗng (không chứa file hoặc thư mục con nào)'],
            accessStatus: 'public',
        };
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
                    targetFolderId: subRes.targetFolderId || matched.id,
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
        (it) =>
            it.isFolder &&
            it.name.toLowerCase() !== 'oldversions' &&
            !it.name.startsWith('_') &&
            !it.name.startsWith('.')
    );

    if (allowedInCurrent.length === 0 && subFolders.length === 1 && currentDepth < 3) {
        const bufferFolder = subFolders[0];
        logger.i(`Tự động xuyên qua thư mục đệm: "${bufferFolder.name}"`);
        const subResult = await resolveTargetFiles(bufferFolder.id, options, currentDepth + 1);
        return {
            matchedFolderName: subResult.matchedFolderName,
            targetFolderId: subResult.targetFolderId || bufferFolder.id,
            files: subResult.files,
            warnings: [...warnings, ...subResult.warnings],
            accessStatus: subResult.accessStatus,
            accessReason: subResult.accessReason,
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
        targetFolderId: folderId,
        files: validFiles,
        warnings,
        accessStatus: 'public',
    };
}

/**
 * Trích xuất Metadata của thư mục bài nộp cuối cùng mà KHÔNG tải binary
 * Phục vụ kiểm tra phân quyền, versioning và kiểm tra vi sai (Dry-run / Inspection).
 */
export async function fetchSubmissionMetadata(
    url: string,
    options: GDriveDownloadOptions = {}
): Promise<GDriveSubmissionMetadata> {
    const parsed = parseGDriveUrl(url);
    if (!parsed) {
        return {
            url,
            type: 'unknown',
            accessStatus: 'invalid_url',
            accessReason: `URL không hợp lệ hoặc không phải định dạng Google Drive: "${url}"`,
            fetchedAt: new Date().toISOString(),
            files: [],
            totalFiles: 0,
            totalBytes: 0,
            warnings: [`URL không hợp lệ hoặc không phải định dạng Google Drive: "${url}"`],
        };
    }

    // Trường hợp 1: Link là File đơn lẻ
    if (parsed.type === 'file') {
        const apiKey = options.googleApiKey || getGoogleApiKey();
        if (apiKey) {
            try {
                const apiUrl = `https://www.googleapis.com/drive/v3/files/${parsed.id}?fields=id,name,mimeType,size,modifiedTime,md5Checksum&key=${apiKey}`;
                const res = await fetch(apiUrl, {
                    signal: AbortSignal.timeout(options.timeoutMs || 20000),
                });
                if (res.ok) {
                    const data = (await res.json()) as {
                        id: string;
                        name: string;
                        mimeType: string;
                        size?: string;
                        modifiedTime?: string;
                        md5Checksum?: string;
                    };
                    const sizeBytes = data.size ? Number(data.size) : undefined;
                    return {
                        url,
                        type: 'file',
                        accessStatus: 'public',
                        fetchedAt: new Date().toISOString(),
                        files: [
                            {
                                id: data.id,
                                name: data.name,
                                mimeType: data.mimeType,
                                sizeBytes,
                                modifiedTime: data.modifiedTime,
                                md5Checksum: data.md5Checksum,
                            },
                        ],
                        totalFiles: 1,
                        totalBytes: sizeBytes || 0,
                        warnings: [],
                    };
                }
            } catch {
                // Tiếp tục fallback kiểm tra qua scraper bên dưới
            }
        }

        try {
            const checkUrl = `https://drive.google.com/file/d/${parsed.id}/view`;
            const res = await fetch(checkUrl, {
                headers: { 'User-Agent': DEFAULT_USER_AGENT },
                signal: AbortSignal.timeout(options.timeoutMs || 20000),
            });
            const html = await res.text();
            const accessCheck = detectHtmlAccessStatus(html, res.url, res.status);
            if (accessCheck.status !== 'public') {
                return {
                    url,
                    type: 'file',
                    accessStatus: accessCheck.status,
                    accessReason: accessCheck.reason,
                    fetchedAt: new Date().toISOString(),
                    files: [],
                    totalFiles: 0,
                    totalBytes: 0,
                    warnings: [accessCheck.reason || 'Tệp bị hạn chế quyền truy cập'],
                };
            }

            let fileName = `submission_${parsed.id}.zip`;
            const ogTitleMatch = html.match(
                /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i
            );
            if (ogTitleMatch && ogTitleMatch[1]) {
                fileName = ogTitleMatch[1].trim();
            } else {
                const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
                if (titleMatch && titleMatch[1]) {
                    fileName = titleMatch[1].replace(/\s*-\s*Google Drive\s*$/i, '').trim();
                }
            }

            return {
                url,
                type: 'file',
                accessStatus: 'public',
                fetchedAt: new Date().toISOString(),
                files: [
                    {
                        id: parsed.id,
                        name: fileName,
                    },
                ],
                totalFiles: 1,
                totalBytes: 0,
                warnings: [],
            };
        } catch (err) {
            return {
                url,
                type: 'file',
                accessStatus: 'restricted',
                accessReason: (err as Error).message,
                fetchedAt: new Date().toISOString(),
                files: [],
                totalFiles: 0,
                totalBytes: 0,
                warnings: [(err as Error).message],
            };
        }
    }

    // Trường hợp 2: Link là Folder hoặc Unknown -> Phân giải cây thư mục
    const resolved = await resolveTargetFiles(parsed.id, options);
    if (resolved.accessStatus !== 'public') {
        return {
            url,
            type: parsed.type,
            targetFolderId: resolved.targetFolderId,
            targetFolderName: resolved.matchedFolderName,
            accessStatus: resolved.accessStatus,
            accessReason: resolved.accessReason,
            fetchedAt: new Date().toISOString(),
            files: [],
            totalFiles: 0,
            totalBytes: 0,
            warnings: resolved.warnings,
        };
    }

    const files = resolved.files.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        modifiedTime: f.modifiedTime,
        md5Checksum: f.md5Checksum,
    }));

    const totalBytes = files.reduce((acc, f) => acc + (f.sizeBytes || 0), 0);

    return {
        url,
        type: 'folder',
        targetFolderId: resolved.targetFolderId,
        targetFolderName: resolved.matchedFolderName,
        accessStatus: 'public',
        fetchedAt: new Date().toISOString(),
        files,
        totalFiles: files.length,
        totalBytes,
        warnings: resolved.warnings,
    };
}

/**
 * So sánh Manifest cũ với Metadata mới để phát hiện vi sai (Added, Modified, Deleted, Unchanged)
 */
export function diffSubmissionManifest(
    oldManifest: GDriveSubmissionMetadata | null,
    newMetadata: GDriveSubmissionMetadata
): GDriveManifestDiff {
    if (!oldManifest || !oldManifest.files || oldManifest.files.length === 0) {
        return {
            hasChanges: newMetadata.files.length > 0,
            added: newMetadata.files.map((f) => ({
                id: f.id,
                name: f.name,
                mimeType: f.mimeType || 'application/octet-stream',
                sizeBytes: f.sizeBytes,
                modifiedTime: f.modifiedTime,
                md5Checksum: f.md5Checksum,
                isFolder: false,
            })),
            modified: [],
            deleted: [],
            unchanged: [],
        };
    }

    const oldMapById = new Map(oldManifest.files.map((f) => [f.id, f]));
    const oldMapByName = new Map(oldManifest.files.map((f) => [f.name, f]));

    const added: GDriveItem[] = [];
    const modified: GDriveItem[] = [];
    const unchanged: GDriveItem[] = [];
    const matchedOldIds = new Set<string>();

    for (const newFile of newMetadata.files) {
        const item: GDriveItem = {
            id: newFile.id,
            name: newFile.name,
            mimeType: newFile.mimeType || 'application/octet-stream',
            sizeBytes: newFile.sizeBytes,
            modifiedTime: newFile.modifiedTime,
            md5Checksum: newFile.md5Checksum,
            isFolder: false,
        };

        const oldFile = oldMapById.get(newFile.id) || oldMapByName.get(newFile.name);
        if (!oldFile) {
            added.push(item);
        } else {
            matchedOldIds.add(oldFile.id);
            // So sánh các thuộc tính để phát hiện thay đổi
            const isMd5Diff = Boolean(
                oldFile.md5Checksum &&
                newFile.md5Checksum &&
                oldFile.md5Checksum !== newFile.md5Checksum
            );
            const isTimeDiff = Boolean(
                oldFile.modifiedTime &&
                newFile.modifiedTime &&
                oldFile.modifiedTime !== newFile.modifiedTime
            );
            const isSizeDiff =
                oldFile.sizeBytes !== undefined &&
                newFile.sizeBytes !== undefined &&
                oldFile.sizeBytes !== newFile.sizeBytes;

            if (isMd5Diff || isTimeDiff || isSizeDiff) {
                modified.push(item);
            } else {
                unchanged.push(item);
            }
        }
    }

    const deleted: Array<{ id: string; name: string }> = [];
    for (const oldFile of oldManifest.files) {
        if (!matchedOldIds.has(oldFile.id)) {
            deleted.push({ id: oldFile.id, name: oldFile.name });
        }
    }

    const hasChanges = added.length > 0 || modified.length > 0 || deleted.length > 0;

    return {
        hasChanges,
        added,
        modified,
        deleted,
        unchanged,
    };
}
