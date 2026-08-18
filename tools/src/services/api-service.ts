import streamDeck from "@elgato/streamdeck";
import {
    BOSS_IMAGE_BASE,
    BOSS_IMAGE_FALLBACK,
    ENDPOINTS,
    INTERVALS,
    mapsEndpoint,
    traderResetsEndpoint,
} from "../config/constants";
import type {
    ConsolidatedBoss,
    DatacentersData,
    GameMode,
    LocalMapEntry,
    MapData,
    MapsApiResponse,
    TraderData,
    TradersApiResponse,
} from "../types";
import { stateService } from "./state-service";

function isMapsApiResponse(data: unknown): data is MapsApiResponse {
    return !!data && typeof data === "object" && Array.isArray((data as MapsApiResponse).maps);
}

function isTradersApiResponse(data: unknown): data is TradersApiResponse {
    return (
        !!data &&
        typeof data === "object" &&
        Array.isArray((data as TradersApiResponse).data?.traders)
    );
}

function isLocalMapNamesArray(data: unknown): data is LocalMapEntry[] {
    return (
        Array.isArray(data) &&
        data.every(
            (item) =>
                item &&
                typeof item === "object" &&
                Array.isArray(item.localIDs) &&
                typeof item.dataID === "string",
        )
    );
}

function consolidateBosses(rawBosses: any[]): ConsolidatedBoss[] {
    const bossMap = new Map<string, { id: string; spawnChances: number[] }>();

    for (const b of rawBosses) {
        const name: string = b.boss.name;
        const id: string = b.boss.id;
        const chance = Number((b.spawnChance * 100).toFixed(0));

        if (!bossMap.has(name)) {
            bossMap.set(name, { id, spawnChances: [] });
        }
        bossMap.get(name)!.spawnChances.push(chance);
    }

    return Array.from(bossMap.entries()).map(([name, { id, spawnChances }]) => {
        const lowest = Math.min(...spawnChances);
        const highest = Math.max(...spawnChances);
        const spawnChance = lowest === highest ? `${lowest}%` : `${lowest}-${highest}%`;
        return { name, id, spawnChance };
    });
}

function dedupe<TArgs extends unknown[], T>(
    fn: (...args: TArgs) => Promise<T>,
    keyFn: (...args: TArgs) => string = (...args) => JSON.stringify(args),
): (...args: TArgs) => Promise<T> {
    const inflight = new Map<string, Promise<T>>();
    return async (...args: TArgs) => {
        const key = keyFn(...args);
        const existing = inflight.get(key);
        if (existing) return existing;
        const p = fn(...args).finally(() => inflight.delete(key));
        inflight.set(key, p);
        return p;
    };
}

interface CachedEntry<T> {
    data: T;
    expiresAt: number;
}

class TTLCache<T> {
    private entry: CachedEntry<T> | null = null;
    constructor(private readonly ttlMs: number) {}

    get(): T | null {
        if (!this.entry) return null;
        if (Date.now() >= this.entry.expiresAt) {
            this.entry = null;
            return null;
        }
        return this.entry.data;
    }

    set(data: T): void {
        this.entry = { data, expiresAt: Date.now() + this.ttlMs };
    }
}

class TarkovApiService {
    private readonly mapsCache: Record<GameMode, TTLCache<MapData[]>> = {
        PVP: new TTLCache<MapData[]>(INTERVALS.MAP_DATA_REFRESH),
        PVE: new TTLCache<MapData[]>(INTERVALS.MAP_DATA_REFRESH),
        SEASON: new TTLCache<MapData[]>(INTERVALS.MAP_DATA_REFRESH),
    };
    private readonly tradersCache: Record<GameMode, TTLCache<TraderData[]>> = {
        PVP: new TTLCache<TraderData[]>(INTERVALS.TRADER_DATA_REFRESH),
        PVE: new TTLCache<TraderData[]>(INTERVALS.TRADER_DATA_REFRESH),
        SEASON: new TTLCache<TraderData[]>(INTERVALS.TRADER_DATA_REFRESH),
    };
    private localMapNamesCache: LocalMapEntry[] = [];
    private localMapNamesLoaded = false;

    private readonly bossImageCache = new Map<string, string>();

