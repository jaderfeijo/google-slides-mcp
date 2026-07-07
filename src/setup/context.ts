import { homedir } from "node:os";

import { runPkceFlow } from "../auth/pkce.js";
import type { KeychainStore } from "../keychain/store.js";
import type { SlidesClientFactory } from "../google/slides-client.js";
import { SetupEngine } from "./engine.js";
import { defaultExecRunner, defaultSetupFs } from "./exec.js";
import { FileStateStore, defaultStatePath } from "./state-store.js";
import { SETUP_STEPS } from "./steps/index.js";

/** Wires the engine with real dependencies — shared by the MCP entry point
 * and the CLI so both expose the identical setup behaviour (PRD §5.2). */
export function buildSetupEngine(
	keychain: KeychainStore,
	slides: SlidesClientFactory,
): SetupEngine {
	const home = homedir();
	return new SetupEngine(
		{
			keychain,
			state: new FileStateStore(defaultStatePath(home)),
			exec: defaultExecRunner,
			fs: defaultSetupFs,
			runAuthFlow: runPkceFlow,
			fetch: globalThis.fetch,
			slides,
			platform: process.platform,
			homeDir: home,
			log: (line) => console.error(line),
		},
		SETUP_STEPS,
	);
}
