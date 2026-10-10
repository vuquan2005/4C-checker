/**
 * 4C-Checker Core Library API
 * Pure programmatic exports - no CLI or console logging dependencies
 */

// CAD parsers and extractors
export { parseCadMetadata } from './cad/ole-parser.js';
export {
    extractPreviewFromBuffer,
    extractPreviewFromFile,
    savePreviewToFile,
} from './cad/preview-extractor.js';

// Network (MyBB HTTP Client, Image Downloader & Google Drive Downloader)
export {
    fetchThreadPage,
    extractTotalPages,
    fetchAllThreadPages,
    type MyBbClientOptions,
    type FetchAllPagesOptions,
    type ThreadPageResult,
} from './network/mybb-client.js';
export {
    downloadImage,
    downloadImages,
    type ImageDownloadTask,
    type DownloadImageResult,
    type ImageDownloadOptions,
    type BatchDownloadOptions,
} from './network/image-downloader.js';
export {
    parseGDriveUrl,
    fetchFolderItems,
    resolveTargetFiles,
    downloadGDriveFile,
    downloadGDriveSubmission,
    fetchSubmissionMetadata,
    diffSubmissionManifest,
    detectHtmlAccessStatus,
    GDriveAccessError,
    DEFAULT_ALLOWED_EXTENSIONS,
    type GDriveItem,
    type ParsedGDriveUrl,
    type GDriveDownloadOptions,
    type GDriveDownloadResult,
    type GDriveSubmissionMetadata,
    type GDriveManifestDiff,
    type GDriveAccessStatus,
} from './network/google-driver/index.js';

// Parser (DOM to Plain Text, Sanitized Links & Image URLs)
export {
    htmlToPlainText,
    parsePostEditSummary,
    parsePostElement,
    parseThreadPosts,
    extractBaseUrlFromDom,
    isImageUrl,
    cleanUrlString,
    type ThreadParserOptions,
} from './parser/thread-parser.js';

// Preparation & Sync Models
export * from './preparation/index.js';

// Configuration
export * from './config/index.js';

// Types
export * from './types/index.js';

// Environment Cookie Loader
export { getMyBbCookie, getGoogleApiKey, loadEnvSafely } from './env.js';

// Utilities
export { Logger, createLogger, setGlobalLogLevel, getGlobalLogLevel } from './utils/logger.js';
export { removeDiacritics, normalizeName, stringSimilarity } from './utils/text-utils.js';
export { parseForumDateToIso, type ParseForumDateOptions } from './utils/time-utils.js';
export {
    ensureDir,
    readTextFileAutoEncoding,
    findFilesByExtension,
    extractZipArchive,
    formatFileTimestamp,
    archiveOldFile,
} from './utils/file-utils.js';
