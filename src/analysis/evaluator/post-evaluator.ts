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

    // 6. Minimum Images & Image Size/Quality Validation
    const minImages = criteria?.minImages ?? 0;
    const minImageSizeBytes = criteria?.minImageSizeBytes ?? 5000;
    const minImageWidth = criteria?.minImageWidth ?? 100;
    const minImageHeight = criteria?.minImageHeight ?? 80;

    let validImageCount = 0;
    const imageWarnings: string[] = [];

    for (const img of postData.forumImages ?? []) {
        // Skip failed downloads
        if (img.status !== 'downloaded') {
            continue;
        }

        const size = img.fileSizeBytes ?? 0;
        let isTooSmall = false;
        let reason = '';

        if (size > 0 && size < minImageSizeBytes) {
            isTooSmall = true;
            reason = `${size}B<${minImageSizeBytes}B`;
        }

        const width = img.width;
        const height = img.height;
        if (width !== undefined && height !== undefined) {
            if (width < minImageWidth || height < minImageHeight) {
                isTooSmall = true;
                const dimReason = `${width}x${height}<${minImageWidth}x${minImageHeight}`;
                reason = reason ? `${reason}, ${dimReason}` : dimReason;
            }
        }

        if (isTooSmall) {
            const warnCode = `IMAGE_TOO_SMALL:${img.fileName || 'image'}:${reason}`;
            imageWarnings.push(warnCode);
            criteriaViolations.push(warnCode);
        } else {
            validImageCount++;
        }
    }

    if (minImages > 0 && validImageCount < minImages) {
        criteriaViolations.push(`INSUFFICIENT_IMAGES:${validImageCount}/${minImages}`);
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
    const filteredImageWarnings = imageWarnings.filter(
        (i) => !isIgnored(i, postData.postId, ignoreConfig)
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
        imageCount: postData.forumImages?.length ?? 0,
        validImageCount,
        driveStatus: postData.driveFiles?.status ?? 'unknown',
        isLate,
        sessionDeadline: criteria?.deadline,
        passedCriteria: filteredViolations.length === 0,
        criteriaViolations: filteredViolations,
        warnings,
        urlWarnings: filteredUrlWarnings,
        sessionWarnings: filteredSessionWarnings,
        driveWarnings: filteredDriveWarnings,
        imageWarnings: filteredImageWarnings,
        involvedClusterIds: [],
    };
}
