import {
    action,
    streamDeck,
    KeyDownEvent,
    SendToPluginEvent,
    SingletonAction,
    WillAppearEvent,
    WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue, JsonObject } from "@elgato/utils";
import { ENDPOINTS, INTERVALS, URL_PATREON, URL_WEBSITE } from "../config/constants";
import type { GoonsLocationSettings, GoonsModeReport, GoonsReport, GoonsSource } from "../types";
import { formatElapsed } from "../utils/time-format";

const DEFAULT_TITLE = `Get\nGoons\nLocation`;
const SELECT_MODE_TITLE = "Select\nGame\nMode";
const ENTER_TOKEN_TITLE = "Enter\nYour\nToken";
const SELECT_MODE_AND_TOKEN_TITLE = "Select Mode\n& Token";

function isValidGoonsSource(source: GoonsSource | undefined | string | null): source is GoonsSource {
    return source === "PVP" || source === "PVE" || source === "SEASON";
}

@action({ UUID: "eu.tarkovbot.tools.goonsgetlocation" })
export class TarkovGoonsLocation extends SingletonAction {
    private autoRefreshTimers = new Map<string, NodeJS.Timeout>();
    private autoResetTimers = new Map<string, NodeJS.Timeout>();
    private generations = new Map<string, number>();

    override async onWillAppear(ev: WillAppearEvent<GoonsLocationSettings>): Promise<void> {
        const settings = ev.payload.settings ?? ({} as GoonsLocationSettings);
        await this.renderIdle(ev.action, settings);
    }

    override onWillDisappear(ev: WillDisappearEvent): void | Promise<void> {
        this.stopAllTimers(ev.action.id);
    }

    override async onDidReceiveSettings(
        ev: { action: any; payload: { settings: GoonsLocationSettings } } & any,
    ): Promise<void> {
        const actionId = ev.action.id;
        const settings = ev.payload.settings ?? ({} as GoonsLocationSettings);

        if (!this.autoResetTimers.has(actionId) && !this.autoRefreshTimers.has(actionId)) {
            await this.renderIdle(ev.action, settings);
        }
    }
    private async renderIdle(action: any, settings: GoonsLocationSettings): Promise<void> {
        const actionId = action.id;
        this.stopAllTimers(actionId);

        const hasSource = isValidGoonsSource(settings.selectedGoonsSource);
        const hasToken = !!settings.token;

        if (!hasSource && !hasToken) {
            action.setTitle(SELECT_MODE_AND_TOKEN_TITLE);
            return;
        }
        if (!hasSource) {
            action.setTitle(SELECT_MODE_TITLE);
            return;
        }
        if (!hasToken) {
            action.setTitle(ENTER_TOKEN_TITLE);
            return;
        }

        action.setTitle(DEFAULT_TITLE);

        if (settings.auto_refresh) {
            this.startAutoRefresh(action, settings);
        }
    }

    override async onKeyDown(ev: KeyDownEvent<GoonsLocationSettings>): Promise<void> {
        const actionId = ev.action.id;

        this.stopAllTimers(actionId);
        const gen = this.bumpGen(actionId);

        const { selectedGoonsSource, token } = ev.payload.settings ?? ({} as GoonsLocationSettings);

        if (!isValidGoonsSource(selectedGoonsSource)) {
            ev.action.setTitle(SELECT_MODE_TITLE);
            return;
        }
        if (!token) {
            ev.action.setTitle(ENTER_TOKEN_TITLE);
            return;
        }

        try {
            const response = await fetch(ENDPOINTS.GOONS_LOCATION, {
                method: "GET",
                headers: { "auth-token": String(token) },
            });

            if (this.generations.get(actionId) !== gen) return;

            if (response.status === 401) {
                ev.action.setTitle("Invalid\nToken");
                this.scheduleReset(actionId, gen, ev.action);
                return;
            }
            if (response.status !== 200) {
                ev.action.setTitle("Something\nWent\nWrong.");
                this.scheduleReset(actionId, gen, ev.action);
                return;
            }

            const data = (await response.json()) as GoonsReport;
            const report = this.selectReport(data, selectedGoonsSource);
            if (!report) {
                ev.action.setTitle("No\nReport\nYet");
                this.scheduleReset(actionId, gen, ev.action);
                return;
            }

            const elapsedMs = Date.now() - new Date(report.reported).getTime();
            ev.action.setTitle(`${report.location}\n${formatElapsed(elapsedMs)}`);

            // Only schedule reset if auto-refresh is NOT running
            if (!this.autoRefreshTimers.has(actionId)) {
                this.scheduleReset(actionId, gen, ev.action);
            }
        } catch {
            if (this.generations.get(actionId) === gen) {
                ev.action.setTitle("Something\nWent\nWrong.");
            }
        }
    }

