import { describe, expect, it } from 'vitest';
import { resolveSession } from './session-resolver.js';

describe('Session Resolver', () => {
    it('uses the declared session when it matches the inferred session', () => {
        expect(resolveSession('Nộp bài buổi 3', 3)).toMatchObject({
            declaredSession: 3,
            inferredSession: 3,
            sessionIndex: 3,
            sessionSource: 'declared',
            warnings: [],
        });
    });

    it('does not choose a folder when declared and inferred sessions conflict', () => {
        const result = resolveSession('Nộp bài buổi 2', 3);
        expect(result.declaredSession).toBe(2);
        expect(result.inferredSession).toBe(3);
        expect(result.sessionIndex).toBeUndefined();
        expect(result.sessionSource).toBeUndefined();
        expect(result.warnings).toEqual(['SESSION_CONFLICT:2->3']);
    });

    it('uses a manual override to resolve a conflict', () => {
        expect(resolveSession('Nộp bài buổi 2', 3, 4)).toMatchObject({
            declaredSession: 2,
            inferredSession: 3,
            sessionOverride: 4,
            sessionIndex: 4,
            sessionSource: 'override',
            warnings: ['SESSION_CONFLICT:2->3'],
        });
    });

    it('does not default to session one when no session is present', () => {
        const result = resolveSession('Nộp bài CAD', undefined);
        expect(result.sessionIndex).toBeUndefined();
        expect(result.sessionSource).toBeUndefined();
        expect(result.warnings).toEqual(['SESSION_NOT_FOUND']);
    });
});
