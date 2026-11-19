import fs from "node:fs";
import streamDeck from "@elgato/streamdeck";
import { diag, describeFsError } from "./diagnostics-service";
import { getLatestLogFile } from "./log-service";

const LOG_TS_REGEX = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\|/;

export class RaidLogWatcher {
    private eftPath = "";
    private currentLogFile: string | null = null;
    private bytesRead = 0;
    private pollTimer: NodeJS.Timeout | null = null;
    private _raidStart: number | null = null;
    private _inRaid = false;

    onStateChange: ((inRaid: boolean, raidStartMs: number | null) => void) | null = null;

    get inRaid(): boolean { return this._inRaid; }
    get raidStartMs(): number | null { return this._raidStart; }
    get watchedPath(): string { return this.eftPath; }
    get elapsedMs(): number | null {
        return this._raidStart !== null ? Date.now() - this._raidStart : null;
    }

    start(eftPath: string, intervalMs: number): void {
        if (!eftPath) {
            diag.warn("WATCHER", "Raid log watcher start skipped - no EFT path configured");
            return;
        }
        this.stop();
        this.eftPath = eftPath;
        diag.info("WATCHER", "Raid log watcher started", { eftPath, intervalMs });
        this.initialScan();
        this.pollTimer = setInterval(() => this.poll(), intervalMs);
    }

    stop(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
            diag.debug("WATCHER", "Raid log watcher stopped", { eftPath: this.eftPath });
        }
        this.currentLogFile = null;
        this.bytesRead = 0;
        this._raidStart = null;
        this._inRaid = false;
    }

    restart(eftPath: string, intervalMs: number): void {
        diag.info("WATCHER", "Raid log watcher restarting with new path", { newEftPath: eftPath || "(empty)" });
        this.stop();
        this.start(eftPath, intervalMs);
    }

    private async initialScan(): Promise<void> {
        try {
            const logFile = await getLatestLogFile(this.eftPath);
            if (!logFile) return;
            this.currentLogFile = logFile;
            await this.scanFileForState(logFile);
            this.notify();
        } catch (err) {
            diag.throttled(
                "error",
                "watcher-initial-scan",
                "WATCHER",
                "Initial scan of the latest log failed",
                { eftPath: this.eftPath, err: describeFsError(err) },
            );
            streamDeck.logger.error("[RAID WATCHER] Initial scan failed:", err);
        }
    }

    private async scanFileForState(logFile: string): Promise<void> {
        let content: string;
        try {
            content = await fs.promises.readFile(logFile, "utf-8");
        } catch (err) {
            diag.throttled(
                "error",
                `watcher-read:${logFile}`,
                "FS",
                "Cannot read the log file while scanning for raid state",
                { logFile, err: describeFsError(err) },
            );
            throw err;
        }
        this.bytesRead = Buffer.byteLength(content, "utf-8");

        let lastStartTs: number | null = null;
        let lastEndTs: number | null = null;

        for (const line of content.split("\n")) {
            const ts = this.parseTs(line);
            if (!ts) continue;
            if (this.isGameStarted(line)) lastStartTs = ts;
            if (this.isBEClientExit(line)) lastEndTs = ts;
        }

        if (lastStartTs !== null && (lastEndTs === null || lastStartTs > lastEndTs)) {
            this._inRaid = true;
            this._raidStart = lastStartTs;
        } else {
            this._inRaid = false;
            this._raidStart = null;
        }
    }

    private async poll(): Promise<void> {
        try {
            const logFile = await getLatestLogFile(this.eftPath);
            if (!logFile) return;

            if (logFile !== this.currentLogFile) {
                diag.info("WATCHER", "New log file detected (game restarted)", {
                    previousFile: this.currentLogFile,
                    newFile: logFile,
                });
                this.currentLogFile = logFile;
                this.bytesRead = 0;
                this._inRaid = false;
                this._raidStart = null;
                await this.scanFileForState(logFile);
                this.notify();
                return;
            }

            let stat: fs.Stats;
            try {
                stat = await fs.promises.stat(logFile);
            } catch (err) {
                diag.throttled(
                    "error",
                    `watcher-stat:${logFile}`,
                    "FS",
                    "Cannot stat the log file during polling",
                    { logFile, err: describeFsError(err) },
                );
                return;
            }
            if (stat.size <= this.bytesRead) return;

            try {
                const fd = await fs.promises.open(logFile, "r");
                const buf = Buffer.alloc(stat.size - this.bytesRead);
                await fd.read(buf, 0, buf.length, this.bytesRead);
                await fd.close();
                this.bytesRead = stat.size;

                for (const line of buf.toString("utf-8").split("\n")) {
                    const ts = this.parseTs(line);
                    if (!ts) continue;

                    if (this.isGameStarted(line)) {
                        this._inRaid = true;
                        this._raidStart = ts;
                        diag.info("WATCHER", "Raid start detected in log", { raidStartTs: ts });
                        this.notify();
                    }
                    if (this.isBEClientExit(line) && this._inRaid) {
                        this._inRaid = false;
                        this._raidStart = null;
                        diag.info("WATCHER", "Raid end detected in log");
                        this.notify();
                    }
                }
            } catch (err) {
                diag.throttled(
                    "error",
                    `watcher-incremental:${logFile}`,
                    "FS",
                    "Cannot read new log content during polling",
                    { logFile, err: describeFsError(err) },
                );
            }
        } catch (err) {
            diag.throttled(
                "error",
                "watcher-poll",
                "WATCHER",
                "Unexpected poll error",
                { eftPath: this.eftPath, err: describeFsError(err) },
            );
            streamDeck.logger.error("[RAID WATCHER] Poll error:", err);
        }
    }

    private parseTs(line: string): number | null {
        const m = line.match(LOG_TS_REGEX);
        return m ? new Date(m[1]).getTime() : null;
    }

    private isGameStarted(line: string): boolean {
        return line.includes("GameStarted") && !line.includes("GameStarting");
    }

    private isBEClientExit(line: string): boolean {
        return line.includes("BEClient exit") && !line.includes("successfully");
    }

    private notify(): void {
        this.onStateChange?.(this._inRaid, this._raidStart);
    }
}

export const raidLogWatcher = new RaidLogWatcher();
