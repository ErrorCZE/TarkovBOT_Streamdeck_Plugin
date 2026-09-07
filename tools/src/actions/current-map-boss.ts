import { action, SingletonAction, WillAppearEvent, WillDisappearEvent } from "@elgato/streamdeck";
import { INTERVALS } from "../config/constants";
import { tarkovApiService } from "../services/api-service";
import { settingsService } from "../services/settings-service";
import { stateService } from "../services/state-service";
import type { ConsolidatedBoss, GameMode } from "../types";

@action({ UUID: "eu.tarkovbot.tools.mapinfo.boss" })
export class TarkovCurrentMapInfo_Boss extends SingletonAction {
    protected readonly bossIndex: number;
    private timer: NodeJS.Timeout | null = null;
    private lastGameMode: GameMode | null = null;

    constructor(bossIndex: number) {
        super();
        this.bossIndex = bossIndex;
    }

    override async onWillAppear(ev: WillAppearEvent): Promise<void> {
        await this.updateBossInfo(ev);

        const settings = settingsService.load();
        if (settings.map_autoupdate_check) {
            this.timer = setInterval(() => void this.updateBossInfo(ev), INTERVALS.MAP_INFO_AUTO_UPDATE);
        }
    }

    override onWillDisappear(_ev: WillDisappearEvent): void | Promise<void> {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private async updateBossInfo(ev: WillAppearEvent): Promise<void> {
        const settings = settingsService.load();

        const locationId = stateService.currentLocationId;
        if (!locationId) {
            ev.action.setTitle("\nUnknown\nLocation");
            return;
        }

        const mapData = stateService.getMapData(locationId, settings.game_mode);
        if (!mapData) {
            ev.action.setTitle("\nNo Map\nData");
            return;
        }

        const boss = mapData.bosses?.[this.bossIndex] as ConsolidatedBoss | undefined;
        if (!boss) {
            ev.action.setTitle("");
            ev.action.setImage("");
            return;
        }

        ev.action.setTitle(`${this.formatBossName(boss.name)}\n${boss.spawnChance}`);

        const image = await tarkovApiService.getBossImage(boss.id);
        if (image) {
            ev.action.setImage(image);
        }
    }

    private formatBossName(name: string): string {
        let formatted = name.split(" ").join("\n");
        if (formatted === "Knight") formatted = "Goons";
        if (formatted === "Cultist\nPriest") formatted = "Cultists";
        return formatted;
    }
}
