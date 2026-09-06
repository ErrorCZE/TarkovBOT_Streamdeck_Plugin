import {
    action,
    streamDeck,
    DidReceiveSettingsEvent,
    SendToPluginEvent,
    SingletonAction,
    WillAppearEvent,
    WillDisappearEvent,
} from "@elgato/streamdeck";
import path from "node:path";
import fs from "node:fs";
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

const MODE_BORDER_COLOR: Record<GameMode, string> = {
    PVP: "#ffae00",
    PVE: "#00d9ff",
    SEASON: "#00ff91",
};

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
        this._hiddenActions.delete(ev.action.id);
        const raw = ev.payload.settings ?? ({} as TraderRestockSettings);
        const settings = migrateLegacy(raw);
        if (settings !== raw) {
            await ev.action.setSettings(settings as unknown as JsonObject);
        }
        await this.renderFor(ev.action, settings);
    }

    override onWillDisappear(ev: WillDisappearEvent<TraderRestockSettings>): void | Promise<void> {
        this._hiddenActions.add(ev.action.id);
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
            try {
                this.applyTraderImage(action, settings.selectedTrader, settings.game_mode);
            } catch {
                action.setImage("");
            }
            return;
        }
        if (!hasTrader) {
            action.setTitle(SELECT_TRADER_TITLE);
            action.setImage("");
            return;
        }

        try {
            this.applyTraderImage(action, settings.selectedTrader, settings.game_mode);
        } catch {
            action.setImage("");
        }

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
            if (!this._hiddenActions.has(action.id)) action.setTitle(SELECT_TRADER_TITLE);
            return;
        }

        const traders = await tarkovApiService.getTraders(mode);
        const trader = traders.find((t) => t.name === settings.selectedTrader);

        if (!trader) {
            if (!this._hiddenActions.has(action.id)) action.setTitle(NO_DATA_TITLE);
            return;
        }

        this.renderCountdown(action, trader, settings);
    }

    private _hiddenActions = new Set<string>();

    private _lastRestockAlert = new Set<string>();

    private renderCountdown(action: any, trader: TraderData, settings: TraderRestockSettings): void {
        const remaining = new Date(trader.resetTime).getTime() - Date.now();
        const isHidden = this._hiddenActions.has(action.id);

        if (remaining <= 0) {
            if (!isHidden) action.setTitle(RESTOCK_TITLE);

            const alertKey = action.id;
            if (!this._lastRestockAlert.has(alertKey)) {
                this._lastRestockAlert.add(alertKey);
                this.playRestockSound(settings);
            }
            return;
        }

        this._lastRestockAlert.delete(action.id);
        if (!isHidden) action.setTitle(`\n\n\n${formatCountdown(remaining)}`);
    }

    private applyTraderImage(action: any, traderName: string | undefined, gameMode?: GameMode): void {
        if (!traderName) {
            action.setImage("");
            return;
        }

        const imagePath = path.join(process.cwd(), "assets", `${traderName}.png`);
        if (!fs.existsSync(imagePath)) {
            action.setImage("");
            return;
        }

        const imgBase64 = fs.readFileSync(imagePath).toString("base64");

        if (!gameMode) {
            action.setImage(`data:image/png;base64,${imgBase64}`);
            return;
        }

        const color = MODE_BORDER_COLOR[gameMode];
        const modeText = gameMode.toUpperCase();

        const svg = `<svg xmlns="http://www.w3.org/2000/svg"
        width="144"
        height="144"
        viewBox="0 0 144 144">

        <image
            href="data:image/png;base64,${imgBase64}"
            x="0"
            y="0"
            width="144"
            height="144"
            preserveAspectRatio="none"
        />

        <rect
            x="0"
            y="0"
            width="144"
            height="23"
            fill="${color}"
        />

        <text
            x="72"
            y="20"
            text-anchor="middle"
            dominant-baseline="middle"
            fill="#000000"
            font-family="Arial, sans-serif"
            font-size="22"
            font-weight="bold"
        >${modeText}</text>

    </svg>`;

        action.setImage(
            `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
        );
    }

    private async playRestockSound(settings: TraderRestockSettings): Promise<void> {
        if (!settings.soundPath) return;
        const soundFile = settings.soundPath;
        streamDeck.logger.info(`[RESTOCK SOUND] Attempting to play: ${soundFile}`);

        if (!fs.existsSync(soundFile)) {
            streamDeck.logger.warn(`[RESTOCK SOUND] File not found: ${soundFile}`);
            return;
        }

        try {
            const { exec } = await import("node:child_process");
            const escaped = soundFile.replace(/'/g, "''");
            exec(
                `powershell -NoProfile -Command "Add-Type -AssemblyName presentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open('${escaped}'); $p.Play(); Start-Sleep -Seconds 2"`
            );
            streamDeck.logger.info(`[RESTOCK SOUND] Playback started`);
        } catch (err: any) {
            streamDeck.logger.error(`[RESTOCK SOUND] Failed: ${err.message}`);
        }
    }

    override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
        if (typeof ev.payload === "string" && ev.payload === "openPatreon") {
            streamDeck.system.openUrl(URL_PATREON);
        }
    }
}
