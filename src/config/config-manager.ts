/**
 * Configuration Manager
 * Handles loading, persisting, and merging default configuration for threads.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../utils/file-utils.js';
import { DEFAULT_ALLOWED_EXTENSIONS } from '../network/google-driver/types.js';
import type { ThreadConfig } from './types.js';

export const DEFAULT_SESSION_KEYWORDS = ['buoi', 'buổi', 'b', 'btvn', 'lab', 'tuan', 'tuần'];

/**
 * Returns default ThreadConfig instance populated with sensible standard defaults
 */
export function getDefaultThreadConfig(threadId?: string, title?: string): ThreadConfig {
    return {
        threadId,
        title,
        prepare: {
            ignore: {
                ignoreOp: true,
                postIds: [],
                postNumbers: [],
                uids: [],
                usernames: [],
            },
            session: {
                keywords: [...DEFAULT_SESSION_KEYWORDS],
                overrides: {},
            },
            drive: {
                allowedExtensions: [...DEFAULT_ALLOWED_EXTENSIONS],
                maxFileSizeBytes: 100 * 1024 * 1024, // 100 MB
            },
            network: {
                concurrency: 2,
                downloadImages: true,
                downloadDrive: true,
                extractCad: true,
            },
        },
        analysis: {
            templateRseWhitelists: [],
            sessions: {},
        },
    };
}

/**
 * Resolves standard file path to `config.json` within thread folder
 */
export function getThreadConfigPath(dataDir: string, threadId: string): string {
    return path.join(dataDir, threadId, 'config.json');
}

/**
 * Merges loaded configuration with default fallback values
 */
export function mergeWithDefaultConfig(
    loadedConfig: Partial<ThreadConfig>,
    threadId?: string,
    title?: string
): ThreadConfig {
    const defaults = getDefaultThreadConfig(
        threadId || loadedConfig.threadId,
        title || loadedConfig.title
    );

    return {
        $schema: loadedConfig.$schema || defaults.$schema,
        threadId: loadedConfig.threadId || defaults.threadId,
        title: loadedConfig.title || defaults.title,
        prepare: {
            ignore: {
                ignoreOp:
                    loadedConfig.prepare?.ignore?.ignoreOp !== undefined
                        ? loadedConfig.prepare.ignore.ignoreOp
                        : defaults.prepare?.ignore?.ignoreOp,
                postIds: loadedConfig.prepare?.ignore?.postIds ?? defaults.prepare?.ignore?.postIds,
                postNumbers:
                    loadedConfig.prepare?.ignore?.postNumbers ??
                    defaults.prepare?.ignore?.postNumbers,
                uids: loadedConfig.prepare?.ignore?.uids ?? defaults.prepare?.ignore?.uids,
                usernames:
                    loadedConfig.prepare?.ignore?.usernames ?? defaults.prepare?.ignore?.usernames,
            },
            session: {
                keywords:
                    loadedConfig.prepare?.session?.keywords ?? defaults.prepare?.session?.keywords,
                maxSession:
                    loadedConfig.prepare?.session?.maxSession ??
                    defaults.prepare?.session?.maxSession,
                overrides: {
                    ...(defaults.prepare?.session?.overrides || {}),
                    ...(loadedConfig.prepare?.session?.overrides || {}),
                },
            },
            drive: {
                allowedExtensions:
                    loadedConfig.prepare?.drive?.allowedExtensions ??
                    defaults.prepare?.drive?.allowedExtensions,
                maxFileSizeBytes:
                    loadedConfig.prepare?.drive?.maxFileSizeBytes ??
                    defaults.prepare?.drive?.maxFileSizeBytes,
                subfolderKeywords:
                    loadedConfig.prepare?.drive?.subfolderKeywords ??
                    defaults.prepare?.drive?.subfolderKeywords,
            },
            network: {
                concurrency:
                    loadedConfig.prepare?.network?.concurrency ??
                    defaults.prepare?.network?.concurrency,
                downloadImages:
                    loadedConfig.prepare?.network?.downloadImages ??
                    defaults.prepare?.network?.downloadImages,
                downloadDrive:
                    loadedConfig.prepare?.network?.downloadDrive ??
                    defaults.prepare?.network?.downloadDrive,
                extractCad:
                    loadedConfig.prepare?.network?.extractCad ??
                    defaults.prepare?.network?.extractCad,
            },
        },
        analysis: {
            templateRseWhitelists:
                loadedConfig.analysis?.templateRseWhitelists ??
                defaults.analysis?.templateRseWhitelists,
            sessions: loadedConfig.analysis?.sessions ?? defaults.analysis?.sessions,
        },
    };
}

/**
 * Loads and parses `config.json` from a file path or thread directory
 */
export function loadThreadConfig(options: {
    dataDir?: string;
    threadId?: string;
    customPath?: string;
}): ThreadConfig {
    let targetPath: string | null = null;

    if (options.customPath) {
        targetPath = path.resolve(process.cwd(), options.customPath);
    } else if (options.dataDir && options.threadId) {
        targetPath = getThreadConfigPath(options.dataDir, options.threadId);
    }

    if (!targetPath || !fs.existsSync(targetPath)) {
        return getDefaultThreadConfig(options.threadId);
    }

    try {
        const raw = fs.readFileSync(targetPath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<ThreadConfig>;
        return mergeWithDefaultConfig(parsed, options.threadId);
    } catch (err) {
        throw new Error(
            `Không thể đọc file cấu hình tại ${targetPath}: ${(err as Error).message}`,
            { cause: err }
        );
    }
}

/**
 * Saves `ThreadConfig` to disk as a formatted JSON file
 */
export function saveThreadConfig(filePath: string, config: ThreadConfig): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Ensures a `config.json` exists for a thread. If missing, writes default configuration.
 */
export function ensureThreadConfig(
    dataDir: string,
    threadId: string,
    initialMeta?: { title?: string; opUid?: string; opUsername?: string }
): ThreadConfig {
    const configPath = getThreadConfigPath(dataDir, threadId);

    if (fs.existsSync(configPath)) {
        return loadThreadConfig({ dataDir, threadId });
    }

    const config = getDefaultThreadConfig(threadId, initialMeta?.title);

    // If initial OP author info is known, we can populate initial suggested ignore UID
    if (initialMeta?.opUid) {
        // By default OP post #1 is ignored via ignoreOp: true, but we can also document opUid
    }

    saveThreadConfig(configPath, config);
    return config;
}

/**
 * Persists a session override for a specific post into config.json
 */
export function setThreadConfigSessionOverride(
    configPath: string,
    postId: string,
    sessionIndex: number
): void {
    const config = loadThreadConfig({ customPath: configPath });
    if (!config.prepare) config.prepare = {};
    if (!config.prepare.session) config.prepare.session = {};
    if (!config.prepare.session.overrides) config.prepare.session.overrides = {};

    config.prepare.session.overrides[postId] = sessionIndex;
    saveThreadConfig(configPath, config);
}
