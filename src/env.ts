/**
 * Environment Variables Loader
 * Strictly handles MYBB_COOKIE from .env or process.env when forum authentication is required.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Safely load local .env file into process.env without throwing if missing
 */
export function loadEnvSafely(customEnvPath?: string): void {
    const candidatePaths = [
        customEnvPath,
        path.resolve(process.cwd(), '.env.local'),
        path.resolve(process.cwd(), '.env'),
    ].filter(Boolean) as string[];

    for (const envPath of candidatePaths) {
        if (fs.existsSync(envPath)) {
            try {
                if (typeof process.loadEnvFile === 'function') {
                    process.loadEnvFile(envPath);
                    return;
                }
            } catch {
                // Ignore parse errors and continue
            }
        }
    }
}

/**
 * Get MyBB forum session cookie (from override, .env, or process.env)
 */
export function getMyBbCookie(customCookie?: string): string | undefined {
    loadEnvSafely();
    return customCookie || process.env.MYBB_COOKIE || undefined;
}

/**
 * Get Google API Key (from override, .env, or process.env)
 */
export function getGoogleApiKey(customApiKey?: string): string | undefined {
    loadEnvSafely();
    return customApiKey || process.env.GOOGLE_API_KEY || undefined;
}
