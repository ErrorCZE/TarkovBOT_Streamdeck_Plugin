import { INTERVALS } from "../config/constants";
import { tarkovApiService } from "./api-service";
import { ALL_GAME_MODES } from "../types";

let started = false;
export function startBackgroundRefreshers(): void {
    if (started) return;
    started = true;

    for (const mode of ALL_GAME_MODES) {
        tarkovApiService.refreshMapsAsync(mode);
        tarkovApiService.refreshTradersAsync(mode);
    }
    tarkovApiService.refreshLocalMapNamesAsync();
    tarkovApiService.refreshDatacentersAsync();

    for (const mode of ALL_GAME_MODES) {
        setInterval(() => tarkovApiService.refreshMapsAsync(mode), INTERVALS.MAP_DATA_REFRESH);
        setInterval(() => tarkovApiService.refreshTradersAsync(mode), INTERVALS.TRADER_DATA_REFRESH);
    }
    setInterval(() => tarkovApiService.refreshDatacentersAsync(), INTERVALS.DATACENTER_REFRESH);
}
