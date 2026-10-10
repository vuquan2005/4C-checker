import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    getDefaultThreadConfig,
    loadThreadConfig,
    saveThreadConfig,
    ensureThreadConfig,
    mergeWithDefaultConfig,
} from './config-manager.js';

describe('config-manager', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '4c-test-config-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns standard default config', () => {
        const config = getDefaultThreadConfig('1336', 'Test Course');
        expect(config.threadId).toBe('1336');
        expect(config.title).toBe('Test Course');
        expect(config.prepare?.ignore?.ignoreOp).toBe(true);
        expect(config.prepare?.session?.keywords).toContain('buoi');
        expect(config.prepare?.drive?.allowedExtensions).toContain('.ipt');
        expect(config.prepare?.network?.concurrency).toBe(2);
    });

    it('loads default config when file does not exist', () => {
        const config = loadThreadConfig({ dataDir: tempDir, threadId: '9999' });
        expect(config.threadId).toBe('9999');
        expect(config.prepare?.ignore?.ignoreOp).toBe(true);
    });

    it('saves and reloads config correctly', () => {
        const configPath = path.join(tempDir, '9999', 'config.json');
        const customConfig = getDefaultThreadConfig('9999');
        customConfig.prepare!.ignore!.uids = ['12345'];
        customConfig.prepare!.session!.keywords = ['bai', 'buoi'];

        saveThreadConfig(configPath, customConfig);

        const loaded = loadThreadConfig({ dataDir: tempDir, threadId: '9999' });
        expect(loaded.threadId).toBe('9999');
        expect(loaded.prepare?.ignore?.uids).toEqual(['12345']);
        expect(loaded.prepare?.session?.keywords).toEqual(['bai', 'buoi']);
    });

    it('merges partial config with defaults without losing nested keys', () => {
        const partial = {
            threadId: '1336',
            prepare: {
                ignore: {
                    uids: ['27392'],
                },
            },
        };

        const merged = mergeWithDefaultConfig(partial);
        expect(merged.threadId).toBe('1336');
        expect(merged.prepare?.ignore?.uids).toEqual(['27392']);
        // Default properties should still be present
        expect(merged.prepare?.ignore?.ignoreOp).toBe(true);
        expect(merged.prepare?.session?.keywords).toContain('buoi');
        expect(merged.prepare?.network?.concurrency).toBe(2);
    });

    it('ensures config file is created if missing', () => {
        const config = ensureThreadConfig(tempDir, '1234', { title: 'Auto Generated' });
        expect(config.threadId).toBe('1234');
        expect(config.title).toBe('Auto Generated');

        const expectedFile = path.join(tempDir, '1234', 'config.json');
        expect(fs.existsSync(expectedFile)).toBe(true);
    });
});
