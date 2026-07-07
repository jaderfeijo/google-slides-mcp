import type { KeychainStore } from "../keychain/store.js";
import type { ScopeTier } from "../constants.js";
import type { AccountRecord, ClientConfig } from "./types.js";

export interface PkceFlowOptions {
	tier: ScopeTier;
	/** Injected in tests; defaults to `execFile("/usr/bin/open", [url])`. */
	openBrowser?: (url: string) => Promise<void>;
	timeoutMs?: number;
}

/**
 * Authorization Code + PKCE with loopback redirect (PRD §4.3).
 *
 * Contract for the implementation (issue #8):
 * - loopback http server on 127.0.0.1:0, EADDRINUSE retry ×3
 * - scopes: identity + tier scopes; access_type=offline,
 *   prompt="consent select_account"
 * - 5-minute timeout with clean cancel; account email read from the
 *   ID-token claim
 * - on success: writes the AccountRecord and default-account meta to the
 *   keychain, returns the record
 */
export async function runPkceFlow(
	_client: ClientConfig,
	_keychain: KeychainStore,
	_options: PkceFlowOptions,
): Promise<AccountRecord> {
	throw new Error("Not implemented yet — tracked in issue #8");
}
