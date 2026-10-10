/**
 * Post Submission Evaluator
 * Analyzes an individual student submission against session rubrics,
 * deadlines, software version caps, and CAD file completeness.
 */
import type { AnalysisIgnoreConfig, SessionAnalysisCriteria } from '../../config/types.js';
import type { PostData } from '../../preparation/types/manifest.js';
import { isWhitelistedTemplate } from '../matcher/similarity-matcher.js';
import type {
    PostAnalysisResult,
    PostCadEvaluation,
    PostCadFileEvaluation,
} from '../types/index.js';

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

/**
 * Evaluates individual CAD files within a student post
 */
export function evaluateCadFiles(
    postData: PostData,
    criteria?: SessionAnalysisCriteria,
    templateWhitelists?: string[][]
): PostCadEvaluation {
    const fileEvaluations: PostCadFileEvaluation[] = [];
    const detectedVersions = new Set<string>();
    let isExceedingMaxVersion = false;

    for (const cad of postData.cadSummaries ?? []) {
        const fileWarnings: string[] = [];
        const isTemplate = isWhitelistedTemplate(cad.rseSegmentIds, templateWhitelists);

        if (cad.softwareVersion) {
            detectedVersions.add(cad.softwareVersion);
            const majorVersion = extractInventorMajorVersion(cad.softwareVersion);
            if (
                majorVersion &&
                criteria?.maxAllowedInventorVersion &&
                majorVersion > criteria.maxAllowedInventorVersion
            ) {
                isExceedingMaxVersion = true;
                fileWarnings.push(
                    `INVENTOR_VERSION_TOO_NEW:${majorVersion}>${criteria.maxAllowedInventorVersion}`
                );
            }
        }

        if (!cad.hasPreview) {
            fileWarnings.push('NO_3D_PREVIEW');
        }

        fileEvaluations.push({
            fileName: cad.fileName,
            localPath: cad.localPath,
            fileSizeBytes: cad.fileSizeBytes,
            softwareVersion: cad.softwareVersion,
            creationDate: cad.creationDate,
            lastSavedDate: cad.lastSavedDate,
            lastSavedByWindowsUser: cad.lastSavedByWindowsUser,
            isTemplateMatched: isTemplate,
            hasPreview: cad.hasPreview,
            previewPath: cad.previewPath,
            warnings: fileWarnings,
        });
    }

    return {
        totalCadFiles: fileEvaluations.length,
        validCadFiles: fileEvaluations.filter((f) => f.fileSizeBytes > 0).length,
        files: fileEvaluations,
        detectedInventorVersions: Array.from(detectedVersions),
        isExceedingMaxVersion,
    };
}

/**
 * Evaluates an entire post against session criteria and deadlines
 */
