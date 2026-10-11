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

interface TraderWatcher {
    timer: NodeJS.Timeout | null;
    retryCount: number;
}

class TarkovApiService {
    private readonly mapsCache: Record<GameMode, TTLCache<MapData[]>> = {
        PVP: new TTLCache<MapData[]>(INTERVALS.MAP_DATA_REFRESH),
        PVE: new TTLCache<MapData[]>(INTERVALS.MAP_DATA_REFRESH),
        SEASON: new TTLCache<MapData[]>(INTERVALS.MAP_DATA_REFRESH),
    };
    private readonly tradersData: Record<GameMode, TraderData[]> = {
        PVP: [],
        PVE: [],
        SEASON: [],
    };
    private readonly traderWatchers: Record<GameMode, TraderWatcher> = {
        PVP: { timer: null, retryCount: 0 },
        PVE: { timer: null, retryCount: 0 },
        SEASON: { timer: null, retryCount: 0 },
    };
    /** Number of restock actions currently using each game mode. */
    private readonly traderActionCounts: Record<GameMode, number> = { PVP: 0, PVE: 0, SEASON: 0 };

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

    // ---------- Trader restocks (restock-aware fetching) ----------

    /** Called by a restock action when it starts using a game mode. */
    acquireTraders(mode: GameMode): void {
        this.traderActionCounts[mode] += 1;
    }

    /** Called when a restock action stops using (or hides) a game mode. */
    releaseTraders(mode: GameMode): void {
        this.traderActionCounts[mode] = Math.max(0, this.traderActionCounts[mode] - 1);
        if (this.traderActionCounts[mode] === 0) {
            // No restock action uses this mode anymore -> stop fetching it.
            this.clearTraderWatcher(mode);
            this.traderWatchers[mode].retryCount = 0;
            streamDeck.logger.info(`Trader restock watcher for ${mode} stopped (no action uses it).`);
        }
    }

    private clearTraderWatcher(mode: GameMode): void {
        const watcher = this.traderWatchers[mode];
        if (watcher.timer) {
            clearTimeout(watcher.timer);
            watcher.timer = null;
        }
    }

    private isTraderWatcherActive(mode: GameMode): boolean {
        return this.traderWatchers[mode].timer !== null;
    }

    /** A trader counts as "restocked" while his resetTime lies in the past. */
    private evaluateTraders(traders: TraderData[]): {
        anyRestocked: boolean;
        msUntilNextRestock: number;
    } {
        const now = Date.now();
        let anyRestocked = false;
        let earliestFuture = Number.POSITIVE_INFINITY;
        for (const trader of traders) {
            const ts = new Date(trader.resetTime).getTime();
            if (!Number.isFinite(ts)) continue;
            if (ts <= now) {
                anyRestocked = true;
            } else if (ts < earliestFuture) {
                earliestFuture = ts;
            }
        }
        return {
            anyRestocked,
            msUntilNextRestock:
                earliestFuture === Number.POSITIVE_INFINITY
                    ? Number.POSITIVE_INFINITY
                    : earliestFuture - now,
        };
    }

    private traderRetryDelayMs(retryCount: number): number {
        const growth = Math.pow(
            INTERVALS.TRADER_RESTOCK_RETRY_MULTIPLIER,
            Math.max(0, retryCount - 1),
        );
        return Math.min(
            INTERVALS.TRADER_RESTOCK_RETRY_BASE_MS * growth,
            INTERVALS.TRADER_RESTOCK_RETRY_MAX_MS,
        );
    }

    private scheduleTraderWatch(mode: GameMode, fetchFailed: boolean): void {
        this.clearTraderWatcher(mode);
        const watcher = this.traderWatchers[mode];

        // Never fetch a game mode that no restock action is using.
        if (this.traderActionCounts[mode] === 0) return;

        const traders = this.tradersData[mode] ?? [];
        const { anyRestocked, msUntilNextRestock } = this.evaluateTraders(traders);

        if (fetchFailed || traders.length === 0 || anyRestocked) {
            // Data is missing or a trader is restocked right now: re-fetch with a
            // growing interval until data arrives where NOBODY is restocked.
            watcher.retryCount += 1;
            const delay = this.traderRetryDelayMs(watcher.retryCount);
            const reason =
                fetchFailed
                    ? "fetch failed"
                    : traders.length === 0
                        ? "no data"
                        : "a trader is restocked";
            streamDeck.logger.info(
                `${mode} trader data not clean yet (${reason}), retry #${watcher.retryCount} in ${Math.round(delay / 1000)}s`,
            );
            watcher.timer = setTimeout(() => {
                watcher.timer = null;
                void this.refreshTraders(mode);
            }, delay);
            return;
        }

        watcher.retryCount = 0;
        const delay = Number.isFinite(msUntilNextRestock)
            ? msUntilNextRestock + INTERVALS.TRADER_RESTOCK_RECHECK_BUFFER_MS
            : INTERVALS.TRADER_RESTOCK_RETRY_MAX_MS;
        watcher.timer = setTimeout(() => {
            watcher.timer = null;
            void this.refreshTraders(mode);
        }, delay);
        streamDeck.logger.info(
            `Next ${mode} trader fetch scheduled for the next restock in ${Math.round(delay / 60_000)} min.`,
        );
    }

    private refreshTraders = dedupe(async (mode: GameMode): Promise<TraderData[]> => {
        const url = traderResetsEndpoint(mode);
        let fetched = false;
        try {
            const res = await fetch(url);
            const json = await res.json();
            if (isTradersApiResponse(json)) {
                const traders = json.data.traders.map((t) => ({
                    name: String(t.name ?? ""),
                    resetTime: String(t.resetTime ?? ""),
                }));
                if (traders.length > 0) {
                    this.tradersData[mode] = traders;
                    fetched = true;
                    streamDeck.logger.info(`Processed ${mode} trader data (${traders.length} traders)`);
                } else {
                    streamDeck.logger.warn(`Empty ${mode} trader data, keeping previous data`);
                }
            } else {
                streamDeck.logger.error(`Invalid ${mode} trader data response`);
            }
        } catch (err) {
            streamDeck.logger.error(`Error fetching ${mode} trader data:`, err);
        }
        this.scheduleTraderWatch(mode, !fetched);
        return this.tradersData[mode] ?? [];
    });

    async getTraders(mode: GameMode): Promise<TraderData[]> {
        const cached = this.tradersData[mode] ?? [];

        if (cached.length > 0) {
            if (!this.isTraderWatcherActive(mode) && this.traderActionCounts[mode] > 0) {
                void this.refreshTraders(mode);
            }
            return cached;
        }

        if (this.traderActionCounts[mode] === 0 || this.isTraderWatcherActive(mode)) {
            return [];
        }
        return this.refreshTraders(mode);
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
