import fs from "node:fs";
import path from "node:path";
import streamDeck from "@elgato/streamdeck";

/**
 * Central diagnostics logger.
 *
 * Every problem the plugin runs into (missing path, no read access, unreadable
 * settings file, watcher failures, API errors, unexpected crashes) is written
 * here, so nothing disappears into a silent `catch {}` block.
 *
 * Output:
 *   - `diagnostics.log` next to `user_settings.json` (JSON lines, one event per line)
 *   - Rotated to `diagnostics.old.log` when it exceeds MAX_LOG_SIZE
 *   - `warn`/`error` events are mirrored into the Stream Deck log as well
 */

export type DiagLevel = "debug" | "info" | "warn" | "error";
export type DiagCategory =
    | "PATH"
    | "SETTINGS"
    | "FS"
    | "WATCHER"
    | "API"
    | "ACTION"
    | "GENERAL";

export const DIAG_FILE_PATH = path.join(process.cwd(), "diagnostics.log");
export const DIAG_OLD_FILE_PATH = path.join(process.cwd(), "diagnostics.old.log");

const MAX_LOG_SIZE = 1024 * 1024;
const DEFAULT_THROTTLE_MS = 10 * 60 * 1000; // repeated errors: log again after 10 min

/** Human-readable explanation for common Node.js filesystem error codes. */
const FS_ERROR_HINTS: Record<string, string> = {
    ENOENT: "path does not exist (wrong path, typo, or folder was moved/renamed)",
    EACCES: "access denied (no read permission on this file/folder)",
    EPERM: "operation not permitted (blocked by permissions or antivirus)",
    EISDIR: "path is a folder, but a file was expected",
    ENOTDIR: "part of the path is a file, not a folder (broken path)",
    EBUSY: "file/folder is locked by another process (probably the game)",
    EMFILE: "too many open files (system limit reached)",
    ENFILE: "system-wide file table is full",
    EROFS: "read-only file system, writing is not possible",
};

/** Turns a filesystem error into a short human-readable string, e.g. `ENOENT: path does not exist`. */
export function describeFsError(err: unknown): string {
    const code = (err as any)?.code as string | undefined;
    if (code && FS_ERROR_HINTS[code]) return `${code}: ${FS_ERROR_HINTS[code]}`;
    if (err instanceof Error) {
        const msg = code ? `${code}: ${err.message}` : err.message;
        return (err as any)?.cause ? `${msg} (cause: ${String((err as any).cause)})` : msg;
    }
    return String(err);
}

/**
 * Cleans up a manually entered EFT path so it matches what the plugin expects:
 *  - trims whitespace
 *  - strips wrapping quotes (Explorer "Copy as path" copies `"C:\...\EFT"`)
 *  - unifies forward slashes to backslashes and drops trailing separators
 *  - drops a trailing `\Logs` segment (the plugin appends `\Logs` itself)
 */
