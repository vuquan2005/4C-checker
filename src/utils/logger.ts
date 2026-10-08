/**
 * Logger Utility - Fast and clean logging for CLI & Core
 * Supports log level setting and prefixes, inspired by svHaUI-Helper
 */
import pc from 'picocolors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    none: 4,
};

export interface LoggerOptions {
    prefix?: string;
    minLevel?: LogLevel;
}

let globalMinLevel: LogLevel = 'info';

export function setGlobalLogLevel(level: LogLevel): void {
    globalMinLevel = level;
}

export function getGlobalLogLevel(): LogLevel {
    return globalMinLevel;
}

export class Logger {
    private prefix: string;
    private minLevel: LogLevel | null;

    constructor(options: LoggerOptions = {}) {
        this.prefix = options.prefix || '4C';
        this.minLevel = options.minLevel || null;
    }

    private getEffectiveLevel(): LogLevel {
        return this.minLevel || globalMinLevel;
    }

    private shouldLog(level: Exclude<LogLevel, 'none'>): boolean {
        const effectiveLevel = this.getEffectiveLevel();
        return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[effectiveLevel];
    }

    /** Debug log */
    get d() {
        if (!this.shouldLog('debug')) return () => {};
        return (...args: unknown[]) => {
            console.log(pc.dim(`🔍 [${this.prefix}]`), ...args);
        };
    }

    /** Info log */
    get i() {
        if (!this.shouldLog('info')) return () => {};
        return (...args: unknown[]) => {
            console.info(pc.cyan(`ℹ️ [${this.prefix}]`), ...args);
        };
    }

    /** Warning log */
    get w() {
        if (!this.shouldLog('warn')) return () => {};
        return (...args: unknown[]) => {
            console.warn(pc.yellow(`⚠️ [${this.prefix}]`), ...args);
        };
    }

    /** Error log */
    get e() {
        if (!this.shouldLog('error')) return () => {};
        return (...args: unknown[]) => {
            console.error(pc.red(`❌ [${this.prefix}]`), ...args);
        };
    }

    /** Create child logger with sub-prefix */
    child(name: string): Logger {
        return new Logger({
            prefix: `${this.prefix}:${name}`,
            minLevel: this.minLevel || undefined,
        });
    }

    /** Set minimum log level for this logger */
    setLevel(level: LogLevel): void {
        this.minLevel = level;
    }
}

export const log = new Logger({ prefix: '4C-Checker' });

export function createLogger(name: string): Logger {
    return log.child(name);
}
