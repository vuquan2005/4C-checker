/**
 * Folder Naming Utilities
 * Formats standardized, filesystem-safe folder names for users and post folders.
 */
import { removeDiacritics } from '../../utils/text-utils.js';

/**
 * Normalizes a forum author username into a clean, filesystem-safe user folder name:
 * 1. Removes the part after the first '_' character (typically forum class/cohort suffix like _K16, _CDT)
 * 2. Normalizes Vietnamese diacritics to ASCII characters
 * 3. Replaces spaces and non-alphanumeric characters with '_'
 * 4. Appends the forum UID: `<Clean_Name>_<uid>`
 *
 * Examples:
 * - "Hà Phúc Khánh_K16", "12345" -> "Ha_Phuc_Khanh_12345"
 * - "Nguyen Van A_CDT2", "6789" -> "Nguyen_Van_A_6789"
 * - "TestUser", "101"           -> "TestUser_101"
 * - "user_with_class", "999"    -> "user_999"
 */
export function normalizeUserFolderName(username: string, uid: string): string {
    const rawUsername = (username || '').trim();
    const rawUid = (uid || '').trim();

    // 1. Remove suffix after the first '_' if present
    const underscoreIndex = rawUsername.indexOf('_');
    const namePart = underscoreIndex !== -1 ? rawUsername.slice(0, underscoreIndex) : rawUsername;

    // 2. Remove Vietnamese diacritical marks
    const ascii = removeDiacritics(namePart).trim();

    // 3. Replace spaces, hyphens, and any non-alphanumerics with '_'
    const cleaned = ascii.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    const finalName = cleaned || 'user';
    const finalUid = rawUid || 'unknown';

    return `${finalName}_${finalUid}`;
}

/**
 * Formats a post folder name from the stable unique Post ID.
 * Format: `post_<postId>` (e.g. "post_26091", "post_26150")
 *
 * @param postIndexForUser Retained for compatibility; it is not part of the name
 * @param postId Unique MyBB Post ID
 */
export function buildPostFolderName(_postIndexForUser: number, postId: string): string {
    const cleanId = (postId || '').trim().replace(/[^a-zA-Z0-9]/g, '');

    return `post_${cleanId || 'unknown'}`;
}

/**
 * Reads the initial session index from a generated post folder name.
 * This is a provisional mapping until the post content is parsed for its session number.
 */
export function getPostIndexFromFolderName(postFolder: string): number {
    const match = postFolder.trim().match(/^(\d+)_post_/i);
    if (!match) return 1;

    return Math.max(1, Number.parseInt(match[1], 10) || 1);
}
