import { action, WillAppearEvent, WillDisappearEvent, SingletonAction } from "@elgato/streamdeck";
import {
    INTERVALS,
    TARKOV_TIME_MULTIPLIER,
    TARKOV_TIME_OFFSET_MS,
    TARKOV_TIMEZONE,
} from "../config/constants";

@action({ UUID: "eu.tarkovbot.tools.tarkovtime" })
export class TarkovTime extends SingletonAction {
    private timer: NodeJS.Timeout | null = null;

    override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
        this.scheduleTicks(ev);
    }

    override onWillDisappear(_ev: WillDisappearEvent): void | Promise<void> {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private scheduleTicks(ev: WillAppearEvent): void {
        const tick = () => {
            const nowMs = Date.now();
            const left = this.formatTarkovTime(nowMs * TARKOV_TIME_MULTIPLIER);
            const right = this.formatTarkovTime(nowMs * TARKOV_TIME_MULTIPLIER - TARKOV_TIME_OFFSET_MS);
            ev.action.setTitle(`${left}\n${right}`);
        };

        tick();
        this.timer = setInterval(tick, INTERVALS.TARKOV_TIME);
    }

    private formatTarkovTime(epochMs: number): string {
        return new Date(epochMs).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: TARKOV_TIMEZONE,
        });
    }
}
