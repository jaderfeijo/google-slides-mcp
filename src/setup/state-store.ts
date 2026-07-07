import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { CONFIG_DIR_SUFFIX, SETUP_STATE_FILE } from "../constants.js";
import { emptyState, type SetupState } from "./types.js";

/** Durable, non-secret setup progress (PRD §5.1/§6) — persistence, not
 * session state: read and written per call, never held across calls. */
export interface SetupStateStore {
	read(): Promise<SetupState>;
	write(state: SetupState): Promise<void>;
}

export const defaultStatePath = (homeDir: string): string =>
	join(homeDir, CONFIG_DIR_SUFFIX, SETUP_STATE_FILE);

export class FileStateStore implements SetupStateStore {
	constructor(private readonly path: string) {}

	async read(): Promise<SetupState> {
		try {
			const parsed = JSON.parse(await readFile(this.path, "utf8")) as unknown;
			if (parsed && typeof parsed === "object" && "steps" in parsed) {
				return parsed as SetupState;
			}
		} catch {
			// Missing or corrupt file: steps re-derive from ground truth.
		}
		return emptyState();
	}

	async write(state: SetupState): Promise<void> {
		await mkdir(dirname(this.path), { recursive: true });
		const tmp = `${this.path}.tmp`;
		await writeFile(tmp, `${JSON.stringify(state, null, "\t")}\n`, "utf8");
		await rename(tmp, this.path);
	}
}

export class MemoryStateStore implements SetupStateStore {
	private state: SetupState = emptyState();

	async read(): Promise<SetupState> {
		return structuredClone(this.state);
	}

	async write(state: SetupState): Promise<void> {
		this.state = structuredClone(state);
	}
}
