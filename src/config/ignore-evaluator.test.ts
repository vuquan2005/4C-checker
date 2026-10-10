import { describe, it, expect } from 'vitest';
import { isPostIgnored, type PostMatchTarget } from './ignore-evaluator.js';

describe('ignore-evaluator', () => {
    const dummyPost: PostMatchTarget = {
        postId: '26090',
        postNumber: 5,
        author: {
            uid: '27392',
            username: 'Nguyễn Xuân Hiếu_4CHaUI',
        },
    };

    it('returns false when no ignoreConfig is provided', () => {
        expect(isPostIgnored(dummyPost)).toEqual({ ignored: false });
    });

    it('ignores postNumber 1 when ignoreOp is true by default', () => {
        const opPost: PostMatchTarget = {
            ...dummyPost,
            postNumber: 1,
        };
        const res = isPostIgnored(opPost, { ignoreOp: true });
        expect(res.ignored).toBe(true);
        expect(res.reason).toContain('IGNORED_OP');
    });

    it('does not ignore postNumber 1 when ignoreOp is explicitly false', () => {
        const opPost: PostMatchTarget = {
            ...dummyPost,
            postNumber: 1,
        };
        const res = isPostIgnored(opPost, { ignoreOp: false });
        expect(res.ignored).toBe(false);
    });

    it('ignores post by postNumber', () => {
        const res = isPostIgnored(dummyPost, { postNumbers: [2, 5, 10] });
        expect(res.ignored).toBe(true);
        expect(res.reason).toBe('IGNORED_POST_NUMBER: #5');

        const nonIgnored = isPostIgnored(dummyPost, { postNumbers: [2, 10] });
        expect(nonIgnored.ignored).toBe(false);
    });

    it('ignores post by postId', () => {
        const res = isPostIgnored(dummyPost, { postIds: ['26090', '26100'] });
        expect(res.ignored).toBe(true);
        expect(res.reason).toBe('IGNORED_POST_ID: 26090');

        const nonIgnored = isPostIgnored(dummyPost, { postIds: ['99999'] });
        expect(nonIgnored.ignored).toBe(false);
    });

    it('ignores post by author UID', () => {
        const res = isPostIgnored(dummyPost, { uids: ['27392'] });
        expect(res.ignored).toBe(true);
        expect(res.reason).toBe('IGNORED_UID: 27392');

        const nonIgnored = isPostIgnored(dummyPost, { uids: ['11111'] });
        expect(nonIgnored.ignored).toBe(false);
    });

    it('ignores post by exact username match (case-insensitive)', () => {
        const res = isPostIgnored(dummyPost, {
            usernames: ['nguyễn xuân hiếu_4chaui'],
        });
        expect(res.ignored).toBe(true);
        expect(res.reason).toContain('IGNORED_USERNAME');
    });

    it('ignores post by wildcard username pattern', () => {
        const res = isPostIgnored(dummyPost, {
            usernames: ['*Xuân Hiếu*', 'Admin_*'],
        });
        expect(res.ignored).toBe(true);
        expect(res.reason).toContain('IGNORED_USERNAME');

        const adminPost: PostMatchTarget = {
            ...dummyPost,
            author: { uid: '1', username: 'Admin_Master' },
        };
        const resAdmin = isPostIgnored(adminPost, { usernames: ['Admin_*'] });
        expect(resAdmin.ignored).toBe(true);
    });
});
