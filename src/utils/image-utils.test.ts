import { describe, it, expect } from 'vitest';
import { readImageDimensions } from './image-utils.js';

describe('image-utils', () => {
    it('parses PNG dimensions from header buffer', () => {
        // PNG header with 1920x1080
        const buf = Buffer.alloc(32);
        // Signature
        buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
        // Length + IHDR
        buf.writeUInt32BE(13, 8);
        buf.write('IHDR', 12);
        // Width = 1920, Height = 1080
        buf.writeUInt32BE(1920, 16);
        buf.writeUInt32BE(1080, 20);

        const dims = readImageDimensions(buf);
        expect(dims).toEqual({
            format: 'png',
            width: 1920,
            height: 1080,
        });
    });

    it('parses GIF dimensions from header buffer', () => {
        const buf = Buffer.alloc(16);
        buf.write('GIF89a', 0);
        buf.writeUInt16LE(800, 6);
        buf.writeUInt16LE(600, 8);

        const dims = readImageDimensions(buf);
        expect(dims).toEqual({
            format: 'gif',
            width: 800,
            height: 600,
        });
    });

    it('parses JPEG dimensions from header buffer', () => {
        const buf = Buffer.alloc(32);
        buf[0] = 0xff;
        buf[1] = 0xd8; // SOI
        buf[2] = 0xff;
        buf[3] = 0xc0; // SOF0
        buf.writeUInt16BE(17, 4); // len
        buf[6] = 8; // precision
        buf.writeUInt16BE(768, 7); // height
        buf.writeUInt16BE(1024, 9); // width

        const dims = readImageDimensions(buf);
        expect(dims).toEqual({
            format: 'jpeg',
            width: 1024,
            height: 768,
        });
    });

    it('returns null for invalid or empty buffers', () => {
        expect(readImageDimensions(Buffer.alloc(4))).toBeNull();
        expect(readImageDimensions(Buffer.from('not an image at all'))).toBeNull();
        expect(readImageDimensions('non_existent_file.png')).toBeNull();
    });
});
