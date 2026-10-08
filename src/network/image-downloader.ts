/**
 * Image Downloader Module
 * Streams image binaries directly to disk to prevent RAM bloat (OOM prevention).
 * Supports single downloads and concurrent batch downloads via task lists or URL-to-path maps.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { ensureDir } from '../utils/file-utils.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ImageDownloader');

export interface ImageDownloadOptions {
    /** Bỏ qua nếu file đích đã tồn tại và có dung lượng > 0 (mặc định: true) */
    skipIfExists?: boolean;

    /** Thời gian chờ tối đa cho mỗi request tính bằng ms (mặc định: 20000) */
    timeoutMs?: number;

    /** Headers tùy chỉnh (User-Agent, Referer, Cookie...) */
    headers?: Record<string, string>;
}

export interface ImageDownloadTask {
    /** URL ảnh cần tải */
    url: string;

    /** Đường dẫn lưu file trên ổ đĩa */
    destPath: string;
}

export interface DownloadImageResult {
    url: string;
    destPath: string;
    success: boolean;
    sizeBytes?: number;
    error?: string;
    skipped?: boolean;
}

export interface BatchDownloadOptions extends ImageDownloadOptions {
    /** Số lượng luồng tải đồng thời trong worker pool (mặc định: 4) */
    concurrency?: number;

    /** Khoảng nghỉ giữa các lượt tải trong mỗi worker (ms, mặc định: 50) */
    delayMs?: number;

    /** Callback thông báo tiến độ sau mỗi ảnh hoàn thành */
    onProgress?: (completed: number, total: number, result: DownloadImageResult) => void;
}

const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/**
 * Tải 1 ảnh duy nhất và stream trực tiếp xuống ổ đĩa
 */
export async function downloadImage(
    url: string,
    destPath: string,
    options: ImageDownloadOptions = {}
): Promise<DownloadImageResult> {
    const { skipIfExists = true, timeoutMs = 20000, headers = {} } = options;

    // 1. Kiểm tra nếu file đã có sẵn thì bỏ qua để tiết kiệm băng thông
    if (skipIfExists && fs.existsSync(destPath)) {
        try {
            const stat = fs.statSync(destPath);
            if (stat.size > 0) {
                logger.d(`Skipped (already exists): ${destPath}`);
                return {
                    url,
                    destPath,
                    success: true,
                    skipped: true,
                    sizeBytes: stat.size,
                };
            }
        } catch {
            // Nếu lỗi đọc stat thì tiếp tục tải lại
        }
    }

    ensureDir(path.dirname(destPath));

    let referer = '';
    try {
        referer = new URL(url).origin;
    } catch {
        // Bỏ qua nếu URL không phân tích được origin
    }

    const reqHeaders: Record<string, string> = {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        ...(referer ? { Referer: referer } : {}),
        ...headers,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        logger.d(`Downloading image: ${url} -> ${destPath}`);
        const response = await fetch(url, {
            method: 'GET',
            headers: reqHeaders,
            signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        if (!response.body) {
            throw new Error('Response body is empty');
        }

        const fileStream = fs.createWriteStream(destPath);
        // @ts-expect-error Readable.fromWeb tương thích ReadableStream từ fetch
        await pipeline(Readable.fromWeb(response.body), fileStream);

        const stats = fs.statSync(destPath);
        return {
            url,
            destPath,
            success: true,
            sizeBytes: stats.size,
        };
    } catch (err) {
        clearTimeout(timer);

        // Dọn dẹp file rác tải dở dang nếu có lỗi
        if (fs.existsSync(destPath)) {
            try {
                fs.unlinkSync(destPath);
            } catch {
                // Ignore unlink error
            }
        }

        const isAbort = (err as Error).name === 'AbortError';
        const errorMsg = isAbort
            ? `Request timed out after ${timeoutMs}ms`
            : (err as Error).message;

        logger.w(`Failed to download ${url}: ${errorMsg}`);
        return {
            url,
            destPath,
            success: false,
            error: errorMsg,
        };
    }
}

/**
 * Tải danh sách ảnh (nhận mảng tasks, Map<url, destPath> hoặc Object/Record<url, destPath>)
 * Sử dụng worker pool với concurrency giới hạn để không gây nghẽn mạng hay nghẽn server.
 */
export async function downloadImages(
    tasks: ImageDownloadTask[] | Map<string, string> | Record<string, string>,
    options: BatchDownloadOptions = {}
): Promise<DownloadImageResult[]> {
    const {
        concurrency = 4,
        skipIfExists = true,
        delayMs = 50,
        timeoutMs = 20000,
        headers = {},
        onProgress,
    } = options;

    // Chuẩn hóa định dạng đầu vào thành mảng ImageDownloadTask[]
    let taskList: ImageDownloadTask[];
    if (Array.isArray(tasks)) {
        taskList = tasks;
    } else if (tasks instanceof Map) {
        taskList = Array.from(tasks.entries()).map(([url, destPath]) => ({ url, destPath }));
    } else if (typeof tasks === 'object' && tasks !== null) {
        taskList = Object.entries(tasks).map(([url, destPath]) => ({ url, destPath }));
    } else {
        taskList = [];
    }

    if (taskList.length === 0) {
        return [];
    }

    const results: DownloadImageResult[] = new Array(taskList.length);
    let currentIndex = 0;
    let completedCount = 0;

    async function worker(): Promise<void> {
        while (currentIndex < taskList.length) {
            const taskIndex = currentIndex++;
            const task = taskList[taskIndex];

            const result = await downloadImage(task.url, task.destPath, {
                skipIfExists,
                timeoutMs,
                headers,
            });

            results[taskIndex] = result;
            completedCount++;
            onProgress?.(completedCount, taskList.length, result);

            if (delayMs > 0 && currentIndex < taskList.length) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }

    const poolSize = Math.min(Math.max(1, concurrency), taskList.length);
    const workers = Array.from({ length: poolSize }, () => worker());
    await Promise.all(workers);

    return results;
}
