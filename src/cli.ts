#!/usr/bin/env node
/**
 * Headless CLI (PRD §5.2). M1 bootstrap for auth until the M2 setup engine
 * lands; every setup/diagnostic step stays invocable from here.
 */
import { readFile } from "node:fs/promises";

import { runPkceFlow } from "./auth/pkce.js";
import { AuthManager, NotConfiguredError } from "./auth/manager.js";
import type { ClientConfig, MetaRecord } from "./auth/types.js";
import {
	GOOGLE_REVOKE_URL,
	SERVICE_CLIENT,
	SERVICE_META,
	serviceForAccount,
	type ScopeTier,
} from "./constants.js";
import { SecurityCliKeychain } from "./keychain/security-cli.js";
import type { KeychainStore } from "./keychain/store.js";

const USAGE = `slides-mcp CLI

Usage:
  node dist/cli.js auth import <path-to-client_secret.json>
  node dist/cli.js auth login [--tier core|extended]
  node dist/cli.js auth status
  node dist/cli.js auth remove [email]
`;

const log = (line: string): void => void process.stderr.write(`${line}\n`);

/** Google's Desktop-app client download shape. */
interface InstalledClientJson {
	installed?: { client_id?: string; client_secret?: string; project_id?: string };
}

async function authImport(
	keychain: KeychainStore,
	path?: string,
): Promise<number> {
	if (!path) {
		log("Missing path. Usage: auth import <path-to-client_secret.json>");
		return 1;
	}
	const parsed = JSON.parse(
		await readFile(path, "utf8"),
	) as InstalledClientJson;
	const installed = parsed.installed;
	if (!installed?.client_id || !installed.client_secret) {
		log(
			'Not a Desktop-app OAuth client JSON (expected an "installed" key ' +
				"with client_id and client_secret). In the Google console create " +
				"Create Client → Desktop app, then download its JSON.",
		);
		return 1;
	}
	const config: ClientConfig = {
		clientId: installed.client_id,
		clientSecret: installed.client_secret,
		projectId: installed.project_id,
	};
	await keychain.set(SERVICE_CLIENT, JSON.stringify(config));
	log(`OAuth client ${config.clientId} imported into the Keychain.`);
	log(`Now delete the plaintext file: rm '${path}'`);
	return 0;
}

async function authLogin(
	keychain: KeychainStore,
	args: string[],
): Promise<number> {
	const tierIndex = args.indexOf("--tier");
	const tier = (tierIndex >= 0 ? args[tierIndex + 1] : "core") as ScopeTier;
	if (tier !== "core" && tier !== "extended") {
		log(`Unknown tier "${tier}" — use core or extended.`);
		return 1;
	}
	const rawClient = await keychain.get(SERVICE_CLIENT);
	if (!rawClient) {
		log("No OAuth client configured. Run: auth import <client_secret.json>");
		return 1;
	}
	log("Opening your browser for Google sign-in (5-minute timeout)...");
	const record = await runPkceFlow(
		JSON.parse(rawClient) as ClientConfig,
		keychain,
		{ tier },
	);
	log(`Signed in as ${record.email} (${record.tier} tier).`);
	return 0;
}

async function authStatus(keychain: KeychainStore): Promise<number> {
	const client = await keychain.get(SERVICE_CLIENT);
	log(`OAuth client: ${client ? "configured" : "not configured"}`);
	const rawMeta = await keychain.get(SERVICE_META);
	if (!rawMeta) {
		log("Accounts: none");
		return 0;
	}
	const meta = JSON.parse(rawMeta) as MetaRecord;
	try {
		const account = await new AuthManager(keychain).getAccount(
			meta.defaultAccount,
		);
		log(
			`Default account: ${account.email} (${account.tier} tier, ` +
				`added ${account.addedAt})`,
		);
	} catch (err) {
		if (!(err instanceof NotConfiguredError)) throw err;
		log(`Default account ${meta.defaultAccount} is missing its Keychain entry.`);
	}
	return 0;
}

async function authRemove(
	keychain: KeychainStore,
	email?: string,
): Promise<number> {
	const manager = new AuthManager(keychain);
	const target = await manager.resolveAccount(email).catch(() => undefined);
	if (!target) {
		log("No account to remove.");
		return 1;
	}
	const record = await manager.getAccount(target);

	const response = await fetch(GOOGLE_REVOKE_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ token: record.refreshToken }),
	});
	if (!response.ok && response.status !== 400) {
		// 400 = already invalid/revoked; anything else is a real failure.
		log(`Google revocation failed (${response.status}); keeping the entry.`);
		return 1;
	}

	await keychain.delete(serviceForAccount(target));
	const rawMeta = await keychain.get(SERVICE_META);
	if (rawMeta) {
		const meta = JSON.parse(rawMeta) as MetaRecord;
		if (meta.defaultAccount === target) await keychain.delete(SERVICE_META);
	}
	log(`Removed ${target} (token revoked with Google).`);
	return 0;
}

export async function main(
	argv: string[],
	keychain: KeychainStore = new SecurityCliKeychain(),
): Promise<number> {
	const [group, command, ...rest] = argv;
	if (group !== "auth" || !command) {
		process.stderr.write(USAGE);
		return group ? 1 : 0;
	}
	switch (command) {
		case "import":
			return authImport(keychain, rest[0]);
		case "login":
			return authLogin(keychain, rest);
		case "status":
			return authStatus(keychain);
		case "remove":
			return authRemove(keychain, rest[0]);
		default:
			process.stderr.write(USAGE);
			return 1;
	}
}

// Invoked directly (not imported by tests).
if (process.argv[1]?.endsWith("cli.js")) {
	main(process.argv.slice(2))
		.then((code) => {
			process.exitCode = code;
		})
		.catch((err) => {
			process.stderr.write(`error: ${err instanceof Error ? err.message : err}\n`);
			process.exitCode = 1;
		});
}
