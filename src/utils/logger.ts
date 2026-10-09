/**
 * Logger Utility - Fast and clean diagnostic logging for CLI & Core
 * Supports log level setting and prefixes, inspired by svHaUI-Helper
 */
import { AsyncLocalStorage } from 'node:async_hooks';
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

export interface LogContext {
    post?: string;
    postUrl?: string;
}

let globalMinLevel: LogLevel = 'warn';
const logContext = new AsyncLocalStorage<LogContext>();

export function withLogContext<T>(context: LogContext, callback: () => T): T {
    return logContext.run(context, callback);
}

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

    private getDisplayPrefix(): string {
        const name = this.prefix.split(':').at(-1) || this.prefix;
        return name
            .replace(/(Downloader|Provider|Resolver|Extractor|Client)$/i, '')
            .replace(/([a-z])([A-Z])/g, '$1-$2')
            .toLowerCase();
    }

    private write(level: Exclude<LogLevel, 'none'>, ...args: unknown[]): void {
        const labels: Record<Exclude<LogLevel, 'none'>, string> = {
            debug: 'DEBUG',
            info: 'INFO',
            warn: 'WARN',
            error: 'ERROR',
        };
        const label = labels[level].padEnd(5);
        const coloredLabel =
            level === 'debug'
                ? pc.dim(label)
                : level === 'info'
                  ? pc.cyan(label)
                  : level === 'warn'
                    ? pc.yellow(label)
                    : pc.red(label);

        const context = logContext.getStore();
        const contextLabel = context?.post
            ? ` [${pc.dim(context.post)}]${context.postUrl ? ` ${context.postUrl}` : ''}`
            : '';
        console.error(
            `${coloredLabel} [${pc.dim(this.getDisplayPrefix())}]${contextLabel}`,
            ...args
        );
    }

    /** Debug log */
    get d() {
        if (!this.shouldLog('debug')) return () => {};
        return (...args: unknown[]) => this.write('debug', ...args);
    }

    /** Info log */
    get i() {
        if (!this.shouldLog('info')) return () => {};
        return (...args: unknown[]) => this.write('info', ...args);
    }

    /** Warning log */
    get w() {
        if (!this.shouldLog('warn')) return () => {};
        return (...args: unknown[]) => this.write('warn', ...args);
    }

    /** Error log */
    get e() {
        if (!this.shouldLog('error')) return () => {};
        return (...args: unknown[]) => this.write('error', ...args);
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
