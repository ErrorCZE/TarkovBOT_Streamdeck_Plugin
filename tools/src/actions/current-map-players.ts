import { action } from "@elgato/streamdeck";
import type { MapData } from "../types";
import { MapInfoBaseAction } from "./base/map-info-base";

@action({ UUID: "eu.tarkovbot.tools.mapinfo.playercount" })
export class TarkovCurrentMapInfo_Players extends MapInfoBaseAction {
    protected render(map: MapData): string {
        return `\n${map.players}`;
    }
}
