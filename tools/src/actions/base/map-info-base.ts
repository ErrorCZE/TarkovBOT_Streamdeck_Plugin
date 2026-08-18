import type { WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { SingletonAction } from "@elgato/streamdeck";
import { INTERVALS } from "../../config/constants";
import { settingsService } from "../../services/settings-service";
import { stateService } from "../../services/state-service";
import type { MapData } from "../../types";

export abstract class MapInfoBaseAction extends SingletonAction {
    private timer: NodeJS.Timeout | null = null;

    override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
        void this.tick(ev);
        const settings = settingsService.load();
        if (settings.map_autoupdate_check) {
            this.timer = setInterval(() => void this.tick(ev), INTERVALS.MAP_INFO_AUTO_UPDATE);
        }
    }

    override onWillDisappear(_ev: WillDisappearEvent): void | Promise<void> {
        this.clearTimer();
    }

    protected async tick(ev: WillAppearEvent): Promise<void> {
        const title = await this.computeTitle();
        ev.action.setTitle(title);
    }

    protected async computeTitle(): Promise<string> {
        const settings = settingsService.load();
        const locationId = stateService.currentLocationId;
        if (!locationId) {
            return this.renderUnavailable();
        }
        const mapData = stateService.getMapData(locationId, settings.game_mode);
        if (!mapData) {
            return "\nNo Map\nData";
        }
        return this.render(mapData);
    }

    protected abstract render(map: MapData): string;

    protected renderUnavailable(): string {
        return "\nUnknown\nLocation";
    }

    private clearTimer(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}
