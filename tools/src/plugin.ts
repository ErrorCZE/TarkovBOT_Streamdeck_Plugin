import fs from "node:fs";
import path from "node:path";
import streamDeck from "@elgato/streamdeck";

import { TarkovTime } from "./actions/tarkov-time";
import { TarkovGoonsLocation } from "./actions/goons-location";
import { TarkovTraderRestock } from "./actions/trader-restock";
import { TarkovCurrentMapInfo } from "./actions/current-map-info";
import { TarkovCurrentMapInfo_Name } from "./actions/current-map-name";
import { TarkovCurrentMapInfo_Duration } from "./actions/current-map-duration";
import { TarkovCurrentMapInfo_Players } from "./actions/current-map-players";
import { TarkovCurrentMapInfo_BackToProfile } from "./actions/current-map-backtoprofile";
import { TarkovCurrentMapInfo_CurrentServer } from "./actions/current-map-server";
import { TarkovCurrentServerInfo } from "./actions/current-server";
import { createAllBossInstances } from "./actions/current-map-bosses";
import { startBackgroundRefreshers } from "./services/background-refresh";
import { TarkovRaidTimer } from "./actions/raid-timer";
import { SETTINGS_FILE_PATH } from "./config/constants";
import { diag, DIAG_FILE_PATH, describeFsError, validateEftPath } from "./services/diagnostics-service";
import { settingsService } from "./services/settings-service";

// Log everything that goes wrong globally (crashes, dangling promises).
diag.registerGlobalErrorHandlers();

logStartupBanner();

startBackgroundRefreshers();

streamDeck.actions.registerAction(new TarkovTime());
streamDeck.actions.registerAction(new TarkovGoonsLocation());
streamDeck.actions.registerAction(new TarkovTraderRestock());

streamDeck.actions.registerAction(new TarkovCurrentMapInfo());
streamDeck.actions.registerAction(new TarkovCurrentMapInfo_Name());
streamDeck.actions.registerAction(new TarkovCurrentMapInfo_Duration());
streamDeck.actions.registerAction(new TarkovCurrentMapInfo_Players());
streamDeck.actions.registerAction(new TarkovCurrentMapInfo_CurrentServer());
streamDeck.actions.registerAction(new TarkovCurrentMapInfo_BackToProfile());

for (const bossInstance of createAllBossInstances()) {
    streamDeck.actions.registerAction(bossInstance);
}

streamDeck.actions.registerAction(new TarkovCurrentServerInfo());

streamDeck.actions.registerAction(new TarkovRaidTimer());

streamDeck.connect();

/** Logs environment info + validity of the saved EFT path once at startup. */
function logStartupBanner(): void {
    const manifest = readManifest();
    diag.info("GENERAL", "Plugin starting", {
        plugin: manifest?.Name ?? "unknown",
        version: manifest?.Version ?? "unknown",
        platform: `${process.platform} ${process.arch}`,
        nodeVersion: process.version,
        workingDirectory: process.cwd(),
        settingsFile: SETTINGS_FILE_PATH,
        diagnosticsFile: DIAG_FILE_PATH,
    });

    const settings = settingsService.load();
    if (!settings.eftInstallPath) {
        diag.warn(
            "PATH",
            "No EFT path configured at startup - set it in the property inspector or use auto-detect",
        );
        return;
    }

    const validation = validateEftPath(settings.eftInstallPath);
    if (validation.valid) {
        diag.info("PATH", "Saved EFT path validated successfully", { path: validation.path });
    } else {
        diag.warn("PATH", "Saved EFT path has problems - related actions will not work until fixed", {
            path: validation.path,
            problems: validation.problems,
        });
    }
}

function readManifest(): { Name?: string; Version?: string } | null {
    // cwd is normally the plugin `bin` folder; the manifest lives one level up.
    for (const candidate of ["../manifest.json", "manifest.json"]) {
        try {
            const raw = fs.readFileSync(path.join(process.cwd(), candidate), "utf8");
            return JSON.parse(raw) as { Name?: string; Version?: string };
        } catch (err) {
            diag.debug("GENERAL", `Cannot read manifest at ${candidate}`, {
                err: describeFsError(err),
            });
        }
    }
    return null;
}
