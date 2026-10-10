/**
 * Post Submission Evaluator
 * Analyzes an individual student submission against session rubrics,
 * deadlines, software version caps, and CAD file completeness.
 */
import type { AnalysisIgnoreConfig, SessionAnalysisCriteria } from '../../config/types.js';
import type { PostData } from '../../preparation/types/manifest.js';
import type { PostAnalysisResult } from '../types/index.js';
import { evaluateCadFiles } from './cad-evaluator.js';
import { extractDriveErrorCodes, isIgnored } from './evaluator-helpers.js';

export {
    isIgnored,
    extractInventorMajorVersion,
    extractDriveErrorCodes,
} from './evaluator-helpers.js';
export { evaluateCadFiles } from './cad-evaluator.js';

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
