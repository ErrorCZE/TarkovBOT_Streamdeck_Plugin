import fs from "node:fs";
import { DEFAULT_USER_SETTINGS, SETTINGS_FILE_PATH } from "../config/constants";
import {
    diag,
    describeFsError,
    normalizeEftPath,
    validateEftPath,
    type PathValidationResult,
} from "./diagnostics-service";
import type { GameMode, UserSettings } from "../types";

class SettingsService {
    private cache: UserSettings | null = null;
    private loggedFirstLoad = false;

    load(): UserSettings {
        if (this.cache) return this.cache;

        const defaults: UserSettings = { ...DEFAULT_USER_SETTINGS };

        try {
            if (fs.existsSync(SETTINGS_FILE_PATH)) {
                let raw: string;
                try {
                    raw = fs.readFileSync(SETTINGS_FILE_PATH, "utf8");
                } catch (err) {
                    diag.error("SETTINGS", "Cannot read settings file - using default settings", {
                        file: SETTINGS_FILE_PATH,
                        err: describeFsError(err),
                    });
                    this.cache = defaults;
                    return defaults;
                }

                let parsed: Record<string, any>;
                try {
                    parsed = JSON.parse(raw) as Record<string, any>;
                } catch (err) {
                    diag.error("SETTINGS", "Settings file contains invalid JSON - using default settings", {
                        file: SETTINGS_FILE_PATH,
                        parseError: describeFsError(err),
                        filePreview: raw.slice(0, 200),
                    });
                    this.cache = defaults;
                    return defaults;
                }

                const currentMapInfo = parsed.current_map_info ?? {};
                const gameMode: GameMode =
                    (currentMapInfo.game_mode as GameMode | undefined) ?? "PVP";

                this.cache = {
                    map_autoupdate_check: currentMapInfo.map_autoupdate_check ?? false,
                    game_mode: gameMode,
                    raid_autoupdate_check: parsed.current_server_info?.raid_autoupdate_check ?? false,
                    eftInstallPath: normalizeEftPath(parsed.global?.eft_install_path ?? ""),
                };

                const logFn = this.loggedFirstLoad ? "debug" : "info";
                diag[logFn]("SETTINGS", "Settings loaded", {
                    file: SETTINGS_FILE_PATH,
                    game_mode: this.cache.game_mode,
                    eftInstallPath: this.cache.eftInstallPath || "(empty)",
                    map_autoupdate_check: this.cache.map_autoupdate_check,
                    raid_autoupdate_check: this.cache.raid_autoupdate_check,
                });
                this.loggedFirstLoad = true;
                return this.cache;
            }

            diag.info("SETTINGS", "Settings file does not exist yet - starting with defaults", {
                file: SETTINGS_FILE_PATH,
            });
        } catch (err) {
            diag.error("SETTINGS", "Unexpected error while loading settings - using defaults", {
                file: SETTINGS_FILE_PATH,
                err: describeFsError(err),
            });
        }

        this.cache = defaults;
        return defaults;
    }

    /**
     * Merges `updates` into the settings file.
     *  - undefined values are dropped (they used to erase stored keys!)
     *  - nested plain objects are merged key-by-key instead of replacing
     *  - a corrupt existing file is reported and overwritten instead of blocking the save
     */
    save(updates: Record<string, any>): void {
        try {
            let existing: Record<string, any> = {};
            if (fs.existsSync(SETTINGS_FILE_PATH)) {
                try {
                    existing = JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, "utf8")) as Record<string, any>;
                } catch (err) {
                    diag.warn("SETTINGS", "Existing settings file is corrupt - it will be replaced by a fresh one", {
                        file: SETTINGS_FILE_PATH,
                        parseError: describeFsError(err),
                    });
                    existing = {};
                }
            }
            if (!existing || typeof existing !== "object") existing = {};

            this.mergeDefined(existing, updates);
            fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(existing, null, 4));
            this.cache = null;
            diag.debug("SETTINGS", "Settings saved", { file: SETTINGS_FILE_PATH });
        } catch (err) {
            diag.error("SETTINGS", "Failed to save settings file", {
                file: SETTINGS_FILE_PATH,
                err: describeFsError(err),
            });
        }
    }

    /** Recursively merges `patch` into `target`, skipping undefined values. */
    private mergeDefined(target: Record<string, any>, patch: Record<string, any>): void {
        for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) continue;
            const targetValue = target[key];
            if (
                value &&
                typeof value === "object" &&
                !Array.isArray(value) &&
                targetValue &&
                typeof targetValue === "object" &&
                !Array.isArray(targetValue)
            ) {
                this.mergeDefined(targetValue, value);
            } else {
                target[key] = value;
            }
        }
    }

    /**
     * Persists the EFT path into the global settings. Always normalizes and
     * validates first; the validation result is returned so callers (property
     * inspector sync) can surface concrete problems to the user.
     */
    setEftInstallPath(installPath: string): PathValidationResult {
        const normalized = normalizeEftPath(installPath);
        if (normalized !== (installPath ?? "").trim()) {
            diag.info("PATH", "EFT path was normalized before saving", {
                entered: installPath,
                normalized: normalized || "(empty)",
            });
        }

        if (!normalized) {
            diag.warn("PATH", "EFT path cleared / set to empty - log-based actions will not work until a valid path is set");
            this.save({ global: { eft_install_path: "" } });
            return { path: "", valid: false, problems: ["path is empty / not set"] };
        }

        const validation = validateEftPath(normalized);
        if (validation.valid) {
            diag.info("PATH", "EFT path set and validated successfully", { path: normalized });
        } else {
            diag.warn(
                "PATH",
                "EFT path was set but has problems - log reading will fail until it is fixed",
                { path: normalized, problems: validation.problems },
            );
        }
        this.save({ global: { eft_install_path: normalized } });
        return validation;
    }

    /**
     * Resolves the effective EFT path: the globally saved path is the single
     * source of truth (every property inspector writes to it); a non-empty
     * action-level path is only used as a fallback when global is empty.
     * Always normalized.
     */
    resolvePath(actionPath?: string): string {
        const global = this.load().eftInstallPath;
        if (global) return global;
        return normalizeEftPath(actionPath ?? "");
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
