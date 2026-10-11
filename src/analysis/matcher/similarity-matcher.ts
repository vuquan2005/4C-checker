/**
 * Similarity & Plagiarism Forensic Matcher
 * Analyzes CAD metadata across multiple submissions to detect identical
 * RSe segment roots, geometry hashes, identical creation dates, and borrowed footprints.
 */
import type { CadMetadata } from '../../types/cad.js';
import type { PlagiarismMatchType, PlagiarizedFileRef } from '../types/index.js';

/**
 * Normalizes an array of 8 RSe segment IDs into a canonical sorted comma-separated string
 */
export function normalizeRseSignature(segmentIds?: string[]): string {
    if (!segmentIds || segmentIds.length === 0) return '';
    return [...segmentIds]
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .sort()
        .join(',');
}

/**
 * Checks if a given RSe signature matches any whitelisted instructor template signatures
 */
export function isWhitelistedTemplate(
    segmentIds: string[] | undefined,
    templateWhitelists: string[][] | undefined
): boolean {
    if (
        !segmentIds ||
        segmentIds.length === 0 ||
        !templateWhitelists ||
        templateWhitelists.length === 0
    ) {
        return false;
    }

    const targetSignature = normalizeRseSignature(segmentIds);
    if (!targetSignature) return false;

    return templateWhitelists.some((templateList) => {
        const templateSignature = normalizeRseSignature(templateList);
        return templateSignature === targetSignature;
    });
}

/**
 * Generates a unique signature for geometry fingerprint
 */
export function normalizeGeometrySignature(
    fingerprint?: CadMetadata['geometryFingerprint']
): string {
    if (!fingerprint) return '';
    const hash = fingerprint.contentHash ? fingerprint.contentHash.trim().toLowerCase() : '';
    const sizes = fingerprint.brepStreamSizes ? fingerprint.brepStreamSizes.join(',') : '';
    if (!hash && !sizes) return '';
    return `geom:${hash}:${sizes}`;
}

/**
 * Normalizes creation date timestamp string for comparison
 */
export function normalizeCreationDate(creationDate?: string): string {
    if (!creationDate) return '';
    return creationDate.trim().toLowerCase();
}

/**
 * Inspects whether a file's Windows footprint (username or originalFilePath)
 * resembles another student's identity.
 */
export function detectBorrowedFootprint(
    file: PlagiarizedFileRef,
    otherStudentUsername: string
): { borrowedUser: boolean; borrowedPath: boolean } {
    if (!otherStudentUsername) {
        return { borrowedUser: false, borrowedPath: false };
    }

    // Clean username to ascii alphanumeric parts for partial matching
    // e.g. "Ha Phuc Khanh" -> ["ha", "phuc", "khanh"]
    const nameTokens = otherStudentUsername
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^a-z0-9]+/g)
        .filter((t) => t.length > 2);

    if (nameTokens.length === 0) {
        return { borrowedUser: false, borrowedPath: false };
    }

    let borrowedUser = false;
    if (file.lastSavedByWindowsUser) {
        const winUserNorm = file.lastSavedByWindowsUser
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
        // Check if Windows user matches full username or contains substantial name tokens
        if (winUserNorm.length >= 3 && nameTokens.some((t) => winUserNorm.includes(t))) {
            borrowedUser = true;
        }
    }

    let borrowedPath = false;
    if (file.originalFilePath) {
        const pathNorm = file.originalFilePath
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
        if (nameTokens.some((t) => pathNorm.includes(t))) {
            borrowedPath = true;
        }
    }

    return { borrowedUser, borrowedPath };
}

/**
 * Compares two CAD files from different students and returns detected matching criteria
 */
export function compareCadFiles(
    fileA: PlagiarizedFileRef,
    fileB: PlagiarizedFileRef,
    templateWhitelists?: string[][]
): {
    matched: boolean;
    matchTypes: PlagiarismMatchType[];
    evidence: string[];
} {
    const matchTypes: PlagiarismMatchType[] = [];
    const evidence: string[] = [];

    // 1. Check RSe Segment IDs (Indelible binary root)
    const sigA = normalizeRseSignature(fileA.rseSegmentIds);
    const sigB = normalizeRseSignature(fileB.rseSegmentIds);
    const isTemplate =
        isWhitelistedTemplate(fileA.rseSegmentIds, templateWhitelists) ||
        isWhitelistedTemplate(fileB.rseSegmentIds, templateWhitelists);

    if (sigA && sigB && sigA === sigB) {
        if (!isTemplate) {
            matchTypes.push('identical_rse_segments');
            evidence.push(`RSE_SEGMENT_MATCH:${fileA.fileName}:${fileB.fileName}`);
        }
    }

    // 2. Check Geometry Fingerprint
    const geomA = normalizeGeometrySignature(fileA.geometryFingerprint);
    const geomB = normalizeGeometrySignature(fileB.geometryFingerprint);
    if (geomA && geomB && geomA === geomB && !isTemplate) {
        matchTypes.push('identical_geometry');
        const hash = fileA.geometryFingerprint?.contentHash || '';
        evidence.push(`GEOMETRY_MATCH:${hash}:${fileA.fileName}:${fileB.fileName}`);
    }

    // 3. Check Creation Date
    const dateA = normalizeCreationDate(fileA.creationDate);
    const dateB = normalizeCreationDate(fileB.creationDate);
    if (dateA && dateB && dateA === dateB && !isTemplate) {
        matchTypes.push('identical_creation_date');
        evidence.push(
            `CREATION_DATE_MATCH:${fileA.creationDate || ''}:${fileA.fileName}:${fileB.fileName}`
        );
    }

    // 4. Check Footprints (borrowed username / original file path)
    const footAtoB = detectBorrowedFootprint(fileA, fileB.author.username);
    if (footAtoB.borrowedUser) {
        matchTypes.push('borrowed_windows_user');
        evidence.push(
            `BORROWED_WINDOWS_USER:${fileA.lastSavedByWindowsUser || ''}:${fileA.fileName}:${fileB.author.username}`
        );
    }
    if (footAtoB.borrowedPath) {
        matchTypes.push('borrowed_original_path');
        evidence.push(
            `BORROWED_ORIGINAL_PATH:${fileA.originalFilePath || ''}:${fileA.fileName}:${fileB.author.username}`
        );
    }

    const footBtoA = detectBorrowedFootprint(fileB, fileA.author.username);
    if (footBtoA.borrowedUser) {
        matchTypes.push('borrowed_windows_user');
        evidence.push(
            `BORROWED_WINDOWS_USER:${fileB.lastSavedByWindowsUser || ''}:${fileB.fileName}:${fileA.author.username}`
        );
    }
    if (footBtoA.borrowedPath) {
        matchTypes.push('borrowed_original_path');
        evidence.push(
            `BORROWED_ORIGINAL_PATH:${fileB.originalFilePath || ''}:${fileB.fileName}:${fileA.author.username}`
        );
    }

    return {
        matched: matchTypes.length > 0,
        matchTypes: [...new Set(matchTypes)],
        evidence: [...new Set(evidence)],
    };
}
