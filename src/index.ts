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

// Types
export * from './types/index.js';

// Utilities
export { Logger, createLogger, setGlobalLogLevel, getGlobalLogLevel } from './utils/logger.js';
export { removeDiacritics, normalizeName, stringSimilarity } from './utils/text-utils.js';
export { ensureDir, readTextFileAutoEncoding, findFilesByExtension } from './utils/file-utils.js';
