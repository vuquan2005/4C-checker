/**
 * File system utilities
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Ensure directory exists
 */
export function ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * Read text file with automatic encoding detection (UTF-16LE BOM or UTF-8)
 */
export function readTextFileAutoEncoding(filePath: string): string {
    const buffer = fs.readFileSync(filePath);

    // UTF-16LE BOM: 0xFF 0xFE
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return buffer.subarray(2).toString('utf16le');
    }

    // UTF-8 BOM: 0xEF 0xBB 0xBF
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return buffer.subarray(3).toString('utf8');
    }

    // Check if contains null bytes indicative of UTF-16LE without BOM
    let nullByteCount = 0;
    const sampleLength = Math.min(buffer.length, 100);
    for (let i = 1; i < sampleLength; i += 2) {
        if (buffer[i] === 0x00) nullByteCount++;
    }
    if (nullByteCount > sampleLength / 4) {
        return buffer.toString('utf16le');
    }

    return buffer.toString('utf8');
}

/**
 * Find files in a directory recursively matching specific extensions
 */
export function findFilesByExtension(dirPath: string, extensions: string[]): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dirPath)) return results;

    const normalizedExts = extensions.map((ext) =>
        ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
    );

    function scan(currentDir: string) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                scan(fullPath);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (normalizedExts.includes(ext)) {
                    results.push(fullPath);
                }
            }
        }
    }

    scan(dirPath);
    return results;
}
