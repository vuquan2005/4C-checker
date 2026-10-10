/**
 * Plagiarism Cluster Builder
 * Aggregates individual CAD file comparisons into forensic clusters
 * distinguishing original submissions from copies.
 */
import type { PostAuthorSummary } from '../../types/post.js';
import type {
    PlagiarismCluster,
    PlagiarismMatchType,
    PlagiarismSeverity,
    PlagiarizedFileRef,
} from '../types/index.js';
import {
    compareCadFiles,
    isWhitelistedTemplate,
    normalizeGeometrySignature,
    normalizeRseSignature,
} from './similarity-matcher.js';

/**
 * Sorts file references to determine the chronologically earliest submission
 */
function sortFilesChronologically(files: PlagiarizedFileRef[]): PlagiarizedFileRef[] {
    return [...files].sort((a, b) => {
        const timeA = new Date(a.postDate).getTime();
        const timeB = new Date(b.postDate).getTime();
        if (!isNaN(timeA) && !isNaN(timeB) && timeA !== timeB) {
            return timeA - timeB;
        }

        // Secondary sort: last saved date if post date is identical
        if (a.lastSavedDate && b.lastSavedDate) {
            const saveA = new Date(a.lastSavedDate).getTime();
            const saveB = new Date(b.lastSavedDate).getTime();
            if (!isNaN(saveA) && !isNaN(saveB) && saveA !== saveB) {
                return saveA - saveB;
            }
        }

        return a.postNumber - b.postNumber;
    });
}

/**
 * Extracts distinct authors from a list of file references
 */
function getDistinctAuthors(files: PlagiarizedFileRef[]): PostAuthorSummary[] {
    const authorMap = new Map<string, PostAuthorSummary>();
    for (const f of files) {
        if (!authorMap.has(f.author.uid)) {
            authorMap.set(f.author.uid, f.author);
        }
    }
    return Array.from(authorMap.values());
}

/**
 * Determines the cluster session scope
 */
function resolveClusterSession(files: PlagiarizedFileRef[]): number | undefined {
    const sessions = new Set<number>();
    for (const f of files) {
        if (f.sessionIndex !== undefined && f.sessionIndex > 0) {
            sessions.add(f.sessionIndex);
        }
    }
    if (sessions.size === 1) {
        return Array.from(sessions)[0];
    }
    return undefined; // Cross-session
}

/**
 * Evaluates the severity level for a cluster
 */
function evaluateClusterSeverity(matchTypes: PlagiarismMatchType[]): PlagiarismSeverity {
    if (
        matchTypes.includes('identical_rse_segments') ||
        matchTypes.includes('identical_geometry') ||
        matchTypes.includes('borrowed_windows_user')
    ) {
        return 'high';
    }
    if (matchTypes.includes('identical_creation_date')) {
        return 'medium';
    }
    return 'low';
}

/**
 * Builds plagiarism clusters from an array of student CAD files
 */