    private scheduleReset(actionId: string, gen: number, action: any): void {
        // Clear any previous reset timer for this action
        const prev = this.autoResetTimers.get(actionId);
        if (prev) clearTimeout(prev);

        const reset = setTimeout(() => {
            this.autoResetTimers.delete(actionId);
            if (
                this.generations.get(actionId) === gen &&
                !this.autoRefreshTimers.has(actionId)
            ) {
                action.setTitle(DEFAULT_TITLE);
            }
        }, 5_000);
        this.autoResetTimers.set(actionId, reset);
    }

    private selectReport(data: GoonsReport, source: GoonsSource): GoonsModeReport | null {
        if (source === "PVP") return data.pvp;
        if (source === "PVE") return data.pve;
        if (source === "SEASON") return data.season ?? null;
        return null;
    }

    private startAutoRefresh(action: any, settings: GoonsLocationSettings): void {
        const actionId = action.id;
        if (!settings.token || !isValidGoonsSource(settings.selectedGoonsSource)) return;

        // Initial fetch immediately
        void this.fetchAndRender(action, settings);

        const timer = setInterval(() => {
            void this.fetchAndRender(action, settings);
        }, INTERVALS.GOONS_AUTO_REFRESH);
        this.autoRefreshTimers.set(actionId, timer);
    }

    private async fetchAndRender(action: any, settings: GoonsLocationSettings): Promise<void> {
        const { selectedGoonsSource, token } = settings;
        if (!isValidGoonsSource(selectedGoonsSource) || !token) return;

        try {
            const response = await fetch(ENDPOINTS.GOONS_LOCATION, {
                method: "GET",
                headers: { "auth-token": String(token) },
            });

            if (response.status === 401) {
                action.setTitle("Invalid\nToken");
                return;
            }
            if (response.status !== 200) {
                action.setTitle("Something\nWent\nWrong.");
                return;
            }

            const data = (await response.json()) as GoonsReport;
            const report = this.selectReport(data, selectedGoonsSource);
            if (!report) {
                action.setTitle("No\nReport\nYet");
                return;
            }

            const elapsedMs = Date.now() - new Date(report.reported).getTime();
            action.setTitle(`${report.location}\n${formatElapsed(elapsedMs)}`);
        } catch {
            // silent — keep last title
        }
    }

    private stopAllTimers(actionId: string): void {
        const refresh = this.autoRefreshTimers.get(actionId);
        if (refresh) {
            clearInterval(refresh);
            this.autoRefreshTimers.delete(actionId);
        }
        const reset = this.autoResetTimers.get(actionId);
        if (reset) {
            clearTimeout(reset);
            this.autoResetTimers.delete(actionId);
        }
        this.bumpGen(actionId);
    }

    private bumpGen(actionId: string): number {
        const gen = (this.generations.get(actionId) ?? 0) + 1;
        this.generations.set(actionId, gen);
        return gen;
    }

    override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
        if (typeof ev.payload !== "string") return;
        switch (ev.payload) {
            case "openWebsite":
                streamDeck.system.openUrl(URL_WEBSITE);
                break;
            case "openPatreon":
                streamDeck.system.openUrl(URL_PATREON);
                break;
        }
    }
}