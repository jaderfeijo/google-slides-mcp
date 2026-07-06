import type { KeychainStore } from "./store.js";

/**
 * macOS Keychain access via /usr/bin/security (PRD §6).
 *
 * Contract for the implementation (issue #7):
 * - reads: `security find-generic-password -s <service> -a <account> -w`;
 *   exit code 44 (errSecItemNotFound) maps to null
 * - writes: `security -i` with `add-generic-password -U` on stdin — secrets
 *   must never appear on argv; payloads are base64-encoded before storage
 * - any other failure throws KeychainAccessDeniedError
 */
export class SecurityCliKeychain implements KeychainStore {
	async get(_service: string): Promise<string | null> {
		throw new Error("Not implemented yet — tracked in issue #7");
	}

	async set(_service: string, _secret: string): Promise<void> {
		throw new Error("Not implemented yet — tracked in issue #7");
	}

	async delete(_service: string): Promise<void> {
		throw new Error("Not implemented yet — tracked in issue #7");
	}
}
