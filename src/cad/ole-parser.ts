/* eslint-disable no-control-regex */
/**
 * CAD OLE Metadata Parser
 * Reads Autodesk Inventor Compound File Binary Format (CFBF/OLE) streams,
 * extracting software versions, author, original machine path, timestamps,
 * RSe segment origin fingerprints, and model geometry hashes.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as CFB from 'cfb';
import type { CadMetadata } from '../types/cad.js';
import { extractPreviewFromBuffer } from './preview-extractor.js';

/**
 * Extract printable strings from UTF-16LE buffer
 */
function extractUtf16Strings(buffer: Buffer): string[] {
    const text = buffer.toString('utf16le');
    const strings: string[] = [];
    const parts = text.split('\x00');

    for (const part of parts) {
        const cleaned = part.trim();
        if (cleaned.length >= 2 && /^[\x20-\x7E\u00A0-\u024F\u1EA0-\u1EF9]+$/.test(cleaned)) {
            strings.push(cleaned);
        }
    }
    return strings;
}

/**
 * Parse CAD metadata and origin fingerprints from an Autodesk Inventor file (.ipt, .iam, .ipn)
 */
export function parseCadMetadata(filePath: string): CadMetadata {
    const resolvedPath = path.resolve(filePath);
    const fileName = path.basename(resolvedPath);
    const fileExtension = path.extname(resolvedPath).toLowerCase();

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`CAD file not found: ${resolvedPath}`);
    }

    const fileBuffer = fs.readFileSync(resolvedPath);
    const fileSizeBytes = fileBuffer.length;

    const metadata: CadMetadata = {
        filePath: resolvedPath,
        fileName,
        fileExtension,
        fileSizeBytes,
        hasPreview: false,
        rseSegmentIds: [],
    };

    // 1. 3D Preview thumbnail inspection
    const preview = extractPreviewFromBuffer(fileBuffer);
    if (preview) {
        metadata.hasPreview = true;
        metadata.previewWidth = preview.width;
        metadata.previewHeight = preview.height;
        metadata.previewSizeBytes = preview.buffer.length;
    }

    // 2. Timestamps search across binary
    const utf8Content = fileBuffer.toString('utf8');
    const dateMatches = utf8Content.match(/\b\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}\b/g);
    if (dateMatches && dateMatches.length > 0) {
        const uniqueDates = Array.from(new Set(dateMatches));
        metadata.creationDate = uniqueDates[0];
        metadata.lastSavedDate = uniqueDates[uniqueDates.length - 1];
    }

    // 3. Search for Windows absolute file path of student's machine
    const utf16Full = fileBuffer.toString('utf16le');
    const pathMatches = utf16Full.match(/[A-Za-z]:\\[^<>":|?*\x00-\x1f]+\.ip[tamn]/gi) || [];
    const userPath =
        pathMatches.find((p) => !p.toLowerCase().includes('templates')) || pathMatches[0];
    if (userPath) {
        metadata.originalFilePath = userPath;
    }

    // 4. Parse OLE Compound Document Streams
    try {
        const cfb = CFB.read(fileBuffer, { type: 'buffer' });
        const brepSizes: number[] = [];
        const brepHash = crypto.createHash('sha256');
        const segmentIds: string[] = [];

        for (const entryPath of cfb.FullPaths) {
            const entry = CFB.find(cfb, entryPath);
            if (!entry || !entry.content) continue;

            const entryBuffer = Buffer.from(entry.content);

            // Collect RSe Segment Storage IDs (Origin fingerprint) & geometry sizes
            if (entryPath.includes('RSeStorage/B')) {
                const segName = path.basename(entryPath);
                segmentIds.push(segName);
                brepSizes.push(entryBuffer.length);
                brepHash.update(entryBuffer);
            }

            // Design Tracking Control (Stores the Windows username of the machine modifying the file)
            if (entryPath.includes('Qz4dgm1gRjudbpksAayal4qdGf')) {
                const dtcStrings = extractUtf16Strings(entryBuffer);
                for (const str of dtcStrings) {
                    if (
                        str !== 'Design Tracking Control' &&
                        str !== 'Property Set Name' &&
                        !str.includes('\\')
                    ) {
                        metadata.lastSavedByWindowsUser = str;
                        break;
                    }
                }
            }

            // Design Tracking Properties
            if (entryPath.includes('PypkizqiUjudbposAayal4qdGf')) {
                const verMatch = entryBuffer
                    .toString('utf16le')
                    .match(/20\d{2}(?:\.\d+)?\s*\([^)]+\)/);
                if (verMatch) {
                    metadata.softwareVersion = verMatch[0];
                }

                const strings = extractUtf16Strings(entryBuffer);
                for (let i = 0; i < strings.length; i++) {
                    const str = strings[i];
                    if (str === 'Design Tracking Properties' || str === 'Property Set Name')
                        continue;

                    if (
                        !metadata.partNumber &&
                        str.length > 0 &&
                        !str.includes('Build') &&
                        !str.includes('\\')
                    ) {
                        metadata.partNumber = str;
                    } else if (
                        metadata.partNumber &&
                        !metadata.designer &&
                        str !== metadata.partNumber &&
                        !str.includes('Build') &&
                        !str.includes('\\')
                    ) {
                        if (['Modeling', 'Standard', 'Generic', 'Default'].includes(str)) {
                            const next = strings[i + 1];
                            if (
                                next &&
                                !['Modeling', 'Generic', 'Default'].includes(next) &&
                                !next.includes('Build') &&
                                !next.includes('\\')
                            ) {
                                metadata.designer = next;
                            }
                        } else {
                            metadata.designer = str;
                        }
                    }
                }
            }

            // Inventor Summary Information
            if (entryPath.includes('Zrxrt4arFafyu34gYa3l3ohgHg')) {
                const strings = extractUtf16Strings(entryBuffer);
                for (const str of strings) {
                    if (str !== 'Inventor Summary Information' && str !== 'Property Set Name') {
                        if (!metadata.author && str.length > 1) {
                            metadata.author = str;
                        }
                    }
                }
            }
        }

        metadata.rseSegmentIds = segmentIds;

        if (brepSizes.length > 0) {
            metadata.geometryFingerprint = {
                totalStreams: brepSizes.length,
                brepStreamSizes: brepSizes,
                contentHash: brepHash.digest('hex').substring(0, 16),
            };
        }
    } catch {
        // Safe fallback if OLE read fails
    }

    return metadata;
}
