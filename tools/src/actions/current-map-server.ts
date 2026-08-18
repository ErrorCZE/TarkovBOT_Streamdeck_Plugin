import { action } from "@elgato/streamdeck";
import type { MapData } from "../types";
import { MapInfoBaseAction } from "./base/map-info-base";
import { settingsService } from "../services/settings-service";
import { findServerFromLogs } from "../services/log-service";
import { formatDatacenter } from "../utils/time-format";

@action({ UUID: "eu.tarkovbot.tools.mapinfo.currentserver" })
export class TarkovCurrentMapInfo_CurrentServer extends MapInfoBaseAction {
    private lastDatacenter: string | null = null;

    protected override async computeTitle(): Promise<string> {
        const settings = settingsService.load();
        try {
            const info = await findServerFromLogs(settings.eftInstallPath);
            this.lastDatacenter = info?.datacenter ?? null;
        } catch {
            // keep last known
        }
        if (this.lastDatacenter) {
            return `\n\n${formatDatacenter(this.lastDatacenter)}`;
        }
        return "\n\nNo\nServer\nFound";
    }

    protected render(_map: MapData): string {
        return "";
    }
}
