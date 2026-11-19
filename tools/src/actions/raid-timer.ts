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
import { diag } from "../services/diagnostics-service";
import { settingsService } from "../services/settings-service";
import { handleCommonCommands } from "./base/command-handler";
import {
    ActionPathSync,
    sendManualPathResultToInspector,
} from "./base/path-sync";
import type { RaidTimerSettings } from "../types";

const NO_PATH_TITLE = "Set EFT\nPath";
const NOT_IN_RAID = "Not in\nRaid";

@action({ UUID: "eu.tarkovbot.tools.raidtimer" })
export class TarkovRaidTimer extends SingletonAction {
    private displayTimer: NodeJS.Timeout | null = null;
    private visibleActions = new Set<any>();
    private watcherRunning = false;
    private currentEftPath = "";
    /** Persists manual path edits from the PI into the global settings (echo-safe). */
    private pathSync = new ActionPathSync();

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
        // FIX (manual-path bug): a path typed into THIS action's property
        // inspector used to live only in the action settings, while the global
        // user_settings.json kept its old value. resolvePath() gives the global
        // path absolute priority, so the typed path was silently ignored and the
        // watcher kept the stale path until the user pressed Auto Detect (the
        // only flow that wrote the global settings + restarted the watcher).
        // The sync below makes a manual edit behave exactly like Auto Detect:
        // persist to global, then re-resolve and restart the watcher.
        const syncResult = this.pathSync.sync(
            ev.action.id,
            ev.payload.settings?.eft_install_path,
            "raid-timer",
        );
        if (syncResult.changed) {
            sendManualPathResultToInspector(syncResult);
        }

        const eftPath = this.resolveEftPath(ev.payload.settings);
        if (eftPath !== this.currentEftPath) {
            await this.ensureWatcher(eftPath);
        }
        for (const action of this.visibleActions) {
            this.renderAction(action);
        }
    }

    override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
        // Legacy: openPatreon přijde jako plain string
        if (typeof ev.payload === "string" && ev.payload === "openPatreon") {
            streamDeck.system.openUrl(URL_PATREON);
            return;
        }

        const handled = await handleCommonCommands(ev);
        if (!handled) return;

        const payload = ev.payload as { command?: string };
        if (payload?.command === "autoDetectPath") {
            const settings = settingsService.load();
            if (settings.eftInstallPath) {
                this.currentEftPath = settings.eftInstallPath;
                raidLogWatcher.restart(settings.eftInstallPath, INTERVALS.RAID_TIMER);
                for (const action of this.visibleActions) {
                    this.renderAction(action);
                }
            } else {
                diag.warn(
                    "PATH",
                    "Raid timer: auto-detect ran but no usable EFT path is stored in settings",
                );
            }
        }
    }

    private resolveEftPath(settings: RaidTimerSettings | undefined): string {
        // Global path is the source of truth; the (possibly stale) action-level
        // mirror is only a fallback. Result is always normalized.
        return settingsService.resolvePath(settings?.eft_install_path);
    }

    private async ensureWatcher(eftPath: string): Promise<void> {
        if (!eftPath) {
            // The path was cleared: stop watching the previous path instead of
            // silently keeping it alive, and show the "Set EFT Path" title.
            if (this.watcherRunning) {
                raidLogWatcher.stop();
                this.watcherRunning = false;
                diag.warn("PATH", "Raid timer: EFT path was cleared - raid log watcher stopped");
            }
            this.currentEftPath = "";
            diag.throttled(
                "warn",
                "raidtimer-no-path",
                "PATH",
                "Raid timer is active but no EFT path is set - it cannot track raids. Set the path in the property inspector.",
            );
            return;
        }
        this.currentEftPath = eftPath;
        // Start (or restart) when the watcher is not running, or when the configured path changed.
        if (!this.watcherRunning || raidLogWatcher.watchedPath !== eftPath) {
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