import fs from "node:fs";
import streamDeck from "@elgato/streamdeck";
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
    get elapsedMs(): number | null {
        return this._raidStart !== null ? Date.now() - this._raidStart : null;
    }

    start(eftPath: string, intervalMs: number): void {
        this.stop();
        this.eftPath = eftPath;
        this.initialScan();
        this.pollTimer = setInterval(() => this.poll(), intervalMs);
    }

    stop(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        this.currentLogFile = null;
        this.bytesRead = 0;
        this._raidStart = null;
        this._inRaid = false;
    }

    restart(eftPath: string, intervalMs: number): void {
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
            streamDeck.logger.error("[RAID WATCHER] Initial scan failed:", err);
        }
    }

    private async scanFileForState(logFile: string): Promise<void> {
        const content = await fs.promises.readFile(logFile, "utf-8");
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
                this.currentLogFile = logFile;
                this.bytesRead = 0;
                this._inRaid = false;
                this._raidStart = null;
                await this.scanFileForState(logFile);
                this.notify();
                return;
            }

            const stat = await fs.promises.stat(logFile);
            if (stat.size <= this.bytesRead) return;

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
                    this.notify();
                }
                if (this.isBEClientExit(line) && this._inRaid) {
                    this._inRaid = false;
                    this._raidStart = null;
                    this.notify();
                }
            }
        } catch (err) {
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