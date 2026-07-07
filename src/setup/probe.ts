import type { SetupFs } from "./types.js";

/** Returns the first existing candidate path, or undefined. Absolute paths
 * only — PATH is unreliable in GUI-spawned processes (PRD §9). */
export async function probeBinary(
	fs: SetupFs,
	candidates: string[],
): Promise<string | undefined> {
	for (const candidate of candidates) {
		if (await fs.exists(candidate)) return candidate;
	}
	return undefined;
}
