import streamDeck from "@elgato/streamdeck";
import type { SendToPluginEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import { URL_PATREON } from "../../config/constants";
import { detectEftPath } from "../../services/path-detect-service";
import { settingsService } from "../../services/settings-service";

interface CommandPayload {
    command?: string;
}

export interface AutoDetectResultMessage {
    event: "autoDetectResult";
    success: boolean;
    path?: string;
    error?: string;
}

export interface GlobalSettingsMessage {
    event: "globalSettings";
    eft_install_path: string;
}

export async function handleCommonCommands(
    ev: SendToPluginEvent<JsonValue, any>,
): Promise<boolean> {
    if (typeof ev.payload === "string") {
        if (ev.payload === "openPatreon") {
            streamDeck.system.openUrl(URL_PATREON);
            return true;
        }
        return false;
    }

    const payload = ev.payload as CommandPayload;
    if (!payload?.command) return false;

    if (payload.command === "autoDetectPath") {
        const result = await detectEftPath();
        streamDeck.logger.info("Auto-detect result:", JSON.stringify(result));

        if (result.success && result.path) {
            await ev.action.setSettings({
                ...((await ev.action.getSettings()) as object),
                eft_install_path: result.path,
            });
            settingsService.setEftInstallPath(result.path);

            await sendToInspector<AutoDetectResultMessage>({
                event: "autoDetectResult",
                success: true,
                path: result.path,
            });
        } else {
            await sendToInspector<AutoDetectResultMessage>({
                event: "autoDetectResult",
                success: false,
                error: result.error,
            });
        }
        return true;
    }

    if (payload.command === "getGlobalSettings") {
        const settings = settingsService.load();
        await sendToInspector<GlobalSettingsMessage>({
            event: "globalSettings",
            eft_install_path: settings.eftInstallPath,
        });
        return true;
    }

    return false;
}

async function sendToInspector<T>(msg: T): Promise<void> {
    try {
        await streamDeck.ui.sendToPropertyInspector(msg as unknown as JsonValue);
    } catch {
        // property inspector closed
    }
}
