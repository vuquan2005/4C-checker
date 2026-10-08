import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { parseCadMetadata } from './ole-parser.js';

describe('ole-parser', () => {
    it('parses OLE metadata and origin fingerprints from template.ipt correctly', () => {
        const sampleFile = path.resolve(__dirname, '../../sample/template.ipt');
        const metadata = parseCadMetadata(sampleFile);

        expect(metadata.fileName).toBe('template.ipt');
        expect(metadata.fileExtension).toBe('.ipt');
        expect(metadata.hasPreview).toBe(true);
        expect(metadata.softwareVersion).toContain('2025');
        expect(metadata.originalFilePath).toContain('template1.ipt');
        expect(metadata.designer).toBe('VuQuan');
        expect(metadata.rseSegmentIds.length).toBe(8);
        expect(metadata.rseSegmentIds).toContain('Bgpya2ecpeqt4igmcekykz5brnf');
        expect(metadata.creationDate).toBe('10/08/2026 10:10:33');
    });

    it('throws error when file does not exist', () => {
        expect(() => parseCadMetadata('non_existent.ipt')).toThrow();
    });
});
