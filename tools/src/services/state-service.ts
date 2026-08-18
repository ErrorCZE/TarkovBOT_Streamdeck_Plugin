import type { DatacentersData, GameMode, MapData } from "../types";

class StateService {
    private _currentLocationId: string | null = null;

    private readonly _maps: Record<GameMode, MapData[]> = {
        PVP: [],
        PVE: [],
        SEASON: [],
    };

    private _datacenters: DatacentersData = {};

    get currentLocationId(): string | null {
        return this._currentLocationId;
    }

    set currentLocationId(value: string | null) {
        this._currentLocationId = value;
    }

    get mapsPVP(): MapData[] {
        return this._maps.PVP;
    }

    get mapsPVE(): MapData[] {
        return this._maps.PVE;
    }

    get mapsSeason(): MapData[] {
        return this._maps.SEASON;
    }

    setMaps(mode: GameMode, data: MapData[]): void {
        this._maps[mode] = data;
    }

    getMapData(locationId: string | null, mode: GameMode): MapData | null {
        if (!locationId) return null;
        const source = this._maps[mode];
        return source.find((m) => m.nameId === locationId) ?? null;
    }

    get datacenters(): DatacentersData {
        return this._datacenters;
    }

    set datacenters(value: DatacentersData) {
        this._datacenters = value;
    }

    resolveDatacenter(sidPrefix: string): string {
        for (const region of Object.keys(this._datacenters)) {
            for (const dc of this._datacenters[region]) {
                if (dc.sids?.some((sid) => sidPrefix.startsWith(sid))) {
                    return dc.datacenter;
                }
            }
        }
        return "Unknown";
    }
}

export const stateService = new StateService();