export function buildPlagiarismClusters(
    files: PlagiarizedFileRef[],
    templateWhitelists?: string[][]
): PlagiarismCluster[] {
    const clusters: PlagiarismCluster[] = [];

    // 1. Group by RSe signature (Storage Binary Root)
    const rseGroups = new Map<string, PlagiarizedFileRef[]>();
    for (const file of files) {
        if (!file.rseSegmentIds || file.rseSegmentIds.length === 0) continue;
        if (isWhitelistedTemplate(file.rseSegmentIds, templateWhitelists)) continue;

        const sig = normalizeRseSignature(file.rseSegmentIds);
        if (!sig) continue;

        const group = rseGroups.get(sig) ?? [];
        group.push(file);
        rseGroups.set(sig, group);
    }

    let clusterCounter = 1;
    const handledFilePaths = new Set<string>();

    for (const [rseSig, groupedFiles] of rseGroups.entries()) {
        const distinctAuthors = getDistinctAuthors(groupedFiles);
        // Only consider plagiarism if multiple distinct students share the root
        if (distinctAuthors.length < 2) continue;

        const sorted = sortFilesChronologically(groupedFiles);
        const suspectedOriginal = sorted[0];
        const suspectedCopies = sorted.slice(1);

        const matchTypes: PlagiarismMatchType[] = ['identical_rse_segments'];
        const evidence: string[] = [
            `Trùng khớp 100% bộ 8 mã RSe Storage Segment IDs giữa các bài nộp của ${distinctAuthors.map((a) => a.username).join(', ')}`,
        ];

        // Perform cross file comparisons to accumulate additional evidence
        for (let i = 0; i < sorted.length; i++) {
            for (let j = i + 1; j < sorted.length; j++) {
                const comparison = compareCadFiles(sorted[i], sorted[j], templateWhitelists);
                for (const m of comparison.matchTypes) {
                    if (!matchTypes.includes(m)) matchTypes.push(m);
                }
                for (const e of comparison.evidence) {
                    if (!evidence.includes(e)) evidence.push(e);
                }
            }
        }

        const sessionIndex = resolveClusterSession(sorted);
        const severity = evaluateClusterSeverity(matchTypes);

        clusters.push({
            clusterId: `cluster_${clusterCounter++}`,
            sessionIndex,
            matchTypes,
            severity,
            title: `Cụm trùng nguồn gốc file RSe: ${suspectedOriginal.fileName}`,
            description: `Phát hiện ${sorted.length} tệp CAD có cùng phân đoạn nhị phân RSe giữa ${distinctAuthors.length} sinh viên (${distinctAuthors.map((a) => a.username).join(', ')}). Bản nộp sớm nhất thuộc về ${suspectedOriginal.author.username}.`,
            evidence,
            signature: rseSig,
            files: sorted,
            authors: distinctAuthors,
            suspectedOriginal,
            suspectedCopies,
        });

        for (const f of sorted) {
            handledFilePaths.add(f.filePath);
        }
    }

    // 2. Group by identical Geometry (for remaining files that might have different RSe but identical 3D body)
    const geomGroups = new Map<string, PlagiarizedFileRef[]>();
    for (const file of files) {
        if (handledFilePaths.has(file.filePath)) continue;
        if (!file.geometryFingerprint) continue;

        const geomSig = normalizeGeometrySignature(file.geometryFingerprint);
        if (!geomSig) continue;

        const group = geomGroups.get(geomSig) ?? [];
        group.push(file);
        geomGroups.set(geomSig, group);
    }

    for (const [geomSig, groupedFiles] of geomGroups.entries()) {
        const distinctAuthors = getDistinctAuthors(groupedFiles);
        if (distinctAuthors.length < 2) continue;

        const sorted = sortFilesChronologically(groupedFiles);
        const suspectedOriginal = sorted[0];
        const suspectedCopies = sorted.slice(1);

        const matchTypes: PlagiarismMatchType[] = ['identical_geometry'];
        const evidence: string[] = [
            `Trùng khớp mã băm hình học B-Rep (${suspectedOriginal.geometryFingerprint?.contentHash}) giữa ${distinctAuthors.map((a) => a.username).join(', ')}`,
        ];

        for (let i = 0; i < sorted.length; i++) {
            for (let j = i + 1; j < sorted.length; j++) {
                const comparison = compareCadFiles(sorted[i], sorted[j], templateWhitelists);
                for (const m of comparison.matchTypes) {
                    if (!matchTypes.includes(m)) matchTypes.push(m);
                }
                for (const e of comparison.evidence) {
                    if (!evidence.includes(e)) evidence.push(e);
                }
            }
        }

        const sessionIndex = resolveClusterSession(sorted);
        const severity = evaluateClusterSeverity(matchTypes);

        clusters.push({
            clusterId: `cluster_${clusterCounter++}`,
            sessionIndex,
            matchTypes,
            severity,
            title: `Cụm trùng mô hình 3D (B-Rep): ${suspectedOriginal.fileName}`,
            description: `Phát hiện ${sorted.length} tệp CAD có cùng cấu trúc hình học B-Rep giống hệt nhau giữa ${distinctAuthors.length} sinh viên.`,
            evidence,
            signature: geomSig,
            files: sorted,
            authors: distinctAuthors,
            suspectedOriginal,
            suspectedCopies,
        });

        for (const f of sorted) {
            handledFilePaths.add(f.filePath);
        }
    }

    return clusters;
}
