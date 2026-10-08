/**
 * Text Utilities
 * Processing and normalization for Vietnamese text, student info, and codes
 */

/**
 * Remove Vietnamese diacritics and other diacritical marks
 * Uses Unicode Normalization Form D (NFD)
 */
export function removeDiacritics(text: string): string {
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D');
}

/**
 * Normalize person name for comparison:
 * - Trim extra spaces
 * - Lowercase
 * - Remove diacritics
 */
export function normalizeName(name: string): string {
    return removeDiacritics(name).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Extract Vietnamese student ID (MSSV) from string.
 * Typically 10 digits in HaUI (e.g. 2021601234), or 8-10 digits.
 */
export function extractStudentId(text: string): string | null {
    const match = text.match(/\b(20\d{8}|\d{10}|\d{8,10})\b/);
    return match ? match[1] : null;
}

/**
 * Remove BBCode tags from text while preserving inner contents
 */
export function stripBBCode(text: string): string {
    return text
        .replace(/\[\/?(?:b|i|u|s|color|size|font|quote|url|align|code|list|\*)[^\]]*\]/gi, '')
        .trim();
}

/**
 * Simple token/character similarity score between 0.0 and 1.0
 */
export function stringSimilarity(str1: string, str2: string): number {
    const s1 = normalizeName(str1);
    const s2 = normalizeName(str2);

    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0.0;

    // Check if one contains the other
    if (s1.includes(s2) || s2.includes(s1)) {
        const shorter = Math.min(s1.length, s2.length);
        const longer = Math.max(s1.length, s2.length);
        return shorter / longer;
    }

    // Levenshtein distance
    const track = Array.from({ length: s2.length + 1 }, (_, i) => [i]);
    for (let j = 0; j <= s1.length; j++) track[0][j] = j;

    for (let i = 1; i <= s2.length; i++) {
        for (let j = 1; j <= s1.length; j++) {
            const indicator = s1[j - 1] === s2[i - 1] ? 0 : 1;
            track[i][j] = Math.min(
                track[i - 1][j] + 1,
                track[i][j - 1] + 1,
                track[i - 1][j - 1] + indicator
            );
        }
    }

    const distance = track[s2.length][s1.length];
    const maxLen = Math.max(s1.length, s2.length);
    return 1 - distance / maxLen;
}