export function evaluatePostSubmission(
    postData: PostData,
    criteria?: SessionAnalysisCriteria,
    templateWhitelists?: string[][],
    ignoreConfig?: AnalysisIgnoreConfig
): PostAnalysisResult {
    const cadEvaluation = evaluateCadFiles(postData, criteria, templateWhitelists);
    const criteriaViolations: string[] = [];
    const urlWarnings: string[] = [];
    const sessionWarnings: string[] = [];
    const driveWarnings: string[] = [];
    let isLate = false;

    // 1. Classify forum & parser warnings from latest post version
    for (const warn of postData.warnings ?? []) {
        if (
            warn.includes('URL') ||
            warn.includes('BBCODE') ||
            warn.includes('IMAGE_URL') ||
            warn.includes('NO_CAD_LINK')
        ) {
            urlWarnings.push(warn);
        }
    }

    // 2. Session detection, conflict, and override analysis
    const ambWarn = (postData.warnings ?? []).find((w) => w.startsWith('SESSION_AMBIGUOUS:'));
    const conflictWarn = (postData.warnings ?? []).find((w) => w.startsWith('SESSION_CONFLICT:'));
    const hasNotFound = (postData.warnings ?? []).includes('SESSION_NOT_FOUND');

    if (ambWarn) {
        const rawList = ambWarn.split(':')[1]?.trim() || '';
        sessionWarnings.push(`SESSION_AMBIGUOUS:${rawList}`);
        criteriaViolations.push(`SESSION_AMBIGUOUS:${rawList}`);
    } else if (conflictWarn) {
        const rawCode = conflictWarn.split(':')[1]?.trim();
        const conflictCode = rawCode
            ? `SESSION_CONFLICT:${rawCode}`
            : `SESSION_CONFLICT:${postData.declaredSession ?? '?'}->${postData.inferredSession ?? '?'}`;
        sessionWarnings.push(conflictCode);
        criteriaViolations.push(conflictCode);
    } else if (hasNotFound || postData.sessionIndex === undefined || postData.sessionIndex === 0) {
        sessionWarnings.push('SESSION_NOT_FOUND');
        criteriaViolations.push('SESSION_NOT_FOUND');
    }

    if (
        postData.sessionSource === 'override' &&
        postData.sessionOverride !== undefined &&
        postData.sessionOverride !== null
    ) {
        sessionWarnings.push(`SESSION_OVERRIDE_APPLIED:${postData.sessionOverride}`);
    }

    // 3. Google Drive status & error checks
    if (postData.driveFiles?.status === 'not_found') {
        driveWarnings.push('DRIVE_NOT_FOUND');
        criteriaViolations.push('DRIVE_NOT_FOUND');
    } else if (postData.driveFiles?.error) {
        const driveCodes = extractDriveErrorCodes(postData.driveFiles.error);
        for (const code of driveCodes) {
            driveWarnings.push(code);
            criteriaViolations.push(code);
        }
    } else if (postData.driveFiles?.status === 'failed') {
        driveWarnings.push('DRIVE_DOWNLOAD_FAILED');
        criteriaViolations.push('DRIVE_DOWNLOAD_FAILED');
    }

    // 4. Deadline check
    if (criteria?.deadline && postData.postDate) {
        const postTime = new Date(postData.postDate).getTime();
        const deadlineTime = new Date(criteria.deadline).getTime();
        if (!isNaN(postTime) && !isNaN(deadlineTime) && postTime > deadlineTime) {
            isLate = true;
            criteriaViolations.push(`LATE_SUBMISSION:${postData.postDate}>${criteria.deadline}`);
        }
    }

    // 5. Minimum CAD files
    const minCadFiles = criteria?.minCadFiles ?? 0;
    if (minCadFiles > 0 && cadEvaluation.validCadFiles < minCadFiles) {
        criteriaViolations.push(
            `INSUFFICIENT_CAD_FILES:${cadEvaluation.validCadFiles}/${minCadFiles}`
        );
    }

    // 6. Minimum Images
    const minImages = criteria?.minImages ?? 0;
    const imageCount = postData.forumImages?.length ?? 0;
    if (minImages > 0 && imageCount < minImages) {
        criteriaViolations.push(`INSUFFICIENT_IMAGES:${imageCount}/${minImages}`);
    }

    // 7. Max Inventor Version Violation
    if (cadEvaluation.isExceedingMaxVersion) {
        criteriaViolations.push(
            `EXCEEDED_MAX_INVENTOR_VERSION:${cadEvaluation.detectedInventorVersions.join(',')}>${criteria?.maxAllowedInventorVersion}`
        );
    }

    // 8. Filter out any violations or warnings that are configured to be ignored
    const filteredViolations = criteriaViolations.filter(
        (v) => !isIgnored(v, postData.postId, ignoreConfig)
    );
    const filteredUrlWarnings = urlWarnings.filter(
        (w) => !isIgnored(w, postData.postId, ignoreConfig)
    );
    const filteredSessionWarnings = sessionWarnings.filter(
        (s) => !isIgnored(s, postData.postId, ignoreConfig)
    );
    const filteredDriveWarnings = driveWarnings.filter(
        (d) => !isIgnored(d, postData.postId, ignoreConfig)
    );

    const warnings = [...(postData.warnings ?? [])];

    return {
        postId: postData.postId,
        postNumber: postData.postNumber,
        postUrl: postData.postUrl,
        author: postData.author,
        userFolder: postData.userFolder,
        postFolder: postData.postFolder,
        postDate: postData.postDate,
        sessionIndex: postData.sessionIndex,
        declaredSession: postData.declaredSession,
        inferredSession: postData.inferredSession,
        sessionOverride: postData.sessionOverride,
        sessionSource: postData.sessionSource,
        cadEvaluation,
        imageCount,
        driveStatus: postData.driveFiles?.status ?? 'unknown',
        isLate,
        sessionDeadline: criteria?.deadline,
        passedCriteria: filteredViolations.length === 0,
        criteriaViolations: filteredViolations,
        warnings,
        urlWarnings: filteredUrlWarnings,
        sessionWarnings: filteredSessionWarnings,
        driveWarnings: filteredDriveWarnings,
        involvedClusterIds: [],
    };
}

/**
 * Formats a raw criteria violation code into human-readable text for CLI/UI
 */
