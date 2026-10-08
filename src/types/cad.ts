/**
 * CAD metadata and preview types
 */

export interface CadMetadata {
    /** File name and path */
    filePath: string;
    fileName: string;
    fileExtension: string;
    fileSizeBytes: number;

    /** Software Version (e.g. 2025.5 (Build 295498000, 498)) */
    softwareVersion?: string;

    /** Author & Computer Footprint */
    designer?: string;
    author?: string;
    originalFilePath?: string;
    lastSavedByWindowsUser?: string;

    /** Model Details */
    partNumber?: string;

    /** Timestamps (Precision to the exact second) */
    creationDate?: string;
    lastSavedDate?: string;

    /** 3D raster thumbnail state */
    hasPreview: boolean;
    previewWidth?: number;
    previewHeight?: number;
    previewSizeBytes?: number;

    /** RSe Segment Storage IDs (Indelible Document Origin Fingerprint) */
    rseSegmentIds: string[];

    /** B-Rep & Geometry stream fingerprints (sizes & hash of model streams) */
    geometryFingerprint?: {
        totalStreams: number;
        brepStreamSizes: number[];
        contentHash?: string;
    };
}

export interface ExtractedPreview {
    /** Image data buffer */
    buffer: Buffer;
    /** Image width in pixels */
    width: number;
    /** Image height in pixels */
    height: number;
    /** Format */
    format: 'png' | 'bmp';
}
