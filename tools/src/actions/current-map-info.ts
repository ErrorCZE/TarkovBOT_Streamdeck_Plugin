import {
    action,
    streamDeck,
    DidReceiveSettingsEvent,
    KeyDownEvent,
    SendToPluginEvent,
    SingletonAction,
    WillAppearEvent,
    WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue, JsonObject } from "@elgato/utils";
import { existsSync } from "fs";
import { join } from "path";
import { DEVICE_PROFILE_MAP, INTERVALS } from "../config/constants";
import { handleCommonCommands } from "./base/command-handler";
import { settingsService } from "../services/settings-service";
import { stateService } from "../services/state-service";
import { findCurrentMapFromLogs } from "../services/log-service";
import type { GameMode, MapInfoSettings } from "../types";

const SELECT_MODE_TITLE = "Select\nGame\nMode";
const DEFAULT_TITLE = "Get\nCurrent\nMap Info";
const ERROR_TITLE_DURATION_MS = 4000;

const ERROR_TITLES = {
    NO_INSTALL_PATH: "EFT path\nnot set",
    LOGS_FOLDER_MISSING: "Logs\nfolder\nnot found",
    NO_RAID_FOUND: "No raid\nfound in\ncurrent logs",
    READ_FAILED: "Failed to\nread logs",
    PROFILE_SWITCH_FAILED: "Profile\nswitch\nfailed",
} as const;

const MODE_BORDER_COLOR: Record<GameMode, string> = {
    PVP: "#ffae00",
    PVE: "#00d9ff",
    SEASON: "#00ff91",
};

