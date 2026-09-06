import type { JsonObject } from "@elgato/utils";

export type GameMode = "PVP" | "PVE" | "SEASON";

export const ALL_GAME_MODES: readonly GameMode[] = ["PVP", "PVE", "SEASON"] as const;

export interface RawBoss {
    spawnChance: number;
    boss: { id: string; name: string };
    id: string;
    name: string;
    health: { bodyPart: string; max: number }[];
}

export interface ConsolidatedBoss {
    id: string;
    name: string;
    spawnChance: string;
}

export interface MapData {
    id: string;
    name: string;
    nameId: string;
    accessKeysMinPlayerLevel: number;
    raidDuration: number;
    players: string;
    accessKeys: unknown[];
    bosses: ConsolidatedBoss[];
}

export interface MapsApiResponse {
    maps: MapData[];
}

export interface LocalMapEntry {
    localIDs: string[];
    dataID: string;
}

export interface TraderData {
    name: string;
    resetTime: string;
}

export interface TradersApiResponse {
    data: { traders: TraderData[] };
}

export interface GoonsModeReport {
    location: string;
    reported: string;
}

export interface GoonsReport {
    location: string;
    reported: string;
    pvp: GoonsModeReport;
    pve: GoonsModeReport;
    season: GoonsModeReport;
}

export type GoonsSource = GameMode;

export interface DatacenterEntry {
    datacenter: string;
    sids: string[];
}

export type DatacentersData = Record<string, DatacenterEntry[]>;

export interface MapInfoSettings extends JsonObject {
    eft_install_path?: string;
    map_autoupdate_check?: boolean;
    game_mode?: GameMode;
}

export interface RaidServerSettings extends JsonObject {
    eft_install_path?: string;
    raid_autoupdate_check?: boolean;
}

export interface TraderRestockSettings extends JsonObject {
    selectedTrader?: string;
    game_mode?: GameMode;
    soundPath?: string
}

export interface GoonsLocationSettings extends JsonObject {
    token?: string;
    selectedGoonsSource?: GoonsSource;
    auto_refresh?: boolean;
}

export interface RaidTimerSettings extends JsonObject {
    eft_install_path?: string;
}

export interface UserSettings {
    map_autoupdate_check: boolean;
    game_mode: GameMode;
    eftInstallPath: string;
    raid_autoupdate_check: boolean;
}

export interface PathDetectionResult {
    success: boolean;
    path?: string;
    error?: string;
}
