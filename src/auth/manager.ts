import type { KeychainStore } from "../keychain/store.js";

/** Thrown when no client or account is configured yet (PRD §5, §9 row 1). */
export class NotConfiguredError extends Error {
	readonly code = "SETUP_REQUIRED";
	constructor(detail: string) {
		super(detail);
		this.name = "NotConfiguredError";
	}
}

/**
 * Per-call credential resolution (PRD §3 stateless-handler contract).
 *
 * Contract for the implementation (issue #9):
 * - getAccessToken(): in-memory cache (60s skew) → Keychain refresh token →
 *   OAuth2Client.refreshAccessToken(); access tokens never persisted
 * - invalid_grant maps to a structured AUTH_EXPIRED error naming the account
 * - missing client/account entries throw NotConfiguredError
 */
export class AuthManager {
	constructor(private readonly keychain: KeychainStore) {}

	async getAccessToken(_account?: string): Promise<string> {
		throw new Error("Not implemented yet — tracked in issue #9");
	}
}
