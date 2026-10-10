/**
 * Image Utilities Module
 * Fast, lightweight binary header parser for PNG, JPEG, GIF, and WebP images.
 * Reads image dimensions without loading entire file into memory or requiring external native dependencies.
 */
import fs from 'node:fs';

export interface ImageDimensions {
    format: 'png' | 'jpeg' | 'gif' | 'webp';
    width: number;
    height: number;
}

export interface ImageFileInfo {
    fileSizeBytes: number;
    width?: number;
    height?: number;
    format?: 'png' | 'jpeg' | 'gif' | 'webp';
}

/**
 * Reads image format and pixel dimensions from a buffer or file path
 * Reads at most 1024 bytes from the start of the file.
 */
export function readImageDimensions(filePathOrBuffer: string | Buffer): ImageDimensions | null {
    let buf: Buffer;

    if (typeof filePathOrBuffer === 'string') {
        if (!fs.existsSync(filePathOrBuffer)) return null;
        let fd: number | undefined;
        try {
            fd = fs.openSync(filePathOrBuffer, 'r');
            const temp = Buffer.alloc(1024);
            const bytesRead = fs.readSync(fd, temp, 0, 1024, 0);
            buf = temp.subarray(0, bytesRead);
        } catch {
            return null;
        } finally {
            if (fd !== undefined) {
                try {
                    fs.closeSync(fd);
                } catch {
                    // Ignore close error
                }
            }
        }
    } else {
        buf = filePathOrBuffer;
    }

    if (buf.length < 8) return null;

    // 1. PNG: Signature [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    if (buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
        if (buf.length >= 24) {
            return {
                format: 'png',
                width: buf.readUInt32BE(16),
                height: buf.readUInt32BE(20),
            };
        }
    }

    // 2. GIF: "GIF87a" or "GIF89a"
    const gifSig = buf.toString('ascii', 0, 6);
    if (gifSig === 'GIF87a' || gifSig === 'GIF89a') {
        if (buf.length >= 10) {
            return {
                format: 'gif',
                width: buf.readUInt16LE(6),
                height: buf.readUInt16LE(8),
            };
        }
    }

    // 3. JPEG: Starts with 0xFF, 0xD8
    if (buf[0] === 0xff && buf[1] === 0xd8) {
        let offset = 2;
        while (offset < buf.length - 8) {
            if (buf[offset] !== 0xff) {
                offset++;
                continue;
            }
            const marker = buf[offset + 1];
            // SOF markers: C0 (Baseline), C1 (Extended), C2 (Progressive)
            if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
                return {
                    format: 'jpeg',
                    height: buf.readUInt16BE(offset + 5),
                    width: buf.readUInt16BE(offset + 7),
                };
            }
            if (offset + 4 > buf.length) break;
            const len = buf.readUInt16BE(offset + 2);
            offset += 2 + len;
        }
    }

    // 4. WebP: Starts with RIFF...WEBP
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
        const type = buf.toString('ascii', 12, 16);
        // Simple VP8 (lossy)
        if (type === 'VP8 ' && buf.length >= 30) {
            return {
                format: 'webp',
                width: buf.readUInt16LE(26) & 0x3fff,
                height: buf.readUInt16LE(28) & 0x3fff,
            };
        }
        // VP8L (lossless)
        if (type === 'VP8L' && buf.length >= 25) {
            const b1 = buf[21];
            const b2 = buf[22];
            const b3 = buf[23];
            const b4 = buf[24];
            const width = 1 + (((b2 & 0x3f) << 8) | b1);
            const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
            return {
                format: 'webp',
                width,
                height,
            };
        }
    }

    return null;
}

/**
 * Gets file size and image dimensions for a local image file
 */
export function getImageFileInfo(filePath: string): ImageFileInfo | null {
    if (!fs.existsSync(filePath)) return null;
    try {
        const stat = fs.statSync(filePath);
        const dims = readImageDimensions(filePath);
        return {
            fileSizeBytes: stat.size,
            width: dims?.width,
            height: dims?.height,
            format: dims?.format,
        };
    } catch {
        return null;
    }
}
