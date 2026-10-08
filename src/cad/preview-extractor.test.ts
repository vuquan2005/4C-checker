import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { extractPreviewFromFile } from './preview-extractor.js';

describe('preview-extractor', () => {
    it('extracts embedded 512x512 PNG preview from template.ipt', () => {
        const sampleFile = path.resolve(__dirname, '../../sample/template.ipt');
        const preview = extractPreviewFromFile(sampleFile);

        expect(preview).not.toBeNull();
        expect(preview?.format).toBe('png');
        expect(preview?.width).toBe(512);
        expect(preview?.height).toBe(512);
        expect(preview?.buffer.length).toBeGreaterThan(1000);

        // Check PNG magic bytes
        const magic = preview?.buffer.subarray(0, 8);
        expect(magic).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    });

    it('returns null for non-existent file', () => {
        const preview = extractPreviewFromFile('non-existent.ipt');
        expect(preview).toBeNull();
    });
});
