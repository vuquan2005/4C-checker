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

// Network (MyBB HTTP Client & Image Downloader)
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

// Parser (DOM to Plain Text, Sanitized Links & Image URLs)
export {
    htmlToPlainText,
    parsePostEditSummary,
    parsePostElement,
    parseThreadPosts,
    extractBaseUrlFromDom,
    isImageUrl,
    cleanUrlString,
} from './parser/thread-parser.js';

// Types
export * from './types/index.js';

// Environment Cookie Loader
export { getMyBbCookie, loadEnvSafely } from './env.js';

// Utilities
export { Logger, createLogger, setGlobalLogLevel, getGlobalLogLevel } from './utils/logger.js';
export { removeDiacritics, normalizeName, stringSimilarity } from './utils/text-utils.js';
export { ensureDir, readTextFileAutoEncoding, findFilesByExtension } from './utils/file-utils.js';
