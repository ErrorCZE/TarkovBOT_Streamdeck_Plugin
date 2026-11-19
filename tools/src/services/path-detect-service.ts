import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import { diag, describeFsError } from "./diagnostics-service";
import type { PathDetectionResult } from "../types";

const execAsync = promisify(exec);

const REGISTRY_PATHS = [
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov",
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 3932890",
] as const;

const REG_INSTALL_LOCATION = /InstallLocation\s+REG_SZ\s+(.+)/i;

export async function detectEftPath(): Promise<PathDetectionResult> {
    diag.info("PATH", "EFT path auto-detection started (checking registry keys)");

    for (const regPath of REGISTRY_PATHS) {
        let stdout: string;
        try {
            const result = await execAsync(`reg query "${regPath}" /v InstallLocation`, {
                encoding: "utf8",
            });
            stdout = result.stdout;
        } catch (err: any) {
            // reg.exe exits non-zero when the key does not exist - normal for one of the two keys.
            diag.info("PATH", `Registry key not usable (skipping)`, {
                regPath,
                reason: err?.code ? `exit code ${err.code}` : describeFsError(err),
            });
            continue;
        }

        const match = stdout.match(REG_INSTALL_LOCATION);
        if (!match?.[1]) {
            diag.warn("PATH", "Registry key exists but InstallLocation value is missing or empty", {
                regPath,
            });
            continue;
        }

        const installPath = match[1].trim();

        let logsExists: boolean;
        try {
            logsExists = fs.existsSync(`${installPath}\\Logs`);
        } catch (err) {
            diag.warn("PATH", "Cannot check the detected install path", {
                installPath,
                err: describeFsError(err),
            });
            continue;
        }

        if (logsExists) {
            diag.info("PATH", "EFT path auto-detected from registry", { installPath });
            return { success: true, path: installPath };
        }

        diag.warn("PATH", "Detected install path has no Logs folder (game never run from here?)", {
            installPath,
            checkedPath: `${installPath}\\Logs`,
        });
    }

    const error = "EFT installation not found. Please enter the path manually.";
    diag.warn("PATH", `EFT path auto-detection failed - ${error}`, {
        triedRegistryKeys: REGISTRY_PATHS.length,
        hint: "Set the path manually in the property inspector; the problem will be logged with details.",
    });
    return { success: false, error };
}
