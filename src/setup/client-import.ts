import { SERVICE_CLIENT } from "../constants.js";
import type { ClientConfig } from "../auth/types.js";
import type { KeychainStore } from "../keychain/store.js";

export type ClientParseResult =
	| { ok: true; config: ClientConfig }
	| { ok: false; reason: string };

/** Google's Desktop-app client download shape. */
interface InstalledClientJson {
	installed?: {
		client_id?: string;
		client_secret?: string;
		project_id?: string;
	};
}

/** Validates a client_secret_*.json payload (Desktop-app shape only). */
export function parseClientJson(raw: string): ClientParseResult {
	let parsed: InstalledClientJson;
	try {
		parsed = JSON.parse(raw) as InstalledClientJson;
	} catch {
		return { ok: false, reason: "the file is not valid JSON" };
	}
	const installed = parsed.installed;
	if (!installed?.client_id || !installed.client_secret) {
		return {
			ok: false,
			reason:
				'not a Desktop-app OAuth client JSON (expected an "installed" key ' +
				"with client_id and client_secret) — in the Google console use " +
				"Create Client → Desktop app, then download its JSON",
		};
	}
	return {
		ok: true,
		config: {
			clientId: installed.client_id,
			clientSecret: installed.client_secret,
			projectId: installed.project_id,
		},
	};
}

/** Parses and stores the OAuth client in the Keychain (PRD §6). */
export async function importClientJson(
	keychain: KeychainStore,
	raw: string,
): Promise<ClientParseResult> {
	const result = parseClientJson(raw);
	if (result.ok) {
		await keychain.set(SERVICE_CLIENT, JSON.stringify(result.config));
	}
	return result;
}
