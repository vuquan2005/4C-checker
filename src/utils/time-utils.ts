/**
 * Time Utilities Module
 * Normalizes forum date/time strings (relative and absolute) to standard ISO 8601 format
 * Defaults to Vietnam timezone (Asia/Ho_Chi_Minh: UTC+7)
 */

export interface ParseForumDateOptions {
    /** Timezone offset in hours (default: 7 for UTC+7) */
    timezoneOffsetHours?: number;

    /** Reference date for relative terms like "Today" / "Yesterday" (default: new Date()) */
    referenceDate?: Date;

    /** If day and month are ambiguous (both <= 12), prefer month first (default: false -> DD-MM-YYYY) */
    preferMonthFirst?: boolean;
}

/**
 * Format date components to ISO 8601 string with offset (e.g. "2026-10-08T00:02:00+07:00")
 */
function toIsoWithOffset(
    year: number,
    month: number,
    day: number,
    hours: number,
    minutes: number,
    seconds: number,
    timezoneOffsetHours: number
): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const sign = timezoneOffsetHours >= 0 ? '+' : '-';
    const offsetStr = `${sign}${pad(Math.abs(timezoneOffsetHours))}:00`;
    return `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}${offsetStr}`;
}

/**
 * Convert forum datetime string (e.g. "29-09-2026, 18:00", "08-10-2026, 00:02",
 * "Yesterday, 00:02", "09-29-2026, 10:06 PM") into standard ISO 8601 string.
 * Returns null if the input string cannot be parsed.
 */
export function parseForumDateToIso(
    rawText: string,
    options: ParseForumDateOptions = {}
): string | null {
    if (!rawText) return null;
    const clean = rawText.trim();
    if (!clean) return null;

    const {
        timezoneOffsetHours = 7,
        referenceDate = new Date(),
        preferMonthFirst = false,
    } = options;

    // 1. Already valid ISO 8601 string (e.g. 2026-10-08T00:02:00+07:00 or 2026-10-07T17:02:00.000Z)
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(clean)) {
        return clean;
    }

    // 2. Relative time: "Yesterday, 00:02", "Today, 11:52", "Hôm qua, 00:02", "Hôm nay, 11:52"
    const relativeMatch = clean.match(
        /^(yesterday|today|hôm\s*qua|hôm\s*nay)(?:,\s*(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(am|pm))?)?$/i
    );
    if (relativeMatch) {
        const word = relativeMatch[1].toLowerCase().replace(/\s+/g, ' ');
        const isYesterday = word === 'yesterday' || word === 'hôm qua';

        // Calculate target date based on referenceDate shifted to forum timezone
        const refUtcMs = referenceDate.getTime() + referenceDate.getTimezoneOffset() * 60000;
        const localRef = new Date(refUtcMs + timezoneOffsetHours * 3600000);
        if (isYesterday) {
            localRef.setDate(localRef.getDate() - 1);
        }

        let hours = relativeMatch[2] ? parseInt(relativeMatch[2], 10) : 0;
        const minutes = relativeMatch[3] ? parseInt(relativeMatch[3], 10) : 0;
        const seconds = relativeMatch[4] ? parseInt(relativeMatch[4], 10) : 0;
        const ampm = relativeMatch[5];

        if (ampm) {
            const upper = ampm.toUpperCase();
            if (upper === 'PM' && hours < 12) hours += 12;
            if (upper === 'AM' && hours === 12) hours = 0;
        }

        return toIsoWithOffset(
            localRef.getFullYear(),
            localRef.getMonth() + 1,
            localRef.getDate(),
            hours,
            minutes,
            seconds,
            timezoneOffsetHours
        );
    }

    // 3. Absolute date: DD-MM-YYYY or MM-DD-YYYY with optional time
    // e.g. "29-09-2026, 18:00", "08-10-2026, 00:02", "09-29-2026, 10:06 PM", "10-01-2026"
    const dmyMatch = clean.match(
        /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:,\s*(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(am|pm))?)?$/i
    );
    if (dmyMatch) {
        const p1 = parseInt(dmyMatch[1], 10);
        const p2 = parseInt(dmyMatch[2], 10);
        const year = parseInt(dmyMatch[3], 10);

        let day: number;
        let month: number;

        if (p1 > 12 && p2 <= 12) {
            // First is clearly day (DD-MM-YYYY)
            day = p1;
            month = p2;
        } else if (p2 > 12 && p1 <= 12) {
            // Second is clearly day (MM-DD-YYYY)
            day = p2;
            month = p1;
        } else {
            // Ambiguous (both <= 12): use preferMonthFirst option
            if (preferMonthFirst) {
                day = p2;
                month = p1;
            } else {
                day = p1;
                month = p2;
            }
        }

        let hours = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0;
        const minutes = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
        const seconds = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
        const ampm = dmyMatch[7];

        if (ampm) {
            const upper = ampm.toUpperCase();
            if (upper === 'PM' && hours < 12) hours += 12;
            if (upper === 'AM' && hours === 12) hours = 0;
        }

        return toIsoWithOffset(year, month, day, hours, minutes, seconds, timezoneOffsetHours);
    }

    // 4. ISO-style date: YYYY-MM-DD with optional time
    const ymdMatch = clean.match(
        /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(am|pm))?)?$/i
    );
    if (ymdMatch) {
        const year = parseInt(ymdMatch[1], 10);
        const month = parseInt(ymdMatch[2], 10);
        const day = parseInt(ymdMatch[3], 10);

        let hours = ymdMatch[4] ? parseInt(ymdMatch[4], 10) : 0;
        const minutes = ymdMatch[5] ? parseInt(ymdMatch[5], 10) : 0;
        const seconds = ymdMatch[6] ? parseInt(ymdMatch[6], 10) : 0;
        const ampm = ymdMatch[7];

        if (ampm) {
            const upper = ampm.toUpperCase();
            if (upper === 'PM' && hours < 12) hours += 12;
            if (upper === 'AM' && hours === 12) hours = 0;
        }

        return toIsoWithOffset(year, month, day, hours, minutes, seconds, timezoneOffsetHours);
    }

    return null;
}
