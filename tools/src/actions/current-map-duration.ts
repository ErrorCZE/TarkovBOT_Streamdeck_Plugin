import { action } from "@elgato/streamdeck";
import type { MapData } from "../types";
import { MapInfoBaseAction } from "./base/map-info-base";

@action({ UUID: "eu.tarkovbot.tools.mapinfo.raidduration" })
export class TarkovCurrentMapInfo_Duration extends MapInfoBaseAction {
    protected render(map: MapData): string {
        return `\n${map.raidDuration} min`;
    }
}
