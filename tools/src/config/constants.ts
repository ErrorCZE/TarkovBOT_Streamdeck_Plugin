import path from "node:path";

export const API_BASE = "https://tarkovbot.eu/api";

export const ENDPOINTS = {
    GOONS_LOCATION: `${API_BASE}/streamdeck/goonslocation`,
    TRADER_RESETS_PVP: `${API_BASE}/streamdeck/trader-resets`,
    TRADER_RESETS_PVE: `${API_BASE}/pve/streamdeck/trader-resets`,
    TRADER_RESETS_SEASON: `${API_BASE}/season/streamdeck/trader-resets`,
    MAPS_PVP: `${API_BASE}/streamdeck/maps`,
    MAPS_PVE: `${API_BASE}/pve/streamdeck/maps`,
    MAPS_SEASON: `${API_BASE}/season/streamdeck/maps`,
    LOCAL_MAP_NAMES: `${API_BASE}/pve/streamdeck/local-map-names`,
    DATACENTERS: `${API_BASE}/streamdeck/v2/eft-datacenters`,
} as const;

export function traderResetsEndpoint(mode: "PVP" | "PVE" | "SEASON"): string {
    switch (mode) {
        case "PVE":
            return ENDPOINTS.TRADER_RESETS_PVE;
        case "SEASON":
            return ENDPOINTS.TRADER_RESETS_SEASON;
        case "PVP":
        default:
            return ENDPOINTS.TRADER_RESETS_PVP;
    }
}

export function mapsEndpoint(mode: "PVP" | "PVE" | "SEASON"): string {
    switch (mode) {
        case "PVE":
            return ENDPOINTS.MAPS_PVE;
        case "SEASON":
            return ENDPOINTS.MAPS_SEASON;
        case "PVP":
        default:
            return ENDPOINTS.MAPS_PVP;
    }
}

export const BOSS_IMAGE_BASE = "https://tarkovbot.eu/streamdeck/img";
export const BOSS_IMAGE_FALLBACK = `${BOSS_IMAGE_BASE}/unknown_boss.webp`;

export const URL_PATREON = "https://patreon.com/tarkovboteu";
export const URL_WEBSITE = "https://tarkovbot.eu/stream-deck";

export const INTERVALS = {
    TARKOV_TIME: 2_000, // 2 seconds
    MAP_INFO_AUTO_UPDATE: 5_000, // 5 seconds
    MAP_DISCOVERY: 10_000, // 10 seconds
    TRADER_RESTOCK: 1_000, // 1 second
    MAP_DATA_REFRESH: 2_700_000, // 45 minutes
    TRADER_DATA_REFRESH: 600_000, // 10 minutes
    DATACENTER_REFRESH: 10_800_000, // 3 hours
    GOONS_AUTO_REFRESH: 300_000, // 5 minutes
    RAID_TIMER: 1_000, // 1 second
} as const;

export const TARKOV_TIME_MULTIPLIER = 7;
export const TARKOV_TIME_OFFSET_MS = 12 * 60 * 60 * 1000;
export const TARKOV_TIMEZONE = "Europe/Moscow";

export const SETTINGS_FILE_PATH = path.join(process.cwd(), "user_settings.json");

export const DEFAULT_USER_SETTINGS = Object.freeze({
    map_autoupdate_check: false,
    game_mode: "PVP" as const,
    raid_autoupdate_check: false,
    eftInstallPath: "",
});

export const DEVICE_PROFILE_MAP: Record<number, string> = {
    0: "Map Info MK V2",
    1: "Map Info Mini V2",
    2: "Map Info XL V2",
    3: "Map Info MK V2",
    7: "Map Info Neo V2",
    9: "Map Info Neo V2",
};

export const LOG_REGEX_LOCATION = /Location:\s(\w+),/;
export const LOG_REGEX_SCENE_PRESET = /rcid:([\w_]+)\.ScenesPreset\.asset/i;
export const LOG_REGEX_SID = /Sid:\s([^_]+)_/;
export const LOG_REGEX_FOLDER_TIMESTAMP = /^log_(\d{4})\.(\d{2})\.(\d{2})_(\d{1,2})-(\d{1,2})-(\d{1,2})/;
export const LOG_APP_FILE_FRAGMENT = "application";
