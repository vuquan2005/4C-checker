import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { RawForumPost } from '../../types/post.js';
import {
    createEmptyManifest,
    syncThreadPostsIntoManifest,
    saveThreadManifest,
    loadThreadManifest,
} from './manifest-manager.js';

describe('Thread Manifest Manager', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '4c-manifest-test-'));
    });

    afterEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    const createDummyPost = (
        postId: string,
        postNumber: number,
        username: string,
        uid: string,
        options?: { plainText?: string; links?: string[]; editedAt?: string }
    ): RawForumPost => ({
        postId,
        postNumber,
        postUrl: `https://example.com/showthread.php?tid=999&pid=${postId}`,
        author: { username, uid },
        postDate: '2026-10-01T10:00:00+07:00',
        editedInfo: options?.editedAt
            ? { editedAt: options.editedAt, editedBy: username }
            : undefined,
        plainText: options?.plainText || `Hello, this is post ${postId}`,
        links: options?.links || ['https://drive.example.com/file/1'],
        imageUrls: ['https://img.example.com/pic1.png'],
        warnings: [],
    });

    it('creates initial records for new posts and numbers multiple posts per user chronologically', () => {
        const manifest = createEmptyManifest('999', { title: 'Test Thread' });

        const post1 = createDummyPost('101', 2, 'Student One_K16', '1001');
        const post2 = createDummyPost('102', 3, 'Student Two_K16', '1002');
        const post3 = createDummyPost('103', 4, 'Student One_K16', '1001'); // 2nd post from user 1001

        const result = syncThreadPostsIntoManifest(manifest, [post1, post2, post3], {
            now: '2026-10-01T12:00:00+07:00',
        });

        expect(result.newPosts).toHaveLength(3);
        expect(result.editedPosts).toHaveLength(0);
        expect(manifest.stats.totalPosts).toBe(3);
        expect(manifest.stats.totalUsers).toBe(2);

        // First post of Student One
        const rec1 = manifest.posts['101'];
        expect(rec1.userFolder).toBe('Student_One_1001');
        expect(rec1.postFolder).toBe('post_101');
        expect(rec1.current).toBe(1);
        expect(rec1.history).toHaveLength(1);

        // Second post of Student One
        const rec3 = manifest.posts['103'];
        expect(rec3.userFolder).toBe('Student_One_1001');
        expect(rec3.postFolder).toBe('post_103');
        expect(rec3.current).toBe(1);
    });

    it('identifies unchanged posts on subsequent run without appending history', () => {
        const manifest = createEmptyManifest('999');
        const post = createDummyPost('101', 2, 'Student One_K16', '1001');

        syncThreadPostsIntoManifest(manifest, [post]);
        expect(manifest.posts['101'].history).toHaveLength(1);

        // Run again with identical post
        const result2 = syncThreadPostsIntoManifest(manifest, [post]);
        expect(result2.newPosts).toHaveLength(0);
        expect(result2.editedPosts).toHaveLength(0);
        expect(result2.unchangedPosts).toHaveLength(1);
        expect(manifest.posts['101'].history).toHaveLength(1);
    });

    it('stores declared and inferred sessions and leaves conflicts unresolved', () => {
        const manifest = createEmptyManifest('999');
        const firstPost = createDummyPost('101', 2, 'Student One_K16', '1001', {
            plainText: 'Nộp bài buổi 2',
        });
        const secondPost = createDummyPost('102', 3, 'Student One_K16', '1001', {
            plainText: 'Nộp bài buổi 4',
        });

        syncThreadPostsIntoManifest(manifest, [firstPost, secondPost]);

        expect(manifest.posts['101'].sessionIndex).toBe(2);
        expect(manifest.posts['101'].sessionSource).toBe('declared');
        expect(manifest.posts['102'].inferredSession).toBe(3);
        expect(manifest.posts['102'].declaredSession).toBe(4);
        expect(manifest.posts['102'].sessionIndex).toBeUndefined();
        expect(manifest.posts['102'].sessionWarnings).toContain('SESSION_CONFLICT:4->3');
    });

    it('marks missing posts deleted and renames their downloaded folder', () => {
        const manifest = createEmptyManifest('999');
        const post = createDummyPost('101', 2, 'Student One_K16', '1001');
        syncThreadPostsIntoManifest(manifest, [post], { dataDir: tempDir });

        const activePath = path.join(tempDir, '999', 'Student_One_1001', 'post_101');
        fs.mkdirSync(activePath, { recursive: true });

        syncThreadPostsIntoManifest(manifest, [], {
            dataDir: tempDir,
            markMissing: true,
        });

        expect(manifest.posts['101'].forumStatus).toBe('deleted');
        expect(manifest.posts['101'].postFolder).toBe('post_101_deleted');
        expect(fs.existsSync(`${activePath}_deleted`)).toBe(true);

        syncThreadPostsIntoManifest(manifest, [], {
            dataDir: tempDir,
            markMissing: true,
        });
        expect(manifest.posts['101'].postFolder).toBe('post_101_deleted');

        syncThreadPostsIntoManifest(manifest, [post], { dataDir: tempDir });
        expect(manifest.posts['101'].forumStatus).toBe('deleted');
        expect(manifest.posts['101'].postFolder).toBe('post_101_deleted');
    });

    it('detects edited posts, updates history snapshots, and sets outdated status when links change', () => {
        const manifest = createEmptyManifest('999');
        const postOriginal = createDummyPost('101', 2, 'Student One_K16', '1001');

        syncThreadPostsIntoManifest(manifest, [postOriginal], { now: '2026-10-01T12:00:00+07:00' });

        // Student edits post with a new drive link
        const postEdited = createDummyPost('101', 2, 'Student One_K16', '1001', {
            editedAt: '2026-10-01T15:00:00+07:00',
            links: ['https://drive.example.com/file/2_updated'],
        });

        const result = syncThreadPostsIntoManifest(manifest, [postEdited], {
            now: '2026-10-01T16:00:00+07:00',
        });

        expect(result.editedPosts).toHaveLength(1);
        expect(result.editedPosts[0].hasLinkChanges).toBe(true);

        const record = manifest.posts['101'];
        expect(record.history).toHaveLength(2);
        expect(record.history[0].version).toBe(1);
        expect(record.history[1].version).toBe(2);
        expect(record.history[1].links).toEqual(['https://drive.example.com/file/2_updated']);
        expect(record.syncStatus).toBe('outdated');
    });

    it('saves and loads manifest atomically to disk', () => {
        const manifest = createEmptyManifest('999', { title: 'Test Thread' });
        const post = createDummyPost('101', 2, 'Student One_K16', '1001');
        syncThreadPostsIntoManifest(manifest, [post]);

        const savedPath = saveThreadManifest(tempDir, manifest);
        expect(fs.existsSync(savedPath)).toBe(true);

        const loaded = loadThreadManifest(tempDir, '999');
        expect(loaded).not.toBeNull();
        expect(loaded?.threadId).toBe('999');
        expect(loaded?.posts['101'].userFolder).toBe('Student_One_1001');
    });
});