export function normalizeEftPath(input: string): string {
    let p = (input ?? "").trim();
    if (!p) return "";
    if (
        (p.startsWith('"') && p.endsWith('"') && p.length >= 2) ||
        (p.startsWith("'") && p.endsWith("'") && p.length >= 2)
    ) {
        p = p.slice(1, -1).trim();
    }
    p = p.replace(/\//g, "\\").replace(/\\+$/, "");
    const logsSuffix = p.match(/^(.*)\\Logs$/i);
    if (logsSuffix && logsSuffix[1]) {
        return logsSuffix[1].trim();
    }
    return p;
}

export interface PathValidationResult {
    path: string;
    valid: boolean;
    /** Concrete list of problems; empty when the path is usable. */
    problems: string[];
}

/**
 * Full validation of a configured (usually manually entered) EFT install path:
 * does it exist, is it a folder, does it contain `Logs`, can we actually read it?
 */
export function validateEftPath(eftPath: string): PathValidationResult {
    const p = (eftPath ?? "").trim();
    const problems: string[] = [];

    if (!p) {
        problems.push("path is empty / not set");
        return { path: p, valid: false, problems };
    }

    if (!fs.existsSync(p)) {
        problems.push("path does not exist (typo, wrong drive letter, or folder moved?)");
        return { path: p, valid: false, problems };
    }

    let st: fs.Stats;
    try {
        st = fs.statSync(p);
    } catch (err) {
        problems.push(`cannot inspect path (${describeFsError(err)})`);
        return { path: p, valid: false, problems };
    }

    if (!st.isDirectory()) {
        problems.push("path points to a file, not to a folder");
        return { path: p, valid: false, problems };
    }

    const logsDir = path.join(p, "Logs");
    if (!fs.existsSync(logsDir)) {
        problems.push(`Logs folder not found inside (expected: ${logsDir})`);
        return { path: p, valid: false, problems };
    }

    // Read-permission checks: access() + a real readdir() as the authoritative test.
    try {
        fs.accessSync(p, fs.constants.R_OK);
    } catch (err) {
        problems.push(`no read permission for the path (${describeFsError(err)})`);
    }
    try {
        fs.accessSync(logsDir, fs.constants.R_OK);
    } catch (err) {
        problems.push(`no read permission for the Logs folder (${describeFsError(err)})`);
    }
    try {
        const entries = fs.readdirSync(logsDir);
        const logFolders = entries.filter((e) => e.startsWith("log_"));
        if (logFolders.length === 0) {
            problems.push(
                "Logs folder exists but contains no log_* folders yet (game has not run since the folder was created)",
            );
        }
    } catch (err) {
        problems.push(`cannot list the Logs folder (${describeFsError(err)})`);
    }

    return { path: p, valid: problems.length === 0, problems };
}

interface ThrottleState {
    lastAt: number;
    suppressed: number;
}

class DiagnosticsLogger {
    private readonly throttleState = new Map<string, ThrottleState>();
    /** Set to true when writing the file keeps failing; prevents endless retry spam. */
    private fileDisabled = false;

    debug(category: DiagCategory, message: string, details?: Record<string, unknown>): void {
        this.log("debug", category, message, details);
    }

    info(category: DiagCategory, message: string, details?: Record<string, unknown>): void {
        this.log("info", category, message, details);
    }

    warn(category: DiagCategory, message: string, details?: Record<string, unknown>): void {
        this.log("warn", category, message, details);
    }

    error(category: DiagCategory, message: string, details?: Record<string, unknown>): void {
        this.log("error", category, message, details);
    }

    /**
     * Logs with rate limiting: the first occurrence is written immediately,
     * repeats within the throttle window are counted silently, and once the
     * window expires the message is logged again including the suppressed count.
     * Use this inside poll loops / timers so a broken path does not flood the log.
     */
    throttled(
        level: DiagLevel,
        key: string,
        category: DiagCategory,
        message: string,
        details?: Record<string, unknown>,
        throttleMs: number = DEFAULT_THROTTLE_MS,
    ): void {
        try {
            const now = Date.now();
            const state = this.throttleState.get(key);
            if (state && now - state.lastAt < throttleMs) {
                state.suppressed += 1;
                return;
            }
            const suppressed = state?.suppressed ?? 0;
            this.throttleState.set(key, { lastAt: now, suppressed: 0 });
            const enriched = suppressed > 0 ? { ...details, suppressedRepeats: suppressed } : details;
            this.log(level, category, message, enriched);
        } catch {
            /* never let diagnostics itself break the plugin */
        }
    }

    log(level: DiagLevel, category: DiagCategory, message: string, details?: Record<string, unknown>): void {
        const entry: Record<string, unknown> = {
            ts: new Date().toISOString(),
            level,
            category,
            message,
        };
        if (details) {
            for (const [k, v] of Object.entries(details)) {
                entry[k] = v instanceof Error ? describeFsError(v) : v;
            }
        }

        // Always mirror warnings/errors into the Stream Deck log.
        if (level === "warn" || level === "error") {
            try {
                const line = `[DIAG][${category}] ${message}${details ? ` | ${JSON.stringify(compact(details))}` : ""}`;
                if (level === "error") streamDeck.logger.error(line);
                else streamDeck.logger.warn(line);
            } catch {
                /* streamDeck logger unavailable */
            }
        }

        this.writeLine(JSON.stringify(entry));
    }

    private writeLine(line: string): void {
        if (this.fileDisabled) return;
        try {
            this.rotateIfNeeded();
            fs.appendFileSync(DIAG_FILE_PATH, line + "\n", "utf8");
        } catch {
            // Disk/permission problems with the log file itself must not break the plugin.
            // Give up on the file log after the first failure and rely on the SD log.
            this.fileDisabled = true;
            try {
                streamDeck.logger.error(`[DIAG] Cannot write ${DIAG_FILE_PATH}: logging to file disabled`);
            } catch {
                /* ignore */
            }
        }
    }

    private rotateIfNeeded(): void {
        try {
            const st = fs.statSync(DIAG_FILE_PATH);
            if (st.size < MAX_LOG_SIZE) return;
            try {
                fs.unlinkSync(DIAG_OLD_FILE_PATH);
            } catch {
                /* no old file yet */
            }
            fs.renameSync(DIAG_FILE_PATH, DIAG_OLD_FILE_PATH);
        } catch {
            /* file does not exist yet */
        }
    }

    /** Logs uncaught exceptions / unhandled rejections instead of dying silently. */
    registerGlobalErrorHandlers(): void {
        process.on("uncaughtException", (err) => {
            this.log("error", "GENERAL", "Uncaught exception", { err: describeFsError(err), stack: (err as Error)?.stack });
        });
        process.on("unhandledRejection", (reason) => {
            this.log("error", "GENERAL", "Unhandled promise rejection", {
                err: reason instanceof Error ? describeFsError(reason) : String(reason),
                stack: reason instanceof Error ? reason.stack : undefined,
            });
        });
    }
}

function compact(details: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(details)) {
        out[k] = v instanceof Error ? describeFsError(v) : v;
    }
    return out;
}

export const diag = new DiagnosticsLogger();
