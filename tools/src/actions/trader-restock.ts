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
import { tarkovApiService } from "../services/api-service";
import type { GameMode, TraderData, TraderRestockSettings } from "../types";
import { formatCountdown } from "../utils/time-format";

const LOADING_TITLE = "\n\n\nLoading";
const NO_DATA_TITLE = "\n\n\nNo Data";
const RESTOCK_TITLE = "\n\n\nRestock";
const SELECT_BOTH_TITLE = "Select\nTrader\n& Mode";
const SELECT_TRADER_TITLE = "Select\nTrader";
const SELECT_MODE_TITLE = "Select\nGame\nMode";

function isValidGameMode(mode: unknown): mode is GameMode {
    return mode === "PVP" || mode === "PVE" || mode === "SEASON";
}

function migrateLegacy(settings: TraderRestockSettings): TraderRestockSettings {
    if (isValidGameMode(settings.game_mode)) return settings;
    const legacy = (settings as any).pve_traders_mode_check;
    if (typeof legacy !== "boolean") return settings;
    const migrated = { ...settings };
    migrated.game_mode = legacy ? "PVE" : "PVP";
    delete (migrated as any).pve_traders_mode_check;
    return migrated;
}

@action({ UUID: "eu.tarkovbot.tools.traderrestock" })
export class TarkovTraderRestock extends SingletonAction {
    private timers = new Map<string, NodeJS.Timeout>();
    private generations = new Map<string, number>();

    override async onWillAppear(ev: WillAppearEvent<TraderRestockSettings>): Promise<void> {
        const raw = ev.payload.settings ?? ({} as TraderRestockSettings);
        const settings = migrateLegacy(raw);
        if (settings !== raw) {
            await ev.action.setSettings(settings as unknown as JsonObject);
        }
        await this.renderFor(ev.action, settings);
    }

    override onWillDisappear(ev: WillDisappearEvent<TraderRestockSettings>): void | Promise<void> {
        this.stopTimer(ev.action.id);
    }

    override async onDidReceiveSettings(
        ev: DidReceiveSettingsEvent<TraderRestockSettings>,
    ): Promise<void> {
        const settings = ev.payload.settings ?? ({} as TraderRestockSettings);
        await this.renderFor(ev.action, settings);
    }

    private async renderFor(action: any, settings: TraderRestockSettings): Promise<void> {
        const actionId = action.id;
        this.stopTimer(actionId);

        const hasMode = isValidGameMode(settings.game_mode);
        const hasTrader = !!settings.selectedTrader;

        if (!hasMode && !hasTrader) {
            action.setTitle(SELECT_BOTH_TITLE);
            action.setImage("");
            return;
        }
        if (!hasMode) {
            action.setTitle(SELECT_MODE_TITLE);
            this.applyTraderImage(action, settings.selectedTrader);
            return;
        }
        if (!hasTrader) {
            action.setTitle(SELECT_TRADER_TITLE);
            action.setImage("");
            return;
        }

        this.applyTraderImage(action, settings.selectedTrader);
        await this.startUpdating(action, settings);
    }

    private async startUpdating(action: any, settings: TraderRestockSettings): Promise<void> {
        const actionId = action.id;
        const gen = this.bumpGen(actionId);

        action.setTitle(LOADING_TITLE);
        const mode = settings.game_mode!;

        await tarkovApiService.getTraders(mode);

        if (this.generations.get(actionId) !== gen) return;

        const tick = () => {
            if (this.generations.get(actionId) !== gen) {
                this.stopTimer(actionId);
                return;
            }
            void this.renderTick(action, settings, mode);
        };
        tick();
        const timer = setInterval(tick, INTERVALS.TRADER_RESTOCK);
        this.timers.set(actionId, timer);
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

    private async renderTick(
        action: any,
        settings: TraderRestockSettings,
        mode: GameMode,
    ): Promise<void> {
        if (!settings.selectedTrader) {
            action.setTitle(SELECT_TRADER_TITLE);
            return;
        }

        const traders = await tarkovApiService.getTraders(mode);
        const trader = traders.find((t) => t.name === settings.selectedTrader);

        if (!trader) {
            action.setTitle(NO_DATA_TITLE);
            return;
        }

        this.renderCountdown(action, trader);
    }

    private renderCountdown(action: any, trader: TraderData): void {
        const remaining = new Date(trader.resetTime).getTime() - Date.now();
        if (remaining <= 0) {
            action.setTitle(RESTOCK_TITLE);
            return;
        }
        action.setTitle(`\n\n\n${formatCountdown(remaining)}`);
    }

    private applyTraderImage(action: any, traderName?: string): void {
        if (!traderName) {
            action.setImage("");
            return;
        }
        action.setImage(`assets/${traderName}.png`);
    }

    override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
        if (typeof ev.payload === "string" && ev.payload === "openPatreon") {
            streamDeck.system.openUrl(URL_PATREON);
        }
    }
}
