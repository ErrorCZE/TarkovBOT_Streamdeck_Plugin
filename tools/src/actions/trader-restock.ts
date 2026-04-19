import {
    action,
    streamDeck,
    SingletonAction,
    WillAppearEvent,
    DidReceiveSettingsEvent,
    WillDisappearEvent,
    SendToPluginEvent,
} from "@elgato/streamdeck";


interface TraderData {
    name: string;
    resetTime: string;
}

interface TraderSettings {
    selectedTrader?: string;
    pve_traders_mode_check?: boolean;
}

interface ApiResponse {
    data: {
        traders: TraderData[];
    }
}

const apiURL_PVE = "https://tarkovbot.eu/api/pve/streamdeck/trader-resets";
const apiURL_PVP = "https://tarkovbot.eu/api/streamdeck/trader-resets";

let data_PVE: TraderData[] = [];
let data_PVP: TraderData[] = [];

async function refreshDataPVE(): Promise<void> {
    try {
        const response = await fetch(apiURL_PVE);
        const jsonData = await response.json();
        data_PVE = (jsonData as ApiResponse).data.traders;
    } catch (error) {
        console.error("Error fetching PVE data:", error);
        data_PVE = [];
    }
}

async function refreshDataPVP(): Promise<void> {
    try {
        const response = await fetch(apiURL_PVP);
        const jsonData = await response.json();
        data_PVP = (jsonData as ApiResponse).data.traders;
    } catch (error) {
        console.error("Error fetching PVP data:", error);
        data_PVP = [];
    }
}

refreshDataPVP();
refreshDataPVE();
setInterval(refreshDataPVP, 900000);
setInterval(refreshDataPVE, 900000);

@action({ UUID: "eu.tarkovbot.tools.traderrestock" })
export class TarkovTraderRestock extends SingletonAction {
    private updateIntervals = new Map<string, NodeJS.Timeout>();

    private updateTitleAndImage(action: any, restockData?: TraderData): void {
        if (!restockData) {
            action.setTitle("\n\n\nNo Data");
            return;
        }

        const resetTime = new Date(restockData.resetTime);
        const currentTime = new Date();
        const timeDifference = resetTime.getTime() - currentTime.getTime();

        if (timeDifference >= 0) {
            const hours = String(Math.floor(timeDifference / (1000 * 60 * 60))).padStart(2, '0');
            const minutes = String(Math.floor((timeDifference % (1000 * 60 * 60)) / (1000 * 60))).padStart(2, '0');
            const seconds = String(Math.floor((timeDifference % (1000 * 60)) / 1000)).padStart(2, '0');
            action.setTitle(`\n\n\n${hours}:${minutes}:${seconds}`);
        } else {
            action.setTitle(`\n\n\nRestock`);
        }
    }

    private async startUpdating(action: any, settings: TraderSettings, actionId: string): Promise<void> {
        // Clear existing interval for this action
        this.stopUpdating(actionId);

        action.setTitle("\n\n\nLoading");

        // Wait for data to be refreshed if it's empty
        if (settings.pve_traders_mode_check && (!Array.isArray(data_PVE) || data_PVE.length === 0)) {
            await refreshDataPVE();
        } else if (!settings.pve_traders_mode_check && (!Array.isArray(data_PVP) || data_PVP.length === 0)) {
            await refreshDataPVP();
        }

        const intervalId = setInterval(() => {
            const trader = settings.selectedTrader;
            const pveMode = settings.pve_traders_mode_check;

            if (!trader) {
                action.setTitle("No\nTrader\nSelected");
                return;
            }

            const traderData = pveMode ? data_PVE : data_PVP;

            if (!Array.isArray(traderData) || traderData.length === 0) {
                action.setTitle("\n\n\nNo Data");
                return;
            }

            const restockData = traderData.find(data => data.name === trader);

            if (!restockData) {
                action.setTitle("\n\n\nNo Data");
                return;
            }

            this.updateTitleAndImage(action, restockData);
        }, 1000);

        this.updateIntervals.set(actionId, intervalId);
    }

    private stopUpdating(actionId: string): void {
        const intervalId = this.updateIntervals.get(actionId);
        if (intervalId) {
            clearInterval(intervalId);
            this.updateIntervals.delete(actionId);
        }
    }

    override onWillAppear(ev: WillAppearEvent<TraderSettings>): void | Promise<void> {
        const settings = ev.payload.settings;
        const actionId = ev.action.id;

        if (!settings.selectedTrader) {
            ev.action.setTitle("Select\nTrader");
        }

        ev.action.setImage(`assets/${settings.selectedTrader}.png`);
        this.startUpdating(ev.action, settings, actionId);
    }

    override onWillDisappear(ev: WillDisappearEvent<TraderSettings>): void | Promise<void> {
        this.stopUpdating(ev.action.id);
    }

    override onDidReceiveSettings(ev: DidReceiveSettingsEvent<TraderSettings>): void | Promise<void> {
        const settings = ev.payload.settings;
        const actionId = ev.action.id;

        this.stopUpdating(actionId);

        if (!settings.selectedTrader) {
            ev.action.setTitle("Select\nTrader");
            ev.action.setImage(``);
            return;
        }

        ev.action.setImage(`assets/${settings.selectedTrader}.png`);
        this.startUpdating(ev.action, settings, actionId);
    }

    override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, LaunchSettings>): void | Promise<void> {
        if (ev.payload === 'openPatreon') {
            streamDeck.system.openUrl('https://patreon.com/tarkovboteu');
        }
    }
}
