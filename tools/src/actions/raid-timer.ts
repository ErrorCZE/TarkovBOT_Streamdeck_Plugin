import {
    action,
    streamDeck,
    DidReceiveSettingsEvent,
    SendToPluginEvent,
    SingletonAction,
    WillAppearEvent,
    WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue, JsonObject } from "@elgato/utils";
import { INTERVALS, URL_PATREON } from "../config/constants";
import { raidLogWatcher } from "../services/raid-log-watcher";
import { settingsService } from "../services/settings-service";
import { detectEftPath } from "../services/path-detect-service";
import type { RaidTimerSettings } from "../types";

const NO_PATH_TITLE = "Set EFT\nPath";
const NOT_IN_RAID = "Not in\nRaid";

@action({ UUID: "eu.tarkovbot.tools.raidtimer" })
export class TarkovRaidTimer extends SingletonAction {
    private displayTimer: NodeJS.Timeout | null = null;
    private visibleActions = new Set<any>();
    private watcherRunning = false;
    private currentEftPath = "";

    override async onWillAppear(ev: WillAppearEvent<RaidTimerSettings>): Promise<void> {
        this.visibleActions.add(ev.action);
        const eftPath = this.resolveEftPath(ev.payload.settings);
        await this.ensureWatcher(eftPath);
        this.renderAction(ev.action);
        this.ensureDisplayTimer();
    }

    override onWillDisappear(ev: WillDisappearEvent): void | Promise<void> {
        this.visibleActions.delete(ev.action);
        if (this.visibleActions.size === 0 && this.displayTimer) {
            clearInterval(this.displayTimer);
            this.displayTimer = null;
        }
    }

    override async onDidReceiveSettings(
        ev: DidReceiveSettingsEvent<RaidTimerSettings>,
    ): Promise<void> {
        const eftPath = this.resolveEftPath(ev.payload.settings);
        if (eftPath !== this.currentEftPath) {
            await this.ensureWatcher(eftPath);
        }
        for (const action of this.visibleActions) {
            this.renderAction(action);
        }
    }

    override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
        if (typeof ev.payload === "string" && ev.payload === "openPatreon") {
            streamDeck.system.openUrl(URL_PATREON);
        }
        if (typeof ev.payload === "string" && ev.payload === "autoDetect") {
            const result = await detectEftPath();
            if (result.success && result.path) {
                settingsService.setEftInstallPath(result.path);
                this.currentEftPath = result.path;
                raidLogWatcher.restart(result.path, INTERVALS.RAID_TIMER);
                for (const action of this.visibleActions) {
                    this.renderAction(action);
                }
            }
        }
    }

    private resolveEftPath(settings: RaidTimerSettings | undefined): string {
        if (settings?.eft_install_path) return settings.eft_install_path;
        return settingsService.load().eftInstallPath;
    }

    private async ensureWatcher(eftPath: string): Promise<void> {
        if (!eftPath) return;
        this.currentEftPath = eftPath;
        if (!this.watcherRunning) {
            raidLogWatcher.onStateChange = () => {
                for (const action of this.visibleActions) {
                    this.renderAction(action);
                }
            };
            raidLogWatcher.start(eftPath, INTERVALS.RAID_TIMER);
            this.watcherRunning = true;
        }
    }

    private ensureDisplayTimer(): void {
        if (this.displayTimer) return;
        this.displayTimer = setInterval(() => {
            for (const action of this.visibleActions) {
                this.renderAction(action);
            }
        }, INTERVALS.RAID_TIMER);
    }

    private renderAction(action: any): void {
        if (!this.currentEftPath) {
            action.setTitle(NO_PATH_TITLE);
            return;
        }
        if (!raidLogWatcher.inRaid) {
            action.setTitle(NOT_IN_RAID);
            return;
        }
        const elapsed = raidLogWatcher.elapsedMs;
        if (elapsed === null) {
            action.setTitle(NOT_IN_RAID);
            return;
        }
        action.setTitle(`\n\n${this.formatMMSS(elapsed)}`);
    }

    private formatMMSS(ms: number): string {
        const totalSec = Math.floor(ms / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
}