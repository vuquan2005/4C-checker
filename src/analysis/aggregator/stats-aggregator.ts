/**
 * Stats Aggregator
 * Computes high-level metrics for thread-level analysis reports.
 */
import type {
    AnalysisSummaryStats,
    PlagiarismCluster,
    PlagiarizedFileRef,
    PostAnalysisResult,
    StudentAnalysisSummary,
} from '../types/index.js';

export interface AggregateStatsParams {
    totalPostsDiscovered: number;
    postResults: PostAnalysisResult[];
    skippedPostsCount: number;
    students: Record<string, StudentAnalysisSummary>;
    allCadFiles: PlagiarizedFileRef[];
    allClusters: PlagiarismCluster[];
}

/**
 * Computes high-level summary statistics
 */
export function aggregateSummaryStats(params: AggregateStatsParams): AnalysisSummaryStats {
    const {
        totalPostsDiscovered,
        postResults,
        skippedPostsCount,
        students,
        allCadFiles,
        allClusters,
    } = params;

    const highSeverityClustersCount = allClusters.filter((c) => c.severity === 'high').length;
    const mediumSeverityClustersCount = allClusters.filter((c) => c.severity === 'medium').length;
    const lowSeverityClustersCount = allClusters.filter((c) => c.severity === 'low').length;
    const suspiciousStudentsCount = Object.values(students).filter(
        (s) => s.plagiarismInvolvementCount > 0
    ).length;

    return {
        totalPostsDiscovered,
        totalPostsAnalyzed: postResults.length,
        totalPostsSkipped: skippedPostsCount,
        totalStudents: Object.keys(students).length,
        totalCadFiles: allCadFiles.length,
        totalValidCadFiles: allCadFiles.filter((f) => f.fileSizeBytes > 0).length,
        totalClustersDetected: allClusters.length,
        highSeverityClustersCount,
        mediumSeverityClustersCount,
        lowSeverityClustersCount,
        suspiciousStudentsCount,
    };
}
