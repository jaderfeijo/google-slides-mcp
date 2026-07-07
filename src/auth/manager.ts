import { OAuth2Client } from "google-auth-library";

import {
	SERVICE_CLIENT,
	SERVICE_META,
	TOKEN_EXPIRY_SKEW_MS,
	serviceForAccount,
} from "../constants.js";
import type { KeychainStore } from "../keychain/store.js";
import type { AccountRecord, ClientConfig, MetaRecord } from "./types.js";

/** Thrown when no client or account is configured yet (PRD §5, §9 row 1). */
export class NotConfiguredError extends Error {
	readonly code = "SETUP_REQUIRED";
	constructor(detail: string) {
		super(detail);
		this.name = "NotConfiguredError";
	}
}

/** Refresh token revoked or expired — names the account (PRD §9 row 2). */
export class AuthExpiredError extends Error {
	readonly code = "AUTH_EXPIRED";
	constructor(readonly account: string, detail: string) {
		super(
			`Google no longer accepts the credentials for ${account} (${detail}). ` +
				"Re-authenticate this account.",
		);
		this.name = "AuthExpiredError";
	}
}

interface CachedToken {
	accessToken: string;
	expiresAt: number;
}

/** Test seam: exchanges a refresh token for an access token. */
export type TokenRefresher = (
	client: ClientConfig,
	refreshToken: string,
) => Promise<{ accessToken: string; expiresAt: number }>;

const defaultRefresher: TokenRefresher = async (client, refreshToken) => {
	const oauth = new OAuth2Client({
		clientId: client.clientId,
		clientSecret: client.clientSecret,
	});
	oauth.setCredentials({ refresh_token: refreshToken });
	const { token } = await oauth.getAccessToken();
	if (!token) throw new Error("Google returned an empty access token");
	return {
		accessToken: token,
		expiresAt: oauth.credentials.expiry_date ?? Date.now() + 55 * 60 * 1000,
	};
};

/**
 * Per-call credential resolution (PRD §3): every tool call independently
 * resolves account → Keychain → token. The only state is the permitted
 * per-account access-token cache; access tokens never persist.
 */
export class AuthManager {
	private readonly cache = new Map<string, CachedToken>();

	constructor(
		private readonly keychain: KeychainStore,
		private readonly refresh: TokenRefresher = defaultRefresher,
	) {}

	/** Resolves the target account's email (explicit or the stored default). */
	async resolveAccount(account?: string): Promise<string> {
		if (account) return account;
		const rawMeta = await this.keychain.get(SERVICE_META);
		if (!rawMeta) {
			throw new NotConfiguredError(
				"no Google account has been added yet (missing default-account record)",
			);
		}
		return (JSON.parse(rawMeta) as MetaRecord).defaultAccount;
	}

	async getAccessToken(account?: string): Promise<string> {
		const email = await this.resolveAccount(account);

		const cached = this.cache.get(email);
		if (cached && cached.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
			return cached.accessToken;
		}

		const rawClient = await this.keychain.get(SERVICE_CLIENT);
		if (!rawClient) {
			throw new NotConfiguredError("no OAuth client is configured");
		}
		const client = JSON.parse(rawClient) as ClientConfig;

		const rawAccount = await this.keychain.get(serviceForAccount(email));
		if (!rawAccount) {
			throw new NotConfiguredError(
				`the account ${email} is not configured in the Keychain`,
			);
		}
		const record = JSON.parse(rawAccount) as AccountRecord;

		try {
			const fresh = await this.refresh(client, record.refreshToken);
			this.cache.set(email, {
				accessToken: fresh.accessToken,
				expiresAt: fresh.expiresAt,
			});
			return fresh.accessToken;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (/invalid_grant/i.test(message)) {
				throw new AuthExpiredError(email, "invalid_grant on refresh");
			}
			throw err;
		}
	}

	/** Returns the stored record for an account (tier checks, CLI status). */
	async getAccount(account?: string): Promise<AccountRecord> {
		const email = await this.resolveAccount(account);
		const raw = await this.keychain.get(serviceForAccount(email));
		if (!raw) {
			throw new NotConfiguredError(
				`the account ${email} is not configured in the Keychain`,
			);
		}
		return JSON.parse(raw) as AccountRecord;
	}
}
