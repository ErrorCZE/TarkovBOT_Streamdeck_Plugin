import { action } from "@elgato/streamdeck";
import type { MapData } from "../types";
import { MapInfoBaseAction } from "./base/map-info-base";

@action({ UUID: "eu.tarkovbot.tools.mapinfo.name" })
export class TarkovCurrentMapInfo_Name extends MapInfoBaseAction {
    protected render(map: MapData): string {
        return `\n${map.name.replace(/ /g, "\n")}`;
    }
}
