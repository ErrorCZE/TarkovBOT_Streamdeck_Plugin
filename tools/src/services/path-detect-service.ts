import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import type { PathDetectionResult } from "../types";

const execAsync = promisify(exec);

const REGISTRY_PATHS = [
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov",
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 3932890",
] as const;

const REG_INSTALL_LOCATION = /InstallLocation\s+REG_SZ\s+(.+)/i;

export async function detectEftPath(): Promise<PathDetectionResult> {
    for (const regPath of REGISTRY_PATHS) {
        try {
            const { stdout } = await execAsync(`reg query "${regPath}" /v InstallLocation`, {
                encoding: "utf8",
            });

            const match = stdout.match(REG_INSTALL_LOCATION);
            if (!match?.[1]) continue;

            const installPath = match[1].trim();
            const candidate = resolveLogsRoot(installPath);
            if (candidate) {
                return { success: true, path: candidate };
            }
        } catch {
            continue;
        }
    }

    return {
        success: false,
        error: "EFT installation not found. Please enter the path manually.",
    };
}

function resolveLogsRoot(installPath: string): string | null {
    if (fs.existsSync(`${installPath}\\Logs`)) {
        return installPath;
    }
    return null;
}
