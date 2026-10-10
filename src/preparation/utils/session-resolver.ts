/** Resolve the session number used to locate a submission on Google Drive. */
export type SessionSource = 'declared' | 'inferred' | 'override';

export interface SessionResolution {
    declaredSession?: number;
    inferredSession?: number;
    sessionOverride?: number;
    sessionIndex?: number;
    sessionSource?: SessionSource;
    warnings: string[];
}

function buildSessionRegex(keywords?: string[]): RegExp {
    if (!keywords || keywords.length === 0) {
        return /(?:buổi|buoi)\s*[-:]?\s*0?(\d+)\b|\bb\s*0?(\d+)\b/giu;
    }
    const escapedKeywords = keywords
        .map((k) => k.trim())
        .filter(Boolean)
        .map((k) => k.replace(/[.+^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`(?:${escapedKeywords.join('|')})\\s*[-:]?\\s*0?(\\d+)\\b`, 'giu');
}

function extractDeclaredSessions(text: string, keywords?: string[]): number[] {
    const regex = buildSessionRegex(keywords);
    const matches = text.matchAll(regex);
    return [...new Set([...matches].map((match) => Number(match[1])))].filter(
        (session) => session > 0
    );
}

export function resolveSession(
    text: string,
    inferredSession?: number,
    sessionOverride?: number,
    keywords?: string[]
): SessionResolution {
    const declaredSessions = extractDeclaredSessions(text, keywords);
    const declaredSession = declaredSessions.length === 1 ? declaredSessions[0] : undefined;
    const warnings: string[] = [];

    if (declaredSessions.length > 1) {
        warnings.push(`SESSION_AMBIGUOUS:${declaredSessions.join(',')}`);
    }

    if (
        declaredSessions.length === 0 &&
        inferredSession === undefined &&
        sessionOverride === undefined
    ) {
        warnings.push('SESSION_NOT_FOUND');
    }

    const hasConflict =
        declaredSession !== undefined &&
        inferredSession !== undefined &&
        declaredSession !== inferredSession;

    if (hasConflict) {
        warnings.push(`SESSION_CONFLICT:${declaredSession}->${inferredSession}`);
    }

    if (
        sessionOverride === undefined &&
        (hasConflict ||
            declaredSessions.length > 1 ||
            (declaredSession === undefined && inferredSession === undefined))
    ) {
        warnings.push('SESSION_OVERRIDE_REQUIRED: set session.overrides in config.json and rerun');
    }

    if (sessionOverride !== undefined) {
        return {
            declaredSession,
            inferredSession,
            sessionOverride,
            sessionIndex: sessionOverride,
            sessionSource: 'override',
            warnings,
        };
    }

    if (
        hasConflict ||
        declaredSessions.length > 1 ||
        (declaredSession === undefined && inferredSession === undefined)
    ) {
        return { declaredSession, inferredSession, warnings };
    }

    if (declaredSession !== undefined) {
        return {
            declaredSession,
            inferredSession,
            sessionIndex: declaredSession,
            sessionSource: 'declared',
            warnings,
        };
    }

    return {
        inferredSession,
        sessionIndex: inferredSession,
        sessionSource: 'inferred',
        warnings,
    };
}

export function getSessionForInference(record: {
    sessionIndex?: number;
    sessionOverride?: number;
    inferredSession?: number;
}): number | undefined {
    return record.sessionOverride ?? record.sessionIndex ?? record.inferredSession;
}
