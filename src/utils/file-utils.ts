/**
 * File system utilities
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';

const execFileAsync = promisify(execFile);

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

/**
 * Extract a ZIP archive to a destination directory
 */
export function extractZipArchive(
    zipFilePath: string,
    targetDir: string,
    overwrite = true
): boolean {
    try {
        ensureDir(targetDir);
        const zip = new AdmZip(zipFilePath);
        zip.extractAllTo(targetDir, overwrite);
        return true;
    } catch {
        return false;
    }
}

/** Extract ZIP or RAR archives based on their file signature, not only extension. */
export async function extractArchive(
    archivePath: string,
    targetDir: string,
    overwrite = true
): Promise<'zip' | 'rar'> {
    const header = fs.readFileSync(archivePath).subarray(0, 8);
    const isRar = header.subarray(0, 6).toString('ascii') === 'Rar!\x1a\x07';

    if (!isRar) {
        extractZipArchive(archivePath, targetDir, overwrite);
        return 'zip';
    }

    fs.mkdirSync(targetDir, { recursive: true });
    try {
        await execFileAsync('unrar', [
            'x',
            overwrite ? '-o+' : '-o-',
            '-y',
            archivePath,
            `${targetDir}${path.sep}`,
        ]);
        return 'rar';
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    let command = '7z';
    try {
        await execFileAsync(command, ['x', archivePath, '-y', `-o${targetDir}`]);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        command = '7zz';
        await execFileAsync(command, ['x', archivePath, '-y', `-o${targetDir}`]);
    }

    return 'rar';
}

/**
 * Định dạng timestamp an toàn cho tên file trên mọi hệ điều hành (YYYYMMDD_HHmmss)
 */
export function formatFileTimestamp(date: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

/**
 * Di chuyển file cũ sang thư mục lưu trữ (backup archive) kèm hậu tố timestamp
 * Ví dụ: 'truc_vit.ipt' -> '_history/truc_vit_20261009_133000.ipt'
 */
export function archiveOldFile(
    filePath: string,
    backupDir: string,
    customTimestamp?: string
): string | null {
    if (!fs.existsSync(filePath)) return null;

    ensureDir(backupDir);
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);
    const ts = customTimestamp || formatFileTimestamp(stat.mtime);
    const backupFileName = `${baseName}_${ts}${ext}`;
    const backupPath = path.join(backupDir, backupFileName);

    // Di chuyển file cũ vào thư mục backup
    fs.renameSync(filePath, backupPath);
    return backupPath;
}
