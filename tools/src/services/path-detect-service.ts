import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { diag, describeFsError } from "./diagnostics-service";
import type { PathDetectionResult } from "../types";

const execAsync = promisify(exec);
const STEAM_APP_ID = "3932890";

const REGISTRY_PATHS = [
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov",
    "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov",
    "HKCU\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov",
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 3932890",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 3932890",
    "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 3932890",
    "HKCU\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 3932890",
] as const;

const REG_INSTALL_LOCATION = /InstallLocation\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)/i;
const REG_STEAM_PATH = /(?:SteamPath|InstallPath)\s+REG_SZ\s+(.+)/i;

export async function detectEftPath(): Promise<PathDetectionResult> {
    diag.info("PATH", "EFT path auto-detection started");

    const registryPaths = await getRegistryInstallLocations();
    for (const installPath of registryPaths) {
        if (isValidEftPath(installPath)) {
            return { success: true, path: installPath };
        }
    }

    const steamPaths = await getSteamInstallRoots();
    for (const steamRoot of steamPaths) {
        const eftPath = await getSteamEftInstallPath(steamRoot);
        if (eftPath && isValidEftPath(eftPath)) {
            return { success: true, path: eftPath };
        }
    }

    const error = "EFT installation not found. Please enter the path manually.";
    diag.warn("PATH", `EFT path auto-detection failed - ${error}`);
    return { success: false, error };
}

async function getRegistryInstallLocations(): Promise<string[]> {
    const installLocations = new Set<string>();

    for (const regPath of REGISTRY_PATHS) {
        try {
            const result = await execAsync(`reg query "${regPath}" /v InstallLocation`, {
                encoding: "utf8",
            });
            const match = result.stdout.match(REG_INSTALL_LOCATION);
            if (match?.[1]) {
                installLocations.add(path.normalize(match[1].trim()));
            }
        } catch {
        }
    }

    return Array.from(installLocations);
}

async function getSteamInstallRoots(): Promise<string[]> {
    const steamRoots = new Set<string>();
    const steamRegistryPaths = [
        "HKCU\\SOFTWARE\\Valve\\Steam",
        "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam",
    ];

    for (const regPath of steamRegistryPaths) {
        try {
            const result = await execAsync(`reg query "${regPath}"`, { encoding: "utf8" });
            const match = result.stdout.match(REG_STEAM_PATH);
            if (match?.[1]) {
                const steamPath = path.normalize(match[1].trim().replace(/\\"/g, ""));
                if (fs.existsSync(steamPath)) {
                    steamRoots.add(steamPath);
                }
            }
        } catch {
        }
    }

    return Array.from(steamRoots);
}

async function getSteamEftInstallPath(steamRoot: string): Promise<string | null> {
    const libraryFoldersPath = path.join(steamRoot, "steamapps", "libraryfolders.vdf");
    const libraries = new Set<string>([steamRoot]);

    if (fs.existsSync(libraryFoldersPath)) {
        try {
            const vdfContent = fs.readFileSync(libraryFoldersPath, "utf8");
            const matches = [...vdfContent.matchAll(/"path"\s+"([^"]+)"/g)];
            for (const match of matches) {
                const libPath = path.normalize(match[1].replace(/\\\\/g, "\\"));
                if (fs.existsSync(libPath)) {
                    libraries.add(libPath);
                }
            }
        } catch (err) {
            diag.warn("PATH", "Failed to read libraryfolders.vdf", { err: describeFsError(err) });
        }
    }

    for (const libPath of libraries) {
        const manifestPath = path.join(libPath, "steamapps", `appmanifest_${STEAM_APP_ID}.acf`);
        if (fs.existsSync(manifestPath)) {
            try {
                const acfContent = fs.readFileSync(manifestPath, "utf8");
                const dirMatch = acfContent.match(/"installdir"\s+"([^"]+)"/);
                if (dirMatch?.[1]) {
                    const candidate = path.normalize(path.join(libPath, "steamapps", "common", dirMatch[1]));
                    if (fs.existsSync(candidate)) {
                        return candidate;
                    }
                }
            } catch (err) {
                diag.warn("PATH", "Failed to read appmanifest", { manifestPath, err: describeFsError(err) });
            }
        }
    }

    return null;
}

function isValidEftPath(installPath: string): boolean {
    if (!installPath || !fs.existsSync(installPath)) {
        return false;
    }

    const possibleLogPaths = [
        path.join(installPath, "Logs"),
        path.join(installPath, "build", "Logs"),
    ];

    for (const logPath of possibleLogPaths) {
        if (fs.existsSync(logPath)) {
            diag.info("PATH", "EFT path auto-detected successfully", { installPath, logsPath: logPath });
            return true;
        }
    }

    diag.warn("PATH", "Detected install path has no Logs folder", { installPath });
    return false;
}