/**
 * Thread Analysis Orchestrator
 * Coordinates post rubric evaluations, CAD metadata cross-matching,
 * plagiarism cluster building, and report generation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadThreadConfig } from '../config/config-manager.js';
import type { ThreadConfig } from '../config/types.js';
import type { PostData, ThreadManifest } from '../preparation/types/manifest.js';
import {
    aggregateSessionSummaries,
    aggregateStudentSummaries,
    aggregateSummaryStats,
} from './aggregator/index.js';
import { evaluatePostSubmission } from './evaluator/post-evaluator.js';
import { buildPlagiarismClusters } from './matcher/cluster-builder.js';
import type {
    PlagiarizedFileRef,
    PostAnalysisResult,
    ThreadAnalysisReport,
} from './types/index.js';

export interface AnalyzeThreadOptions {
    /** Directory where prepared thread data is stored (default: 'data') */
    dataDir?: string;

    /** Custom path to config.json */
    configPath?: string;

    /** Pre-loaded ThreadConfig or overrides */
    config?: ThreadConfig;

    /** Custom output path for analysis report (default: data/<threadId>/analysis.json) */
    outputPath?: string;

    /** Whether to write report to disk (default: true) */
    saveReport?: boolean;

    /** Target only a specific session number */
    targetSession?: number;
}

/**
 * Loads a PostData file from disk
 */
function readPostData(postJsonPath: string): PostData | null {
    if (!fs.existsSync(postJsonPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(postJsonPath, 'utf8')) as PostData;
    } catch {
        return null;
    }
}

/**
 * Auto-populates analysis.sessions skeleton in thread config if currently empty
 */
function syncSessionConfigSkeleton(
    threadConfig: ThreadConfig,
    discoveredSessions: Set<number>,
    threadDir: string,
    customConfigPath?: string
): void {
    if (
        (!threadConfig.analysis?.sessions ||
            Object.keys(threadConfig.analysis.sessions).length === 0) &&
        discoveredSessions.size > 0
    ) {
        if (!threadConfig.analysis) {
            threadConfig.analysis = { templateRseWhitelists: [], sessions: {} };
        }
        if (!threadConfig.analysis.sessions) {
            threadConfig.analysis.sessions = {};
        }
        for (const sNum of Array.from(discoveredSessions).sort((a, b) => a - b)) {
            threadConfig.analysis.sessions[String(sNum)] = {
                title: `Buổi ${sNum}`,
                deadline: '',
                minCadFiles: 1,
                minImages: 1,
                maxAllowedInventorVersion: 2026,
            };
        }

        const cfgPath = customConfigPath
            ? path.resolve(process.cwd(), customConfigPath)
            : path.join(threadDir, 'config.json');
        if (fs.existsSync(cfgPath)) {
            try {
                fs.writeFileSync(cfgPath, JSON.stringify(threadConfig, null, 2), 'utf8');
            } catch {
                // ignore write error
            }
        }
    }
}

/**
 * Analyzes an entire thread and generates a comprehensive report
 */
