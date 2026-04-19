import fs from "fs";

/**
 * Extract timestamp from log folder name (format: log_YYYY.MM.DD_HH-MM-SS)
 */
export function extractTimestamp(folderName: string): number {
	try {
		const match = folderName.match(/^log_(\d{4})\.(\d{2})\.(\d{2})_(\d{1,2})-(\d{1,2})-(\d{1,2})/);
		if (match) {
			const [_, year, month, day, hour, minute, second] = match;
			const date = new Date(
				parseInt(year),
				parseInt(month) - 1,
				parseInt(day),
				parseInt(hour),
				parseInt(minute),
				parseInt(second)
			);
			return date.getTime();
		}
		return 0;
	} catch (error) {
		return 0;
	}
}

/**
 * Get sorted log folders from EFT Logs directory (newest first)
 */
export async function getLogFolders(eftPath: string): Promise<fs.Dirent[]> {
	const logsPath = `${eftPath}\\Logs`;

	const folders = await fs.promises.readdir(logsPath, { withFileTypes: true });
	return folders
		.filter(f => f.isDirectory() && f.name.startsWith("log_"))
		.map(f => ({
			dirent: f,
			timestamp: extractTimestamp(f.name)
		}))
		.sort((a, b) => b.timestamp - a.timestamp)
		.map(f => f.dirent);
}

/**
 * Get the latest application log file from EFT logs
 */
export async function getLatestLogFile(eftPath: string): Promise<string | null> {
	try {
		const logsPath = `${eftPath}\\Logs`;
		const logFolders = await getLogFolders(eftPath);

		if (logFolders.length === 0) {
			return null;
		}

		const latestFolder = `${logsPath}\\${logFolders[0].name}`;

		const files = await fs.promises.readdir(latestFolder, { withFileTypes: true });
		const logFiles = files
			.filter(f => f.isFile() && f.name.includes("application") && f.name.endsWith(".log"))
			.sort((a, b) => b.name.localeCompare(a.name));

		if (logFiles.length === 0) {
			return null;
		}

		return `${latestFolder}\\${logFiles[0].name}`;
	} catch (error) {
		return null;
	}
}

export async function findServerFromLogs(eftPath: string): Promise<{ sid: string, datacenter: string } | null> {
	try {
		if (!eftPath) return null;

		const latestFile = await getLatestLogFile(eftPath);
		if (!latestFile) return null;

		const content = await fs.promises.readFile(latestFile, "utf-8");
		const lines = content.split("\n");

		for (let i = lines.length - 1; i >= 0; i--) {
			// Updated Regex to find Sid: US-SEA03G002_...
			const match = lines[i].match(/Sid:\s([^_]+)_/);
			if (match) {
				const sidPrefix = match[1];

				let datacenterName = "Unknown";
				const datacenterData = globalThis.datacentersData;

				if (datacenterData) {
					for (const region in datacenterData) {
						for (const dc of datacenterData[region]) {
							if (dc.sids && dc.sids.some((sid: string) => sidPrefix.startsWith(sid))) {
								datacenterName = dc.datacenter;
								break;
							}
						}
						if (datacenterName !== "Unknown") break;
					}
				}

				return { sid: sidPrefix, datacenter: datacenterName };
			}
		}
		return null;
	} catch (error) {
		return null;
	}
}