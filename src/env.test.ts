import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getMyBbCookie, loadEnvSafely } from './env.js';

describe('Environment Loader (src/env.ts)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env = { ...originalEnv };
        delete process.env.MYBB_COOKIE;
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('returns undefined when no cookie is set', () => {
        expect(getMyBbCookie()).toBeUndefined();
    });

    it('prioritizes explicit argument over process.env', () => {
        process.env.MYBB_COOKIE = 'env_cookie';
        expect(getMyBbCookie('arg_cookie')).toBe('arg_cookie');
    });

    it('reads MYBB_COOKIE from process.env if no argument provided', () => {
        process.env.MYBB_COOKIE = 'mybbuser=123; sid=456';
        expect(getMyBbCookie()).toBe('mybbuser=123; sid=456');
    });

    it('does not throw when .env file does not exist', () => {
        expect(() => loadEnvSafely('/invalid/path/.env')).not.toThrow();
    });
});
