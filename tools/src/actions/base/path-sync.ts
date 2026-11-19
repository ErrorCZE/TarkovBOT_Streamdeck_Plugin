import type { JsonValue } from "@elgato/utils";
import { streamDeck } from "@elgato/streamdeck";
import {
    diag,
    normalizeEftPath,
    type PathValidationResult,
} from "../../services/diagnostics-service";
import { settingsService } from "../../services/settings-service";

/** Message sent to the property inspector after a manually typed path was saved. */
export interface ManualPathMessage {
    event: "manualPathResult";
    success: boolean;
    path: string;
    problems?: string[];
}

export interface PathSyncResult {
    /** True when a genuinely new path was persisted into the global settings file. */
    changed: boolean;
    /** The normalized incoming path ("" when the field is empty / not a string). */
    path: string;
    /** Validation result; present only when the path was persisted. */
    validation: PathValidationResult | null;
}

/**
 * Keeps the globally stored EFT path in sync with edits made in a property
 * inspector.
 *
 * WHY THIS EXISTS (the manual-path bug):
 * `settingsService.resolvePath()` treats the globally saved path
 * (`user_settings.json` -> `global.eft_install_path`) as the single source of
 * truth; the action-level `eft_install_path` is only a fallback used while the
 * global path is empty. A path typed into a property inspector lands ONLY in
 * the action settings (written by sdpi-components), so without an explicit
 * write-through it would never reach the global file - and would be silently
 * ignored whenever the global file already contained a (possibly stale) value.
 * That is exactly why a manually entered path "did nothing" until the user
 * pressed Auto Detect (which DOES write the global path and restarts consumers).
 *
 * Stream Deck delivers `didReceiveSettings` both for real edits (the user typed
 * into the path field) and for ECHOES (the property inspector merely loaded its
 * stored settings, or the plugin itself called `setSettings`). Persisting on
 * every event would let a stale action-level value overwrite a newer global
 * path, so the first event per action instance after plugin start is treated as
 * a baseline and only genuine changes are written through. When the incoming
 * path already equals the global one (echo of the auto-detect write), the save
 * is skipped to avoid duplicate work and log noise.
 */
export class ActionPathSync {
    private lastSeen = new Map<string, string>();

    sync(actionId: string, incomingRaw: unknown, source: string): PathSyncResult {
        if (typeof incomingRaw !== "string") {
            return { changed: false, path: "", validation: null };
        }
        const incoming = normalizeEftPath(incomingRaw);

        const lastSeen = this.lastSeen.get(actionId);
        if (lastSeen === undefined) {
            // First settings delivery after plugin start: baseline only, never
            // persist (this is the property-inspector-open echo, not an edit).
            this.lastSeen.set(actionId, incoming);
            return { changed: false, path: incoming, validation: null };
        }
        if (incoming === lastSeen) {
            return { changed: false, path: incoming, validation: null };
        }
        this.lastSeen.set(actionId, incoming);

        if (incoming === settingsService.load().eftInstallPath) {
            // Global already matches (e.g. the didReceiveSettings echo caused by
            // the auto-detect write) - nothing to sync.
            return { changed: false, path: incoming, validation: null };
        }

        diag.info("PATH", "EFT path changed in property inspector - syncing to global settings", {
            source,
            actionId,
            previous: settingsService.load().eftInstallPath || "(empty)",
            incoming: incoming || "(empty)",
        });
        const validation = settingsService.setEftInstallPath(incoming);
        return { changed: true, path: incoming, validation };
    }
}

/**
 * Tells the open property inspector how a manually saved path validated, so a
 * bad manual path is never silently dead again. Safe to call when no property
 * inspector is visible.
 */
export function sendManualPathResultToInspector(result: PathSyncResult): void {
    const message: ManualPathMessage = {
        event: "manualPathResult",
        success: !!result.validation?.valid,
        path: result.path,
        problems: result.validation?.problems,
    };
    void streamDeck.ui
        .sendToPropertyInspector(message as unknown as JsonValue)
        .catch((err) => {
            diag.debug(
                "PATH",
                "Could not deliver manual-path result to the property inspector (probably closed)",
                { err: String(err) },
            );
        });
}
