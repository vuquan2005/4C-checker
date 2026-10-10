/**
 * CAD 3D Preview Extractor
 * Extracts embedded raster PNG (512x512) thumbnails directly from Autodesk Inventor CAD files (.ipt, .iam, .ipn)
 */
import fs from 'node:fs';
import path from 'node:path';
import * as CFB from 'cfb';
import type { ExtractedPreview } from '../types/cad.js';
import { createLogger } from '../utils/logger.js';
import { ensureDir } from '../utils/file-utils.js';

const log = createLogger('PreviewExtractor');

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND_CHUNK = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

/**
 * Extract raw contiguous PNG bytes from a buffer
 */
function extractRawPng(buffer: Buffer): ExtractedPreview | null {
    const pngStart = buffer.indexOf(PNG_HEADER);
    if (pngStart === -1) {
        return null;
    }

    // Try chunk walking first
    let pos = pngStart + 8;
    while (pos + 8 <= buffer.length) {
        const chunkLen = buffer.readUInt32BE(pos);
        const chunkType = buffer.subarray(pos + 4, pos + 8).toString('ascii');
        pos += 8 + chunkLen + 4;
        if (chunkType === 'IEND') {
            if (pos <= buffer.length) {
                const pngBuffer = buffer.subarray(pngStart, pos);
                return parsePngDetails(pngBuffer);
            }
            break;
        }
    }

    // Fallback: search for IEND chunk magic
    const iendIndex = buffer.indexOf(PNG_IEND_CHUNK, pngStart);
    if (iendIndex !== -1) {
        const pngEnd = iendIndex + PNG_IEND_CHUNK.length;
        const pngBuffer = buffer.subarray(pngStart, pngEnd);
        return parsePngDetails(pngBuffer);
    }

    // Fallback: search for "IEND" string
    const iendAscii = buffer.indexOf(Buffer.from('IEND'), pngStart);
    if (iendAscii === -1) {
        log.w('PNG start found but IEND chunk missing');
        return null;
    }
    const pngEnd = iendAscii + 8; // IEND (4 bytes) + CRC (4 bytes)
    const pngBuffer = buffer.subarray(pngStart, pngEnd);
    return parsePngDetails(pngBuffer);
}

/**
 * Extract embedded PNG preview thumbnail from a buffer.
 * If the buffer is an OLE Compound File (CFBF/Autodesk Inventor .ipt/.iam/.ipn),
 * extracts the stream first so that fragmented/interleaved sectors are assembled properly.
 */
export function extractPreviewFromBuffer(buffer: Buffer): ExtractedPreview | null {
    // 1. Try extracting from OLE Compound Document (CFBF) streams
    try {
        const cfb = CFB.read(buffer, { type: 'buffer' });

        // Inventor stores the preview in the Inventor Summary Information stream:
        // entryPath typically includes 'Zrxrt4arFafyu34gYa3l3ohgHg'
        const summaryPath = cfb.FullPaths.find((p) => p.includes('Zrxrt4arFafyu34gYa3l3ohgHg'));
        if (summaryPath) {
            const entry = CFB.find(cfb, summaryPath);
            if (entry && entry.content) {
                const preview = extractRawPng(Buffer.from(entry.content));
                if (preview) {
                    return preview;
                }
            }
        }

        // Check any other stream containing PNG header in the CFB container
        for (const entryPath of cfb.FullPaths) {
            if (entryPath === summaryPath) continue;
            const entry = CFB.find(cfb, entryPath);
            if (entry && entry.content) {
                const entryBuffer = Buffer.from(entry.content);
                if (entryBuffer.includes(PNG_HEADER)) {
                    const preview = extractRawPng(entryBuffer);
                    if (preview) {
                        return preview;
                    }
                }
            }
        }
    } catch {
        // Fallback if CFB parse fails (e.g. non-OLE buffer, partial buffer)
    }

    // 2. Direct contiguous buffer fallback
    const rawPreview = extractRawPng(buffer);
    if (!rawPreview) {
        log.d('No PNG header magic found in buffer');
    }
    return rawPreview;
}

function parsePngDetails(pngBuffer: Buffer): ExtractedPreview | null {
    if (pngBuffer.length < 24) return null;

    // In PNG format, IHDR chunk immediately follows 8-byte header:
    // Offset 8-11: chunk length (usually 13)
    // Offset 12-15: "IHDR"
    // Offset 16-19: Width (32-bit big endian)
    // Offset 20-23: Height (32-bit big endian)
    let width = 512;
    let height = 512;

    try {
        if (pngBuffer.subarray(12, 16).toString('ascii') === 'IHDR') {
            width = pngBuffer.readUInt32BE(16);
            height = pngBuffer.readUInt32BE(20);
        }
    } catch {
        // Keep default dimensions if parse fails
    }

    return {
        buffer: pngBuffer,
        width,
        height,
        format: 'png',
    };
}

/**
 * Extract embedded 3D preview thumbnail from a CAD file path (.ipt, .iam, .ipn)
 */
export function extractPreviewFromFile(filePath: string): ExtractedPreview | null {
    if (!fs.existsSync(filePath)) {
        log.e(`File not found: ${filePath}`);
        return null;
    }

    try {
        const buffer = fs.readFileSync(filePath);
        return extractPreviewFromBuffer(buffer);
    } catch (err) {
        log.e(`Failed to read CAD file for preview extraction: ${filePath}`, err);
        return null;
    }
}

/**
 * Save extracted preview to a PNG file on disk
 * Returns true if successful
 */
export function savePreviewToFile(cadFilePath: string, outputPngPath: string): boolean {
    const preview = extractPreviewFromFile(cadFilePath);
    if (!preview) {
        return false;
    }

    try {
        ensureDir(path.dirname(outputPngPath));
        fs.writeFileSync(outputPngPath, preview.buffer);
        log.d(`Saved preview (${preview.width}x${preview.height}) to ${outputPngPath}`);
        return true;
    } catch (err) {
        log.e(`Failed to save preview image to ${outputPngPath}`, err);
        return false;
    }
}