export async function analyzeThread(
    threadId: string,
    options: AnalyzeThreadOptions = {}
): Promise<ThreadAnalysisReport> {
    const dataDir = options.dataDir ?? 'data';
    const threadDir = path.join(dataDir, threadId);

    // 1. Load Thread Configuration
    const threadConfig =
        options.config ??
        loadThreadConfig({
            dataDir,
            threadId,
            customPath: options.configPath,
        });

    // 2. Load Manifest
    const manifestPath = path.join(threadDir, 'thread.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error(
            `Thread manifest not found at ${manifestPath}. Run '4c-checker prepare ${threadId}' first.`
        );
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ThreadManifest;
    const postRecords = Object.values(manifest.posts ?? {});

    const postResults: PostAnalysisResult[] = [];
    const allCadFiles: PlagiarizedFileRef[] = [];
    let skippedPostsCount = 0;

    const discoveredSessions = new Set<number>();

    // 3. Evaluate each non-skipped post
    for (const record of postRecords) {
        if (record.skipProcessing === true) {
            skippedPostsCount++;
            continue;
        }

        const postJsonPath = path.join(
            threadDir,
            record.userFolder,
            record.postFolder,
            'post.json'
        );
        const postData = readPostData(postJsonPath);
        if (!postData) continue;

        if (postData.sessionIndex !== undefined && postData.sessionIndex > 0) {
            discoveredSessions.add(postData.sessionIndex);
        }

        // Filter by target session if requested
        if (
            options.targetSession !== undefined &&
            postData.sessionIndex !== options.targetSession
        ) {
            continue;
        }

        const sessionKey =
            postData.sessionIndex !== undefined ? String(postData.sessionIndex) : undefined;
        const sessionCriteria = sessionKey
            ? (threadConfig.analysis?.sessions?.[sessionKey] ??
              threadConfig.analysis?.defaultSessionCriteria)
            : threadConfig.analysis?.defaultSessionCriteria;

        const evaluatedPost = evaluatePostSubmission(
            postData,
            sessionCriteria,
            threadConfig.analysis?.templateRseWhitelists,
            threadConfig.analysis?.ignore
        );
        postResults.push(evaluatedPost);

        // Collect CAD files for cross-matching
        for (const cad of postData.cadSummaries ?? []) {
            allCadFiles.push({
                postId: postData.postId,
                postNumber: postData.postNumber,
                author: postData.author,
                sessionIndex: postData.sessionIndex,
                postDate: postData.postDate,
                fileName: cad.fileName,
                filePath: cad.filePath,
                localPath: cad.localPath,
                fileSizeBytes: cad.fileSizeBytes,
                creationDate: cad.creationDate,
                lastSavedDate: cad.lastSavedDate,
                lastSavedByWindowsUser: cad.lastSavedByWindowsUser,
                originalFilePath: cad.originalFilePath,
                softwareVersion: cad.softwareVersion,
                designer: cad.designer,
                authorName: cad.author,
                rseSegmentIds: cad.rseSegmentIds,
                geometryFingerprint: cad.geometryFingerprint,
                previewPath: cad.previewPath,
            });
        }
    }

    // 4. Run Forensic Plagiarism Cross-Matching
    const allClusters = buildPlagiarismClusters(
        allCadFiles,
        threadConfig.analysis?.templateRseWhitelists
    );

    // 5. Link Cluster IDs back to involved Posts
    const postMap = new Map<string, PostAnalysisResult>();
    for (const p of postResults) {
        postMap.set(p.postId, p);
    }

    for (const cluster of allClusters) {
        for (const file of cluster.files) {
            const post = postMap.get(file.postId);
            if (post && !post.involvedClusterIds.includes(cluster.clusterId)) {
                post.involvedClusterIds.push(cluster.clusterId);
            }
        }
    }

    // Auto-populate analysis.sessions skeleton if currently empty
    syncSessionConfigSkeleton(threadConfig, discoveredSessions, threadDir, options.configPath);

    // 6. Aggregate by Sessions
    const sessions = aggregateSessionSummaries(postResults, allClusters, threadConfig);
    const crossSessionClusters = allClusters.filter((c) => c.sessionIndex === undefined);

    // 7. Aggregate Student Summaries
    const students = aggregateStudentSummaries(postResults);

    // 8. Overall Metrics
    const stats = aggregateSummaryStats({
        totalPostsDiscovered: postRecords.length,
        postResults,
        skippedPostsCount,
        students,
        allCadFiles,
        allClusters,
    });

    const report: ThreadAnalysisReport = {
        $schema: 'https://raw.githubusercontent.com/4c-checker/schema/v1/analysis.json',
        threadId,
        title: threadConfig.title,
        analyzedAt: new Date().toISOString(),
        stats,
        sessions,
        crossSessionClusters,
        students,
        allClusters,
    };

    // 9. Save to disk if requested
    if (options.saveReport !== false) {
        const outPath = options.outputPath ?? path.join(threadDir, 'analysis.json');
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    }

    return report;
}
