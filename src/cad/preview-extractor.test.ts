import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, it, expect } from 'vitest';
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

        // Check that IDAT chunks are valid and decompress without corruption
        let pos = 8;
        const idatChunks: Buffer[] = [];
        while (pos < preview!.buffer.length) {
            const len = preview!.buffer.readUInt32BE(pos);
            const type = preview!.buffer.subarray(pos + 4, pos + 8).toString('ascii');
            if (type === 'IDAT') {
                idatChunks.push(preview!.buffer.subarray(pos + 8, pos + 8 + len));
            }
            pos += 8 + len + 4;
            if (type === 'IEND') break;
        }
        expect(idatChunks.length).toBeGreaterThan(0);
        expect(() => zlib.inflateSync(Buffer.concat(idatChunks))).not.toThrow();
    });

    it('extracts valid uncorrupted PNG from complex CAD files with fragmented OLE streams', () => {
        const complexFile = path.resolve(
            __dirname,
            '../../data/1336/Trinh_Viet_Anh_27401/post_26268/drive_files/Buoi3_hinh3.ipt'
        );
        if (fs.existsSync(complexFile)) {
            const preview = extractPreviewFromFile(complexFile);
            expect(preview).not.toBeNull();
            expect(preview?.width).toBe(512);
            expect(preview?.height).toBe(512);

            let pos = 8;
            const idatChunks: Buffer[] = [];
            while (pos < preview!.buffer.length) {
                const len = preview!.buffer.readUInt32BE(pos);
                const type = preview!.buffer.subarray(pos + 4, pos + 8).toString('ascii');
                if (type === 'IDAT') {
                    idatChunks.push(preview!.buffer.subarray(pos + 8, pos + 8 + len));
                }
                pos += 8 + len + 4;
                if (type === 'IEND') break;
            }
            expect(idatChunks.length).toBeGreaterThan(0);
            expect(() => zlib.inflateSync(Buffer.concat(idatChunks))).not.toThrow();
        }
    });

    it('returns null for non-existent file', () => {
        const preview = extractPreviewFromFile('non-existent.ipt');
        expect(preview).toBeNull();
    });
});