function applyModeStrip(action: any, mode: GameMode): void {
    const color = MODE_BORDER_COLOR[mode];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
        <rect width="144" height="144" fill="transparent"/>
        <rect x="0" y="0" width="144" height="23" fill="${color}"/>
        <text x="72" y="20" text-anchor="middle" dominant-baseline="middle"
            fill="#000" font-family="Arial,sans-serif" font-size="22" font-weight="bold">${mode.toUpperCase()}</text>
    </svg>`;
    action.setImage(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

function isValidGameMode(mode: unknown): mode is GameMode {
    return mode === "PVP" || mode === "PVE" || mode === "SEASON";
}

function migrateLegacy(settings: MapInfoSettings): MapInfoSettings {
    if (isValidGameMode(settings.game_mode)) return settings;
    const legacy = (settings as any).pve_map_mode_check;
    if (typeof legacy !== "boolean") return settings;
    const migrated = { ...settings };
    migrated.game_mode = legacy ? "PVE" : "PVP";
    delete (migrated as any).pve_map_mode_check;
    return migrated;
}

type LookupResult =
    | { ok: true; locationId: string }
    | { ok: false; errorTitle: string };

@action({ UUID: "eu.tarkovbot.tools.mapinfo" })
export class TarkovCurrentMapInfo extends SingletonAction {
    private autoUpdateTimers = new Map<string, NodeJS.Timeout>();
    private generations = new Map<string, number>();
    private errorResetTimers = new Map<string, NodeJS.Timeout>();

    override async onWillAppear(ev: WillAppearEvent<MapInfoSettings>): Promise<void> {
        const raw = ev.payload.settings ?? ({} as MapInfoSettings);
        let settings = migrateLegacy(raw);
        if (settings !== raw) {
            await ev.action.setSettings(settings as unknown as JsonObject);
        }
        settings = await this.maybeInheritFromGlobal(ev.action, settings);

        if (!isValidGameMode(settings.game_mode)) {
            ev.action.setTitle(SELECT_MODE_TITLE);
            ev.action.setImage("");
            return;
        }

        applyModeStrip(ev.action, settings.game_mode);
        ev.action.setTitle(DEFAULT_TITLE);
    }

    override async onKeyDown(ev: KeyDownEvent<MapInfoSettings>): Promise<void> {
        const settings = ev.payload.settings ?? ({} as MapInfoSettings);

        if (!isValidGameMode(settings.game_mode)) {
            ev.action.setTitle(SELECT_MODE_TITLE);
            return;
        }

        const global = settingsService.load();
        const eftInstallPath =
            global.eftInstallPath || settings.eft_install_path || "";

        this.stopAutoUpdate(ev.action.id);
        this.clearErrorReset(ev.action.id);

        const gen = this.bumpGen(ev.action.id);

        const result = await this.lookupCurrentMap(eftInstallPath, settings.game_mode);

        if (this.generations.get(ev.action.id) !== gen) return;

        if (!result.ok) {
            stateService.currentLocationId = null as any;
            await this.showError(ev.action, result.errorTitle);
            return;
        }

        stateService.currentLocationId = result.locationId as any;
        ev.action.setTitle(DEFAULT_TITLE);

        if (settings.map_autoupdate_check) {
            this.autoUpdateTimers.set(
                ev.action.id,
                setInterval(async () => {
                    if (this.generations.get(ev.action.id) !== gen) {
                        this.stopAutoUpdate(ev.action.id);
                        return;
                    }
                    const r = await this.lookupCurrentMap(
                        eftInstallPath,
                        settings.game_mode!,
                    );
                    // Keep the last known map if a refresh fails; don't wipe state on a transient miss.
                    if (r.ok) {
                        stateService.currentLocationId = r.locationId as any;
                    }
                }, INTERVALS.MAP_DISCOVERY),
            );
        }

        try {
            await streamDeck.profiles.switchToProfile(
                ev.action.device.id,
                this.getProfilePath(ev.action.device.type),
            );
        } catch (err) {
            streamDeck.logger.error("Failed to switch profile", err);
            await this.showError(ev.action, ERROR_TITLES.PROFILE_SWITCH_FAILED);
        }
    }

    /**
     * Wraps findCurrentMapFromLogs and turns every failure mode into a specific,
     * human-readable button title.
     */
    private async lookupCurrentMap(
        eftInstallPath: string,
        mode: GameMode,
    ): Promise<LookupResult> {
        if (!eftInstallPath) {
            return { ok: false, errorTitle: ERROR_TITLES.NO_INSTALL_PATH };
        }

        // Adjust "Logs" if your log-service resolves a different folder.
        if (!existsSync(join(eftInstallPath, "Logs"))) {
            return { ok: false, errorTitle: ERROR_TITLES.LOGS_FOLDER_MISSING };
        }

        try {
            const locationId = await findCurrentMapFromLogs(eftInstallPath, mode);
            if (!locationId) {
                return { ok: false, errorTitle: ERROR_TITLES.NO_RAID_FOUND };
            }
            return { ok: true, locationId };
        } catch (err) {
            streamDeck.logger.error("Failed to read EFT logs", err);
            return { ok: false, errorTitle: ERROR_TITLES.READ_FAILED };
        }
    }

    /** Shows an error title + alert flash, then restores the default title. */
    private async showError(action: any, title: string): Promise<void> {
        action.setTitle(title);
        try {
            await action.showAlert();
        } catch {
            /* showAlert can fail if the action disappeared; ignore */
        }

        this.clearErrorReset(action.id);
        this.errorResetTimers.set(
            action.id,
            setTimeout(() => {
                this.errorResetTimers.delete(action.id);
                action.setTitle(DEFAULT_TITLE);
            }, ERROR_TITLE_DURATION_MS),
        );
    }

    private clearErrorReset(actionId: string): void {
        const t = this.errorResetTimers.get(actionId);
        if (t) {
            clearTimeout(t);
            this.errorResetTimers.delete(actionId);
        }
    }

    private getProfilePath(deviceType: number): string {
        return DEVICE_PROFILE_MAP[deviceType] ?? "";
    }

    override async onDidReceiveSettings(
        ev: DidReceiveSettingsEvent<MapInfoSettings>,
    ): Promise<void> {
        const settings = ev.payload.settings ?? ({} as MapInfoSettings);

        if (!isValidGameMode(settings.game_mode)) {
            ev.action.setTitle(SELECT_MODE_TITLE);
            ev.action.setImage("");
            this.stopAutoUpdate(ev.action.id);
            return;
        }

        applyModeStrip(ev.action, settings.game_mode);

        settingsService.setMapInfoFlags({
            map_autoupdate_check: settings.map_autoupdate_check,
            game_mode: settings.game_mode,
        });

        if (settings.eft_install_path) {
            settingsService.setEftInstallPath(settings.eft_install_path);
        }
    }

    override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
        const handled = await handleCommonCommands(ev);
        if (handled) return;
    }

    override onWillDisappear(ev: WillDisappearEvent): void | Promise<void> {
        this.stopAutoUpdate(ev.action.id);
        this.clearErrorReset(ev.action.id);
    }

    private stopAutoUpdate(actionId: string): void {
        const t = this.autoUpdateTimers.get(actionId);
        if (t) {
            clearInterval(t);
            this.autoUpdateTimers.delete(actionId);
        }
        this.bumpGen(actionId);
    }

    private bumpGen(actionId: string): number {
        const gen = (this.generations.get(actionId) ?? 0) + 1;
        this.generations.set(actionId, gen);
        return gen;
    }

    private async maybeInheritFromGlobal(
        action: any,
        settings: MapInfoSettings,
    ): Promise<MapInfoSettings> {
        if (isValidGameMode(settings.game_mode)) return settings;

        const global = settingsService.load();
        const inherited: MapInfoSettings = { ...settings };
        let changed = false;

        if (global.game_mode) {
            inherited.game_mode = global.game_mode;
            changed = true;
        }
        if (!settings.eft_install_path && global.eftInstallPath) {
            inherited.eft_install_path = global.eftInstallPath;
            changed = true;
        }
        if (settings.map_autoupdate_check === undefined) {
            inherited.map_autoupdate_check = global.map_autoupdate_check;
            changed = true;
        }

        if (changed) {
            await action.setSettings(inherited as unknown as JsonObject);
            settingsService.invalidateCache();
            return inherited;
        }
        return settings;
    }
}