import { describe, expect, it } from 'vitest';
import type { PostData } from '../../preparation/types/manifest.js';
import {
    evaluateCadFiles,
    evaluatePostSubmission,
    extractInventorMajorVersion,
} from './post-evaluator.js';

describe('Post Evaluator', () => {
    it('extracts Inventor major version', () => {
        expect(extractInventorMajorVersion('2025.5 (Build 295498000, 498)')).toBe(2025);
        expect(extractInventorMajorVersion('2024.4 (Build 284460030, 460C)')).toBe(2024);
        expect(extractInventorMajorVersion(undefined)).toBeUndefined();
    });

    const mockPostData: PostData = {
        postId: '26123',
        postNumber: 11,
        sessionIndex: 1,
        sessionOverride: null,
        postUrl: 'https://example.com/post/26123',
        author: { uid: '27430', username: 'Ha Phuc Khanh' },
        postDate: '2026-10-02T10:00:00+07:00',
        currentVersion: 1,
        syncedAt: '2026-10-02T12:00:00Z',
        userFolder: 'Ha_Phuc_Khanh_27430',
        postFolder: 'post_26123',
        forumImages: [
            {
                originalUrl: 'https://example.com/img1.png',
                localPath: 'student_images/img1.png',
                fileName: 'img1.png',
                fileSizeBytes: 5000,
                status: 'downloaded',
            },
        ],
        driveFiles: {
            status: 'downloaded',
            totalFiles: 2,
            downloadedFiles: ['drive_files/b1.ipt', 'drive_files/b2.ipt'],
        },
        cadSummaries: [
            {
                filePath: '/drive_files/b1.ipt',
                fileName: 'b1.ipt',
                localPath: 'drive_files/b1.ipt',
                fileExtension: '.ipt',
                fileSizeBytes: 200000,
                hasPreview: true,
                softwareVersion: '2024.4 (Build 284460030)',
                rseSegmentIds: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'],
            },
            {
                filePath: '/drive_files/b2.ipt',
                fileName: 'b2.ipt',
                localPath: 'drive_files/b2.ipt',
                fileExtension: '.ipt',
                fileSizeBytes: 200000,
                hasPreview: false,
                softwareVersion: '2025.1',
                rseSegmentIds: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'],
            },
        ],
        warnings: [],
    };

    it('evaluates cad files and detects versions and preview state', () => {
        const evalCad = evaluateCadFiles(mockPostData);
        expect(evalCad.totalCadFiles).toBe(2);
        expect(evalCad.validCadFiles).toBe(2);
        expect(evalCad.detectedInventorVersions).toEqual(['2024.4 (Build 284460030)', '2025.1']);
        expect(evalCad.files[1].warnings).toContain('NO_3D_PREVIEW');
    });

    it('flags late submissions past the deadline', () => {
        const result = evaluatePostSubmission(mockPostData, {
            deadline: '2026-10-01T23:59:59+07:00', // earlier than postDate
        });
        expect(result.isLate).toBe(true);
        expect(result.passedCriteria).toBe(false);
        expect(result.criteriaViolations[0]).toContain('LATE_SUBMISSION');
    });

    it('flags insufficient cad files or images', () => {
        const result = evaluatePostSubmission(mockPostData, {
            minCadFiles: 3, // mock has 2
            minImages: 2, // mock has 1
        });
        expect(result.passedCriteria).toBe(false);
        expect(result.criteriaViolations.some((v) => v.includes('INSUFFICIENT_CAD_FILES'))).toBe(
            true
        );
        expect(result.criteriaViolations.some((v) => v.includes('INSUFFICIENT_IMAGES'))).toBe(true);
    });

    it('flags submissions with Inventor version exceeding maximum cap', () => {
        const result = evaluatePostSubmission(mockPostData, {
            maxAllowedInventorVersion: 2024, // file b2 is 2025
        });
        expect(result.passedCriteria).toBe(false);
        expect(
            result.criteriaViolations.some((v) => v.includes('EXCEEDED_MAX_INVENTOR_VERSION'))
        ).toBe(true);
    });

    it('passes when all criteria are satisfied', () => {
        const result = evaluatePostSubmission(mockPostData, {
            deadline: '2026-10-05T00:00:00+07:00',
            minCadFiles: 2,
            minImages: 1,
            maxAllowedInventorVersion: 2026,
        });
        expect(result.isLate).toBe(false);
        expect(result.passedCriteria).toBe(true);
        expect(result.criteriaViolations).toHaveLength(0);
    });

    it('extracts ambiguous session list cleanly without duplicate errors', () => {
        const ambPost: PostData = {
            ...mockPostData,
            sessionIndex: undefined,
            warnings: ['SESSION_AMBIGUOUS:2,1'],
        };
        const result = evaluatePostSubmission(ambPost);
        expect(result.passedCriteria).toBe(false);
        expect(result.criteriaViolations).toHaveLength(1);
        expect(result.criteriaViolations[0]).toBe('SESSION_AMBIGUOUS:2,1');
    });

    it('suppresses violations and warnings when configured in AnalysisIgnoreConfig', () => {
        const result = evaluatePostSubmission(
            mockPostData,
            {
                maxAllowedInventorVersion: 2024, // normally violates
            },
            undefined,
            {
                violations: ['EXCEEDED_MAX_INVENTOR_VERSION'],
            }
        );
        expect(result.passedCriteria).toBe(true);
        expect(result.criteriaViolations).toHaveLength(0);
    });

    it('retains student session conflict as violation even when manually overridden, until ignored', () => {
        const conflictPost: PostData = {
            ...mockPostData,
            declaredSession: 1,
            inferredSession: 2,
            sessionIndex: 1,
            sessionOverride: 1,
            sessionSource: 'override',
            warnings: ['SESSION_CONFLICT:1->2'],
        };

        // Without ignore: still reports student violation + override applied
        const unignored = evaluatePostSubmission(conflictPost);
        expect(unignored.passedCriteria).toBe(false);
        expect(unignored.criteriaViolations).toEqual(['SESSION_CONFLICT:1->2']);
        expect(unignored.sessionWarnings).toEqual([
            'SESSION_CONFLICT:1->2',
            'SESSION_OVERRIDE_APPLIED:1',
        ]);

        // With ignore: suppressed cleanly
        const ignored = evaluatePostSubmission(conflictPost, undefined, undefined, {
            violations: ['SESSION_CONFLICT'],
        });
        expect(ignored.passedCriteria).toBe(true);
        expect(ignored.criteriaViolations).toHaveLength(0);
        expect(ignored.sessionWarnings).toEqual(['SESSION_OVERRIDE_APPLIED:1']);
    });

    it('standardizes various raw Google Drive errors into clean error codes', () => {
        const noCadPost: PostData = {
            ...mockPostData,
            driveFiles: {
                status: 'failed',
                totalFiles: 0,
                downloadedFiles: [],
                error: 'Không tìm thấy file CAD hợp lệ trong thư mục này (.ipt, .iam)',
            },
        };
        const resNoCad = evaluatePostSubmission(noCadPost);
        expect(resNoCad.criteriaViolations).toContain('DRIVE_NO_CAD_FILES');

        const noSubfolderPost: PostData = {
            ...mockPostData,
            driveFiles: {
                status: 'failed',
                totalFiles: 0,
                downloadedFiles: [],
                error: 'Không tìm thấy thư mục con nào khớp với từ khóa: [buoi 1, b1]',
            },
        };
        const resSub = evaluatePostSubmission(noSubfolderPost);
        expect(resSub.criteriaViolations).toContain('DRIVE_SUBFOLDER_NOT_FOUND:buoi 1, b1');

        const restrictedPost: PostData = {
            ...mockPostData,
            driveFiles: {
                status: 'failed',
                totalFiles: 0,
                downloadedFiles: [],
                error: 'Tệp bị hạn chế quyền truy cập',
            },
        };
        const resRestricted = evaluatePostSubmission(restrictedPost);
        expect(resRestricted.criteriaViolations).toContain('DRIVE_ACCESS_DENIED');
    });
});
