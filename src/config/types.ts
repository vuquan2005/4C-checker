/**
 * Configuration types for 4C-Checker
 * Supports both thread-level preparation rules and assignment analysis criteria.
 */

/**
 * Filter rules to ignore/skip specific forum posts
 */
export interface IgnoreConfig {
    /** Whether to automatically ignore the thread opener post (#1) (default: true) */
    ignoreOp?: boolean;

    /** Specific forum Post IDs to ignore, e.g. ["26090", "26145"] */
    postIds?: string[];

    /** Specific post order numbers to ignore in the thread, e.g. [1, 15] */
    postNumbers?: number[];

    /** Forum User IDs (UIDs) to ignore (e.g. instructors, teaching assistants, admins), e.g. ["27392", "27380"] */
    uids?: string[];

    /** Usernames or wildcard patterns to ignore, e.g. ["Admin", "GiangVien_*"] */
    usernames?: string[];
}

/**
 * Rules for detecting session numbers from post body
 */
export interface SessionConfig {
    /**
     * Keywords and prefixes indicating session index in post body
     * Default: ["buoi", "buổi", "b", "btvn", "lab", "tuan"]
     */
    keywords?: string[];

    /** Optional maximum allowed session number for the course (e.g. 12) */
    maxSession?: number;

    /**
     * Manual session overrides mapped by Post ID (e.g. { "26123": 2, "26167": 3 })
     * Takes highest precedence over declared and inferred sessions.
     */
    overrides?: Record<string, number>;
}

/**
 * Rules for downloading assignment files from Google Drive
 */
export interface DriveConfig {
    /**
     * Whitelist file extensions allowed for download
     * Default: [".ipt", ".iam", ".ipj", ".idw", ".dwg", ".zip", ".rar"]
     */
    allowedExtensions?: string[];

    /**
     * Maximum file size in bytes to download (avoids giant garbage files)
     * Default: 104857600 (100MB)
     */
    maxFileSizeBytes?: number;

    /**
     * Custom subfolder search keywords pattern for session
     * e.g. ["buoi {n}", "b{n}", "bai {n}"]
     */
    subfolderKeywords?: string[];
}

/**
 * Network and worker execution options
 */
export interface NetworkConfig {
    /** Worker concurrency level (default: 2) */
    concurrency?: number;

    /** Whether to download forum BBCode images (default: true) */
    downloadImages?: boolean;

    /** Whether to download Google Drive project files (default: true) */
    downloadDrive?: boolean;

    /** Whether to extract CAD metadata and 3D preview images (default: true) */
    extractCad?: boolean;
}

/**
 * Data Preparation Configuration block
 */
export interface PrepareConfig {
    /** Multi-criteria post filtering rules */
    ignore?: IgnoreConfig;

    /** Session detection options */
    session?: SessionConfig;

    /** Google Drive download options */
    drive?: DriveConfig;

    /** Network and concurrency options */
    network?: NetworkConfig;
}

/**
 * Individual session criteria for analysis (stub for analysis module)
 */
export interface SessionAnalysisCriteria {
    title?: string;
    deadline?: string;
    minCadFiles?: number;
    minImages?: number;
    /** Minimum allowed image file size in bytes (defaults to 10240 bytes / 10KB) */
    minImageSizeBytes?: number;
    /** Minimum allowed image width in pixels (defaults to 150px) */
    minImageWidth?: number;
    /** Minimum allowed image height in pixels (defaults to 100px) */
    minImageHeight?: number;
    requiredFilePatterns?: string[];
    maxAllowedInventorVersion?: number;
}

/**
 * Configuration for ignoring/suppressing known false positives or expected warnings in analysis
 */
export interface AnalysisIgnoreConfig {
    /** Ignore specific warning types globally across the thread (e.g. ['UNRENDERED_URL', 'MALFORMED_BBCODE']) */
    warnings?: string[];

    /** Ignore specific criteria violation types globally (e.g. ['INSUFFICIENT_IMAGES', 'EXCEEDED_MAX_INVENTOR_VERSION']) */
    violations?: string[];

    /** Post-specific ignore rules: map postId to list of ignored warning/violation codes */
    byPost?: Record<string, string[]>;
}

/**
 * Analysis configuration block (for cross-student plagiarism & assignment evaluation)
 */
export interface AnalysisConfig {
    /**
     * Whitelist sets of 8 RSe segment IDs from official instructor template files
     * (prevents false positive plagiarism when entire class uses official template)
     */
    templateRseWhitelists?: string[][];

    /** Rules for suppressing / ignoring known false alarms or non-critical warnings */
    ignore?: AnalysisIgnoreConfig;

    /** Default criteria applied to sessions without custom rules */
    defaultSessionCriteria?: SessionAnalysisCriteria;

    /** Per-session evaluation rules */
    sessions?: Record<string, SessionAnalysisCriteria>;
}

/**
 * Master thread configuration schema stored at `data/<threadId>/config.json`
 */
export interface ThreadConfig {
    $schema?: string;

    /** Associated Thread ID on MyBB forum */
    threadId?: string;

    /** Course title or friendly name */
    title?: string;

    /** Data preparation pipeline configuration */
    prepare?: PrepareConfig;

    /** Plagiarism detection and grading criteria */
    analysis?: AnalysisConfig;
}
