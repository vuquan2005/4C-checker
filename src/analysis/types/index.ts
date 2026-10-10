/**
 * Analysis Module Types
 * Data structures for post evaluation, cross-matching plagiarism detection,
 * and comprehensive thread analysis reports.
 */
import type { PostAuthorSummary } from '../../types/post.js';
import type { CadMetadata } from '../../types/cad.js';

/**
 * Types of plagiarism / similarity evidence detected between submissions
 */
export type PlagiarismMatchType =
    | 'identical_rse_segments' // Exactly matching 8 RSe segment IDs (same file origin)
    | 'identical_geometry' // Exactly matching B-Rep stream sizes and content hash
    | 'identical_creation_date' // Exact creation timestamp match down to the second
    | 'borrowed_windows_user' // Windows username matches another student's identity
    | 'borrowed_original_path'; // Original Windows file path contains another student's username/folder

/**
 * Severity level of detected plagiarism
 */
export type PlagiarismSeverity = 'high' | 'medium' | 'low';

/**
 * Reference to an individual CAD file involved in a plagiarism incident
 */
export interface PlagiarizedFileRef {
    postId: string;
    postNumber: number;
    author: PostAuthorSummary;
    sessionIndex?: number;
    postDate: string;
    fileName: string;
    filePath: string;
    localPath?: string;
    fileSizeBytes: number;
    creationDate?: string;
    lastSavedDate?: string;
    lastSavedByWindowsUser?: string;
    originalFilePath?: string;
    softwareVersion?: string;
    designer?: string;
    authorName?: string;
    rseSegmentIds?: string[];
    geometryFingerprint?: CadMetadata['geometryFingerprint'];
    previewPath?: string;
}

/**
 * A cluster of files/students exhibiting suspicious code/model sharing
 */
export interface PlagiarismCluster {
    /** Unique cluster identifier (e.g. "cluster_rse_1", "cluster_geom_2") */
    clusterId: string;

    /** Session index where this cluster belongs, or undefined if cross-session */
    sessionIndex?: number;

    /** Primary reason / match types connecting the files in this cluster */
    matchTypes: PlagiarismMatchType[];

    /** Severity rating */
    severity: PlagiarismSeverity;

    /** Human-readable title */
    title: string;

    /** Human-readable explanation of why this cluster is suspicious */
    description: string;

    /** Bullet points of factual forensic evidence */
    evidence: string[];

    /** Common signature that grouped these files (e.g. RSe segments string, hash, or creationDate) */
    signature: string;

    /** All files participating in this cluster */
    files: PlagiarizedFileRef[];

    /** Distinct authors involved */
    authors: PostAuthorSummary[];

    /** Suspected original submission (e.g. earliest postDate or earliest save date) */
    suspectedOriginal?: PlagiarizedFileRef;

    /** Suspected copy submissions */
    suspectedCopies: PlagiarizedFileRef[];
}

/**
 * Per-file evaluation status within a post
 */
export interface PostCadFileEvaluation {
    fileName: string;
    localPath: string;
    fileSizeBytes: number;
    softwareVersion?: string;
    creationDate?: string;
    lastSavedDate?: string;
    lastSavedByWindowsUser?: string;
    isTemplateMatched?: boolean;
    hasPreview: boolean;
    previewPath?: string;
    warnings: string[];
}

/**
 * Evaluation of all CAD assets in a single post
 */
export interface PostCadEvaluation {
    totalCadFiles: number;
    validCadFiles: number;
    files: PostCadFileEvaluation[];
    detectedInventorVersions: string[];
    isExceedingMaxVersion?: boolean;
}

/**
 * Analysis result for an individual post / submission
 */
export interface PostAnalysisResult {
    postId: string;
    postNumber: number;
    postUrl: string;
    author: PostAuthorSummary;
    userFolder: string;
    postFolder: string;
    postDate: string;
    sessionIndex?: number;
    declaredSession?: number;
    inferredSession?: number;
    sessionOverride: number | null;
    sessionSource?: string;

    /** Cad analysis results */
    cadEvaluation: PostCadEvaluation;

    /** Number of forum screenshot images attached */
    imageCount: number;

    /** Drive download status */
    driveStatus: string;

    /** Whether the post was submitted past the session deadline */
    isLate?: boolean;

    /** Deadline timestamp used for comparison (if configured) */
    sessionDeadline?: string;

    /** Whether the submission fulfilled all session criteria */
    passedCriteria: boolean;

    /** Specific criteria violation reasons if passedCriteria is false */
    criteriaViolations: string[];

    /** Forum / data preparation warnings preserved */
    warnings: string[];

    /** Categorized URL, link, and BBCode formatting warnings from forum post */
    urlWarnings: string[];

    /** Categorized session detection, conflict, and override warnings */
    sessionWarnings: string[];

    /** Categorized Google Drive download and folder layout warnings */
    driveWarnings: string[];

    /** IDs of plagiarism clusters this post is involved in */
    involvedClusterIds: string[];
}

/**
 * Summary statistics for a specific course session
 */
export interface SessionAnalysisSummary {
    sessionIndex: number;
    title?: string;
    deadline?: string;
    minCadFiles?: number;
    minImages?: number;
    maxAllowedInventorVersion?: number;

    /** Counts */
    totalSubmissions: number;
    passedSubmissionsCount: number;
    failedSubmissionsCount: number;
    lateSubmissionsCount: number;
    clustersCount: number;

    /** Submissions in this session */
    posts: PostAnalysisResult[];

    /** Plagiarism clusters detected within this session */
    clusters: PlagiarismCluster[];
}

/**
 * Aggregated summary for a single student across all sessions
 */
export interface StudentAnalysisSummary {
    uid: string;
    username: string;
    userFolder: string;
    totalSubmissions: number;
    submittedSessions: number[];
    missingSessions: number[];
    lateSubmissionsCount: number;
    criteriaFailedCount: number;
    plagiarismInvolvementCount: number;
    involvedClusterIds: string[];
}

/**
 * Overall summary metrics for the whole thread
 */
export interface AnalysisSummaryStats {
    totalPostsDiscovered: number;
    totalPostsAnalyzed: number;
    totalPostsSkipped: number;
    totalStudents: number;
    totalCadFiles: number;
    totalValidCadFiles: number;
    totalClustersDetected: number;
    highSeverityClustersCount: number;
    mediumSeverityClustersCount: number;
    lowSeverityClustersCount: number;
    suspiciousStudentsCount: number;
}

/**
 * Root output schema written to `data/<threadId>/analysis.json`
 */
export interface ThreadAnalysisReport {
    $schema?: string;
    threadId: string;
    title?: string;
    analyzedAt: string;
    stats: AnalysisSummaryStats;
    sessions: Record<string, SessionAnalysisSummary>;
    crossSessionClusters: PlagiarismCluster[];
    students: Record<string, StudentAnalysisSummary>;
    allClusters: PlagiarismCluster[];
}
