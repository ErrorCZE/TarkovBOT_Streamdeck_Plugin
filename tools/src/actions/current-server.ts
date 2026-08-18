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
import { INTERVALS } from "../config/constants";
import { handleCommonCommands } from "./base/command-handler";
import { settingsService } from "../services/settings-service";
import { findServerFromLogs } from "../services/log-service";
import { formatDatacenter } from "../utils/time-format";
import type { RaidServerSettings } from "../types";

const DEFAULT_TITLE = `Get\nCurrent\nServer`;
const LOADING_TITLE = `Loading...`;
const NO_SERVER_TITLE = `No\nServer\nFound`;

@action({ UUID: "eu.tarkovbot.tools.raidserver" })
export class TarkovCurrentServerInfo extends SingletonAction {
    private timers = new Map<string, NodeJS.Timeout>();
    private generations = new Map<string, number>();

    override async onWillAppear(ev: WillAppearEvent<RaidServerSettings>): Promise<void> {
        await this.maybeInheritFromGlobal(ev.action, ev.payload.settings ?? ({} as RaidServerSettings));
        ev.action.setTitle(DEFAULT_TITLE);
    }

    override async onKeyDown(ev: KeyDownEvent<RaidServerSettings>): Promise<void> {
        const actionId = ev.action.id;
        this.stopTimer(actionId);
        const gen = this.bumpGen(actionId);

        ev.action.setTitle(LOADING_TITLE);
        const settings = settingsService.load();
        const actionSettings = ev.payload.settings ?? ({} as RaidServerSettings);
        const eftInstallPath =
            settings.eftInstallPath || actionSettings.eft_install_path || "";
        const raidAutoUpdate = !!(actionSettings.raid_autoupdate_check ?? settings.raid_autoupdate_check);

        const updateUI = async () => {
            if (this.generations.get(actionId) !== gen) {
                this.stopTimer(actionId);
                return null;
            }
            const info = await findServerFromLogs(eftInstallPath);
            if (this.generations.get(actionId) !== gen) {
                this.stopTimer(actionId);
                return null;
            }
            if (info) {
                ev.action.setTitle(formatDatacenter(info.datacenter));
            } else {
                ev.action.setTitle(NO_SERVER_TITLE);
            }
            return info;
        };

        if (raidAutoUpdate) {
            await updateUI();
            if (this.generations.get(actionId) !== gen) return;
            const timer = setInterval(() => void updateUI(), INTERVALS.MAP_DISCOVERY);
            this.timers.set(actionId, timer);
        } else {
            const info = await updateUI();
            if (this.generations.get(actionId) !== gen) return;
            if (info) {
                setTimeout(() => {
                    if (this.generations.get(actionId) === gen && !this.timers.has(actionId)) {
                        ev.action.setTitle(DEFAULT_TITLE);
                    }
                }, 5_000);
            }
        }
    }

    override onDidReceiveSettings(ev: DidReceiveSettingsEvent<RaidServerSettings>): void | Promise<void> {
        const { eft_install_path, raid_autoupdate_check } = ev.payload.settings ?? ({} as RaidServerSettings);
        settingsService.save({
            global: { eft_install_path },
            current_server_info: { raid_autoupdate_check },
        });
    }

    override onWillDisappear(ev: WillDisappearEvent): void | Promise<void> {
        this.stopTimer(ev.action.id);
    }

    override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
        const handled = await handleCommonCommands(ev);
        if (handled) return;
        streamDeck.logger.info("raidserver onSendToPlugin (unhandled):", JSON.stringify(ev.payload));
    }

    private stopTimer(actionId: string): void {
        const t = this.timers.get(actionId);
        if (t) {
            clearInterval(t);
            this.timers.delete(actionId);
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
        settings: RaidServerSettings,
    ): Promise<void> {
        const global = settingsService.load();
        const inherited: RaidServerSettings = { ...settings };
        let changed = false;

        if (!settings.eft_install_path && global.eftInstallPath) {
            inherited.eft_install_path = global.eftInstallPath;
            changed = true;
        }
        if (settings.raid_autoupdate_check === undefined && global.raid_autoupdate_check) {
            inherited.raid_autoupdate_check = global.raid_autoupdate_check;
            changed = true;
        }

        if (changed) {
            await action.setSettings(inherited as unknown as JsonObject);
            settingsService.invalidateCache();
        }
    }
}