    private refreshMaps = dedupe(async (mode: GameMode): Promise<MapData[]> => {
        const url = mapsEndpoint(mode);
        try {
            const res = await fetch(url);
            const json = await res.json();
            if (!isMapsApiResponse(json)) return [];

            const consolidated = json.maps.map((m) => ({
                ...m,
                bosses: consolidateBosses(m.bosses as any[]),
            }));

            stateService.setMaps(mode, consolidated);
            this.mapsCache[mode].set(consolidated);
            streamDeck.logger.info(`Processed ${mode} Map Data (${consolidated.length} maps)`);
            return consolidated;
        } catch (err) {
            streamDeck.logger.error(`Error fetching ${mode} maps:`, err);
            return [];
        }
    });

    async getMaps(mode: GameMode): Promise<MapData[]> {
        const cached = this.mapsCache[mode].get();
        if (cached) return cached;
        return this.refreshMaps(mode);
    }

    refreshMapsAsync(mode: GameMode): void {
        void this.refreshMaps(mode);
    }

    private refreshTraders = dedupe(async (mode: GameMode): Promise<TraderData[]> => {
        const url = traderResetsEndpoint(mode);
        try {
            const res = await fetch(url);
            const json = await res.json();
            if (!isTradersApiResponse(json)) return [];

            const traders = json.data.traders.map((t) => ({
                name: String(t.name ?? ""),
                resetTime: String(t.resetTime ?? ""),
            }));
            this.tradersCache[mode].set(traders);
            streamDeck.logger.info(`Processed ${mode} trader data (${traders.length} traders)`);
            return traders;
        } catch (err) {
            streamDeck.logger.error(`Error fetching ${mode} trader data:`, err);
            return [];
        }
    });

    async getTraders(mode: GameMode): Promise<TraderData[]> {
        const cached = this.tradersCache[mode].get();
        if (cached) return cached;
        return this.refreshTraders(mode);
    }

    refreshTradersAsync(mode: GameMode): void {
        void this.refreshTraders(mode);
    }

    private refreshDatacenters = dedupe(async (): Promise<DatacentersData> => {
        try {
            const res = await fetch(ENDPOINTS.DATACENTERS);
            const json = await res.json();
            if (json && typeof json === "object") {
                const data = json as DatacentersData;
                stateService.datacenters = data;
                streamDeck.logger.info("Datacenter list updated.");
                return data;
            }
        } catch (err) {
            streamDeck.logger.error("Error fetching datacenter data:", err);
        }
        return {};
    });

    async getDatacenters(): Promise<DatacentersData> {
        const current = stateService.datacenters;
        if (Object.keys(current).length > 0) return current;
        return this.refreshDatacenters();
    }

    refreshDatacentersAsync(): void {
        void this.refreshDatacenters();
    }

    private refreshLocalMapNames = dedupe(async (): Promise<LocalMapEntry[]> => {
        try {
            const res = await fetch(ENDPOINTS.LOCAL_MAP_NAMES);
            const json = await res.json();
            if (isLocalMapNamesArray(json)) {
                this.localMapNamesCache = json;
                this.localMapNamesLoaded = true;
                streamDeck.logger.info("Local map names loaded successfully");
                return json;
            }
        } catch (err) {
            streamDeck.logger.error("Error fetching local map names:", err);
        }
        return [];
    });

    async getLocalMapNames(): Promise<LocalMapEntry[]> {
        if (this.localMapNamesLoaded) return this.localMapNamesCache;
        return this.refreshLocalMapNames();
    }

    refreshLocalMapNamesAsync(): void {
        void this.refreshLocalMapNames();
    }

    async getBossImage(bossId: string): Promise<string | null> {
        const cached = this.bossImageCache.get(bossId);
        if (cached) return cached;

        const primary = `${BOSS_IMAGE_BASE}/${bossId}.webp`;
        try {
            let response = await fetch(primary);
            if (!response.ok) {
                response = await fetch(BOSS_IMAGE_FALLBACK);
            }
            if (!response.ok) return null;

            const buf = await response.arrayBuffer();
            const dataUrl = `data:image/webp;base64,${Buffer.from(buf).toString("base64")}`;
            this.bossImageCache.set(bossId, dataUrl);
            return dataUrl;
        } catch (err) {
            streamDeck.logger.error(`Failed to fetch boss image for ${bossId}:`, err);
            return null;
        }
    }

    invalidateBossImageCache(): void {
        this.bossImageCache.clear();
    }
}

export const tarkovApiService = new TarkovApiService();
