/**
 * CAD Submission Evaluator
 * Evaluates individual CAD files within a student post for version limits,
 * preview presence, and whitelist matches.
 */
import type { SessionAnalysisCriteria } from '../../config/types.js';
import type { PostData } from '../../preparation/types/manifest.js';
import { isWhitelistedTemplate } from '../matcher/similarity-matcher.js';
import type { PostCadEvaluation, PostCadFileEvaluation } from '../types/index.js';
import { extractInventorMajorVersion } from './evaluator-helpers.js';

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