export function formatViolationMessage(code: string): string {
    if (code.startsWith('SESSION_AMBIGUOUS:')) {
        const raw = code.replace('SESSION_AMBIGUOUS:', '');
        const sessions = raw ? `[${raw.split(',').join(', ')}]` : '';
        return `SESSION_AMBIGUOUS: Phát hiện nhiều số buổi ${sessions} trong bài viết`;
    }
    if (code.startsWith('SESSION_CONFLICT:')) {
        const [decl, inf] = code.replace('SESSION_CONFLICT:', '').split('->');
        return `SESSION_CONFLICT: Xung đột số buổi (khai báo Buổi ${decl}, suy luận Buổi ${inf})`;
    }
    if (code === 'SESSION_NOT_FOUND') {
        return 'SESSION_NOT_FOUND: Không tìm thấy số buổi nộp bài trong bài viết';
    }
    if (code === 'DRIVE_NOT_FOUND') {
        return 'DRIVE_NOT_FOUND: Không tìm thấy liên kết Google Drive nộp bài';
    }
    if (code === 'DRIVE_NO_CAD_FILES') {
        return 'DRIVE_NO_CAD_FILES: Không tìm thấy tệp CAD hợp lệ trong thư mục Google Drive';
    }
    if (code.startsWith('DRIVE_SUBFOLDER_NOT_FOUND:')) {
        const kw = code.replace('DRIVE_SUBFOLDER_NOT_FOUND:', '').trim();
        return `DRIVE_SUBFOLDER_NOT_FOUND: Không tìm thấy thư mục con khớp với từ khóa [${kw}]`;
    }
    if (code === 'DRIVE_SUBFOLDER_NOT_FOUND') {
        return 'DRIVE_SUBFOLDER_NOT_FOUND: Không tìm thấy thư mục con tương ứng';
    }
    if (code === 'DRIVE_EMPTY_FOLDER') {
        return 'DRIVE_EMPTY_FOLDER: Thư mục Google Drive rỗng';
    }
    if (code === 'DRIVE_ACCESS_DENIED') {
        return 'DRIVE_ACCESS_DENIED: Tệp/thư mục Google Drive bị giới hạn quyền truy cập';
    }
    if (code === 'DRIVE_INVALID_URL') {
        return 'DRIVE_INVALID_URL: Liên kết Google Drive không hợp lệ';
    }
    if (code === 'DRIVE_DOWNLOAD_FAILED') {
        return 'DRIVE_DOWNLOAD_FAILED: Lỗi khi tải dữ liệu từ Google Drive';
    }
    if (code.startsWith('DRIVE_ERROR:')) {
        return `DRIVE_ERROR: ${code.replace('DRIVE_ERROR:', '').trim()}`;
    }
    if (code.startsWith('INSUFFICIENT_CAD_FILES:')) {
        const [actual, min] = code.replace('INSUFFICIENT_CAD_FILES:', '').split('/');
        return `INSUFFICIENT_CAD_FILES: Chỉ nộp ${actual} tệp CAD (yêu cầu tối thiểu ${min})`;
    }
    if (code.startsWith('INSUFFICIENT_IMAGES:')) {
        const [actual, min] = code.replace('INSUFFICIENT_IMAGES:', '').split('/');
        return `INSUFFICIENT_IMAGES: Đính kèm ${actual} ảnh (yêu cầu tối thiểu ${min})`;
    }
    if (code.startsWith('LATE_SUBMISSION:')) {
        const [postDate, deadline] = code.replace('LATE_SUBMISSION:', '').split('>');
        return `LATE_SUBMISSION: Nộp bài lúc ${postDate} (sau hạn chót ${deadline})`;
    }
    if (code.startsWith('EXCEEDED_MAX_INVENTOR_VERSION:')) {
        const [versions, max] = code.replace('EXCEEDED_MAX_INVENTOR_VERSION:', '').split('>');
        return `EXCEEDED_MAX_INVENTOR_VERSION: Phiên bản Inventor ${versions} vượt quá giới hạn ${max}`;
    }
    if (code.startsWith('INVENTOR_VERSION_TOO_NEW:')) {
        const [actual, max] = code.replace('INVENTOR_VERSION_TOO_NEW:', '').split('>');
        return `INVENTOR_VERSION_TOO_NEW: Phiên bản Inventor ${actual} vượt quá yêu cầu tối đa ${max}`;
    }
    if (code === 'NO_3D_PREVIEW') {
        return 'NO_3D_PREVIEW: Không tìm thấy ảnh xem trước 3D trong tệp CAD';
    }
    return code;
}

/**
 * Formats a session warning/status code for CLI/UI
 */
export function formatSessionMessage(code: string): string {
    if (code.startsWith('SESSION_OVERRIDE_APPLIED:')) {
        const num = code.replace('SESSION_OVERRIDE_APPLIED:', '');
        return `Đã ghi đè thành Buổi ${num}`;
    }
    return formatViolationMessage(code);
}
