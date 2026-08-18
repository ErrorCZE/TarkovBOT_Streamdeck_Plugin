import fs from "node:fs";
import { DEFAULT_USER_SETTINGS, SETTINGS_FILE_PATH } from "../config/constants";
import type { GameMode, UserSettings } from "../types";

class SettingsService {
    private cache: UserSettings | null = null;

    load(): UserSettings {
        if (this.cache) return this.cache;

        const defaults: UserSettings = { ...DEFAULT_USER_SETTINGS };

        try {
            if (fs.existsSync(SETTINGS_FILE_PATH)) {
                const raw = fs.readFileSync(SETTINGS_FILE_PATH, "utf8");
                const parsed = JSON.parse(raw) as Record<string, any>;
                const currentMapInfo = parsed.current_map_info ?? {};
                const gameMode: GameMode =
                    (currentMapInfo.game_mode as GameMode | undefined) ?? "PVP";

                this.cache = {
                    map_autoupdate_check: currentMapInfo.map_autoupdate_check ?? false,
                    game_mode: gameMode,
                    raid_autoupdate_check: parsed.current_server_info?.raid_autoupdate_check ?? false,
                    eftInstallPath: parsed.global?.eft_install_path ?? "",
                };
                return this.cache;
            }
        } catch {
            // fallthrough to defaults
        }

        this.cache = defaults;
        return defaults;
    }

    save(updates: Record<string, any>): void {
        try {
            let existing: Record<string, any> = {};
            if (fs.existsSync(SETTINGS_FILE_PATH)) {
                existing = JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, "utf8")) as Record<string, any>;
            }
            const merged = { ...existing, ...updates };
            fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(merged, null, 4));
            this.cache = null;
        } catch {
            // silent fail
        }
    }

    setEftInstallPath(installPath: string): void {
        this.save({ global: { eft_install_path: installPath } });
    }

    setMapInfoFlags(opts: {
        map_autoupdate_check?: boolean;
        game_mode?: GameMode;
    }): void {
        const current = this.load();
        this.save({
            current_map_info: {
                map_autoupdate_check: opts.map_autoupdate_check ?? current.map_autoupdate_check,
                game_mode: opts.game_mode ?? current.game_mode,
            },
        });
    }

    setRaidServerFlags(opts: { raid_autoupdate_check?: boolean }): void {
        const current = this.load();
        this.save({
            current_server_info: {
                raid_autoupdate_check: opts.raid_autoupdate_check ?? current.raid_autoupdate_check,
            },
        });
    }

    invalidateCache(): void {
        this.cache = null;
    }
}

export const settingsService = new SettingsService();
