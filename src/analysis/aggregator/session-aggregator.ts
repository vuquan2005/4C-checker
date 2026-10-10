/**
 * Session Aggregator
 * Groups post analysis results and plagiarism clusters by session.
 */
import type { ThreadConfig } from '../../config/types.js';
import type {
    PlagiarismCluster,
    PostAnalysisResult,
    SessionAnalysisSummary,
} from '../types/index.js';

/**
 * Aggregates post results and plagiarism clusters by course session index
 */
export function aggregateSessionSummaries(
    postResults: PostAnalysisResult[],
    allClusters: PlagiarismCluster[],
    threadConfig?: ThreadConfig
): Record<string, SessionAnalysisSummary> {
    const sessions: Record<string, SessionAnalysisSummary> = {};

    for (const post of postResults) {
        const sKey = String(post.sessionIndex ?? 0);
        if (!sessions[sKey]) {
            const criteria =
                threadConfig?.analysis?.sessions?.[sKey] ??
                (sKey !== '0' ? threadConfig?.analysis?.defaultSessionCriteria : undefined);

            sessions[sKey] = {
                sessionIndex: post.sessionIndex ?? 0,
                title: criteria?.title,
                deadline: criteria?.deadline,
                minCadFiles: criteria?.minCadFiles,
                minImages: criteria?.minImages,
                minImageSizeBytes: criteria?.minImageSizeBytes,
                minImageWidth: criteria?.minImageWidth,
                minImageHeight: criteria?.minImageHeight,
                maxAllowedInventorVersion: criteria?.maxAllowedInventorVersion,
                totalSubmissions: 0,
                passedSubmissionsCount: 0,
                failedSubmissionsCount: 0,
                lateSubmissionsCount: 0,
                clustersCount: 0,
                posts: [],
                clusters: [],
            };
        }

        const sessionSummary = sessions[sKey];
        sessionSummary.totalSubmissions++;
        if (post.passedCriteria) {
            sessionSummary.passedSubmissionsCount++;
        } else {
            sessionSummary.failedSubmissionsCount++;
        }
        if (post.isLate) {
            sessionSummary.lateSubmissionsCount++;
        }
        sessionSummary.posts.push(post);
    }

    // Assign session clusters
    for (const cluster of allClusters) {
        if (cluster.sessionIndex !== undefined) {
            const sKey = String(cluster.sessionIndex);
            if (sessions[sKey]) {
                sessions[sKey].clusters.push(cluster);
                sessions[sKey].clustersCount++;
            }
        }
    }

    return sessions;
}
