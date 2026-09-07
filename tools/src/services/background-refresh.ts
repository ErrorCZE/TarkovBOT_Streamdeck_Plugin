import { INTERVALS } from "../config/constants";
import { tarkovApiService } from "./api-service";
import { settingsService } from "./settings-service";
import type { GameMode } from "../types";

let started = false;

function currentMode(): GameMode {
    return settingsService.load().game_mode ?? "PVP";
}

export function startBackgroundRefreshers(): void {
    if (started) return;
    started = true;

    const mode = currentMode();
    tarkovApiService.refreshMapsAsync(mode);
    tarkovApiService.refreshTradersAsync(mode);
    tarkovApiService.refreshLocalMapNamesAsync();
    tarkovApiService.refreshDatacentersAsync();

    setInterval(() => {
        tarkovApiService.refreshTradersAsync(currentMode());
    }, INTERVALS.TRADER_DATA_REFRESH);

    setInterval(() => {
        tarkovApiService.refreshMapsAsync(currentMode());
    }, INTERVALS.MAP_DATA_REFRESH);

    setInterval(() => {
        tarkovApiService.refreshDatacentersAsync();
    }, INTERVALS.DATACENTER_REFRESH);
}