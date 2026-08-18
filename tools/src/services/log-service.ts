import fs from "node:fs";
import streamDeck from "@elgato/streamdeck";
import {
    LOG_APP_FILE_FRAGMENT,
    LOG_REGEX_FOLDER_TIMESTAMP,
    LOG_REGEX_LOCATION,
    LOG_REGEX_SCENE_PRESET,
    LOG_REGEX_SID,
} from "../config/constants";
import type { GameMode, LocalMapEntry } from "../types";
import { tarkovApiService } from "./api-service";
import { stateService } from "./state-service";

export function extractTimestamp(folderName: string): number {
    const match = folderName.match(LOG_REGEX_FOLDER_TIMESTAMP);
    if (!match) return 0;
    const [, year, month, day, hour, minute, second] = match;
    return new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
    ).getTime();
}

interface DirentWithTimestamp {
    name: string;
    timestamp: number;
}

async function listLogFolders(eftPath: string): Promise<DirentWithTimestamp[]> {
    const logsPath = `${eftPath}\\Logs`;
    const entries = await fs.promises.readdir(logsPath, { withFileTypes: true });
    return entries
        .filter((f) => f.isDirectory() && f.name.startsWith("log_"))
        .map((f) => ({ name: f.name, timestamp: extractTimestamp(f.name) }))
        .sort((a, b) => b.timestamp - a.timestamp);
}

async function listAppLogFiles(folderPath: string): Promise<string[]> {
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    return entries
        .filter(
            (f) => f.isFile() && f.name.includes(LOG_APP_FILE_FRAGMENT) && f.name.endsWith(".log"),
        )
        .sort((a, b) => b.name.localeCompare(a.name))
        .map((f) => f.name);
}

export async function getLatestLogFile(eftPath: string): Promise<string | null> {
    if (!eftPath) return null;
    try {
        const folders = await listLogFolders(eftPath);
        if (folders.length === 0) return null;

        const latestFolder = `${eftPath}\\Logs\\${folders[0].name}`;
        const files = await listAppLogFiles(latestFolder);
        if (files.length === 0) return null;
        return `${latestFolder}\\${files[0]}`;
    } catch {
        return null;
    }
}

async function readLinesReversed(filePath: string): Promise<string[]> {
    const content = await fs.promises.readFile(filePath, "utf-8");
    return content.split("\n").reverse();
}

function findFirstMatch(linesReversed: string[], regex: RegExp): string | null {
    for (const line of linesReversed) {
        const m = line.match(regex);
        if (m && m[1]) return m[1];
    }
    return null;
}

export interface ServerInfo {
    sid: string;
    datacenter: string;
}

export async function findServerFromLogs(eftPath: string): Promise<ServerInfo | null> {
    if (!eftPath) return null;
    try {
        const latestFile = await getLatestLogFile(eftPath);
        if (!latestFile) return null;

        const lines = await readLinesReversed(latestFile);
        const sidPrefix = findFirstMatch(lines, LOG_REGEX_SID);
        if (!sidPrefix) return null;

        await tarkovApiService.getDatacenters();
        return { sid: sidPrefix, datacenter: stateService.resolveDatacenter(sidPrefix) };
    } catch (err) {
        streamDeck.logger.error("Error finding server from logs:", err);
        return null;
    }
}

export async function findCurrentMapFromLogs(
    eftPath: string,
    mode: GameMode,
): Promise<string | null> {
    if (!eftPath) return null;
    try {
        const latestFile = await getLatestLogFile(eftPath);
        if (!latestFile) return null;

        const lines = await readLinesReversed(latestFile);

        if (mode === "PVE" || mode === "SEASON") {
            const sceneName = findFirstMatch(lines, LOG_REGEX_SCENE_PRESET);
            if (!sceneName) return null;

            const normalised = sceneName.toLowerCase();
            const localMapNames = await tarkovApiService.getLocalMapNames();
            for (const entry of localMapNames) {
                const idsLower = entry.localIDs.map((id) => id.toLowerCase());
                if (idsLower.includes(normalised)) {
                    return entry.dataID;
                }
            }
            return normalised;
        }

        const location = findFirstMatch(lines, LOG_REGEX_LOCATION);
        return location ?? null;
    } catch (err) {
        streamDeck.logger.error("Error reading logs:", err);
        return null;
    }
}

export type { LocalMapEntry };
