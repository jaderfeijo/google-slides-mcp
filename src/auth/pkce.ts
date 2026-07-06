import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { promisify } from "node:util";

import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";

import {
	AUTH_TIMEOUT_MS,
	LOOPBACK_PORT_RETRIES,
	SCHEMA_VERSION,
	SERVICE_META,
	scopesForTier,
	serviceForAccount,
	type ScopeTier,
} from "../constants.js";
import type { KeychainStore } from "../keychain/store.js";
import type { AccountRecord, ClientConfig, MetaRecord } from "./types.js";

const execFileAsync = promisify(execFile);

/** Structured auth-flow failures (PRD §9: clean cancel, never opaque). */
export class AuthFlowError extends Error {
	constructor(
		readonly code: "AUTH_TIMEOUT" | "AUTH_DENIED" | "AUTH_FAILED",
		message: string,
	) {
		super(message);
		this.name = "AuthFlowError";
	}
}

/** What the browser leg of the flow must produce for the token exchange. */
export interface ExchangeResult {
	refreshToken: string;
	email: string;
	grantedScopes: string[];
}

export interface PkceFlowOptions {
	tier: ScopeTier;
	/** Injected in tests; defaults to `execFile("/usr/bin/open", [url])`. */
	openBrowser?: (url: string) => Promise<void>;
	timeoutMs?: number;
	/** Test seam: replaces the Google token exchange. */
	exchangeCode?: (
		code: string,
		codeVerifier: string,
		redirectUri: string,
	) => Promise<ExchangeResult>;
}

const defaultOpenBrowser = async (url: string): Promise<void> => {
	await execFileAsync("/usr/bin/open", [url]);
};

/**
 * Authorization Code + PKCE with loopback redirect (PRD §4.3): ephemeral
 * port on 127.0.0.1 (EADDRINUSE retry ×3), offline access with
 * consent+select_account, 5-minute timeout with clean cancel. On success
 * the account record is written to the Keychain and the first account
 * becomes the default.
 */
export async function runPkceFlow(
	client: ClientConfig,
	keychain: KeychainStore,
	options: PkceFlowOptions,
): Promise<AccountRecord> {
	const timeoutMs = options.timeoutMs ?? AUTH_TIMEOUT_MS;
	const openBrowser = options.openBrowser ?? defaultOpenBrowser;
	const scopes = scopesForTier(options.tier);
	const state = randomBytes(16).toString("hex");

	const oauth = new OAuth2Client({
		clientId: client.clientId,
		clientSecret: client.clientSecret,
	});
	const pkce = await oauth.generateCodeVerifierAsync();

	const { server, port } = await listenLoopback();
	const redirectUri = `http://127.0.0.1:${port}/callback`;

	const exchangeCode =
		options.exchangeCode ??
		(async (code, codeVerifier, redirect): Promise<ExchangeResult> => {
			const { tokens } = await oauth.getToken({
				code,
				codeVerifier,
				redirect_uri: redirect,
			});
			if (!tokens.refresh_token) {
				throw new AuthFlowError(
					"AUTH_FAILED",
					"Google returned no refresh token; re-run with prompt=consent.",
				);
			}
			const email = tokens.id_token
				? emailFromIdToken(tokens.id_token)
				: undefined;
			if (!email) {
				throw new AuthFlowError(
					"AUTH_FAILED",
					"Could not identify the account: no email claim in the ID token.",
				);
			}
			return {
				refreshToken: tokens.refresh_token,
				email,
				grantedScopes: tokens.scope?.split(" ") ?? scopes,
			};
		});

	try {
		const code = await new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(
					new AuthFlowError(
						"AUTH_TIMEOUT",
						`No OAuth callback within ${Math.round(timeoutMs / 60000)} minutes; the sign-in was cancelled.`,
					),
				);
			}, timeoutMs);

			server.on("request", (req, res) => {
				const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
				if (url.pathname !== "/callback") {
					res.writeHead(404).end();
					return;
				}
				res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
				res.end(
					"<html><body><p>slides-mcp is connected. You can close this tab.</p></body></html>",
				);
				clearTimeout(timer);

				const err = url.searchParams.get("error");
				if (err) {
					reject(
						new AuthFlowError("AUTH_DENIED", `Google reported: ${err}`),
					);
					return;
				}
				if (url.searchParams.get("state") !== state) {
					reject(
						new AuthFlowError("AUTH_FAILED", "OAuth state mismatch."),
					);
					return;
				}
				const codeParam = url.searchParams.get("code");
				if (!codeParam) {
					reject(
						new AuthFlowError("AUTH_FAILED", "Callback carried no code."),
					);
					return;
				}
				resolve(codeParam);
			});

			const authUrl = oauth.generateAuthUrl({
				access_type: "offline",
				prompt: "consent select_account",
				scope: scopes,
				state,
				redirect_uri: redirectUri,
				code_challenge_method: CodeChallengeMethod.S256,
				code_challenge: pkce.codeChallenge,
			});
			openBrowser(authUrl).catch(reject);
		});

		const granted = await exchangeCode(code, pkce.codeVerifier, redirectUri);

		const record: AccountRecord = {
			email: granted.email,
			refreshToken: granted.refreshToken,
			scopes: granted.grantedScopes,
			tier: options.tier,
			addedAt: new Date().toISOString(),
		};
		await keychain.set(
			serviceForAccount(record.email),
			JSON.stringify(record),
		);

		const rawMeta = await keychain.get(SERVICE_META);
		const meta: MetaRecord = rawMeta
			? (JSON.parse(rawMeta) as MetaRecord)
			: { defaultAccount: record.email, schemaVersion: SCHEMA_VERSION };
		if (!rawMeta) {
			await keychain.set(SERVICE_META, JSON.stringify(meta));
		}

		return record;
	} finally {
		server.close();
	}
}

/** Binds 127.0.0.1 on an ephemeral port, retrying per PRD §9. */
async function listenLoopback(): Promise<{ server: Server; port: number }> {
	let lastError: unknown;
	for (let attempt = 0; attempt < LOOPBACK_PORT_RETRIES; attempt++) {
		const server = createServer();
		try {
			const port = await new Promise<number>((resolve, reject) => {
				server.once("error", reject);
				server.listen(0, "127.0.0.1", () => {
					const address = server.address();
					if (address && typeof address === "object") {
						resolve(address.port);
					} else {
						reject(new Error("No loopback address assigned"));
					}
				});
			});
			return { server, port };
		} catch (err) {
			server.close();
			lastError = err;
		}
	}
	throw new AuthFlowError(
		"AUTH_FAILED",
		`Could not bind a loopback port after ${LOOPBACK_PORT_RETRIES} attempts: ${String(lastError)}`,
	);
}

/** Decodes the email claim from a Google ID token (JWT) without verification
 * — the token arrived directly from Google's token endpoint over TLS. */
function emailFromIdToken(idToken: string): string | undefined {
	const payload = idToken.split(".")[1];
	if (!payload) return undefined;
	try {
		const claims = JSON.parse(
			Buffer.from(payload, "base64url").toString("utf8"),
		) as { email?: string };
		return claims.email;
	} catch {
		return undefined;
	}
}
